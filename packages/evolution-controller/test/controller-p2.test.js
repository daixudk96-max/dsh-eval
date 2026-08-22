'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Registry } = require('../../preset-registry');
const { EvolutionController } = require('../lib/controller');

async function makeEnv(t, budget) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'evc-p2-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const registry = new Registry({ root: path.join(root, 'registry') });
  const controller = new EvolutionController({
    registry, auditDir: path.join(root, 'audit'),
    ...(budget ? { budget: { dir: path.join(root, 'budget'), limitUsd: budget } } : {}),
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

async function goodRun(controller, registry, opts = {}) {
  const seed = opts.src || await seedRevision(registry, 'coding', opts.srcFiles);
  const src = typeof seed === 'string' ? seed : seed.revisionId;
  const run = await controller.newRun({ source: 'coding', triggerEvaluationRunId: 'eval-x', selectedFailureClusters: ['c1'] });
  const candidateFiles = { 'preset.yml': (opts.files && opts.files['preset.yml']) || 'name: coding\noutput: v2\n' };
  const candidateId = await controller.createCandidate(run.id, {
    logicalId: 'coding', sourceRevisionId: src,
    hypothesis: opts.hypothesis || 'rewrite improves prompt adherence', evidence: opts.evidence || ['c1'],
    mutations: [{ kind: 'prompt', op: 'rewrite' }],
    readCandidateFiles: async () => candidateFiles,
  });
  // materialize the candidate content in staging (like a real caller writing files)
  const dir = path.join(registry.dirs.staging, candidateId);
  for (const [name, content] of Object.entries(candidateFiles)) {
    await fsp.writeFile(path.join(dir, name), content, 'utf8');
  }
  await controller.seal(run.id);
  const baseline = { overall: 0.6, correctness: 0.8, safety: 0.9, verification: 0.7 };
  await controller.evaluate(run.id, {
    baseline, candidate: { overall: 0.8, correctness: 0.85, safety: 0.9, verification: 0.75 },
  });
  return run;
}

test('controller: budget exhaustion blocks newRun (AC3)', async (t) => {
  const { registry, controller } = await makeEnv(t, 2);
  await controller.spendBudget('attempt', 2, { note: 'exhaust' });
  await assert.rejects(
    () => controller.newRun({ source: 'coding', triggerEvaluationRunId: 'ev-9' }),
    /evolution budget exhausted/,
  );
  const run = await controller.newRun({ source: 'coding2', triggerEvaluationRunId: 'ev-10' }).catch(() => null);
  assert.equal(run, null);
});

test('controller: budget ledger entries recorded via spendBudget (AC3)', async (t) => {
  const { controller } = await makeEnv(t, 10);
  await controller.spendBudget('proposal', 1.5, { runId: 'evr-x' });
  const spent = await controller.budget.spent();
  assert.equal(spent.proposal, 1.5);
  assert.equal(await controller.budget.remaining(), 8.5);
});

test('controller: promote rejects near-duplicate of a historical revision (AC4)', async (t) => {
  const { registry, controller } = await makeEnv(t);
  // history: v1 (content A) promoted → v2 (content B) promoted → current is v2
  await seedRevision(registry, 'coding', { 'preset.yml': 'name: coding\noutput: v1\n' });
  await seedRevision(registry, 'coding', { 'preset.yml': 'name: coding\noutput: v2\n' });
  // candidate content = A again (different from its source v2, so proposal-check passes)
  const current = await registry.resolveCurrent('coding');
  const run = await goodRun(controller, registry, { src: current.revisionId, files: { 'preset.yml': 'name: coding\noutput: v1\n' } });
  assert.equal(run.state, 'ACCEPTED');
  await assert.rejects(
    () => controller.promote(run.id, { logicalId: 'coding', approvalId: 'a1' }),
    /near-duplicate/,
  );
  // explicit opt-out allows the promote (caller takes responsibility)
  const res = await controller.promote(run.id, { logicalId: 'coding', approvalId: 'a1', nearDuplicateCheck: false });
  assert.equal(res.ok, true);
});

test('controller: promote allows genuinely new content', async (t) => {
  const { registry, controller } = await makeEnv(t);
  const src = await seedRevision(registry, 'coding', { 'preset.yml': 'name: coding\n' });
  const run = await goodRun(controller, registry, { src, files: { 'preset.yml': 'name: coding\noutput: v3\n' } });
  assert.equal(run.state, 'ACCEPTED');
  const res = await controller.promote(run.id, { logicalId: 'coding', approvalId: 'a1' });
  assert.equal(res.ok, true);
});

test('controller: proposal rejected when hypothesis/evidence missing (AC1)', async (t) => {
  const { registry, controller } = await makeEnv(t);
  const src = await seedRevision(registry);
  const run = await controller.newRun({ source: 'coding', triggerEvaluationRunId: 'ev-1' });
  await assert.rejects(
    () => controller.createCandidate(run.id, {
      logicalId: 'coding', sourceRevisionId: src,
      mutations: [{ kind: 'prompt', op: 'rewrite' }],
      readCandidateFiles: async () => ({ 'preset.yml': 'name: coding\noutput: v2\n' }),
    }),
    /proposal rejected/,
  );
});

test('controller: run tracks candidates with contentHash for dedup', async (t) => {
  const { registry, controller } = await makeEnv(t);
  const seed = await seedRevision(registry);
  const run = await controller.newRun({ source: 'coding', triggerEvaluationRunId: 'ev-2' });
  const candidateId = await controller.createCandidate(run.id, {
    logicalId: 'coding', sourceRevisionId: seed.revisionId,
    hypothesis: 'h1', evidence: ['c1'],
    mutations: [{ kind: 'prompt', op: 'rewrite' }],
    readCandidateFiles: async () => ({ 'preset.yml': 'name: coding\noutput: v2\n' }),
  });
  assert.equal(run.candidates.length, 1);
  assert.equal(run.candidates[0].candidateId, candidateId);
  assert.equal(typeof run.candidates[0].contentHash, 'string');
  assert.equal(run.candidates[0].contentHash.length, 64);
});
