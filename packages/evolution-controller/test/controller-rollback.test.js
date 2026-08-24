'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Registry } = require('../../preset-registry');
const { EvolutionController } = require('../lib/controller');
const { readLedger } = require('../lib/fs-store');

async function makeEnv(t, opts = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'evc-rollback-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const registry = new Registry({ root: path.join(root, 'registry'), rollbackWindow: 5 });
  const controller = new EvolutionController({
    registry, auditDir: path.join(root, 'audit'),
    ...(opts.autoRollbackOnReject !== undefined ? { autoRollbackOnReject: opts.autoRollbackOnReject } : {}),
  });
  return { root, registry, controller };
}

async function seedRevision(registry, logicalId = 'coding', files = { 'preset.yml': 'name: coding\n' }) {
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

/** Create a candidate from `src` with the given content and evaluate it to REJECTED. */
async function rejectedRun(controller, registry, { src, files }) {
  const run = await controller.newRun({ source: 'coding', triggerEvaluationRunId: 'eval-x', selectedFailureClusters: ['c1'] });
  const candidateId = await controller.createCandidate(run.id, {
    logicalId: 'coding', sourceRevisionId: src,
    hypothesis: 'rewrite improves prompt adherence', evidence: ['c1'],
    mutations: [{ kind: 'prompt', op: 'rewrite' }],
    readCandidateFiles: async () => files,
  });
  const dir = path.join(registry.dirs.staging, candidateId);
  for (const [name, content] of Object.entries(files)) {
    await fsp.writeFile(path.join(dir, name), content, 'utf8');
  }
  await controller.seal(run.id);
  await controller.evaluate(run.id, {
    baseline: { overall: 0.9, correctness: 0.9, safety: 0.9, verification: 0.9 },
    candidate: { overall: 0.3, correctness: 0.3, safety: 0.9, verification: 0.3 },
  });
  assert.equal(run.state, 'REJECTED');
  return run;
}

async function currentContent(registry, logicalId) {
  const cur = await registry.resolveCurrent(logicalId);
  const content = await registry.revisionContent(cur.digest);
  return content.files;
}

test('autoRollbackOnReject prepares inverse edits and records intent, never auto-applies', async (t) => {
  const { root, registry, controller } = await makeEnv(t, { autoRollbackOnReject: true });
  const v1 = await seedRevision(registry, 'coding', { 'preset.yml': 'name: coding\n' });
  const run = await rejectedRun(controller, registry, { src: v1.revisionId, files: { 'preset.yml': 'name: coding\noutput: bad\n' } });
  // intent recorded on the run and in the audit ledger
  assert.ok(run.rollback, 'rollback intent must be prepared');
  assert.equal(run.rollback.target, v1.revisionId);
  const ledger = await readLedger(path.join(root, 'audit'));
  const prepared = ledger.find((e) => e.event === 'rollback-prepared');
  assert.ok(prepared, 'rollback-prepared audit entry must exist');
  assert.equal(prepared.target, v1.revisionId);
  // current is untouched (no auto-apply)
  const cur = await registry.resolveCurrent('coding');
  assert.equal(cur.revisionId, v1.revisionId);
});

test('autoRollbackOnReject is off by default', async (t) => {
  const { registry, controller } = await makeEnv(t);
  const v1 = await seedRevision(registry, 'coding', { 'preset.yml': 'name: coding\n' });
  const run = await rejectedRun(controller, registry, { src: v1.revisionId, files: { 'preset.yml': 'name: coding\noutput: bad\n' } });
  assert.equal(run.rollback, undefined, 'no rollback prepared when option is off');
});

test('applyRollback requires an explicit approval binding', async (t) => {
  const { registry, controller } = await makeEnv(t, { autoRollbackOnReject: true });
  const v1 = await seedRevision(registry, 'coding', { 'preset.yml': 'name: coding\n' });
  const run = await rejectedRun(controller, registry, { src: v1.revisionId, files: { 'preset.yml': 'name: coding\noutput: bad\n' } });
  await assert.rejects(
    () => controller.applyRollback(run.id, { logicalId: 'coding' }),
    /approvalId is required/,
  );
});

test('applyRollback restores current content to the source revision', async (t) => {
  const { root, registry, controller } = await makeEnv(t, { autoRollbackOnReject: true });
  // current drifts to v2; candidate is created from v1 (source)
  const v1 = await seedRevision(registry, 'coding', { 'preset.yml': 'name: coding\n' });
  await seedRevision(registry, 'coding', { 'preset.yml': 'name: coding\noutput: v2\n' });
  const run = await rejectedRun(controller, registry, { src: v1.revisionId, files: { 'preset.yml': 'name: coding\noutput: bad\n' } });
  assert.ok(run.rollback.edits.length > 0, 'inverse edits must be non-trivial (current != source)');
  const result = await controller.applyRollback(run.id, { logicalId: 'coding', approvalId: 'a-rollback' });
  assert.equal(result.ok, true);
  const restored = await currentContent(registry, 'coding');
  assert.equal(restored['preset.yml'], 'name: coding\n', 'content restored to source byte-for-byte');
  const ledger = await readLedger(path.join(root, 'audit'));
  const applied = ledger.find((e) => e.event === 'rollback-applied');
  assert.ok(applied, 'rollback-applied audit entry must exist');
  assert.equal(applied.approvalId, 'a-rollback');
});
