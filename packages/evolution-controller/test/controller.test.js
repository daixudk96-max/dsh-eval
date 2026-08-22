'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Registry } = require('../../preset-registry');
const { EvolutionController } = require('../lib/controller');
const { evaluateGate } = require('../lib/gate');
const { canTransition, assertTransition } = require('../lib/state-machine');
const { readLedger } = require('../lib/fs-store');

async function makeEnv(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'evc-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const registry = new Registry({ root: path.join(root, 'registry') });
  const controller = new EvolutionController({ registry, auditDir: path.join(root, 'audit') });
  return { root, registry, controller };
}

/** Create + seal + promote a real source revision (proposal-check requires an existing source). */
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
  return sealed.revisionId;
}

const GOOD_FILES = { 'preset.yml': 'name: coding\noutput: v2\n' };
const candidateFiles = () => GOOD_FILES;

test('state machine: valid + invalid transitions', () => {
  assert.ok(canTransition('DRAFT', 'SEALED'));
  assert.ok(canTransition('SEALED', 'EVALUATING'));
  assert.ok(canTransition('EVALUATING', 'ACCEPTED'));
  assert.ok(canTransition('EVALUATING', 'INCONCLUSIVE'));
  assert.ok(canTransition('INCONCLUSIVE', 'EVALUATING'));
  assert.ok(canTransition('ACCEPTED', 'PROMOTED'));
  assert.throws(() => assertTransition('DRAFT', 'PROMOTED'), /invalid transition/);
  assert.throws(() => assertTransition('PROMOTED', 'EVALUATING'), /invalid transition/);
});

test('gate: four decisions', () => {
  const base = { overall: 0.6, correctness: 0.8, safety: 0.9, verification: 0.7 };
  // PASS
  assert.equal(evaluateGate({ baseline: base, candidate: { ...base, overall: 0.8 }, digestOk: true, epochSame: true }).decision, 'PASS');
  // FAIL (regression)
  assert.equal(evaluateGate({ baseline: base, candidate: { overall: 0.8, correctness: 0.5, safety: 0.9, verification: 0.7 } }).decision, 'FAIL');
  // FAIL (regression wins over minEffect even with negative gain)
  assert.equal(evaluateGate({
    baseline: base,
    candidate: { overall: 0.4, correctness: 0.5, safety: 0.9, verification: 0.6 },
    minEffect: 0.05,
  }).decision, 'FAIL');
  // INCONCLUSIVE (gain <= minEffect)
  assert.equal(evaluateGate({ baseline: base, candidate: { ...base, overall: 0.62 }, minEffect: 0.05 }).decision, 'INCONCLUSIVE');
  // INVALID (digest mismatch)
  assert.equal(evaluateGate({ baseline: base, candidate: { ...base, overall: 0.8 }, digestOk: false }).decision, 'INVALID');
  // FAIL (critical failures / canary / holdout)
  assert.equal(evaluateGate({ baseline: base, candidate: { ...base, overall: 0.8 }, criticalFailures: 1 }).decision, 'FAIL');
  assert.equal(evaluateGate({ baseline: base, candidate: { ...base, overall: 0.8 }, canary: { passed: false } }).decision, 'FAIL');
  assert.equal(evaluateGate({ baseline: base, candidate: { ...base, overall: 0.8 }, holdout: { passed: false } }).decision, 'FAIL');
});

test('controller: full happy path creates candidate, seals, gates PASS, promotes with approval', async (t) => {
  const { registry, controller } = await makeEnv(t);
  const src = await seedRevision(registry);
  const run = await controller.newRun({ source: 'coding', triggerEvaluationRunId: 'eval-1', selectedFailureClusters: ['c1'] });
  await controller.createCandidate(run.id, {
    logicalId: 'coding', sourceRevisionId: src,
    hypothesis: 'rewrite improves prompt adherence', evidence: ['c1'],
    mutations: [{ kind: 'prompt', op: 'rewrite' }], readCandidateFiles: candidateFiles,
  });
  const sealed = await controller.seal(run.id);
  assert.equal(run.state, 'SEALED');
  const baseline = { overall: 0.6, correctness: 0.8, safety: 0.9, verification: 0.7 };
  const candidate = { overall: 0.8, correctness: 0.85, safety: 0.9, verification: 0.75 };
  await controller.evaluate(run.id, { baseline, candidate });
  assert.equal(run.state, 'ACCEPTED');
  const result = await controller.promote(run.id, { logicalId: 'coding', approvalId: 'approve-1' });
  assert.equal(result.revisionId, sealed.revisionId);
  assert.equal(run.state, 'PROMOTED');
  const current = await controller.registry.resolveCurrent('coding');
  assert.equal(current.revisionId, sealed.revisionId);
});

test('controller: INCONCLUSIVE is not promotable and can resample', async (t) => {
  const { registry, controller } = await makeEnv(t);
  const src = await seedRevision(registry);
  const run = await controller.newRun({ source: 'coding', triggerEvaluationRunId: 'eval-2' });
  await controller.createCandidate(run.id, {
    logicalId: 'coding', sourceRevisionId: src,
    hypothesis: 'slightly better prompt', evidence: ['c1'],
    mutations: [{ kind: 'prompt', op: 'rewrite' }], readCandidateFiles: candidateFiles,
  });
  await controller.seal(run.id);
  const baseline = { overall: 0.6, correctness: 0.8, safety: 0.9, verification: 0.7 };
  await controller.evaluate(run.id, { baseline, candidate: { overall: 0.62, correctness: 0.8, safety: 0.9, verification: 0.7 }, gateOverrides: { minEffect: 0.05 } });
  assert.equal(run.state, 'INCONCLUSIVE');
  await assert.rejects(() => controller.promote(run.id, { logicalId: 'coding', approvalId: 'a' }), /cannot promote/);
  await controller.resample(run.id);
  assert.equal(run.state, 'EVALUATING');
});

