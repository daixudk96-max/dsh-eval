'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Registry } = require('../../preset-registry');
const {
  StateStore,
  logicalIdFor,
  parseLogicalId,
  isStateLogicalId,
  parseEntryRecord,
  ENTRY_FILE,
} = require('../lib/state-store');

const NOW = '2026-08-23T12:00:00.000Z';

function makeEnv(t) {
  const root = null;
  const tmp = { value: null };
  const fixture = {
    async init() {
      tmp.value = await fsp.mkdtemp(path.join(os.tmpdir(), 'evc-state-'));
      t.after(() => fsp.rm(tmp.value, { recursive: true, force: true }));
      const registry = new Registry({ root: path.join(tmp.value, 'registry') });
      const store = new StateStore({ registry, now: () => new Date(NOW) });
      return { root: tmp.value, registry, store };
    },
  };
  return fixture;
}

/** Seed a plain (non-state) preset to prove backward compatibility. */
async function seedPlain(registry, logicalId = 'coding', files = { 'preset.yml': 'name: coding\n' }) {
  const candidateId = await registry.createCandidate(logicalId, { sourceRevisionId: null, evolutionRunId: 'seed' });
  const dir = path.join(registry.dirs.staging, candidateId);
  for (const [name, content] of Object.entries(files)) {
    await fsp.writeFile(path.join(dir, name), content, 'utf8');
  }
  const sealed = await registry.sealRevision(candidateId);
  await registry.promote(logicalId, {
    expectedCurrent: null, targetRevision: sealed.revisionId, candidateDigest: sealed.digest,
    gateRunId: 'seed-gate', approvalId: 'seed-approved',
  });
  return sealed;
}

test('logicalId mapping: round-trips and validates states', () => {
  assert.equal(logicalIdFor('prompt', 'style'), 'state:prompt:style');
  assert.equal(logicalIdFor('memory', 'decision-1'), 'state:memory:decision-1');
  assert.equal(logicalIdFor('skill', 'review-pr'), 'state:skill:review-pr');
  assert.equal(logicalIdFor('subagent-spec', 'audit'), 'state:subagent-spec:audit');
  assert.deepEqual(parseLogicalId('state:prompt:style'), { kind: 'prompt', id: 'style' });
  assert.equal(isStateLogicalId('state:prompt:style'), true);
  assert.equal(isStateLogicalId('state:prompt:x:y:z-1'), true);
  assert.equal(isStateLogicalId('coding'), false);
  assert.equal(isStateLogicalId('state:widget:foo'), false); // unknown kind
  assert.throws(() => logicalIdFor('widget', 'x'), /unknown state kind/);
  assert.throws(() => logicalIdFor('prompt', ''), /non-empty/);
  assert.throws(() => logicalIdFor('prompt', 'a:b'), /must not contain/);
});

test('parseEntryRecord rejects corrupt records', () => {
  assert.throws(() => parseEntryRecord('{nope'), /corrupt state entry/);
  assert.throws(() => parseEntryRecord('{"id":"x","kind":"prompt"}'), /version/);
  assert.throws(() => parseEntryRecord('{"id":"x","kind":"prompt","version":-1,"content":"","updatedAt":"t"}'), /version/);
  assert.throws(() => parseEntryRecord('{"id":"x","kind":"prompt","version":1,"content":5,"updatedAt":"t"}'), /content/);
});

test('state-store: all four kinds version independently', async (t) => {
  const { store } = await makeEnv(t).init();
  const fixtures = {
    prompt: 'Keep answers concise.',
    memory: 'User prefers Python.',
    skill: 'steps...',
    'subagent-spec': 'delegation contract',
  };
  for (const [kind, content] of Object.entries(fixtures)) {
    const first = await store.write(kind, 'k1', content);
    assert.equal(first.kind, kind);
    assert.equal(first.version, 1);
    assert.equal(first.id, 'k1');
    assert.equal(first.content, content);
    assert.equal(first.updatedAt, NOW);
    const second = await store.write(kind, 'k1', `${content} (v2)`);
    assert.equal(second.version, 2);
    const read = await store.read(kind, 'k1');
    assert.equal(read.content, `${content} (v2)`);
    assert.equal(read.version, 2);
    assert.equal(read.logicalId, `state:${kind}:k1`);
    assert.ok(read.revisionId.startsWith(`state:${kind}:k1-`));
  }
});

test('state-store: read of a missing entry is null', async (t) => {
  const { store } = await makeEnv(t).init();
  assert.equal(await store.read('prompt', 'missing'), null);
});

