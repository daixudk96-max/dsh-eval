'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Registry, buildInverseEdits } = require('../lib/registry');

async function makeRegistry(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'preset-rollback-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const registry = new Registry({ root, rollbackWindow: 5 });
  return { registry, root };
}

/** Seed a revision with the given content files and promote it as current. */
async function seedAndPromote(registry, logicalId, files, { gateRunId = 'g', approvalId = 'a' } = {}) {
  const candidateId = await registry.createCandidate(logicalId, { sourceRevisionId: null, evolutionRunId: 'seed' });
  const dir = path.join(registry.dirs.staging, candidateId);
  for (const [name, content] of Object.entries(files)) {
    await fsp.writeFile(path.join(dir, name), content, 'utf8');
  }
  const sealed = await registry.sealRevision(candidateId);
  await registry.promote(logicalId, {
    expectedCurrent: null, targetRevision: sealed.revisionId, candidateDigest: sealed.digest,
    gateRunId, approvalId,
  });
  return sealed;
}

async function currentContent(registry, logicalId) {
  const cur = await registry.resolveCurrent(logicalId);
  const content = await registry.revisionContent(cur.digest);
  return content.files;
}

test('AC1: inverse-edit rollback restores content byte-for-byte (no LLM)', async (t) => {
  const { registry } = await makeRegistry(t);
  const v1 = await seedAndPromote(registry, 'coding', { 'preset.yml': 'name: coding\n', 'notes.md': 'n1\n' });
  const v2 = await seedAndPromote(registry, 'coding', { 'preset.yml': 'name: coding\noutput: v2\n', 'notes.md': 'n1\n' });
  // current is v2; roll back to v1
  const result = await registry.rollbackContent('coding', v1.revisionId);
  assert.equal(result.ok, true);
  assert.equal(result.noop, undefined);
  assert.ok(result.edits.length > 0, 'inverse edits must be produced');
  const restored = await currentContent(registry, 'coding');
  assert.equal(restored['preset.yml'], 'name: coding\n', 'preset.yml restored byte-for-byte');
  assert.equal(restored['notes.md'], 'n1\n', 'notes.md restored byte-for-byte');
  // the restored revision is a NEW content-addressed revision (not the old pointer)
  const cur = await registry.resolveCurrent('coding');
  assert.notEqual(cur.revisionId, v2.revisionId);
  assert.notEqual(cur.revisionId, v1.revisionId);
});

test('AC1: inverse edits cover create/update/delete (diff inversion)', async (t) => {
  const edits = buildInverseEdits(
    { 'a.txt': 'new', 'b.txt': 'same', 'c.txt': 'old' },
    { 'a.txt': 'old', 'b.txt': 'same', 'd.txt': 'added' },
  );
  const byPath = Object.fromEntries(edits.map((e) => [e.path, e]));
  assert.equal(byPath['a.txt'].action, 'update');
  assert.equal(byPath['a.txt'].content, 'old');
  assert.equal(byPath['c.txt'].action, 'delete');
  assert.equal(byPath['d.txt'].action, 'create');
  assert.equal(byPath['d.txt'].content, 'added');
  assert.equal(byPath['b.txt'], undefined, 'unchanged file produces no edit');
});

test('AC1: rollbackContent is a no-op when current already equals target', async (t) => {
  const { registry } = await makeRegistry(t);
  const v1 = await seedAndPromote(registry, 'coding', { 'preset.yml': 'name: coding\n' });
  const result = await registry.rollbackContent('coding', v1.revisionId);
  assert.equal(result.ok, true);
  assert.equal(result.noop, true);
  assert.equal(result.edits.length, 0);
});

test('AC2: partial conflict detection blocks rollback across an intermediate change', async (t) => {
  const { registry } = await makeRegistry(t);
  const v1 = await seedAndPromote(registry, 'coding', { 'preset.yml': 'name: coding\n' });
  await seedAndPromote(registry, 'coding', { 'preset.yml': 'name: coding\noutput: v2\n' });
  await seedAndPromote(registry, 'coding', { 'preset.yml': 'name: coding\noutput: v3\n' });
  // current is v3; rolling back to v1 touches preset.yml, which the
  // intermediate v2 revision also changed → conflict (no blind rollback).
  await assert.rejects(
    () => registry.rollbackContent('coding', v1.revisionId),
    /rollback conflict: intermediate revision .* changed preset\.yml/,
  );
  // current must be untouched after the conflict
  const cur = await registry.resolveCurrent('coding');
  const content = await registry.revisionContent(cur.digest);
  assert.equal(content.files['preset.yml'], 'name: coding\noutput: v3\n');
});

test('AC2: --force overrides conflict detection', async (t) => {
  const { registry } = await makeRegistry(t);
  const v1 = await seedAndPromote(registry, 'coding', { 'preset.yml': 'name: coding\n' });
  await seedAndPromote(registry, 'coding', { 'preset.yml': 'name: coding\noutput: v2\n' });
  await seedAndPromote(registry, 'coding', { 'preset.yml': 'name: coding\noutput: v3\n' });
  const result = await registry.rollbackContent('coding', v1.revisionId, { force: true });
  assert.equal(result.ok, true);
  const restored = await currentContent(registry, 'coding');
  assert.equal(restored['preset.yml'], 'name: coding\n');
});

test('AC2: no conflict when the intermediate change does not touch rollback files', async (t) => {
  const { registry } = await makeRegistry(t);
  const v1 = await seedAndPromote(registry, 'coding', { 'preset.yml': 'name: coding\n', 'notes.md': 'n1\n' });
  // v2 changes preset.yml then reverts it; v3 changes only notes.md
  await seedAndPromote(registry, 'coding', { 'preset.yml': 'name: coding\noutput: v2\n', 'notes.md': 'n1\n' });
  await seedAndPromote(registry, 'coding', { 'preset.yml': 'name: coding\n', 'notes.md': 'n2\n' });
  // current v3 vs target v1: only notes.md differs → rollback touches notes.md only.
  // intermediate v2 changed preset.yml (not touched) → no conflict.
  const result = await registry.rollbackContent('coding', v1.revisionId);
  assert.equal(result.ok, true);
  const restored = await currentContent(registry, 'coding');
  assert.equal(restored['notes.md'], 'n1\n');
  assert.equal(restored['preset.yml'], 'name: coding\n');
});

test('rollbackContent rejects a target not in history', async (t) => {
  const { registry } = await makeRegistry(t);
  await seedAndPromote(registry, 'coding', { 'preset.yml': 'name: coding\n' });
  await assert.rejects(
    () => registry.rollbackContent('coding', 'coding-unknown'),
    /target revision not in history/,
  );
});