test('controller: promote requires ACCEPTED state and approvalId', async (t) => {
  const { registry, controller } = await makeEnv(t);
  const src = await seedRevision(registry);
  const run = await controller.newRun({ source: 'coding', triggerEvaluationRunId: 'eval-3' });
  await controller.createCandidate(run.id, {
    logicalId: 'coding', sourceRevisionId: src,
    hypothesis: 'rewrite A', evidence: ['c1'],
    mutations: [{ kind: 'prompt', op: 'rewrite' }], readCandidateFiles: candidateFiles,
  });
  await controller.seal(run.id);
  // SEALED (not evaluated) is not promotable
  await assert.rejects(() => controller.promote(run.id, { logicalId: 'coding', approvalId: 'a' }), /cannot promote/);
  // FAIL decision → REJECTED, not promotable
  const baseline = { overall: 0.6, correctness: 0.8, safety: 0.9, verification: 0.7 };
  await controller.evaluate(run.id, { baseline, candidate: { overall: 0.8, correctness: 0.4, safety: 0.9, verification: 0.7 } });
  assert.equal(run.state, 'REJECTED');
  await assert.rejects(() => controller.promote(run.id, { logicalId: 'coding', approvalId: 'a' }), /cannot promote/);
  // ACCEPTED without approvalId must be rejected
  const run2 = await controller.newRun({ source: 'coding', triggerEvaluationRunId: 'eval-3b' });
  await controller.createCandidate(run2.id, {
    logicalId: 'coding', sourceRevisionId: src,
    hypothesis: 'rewrite prompt again', evidence: ['c1'],
    mutations: [{ kind: 'prompt', op: 'rewrite' }], readCandidateFiles: candidateFiles,
  });
  await controller.seal(run2.id);
  await controller.evaluate(run2.id, { baseline, candidate: { overall: 0.8, correctness: 0.85, safety: 0.9, verification: 0.75 } });
  assert.equal(run2.state, 'ACCEPTED');
  await assert.rejects(() => controller.promote(run2.id, { logicalId: 'coding', approvalId: null }), /approvalId is required/);
});

test('controller: every decision is audited append-only', async (t) => {
  const { registry, controller, root } = await makeEnv(t);
  const src = await seedRevision(registry);
  const run = await controller.newRun({ source: 'coding', triggerEvaluationRunId: 'eval-4' });
  await controller.createCandidate(run.id, {
    logicalId: 'coding', sourceRevisionId: src,
    hypothesis: 'audited rewrite', evidence: ['c1'],
    mutations: [{ kind: 'prompt', op: 'rewrite' }], readCandidateFiles: candidateFiles,
  });
  await controller.seal(run.id);
  const baseline = { overall: 0.6, correctness: 0.8, safety: 0.9, verification: 0.7 };
  await controller.evaluate(run.id, { baseline, candidate: { overall: 0.8, correctness: 0.85, safety: 0.9, verification: 0.75 } });
  await controller.promote(run.id, { logicalId: 'coding', approvalId: 'a1' });
  const ledger = await readLedger(path.join(root, 'audit'));
  const events = ledger.map((e) => e.event);
  assert.ok(events.includes('created'));
  assert.ok(events.includes('candidate-created'));
  assert.ok(events.includes('sealed'));
  assert.ok(events.includes('gate'));
  assert.ok(events.includes('promoted'));
});

test('controller: CAS protection — stale expectedCurrent is rejected at registry level', async (t) => {
  const { registry, controller } = await makeEnv(t);
  const src = await seedRevision(registry);
  const run = await controller.newRun({ source: 'coding', triggerEvaluationRunId: 'eval-5' });
  await controller.createCandidate(run.id, {
    logicalId: 'coding', sourceRevisionId: src,
    hypothesis: 'CAS rewrite', evidence: ['c1'],
    mutations: [{ kind: 'prompt', op: 'rewrite' }], readCandidateFiles: candidateFiles,
  });
  await controller.seal(run.id);
  const baseline = { overall: 0.6, correctness: 0.8, safety: 0.9, verification: 0.7 };
  await controller.evaluate(run.id, { baseline, candidate: { overall: 0.8, correctness: 0.85, safety: 0.9, verification: 0.75 } });
  // missing approval must not promote
  await assert.rejects(() => controller.promote(run.id, { logicalId: 'coding' }), /approvalId/);
  await controller.promote(run.id, { logicalId: 'coding', approvalId: 'ok' });
  const current = await controller.registry.resolveCurrent('coding');
  assert.ok(current);
  // a stale expectedCurrent (e.g. another writer's view) must be rejected by the registry CAS
  const stale = { revisionId: 'someone-elses-view', digest: '0'.repeat(64) };
  await assert.rejects(
    () => controller.registry.promote('coding', {
      expectedCurrent: stale,
      targetRevision: current.revisionId,
      candidateDigest: current.digest,
      gateRunId: 'g',
      approvalId: 'a',
    }),
    /CAS failed/,
    'promote with a stale expectedCurrent must fail instead of overwriting',
  );
});