test('state-store: write maintains per-id version history', async (t) => {
  const { store } = await makeEnv(t).init();
  await store.write('memory', 'facts', 'a');
  await store.write('memory', 'facts', 'b');
  await store.write('memory', 'facts', 'c');
  const versions = await store.versions('memory', 'facts');
  assert.equal(versions.length, 3);
  assert.deepEqual(versions.map((v) => v.version), [1, 2, 3]);
  assert.deepEqual(versions.map((v) => v.content), ['a', 'b', 'c']);
  assert.equal(versions[0].status, 'previous');
  assert.equal(versions[2].status, 'active');
  // history is per id: a sibling id is untouched
  assert.equal((await store.versions('memory', 'other')).length, 0);
});

test('state-store: rollback to the immediate previous version needs no force', async (t) => {
  const { store } = await makeEnv(t).init();
  await store.write('skill', 'review', 'v1 content');
  await store.write('skill', 'review', 'v2 content');
  await store.write('skill', 'review', 'v3 content');
  const v2rev = (await store.versions('skill', 'review')).find((v) => v.version === 2);
  const rolled = await store.rollback('skill', 'review', v2rev.revisionId);
  assert.ok(rolled.revisionId);
  const read = await store.read('skill', 'review');
  assert.equal(read.content, 'v2 content');
  assert.equal(read.version, 2); // restored record keeps its version
});

test('state-store: deep rollback across intermediate versions requires force', async (t) => {
  const { store } = await makeEnv(t).init();
  await store.write('skill', 'review', 'v1 content');
  await store.write('skill', 'review', 'v2 content');
  await store.write('skill', 'review', 'v3 content');
  const v1rev = (await store.versions('skill', 'review')).find((v) => v.version === 1);
  // intermediate revision (v2) changed entry.json -> conflict detection fires
  await assert.rejects(() => store.rollback('skill', 'review', v1rev.revisionId), /conflict/);
  const forced = await store.rollback('skill', 'review', v1rev.revisionId, { force: true });
  assert.ok(forced.revisionId);
  assert.equal((await store.read('skill', 'review')).content, 'v1 content');
  // unknown revision id is still rejected
  await assert.rejects(
    () => store.rollback('skill', 'review', 'state:skill:review-00000000'),
    /no revision/,
  );
});

test('state-store: CAS expectedCurrent rejects a stale overwrite', async (t) => {
  const { store } = await makeEnv(t).init();
  await store.write('prompt', 'cas', 'v1');
  await assert.rejects(() => store.write('prompt', 'cas', 'v2', { expectedCurrent: null }), /conflict/);
  const current = await store.read('prompt', 'cas');
  const wrote = await store.write('prompt', 'cas', 'v2', { expectedCurrent: { revisionId: current.revisionId, digest: current.digest } });
  assert.equal(wrote.version, 2);
});

test('state-store: list narrows by kind and covers all entries', async (t) => {
  const { store } = await makeEnv(t).init();
  await store.write('prompt', 'a', 'pa');
  await store.write('prompt', 'b', 'pb');
  await store.write('memory', 'c', 'mc');
  const prompts = await store.list('prompt');
  assert.deepEqual(prompts.map((e) => e.id), ['a', 'b']);
  const all = await store.list();
  assert.equal(all.length, 3);
  assert.deepEqual(all.map((e) => `${e.kind}:${e.id}`), ['memory:c', 'prompt:a', 'prompt:b']);
});

test('registry backward compatibility: plain ids keep plain file names', async (t) => {
  const { registry, root } = await makeEnv(t).init();
  const sealed = await seedPlain(registry, 'coding');
  const current = await registry.resolveCurrent('coding');
  assert.equal(current.revisionId, sealed.revisionId);
  // logical file for a plain id must remain un-encoded ('coding.json')
  const logicalNames = await fsp.readdir(path.join(root, 'registry', 'logical'));
  assert.ok(logicalNames.includes('coding.json'));
  assert.ok(!logicalNames.includes('coding.json.json'));
});

test('state-store persists through the registry with Windows-safe file names', async (t) => {
  const { registry, store, root } = await makeEnv(t).init();
  await store.write('prompt', 'style', 'keep it short');
  // the on-disk pointer/logical names are percent-encoded (colon is illegal on Windows)
  const logicalNames = await fsp.readdir(path.join(root, 'registry', 'logical'));
  assert.ok(logicalNames.includes('state%3Aprompt%3Astyle.json'), 'encoded logical file name');
  assert.ok(!logicalNames.some((n) => n.includes(':')), 'no raw colon file names on disk');
  // ...yet the stored logicalId is verbatim inside the JSON
  const raw = JSON.parse(await fsp.readFile(path.join(root, 'registry', 'logical', 'state%3Aprompt%3Astyle.json'), 'utf8'));
  assert.equal(raw.current.revisionId.startsWith('state:prompt:style-'), true);
  // and the entry record lives at the expected revision content file
  const current = await registry.resolveCurrent('state:prompt:style');
  const content = await registry.revisionContent(current.digest);
  assert.ok(ENTRY_FILE in content.files);
  const record = JSON.parse(content.files[ENTRY_FILE]);
  assert.equal(record.id, 'style');
  assert.equal(record.version, 1);
});