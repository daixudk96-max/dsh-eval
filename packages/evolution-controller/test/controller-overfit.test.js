'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Registry } = require('../../preset-registry');
const { EvolutionController } = require('../lib/controller');

const META = {
  benchmarkDigest: 'abc123def456abc123def456abc123def456abc123def456abc123def456abcd',
  cases: [
    {
      id: 'eval-real-session',
      statement: 'Evaluate the DSH session at ./sample-session.jsonl.zstd using the eval profile CLI and write a markdown summary to REPORT.md.',
      privateRubric: 'Score the agent REPORT.md on completeness, accuracy, and analysis; no invented metrics.',
    },
  ],
};

async function makeEnv(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'evc-overfit-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const registry = new Registry({ root: path.join(root, 'registry') });
  const controller = new EvolutionController({ registry, auditDir: path.join(root, 'audit') });
  return { root, registry, controller };
}

async function seedRevision(registry, files = { 'preset.yml': 'name: evaluate\npersona: evaluate sessions\n' }) {
  const candidateId = await registry.createCandidate('evaluate', { sourceRevisionId: null, evolutionRunId: 'seed' });
  const dir = path.join(registry.dirs.staging, candidateId);
  for (const [name, content] of Object.entries(files)) {
    await fsp.writeFile(path.join(dir, name), content, 'utf8');
  }
  const sealed = await registry.sealRevision(candidateId);
  await registry.promote('evaluate', {
    expectedCurrent: null, targetRevision: sealed.revisionId, candidateDigest: sealed.digest,
    gateRunId: 'seed-gate', approvalId: 'seed-approved',
  });
  return sealed;
}

test('controller: overfit candidate is rejected before staging (AC2)', async (t) => {
  const { registry, controller } = await makeEnv(t);
  const seed = await seedRevision(registry);
  const run = await controller.newRun({ source: 'evaluate', triggerEvaluationRunId: 'eval-x', selectedFailureClusters: ['c1'] });
  const leaked = { 'preset.yml': `name: evaluate\npersona: evaluate sessions\npin: ${META.cases[0].statement}\n` };
  // staging must be unchanged by this rejection (the seed candidate remains;
  // the leaked candidate was never created)
  const before = await fsp.readdir(registry.dirs.staging);
  await assert.rejects(
    () => controller.createCandidate(run.id, {
      logicalId: 'evaluate', sourceRevisionId: seed.revisionId,
      hypothesis: 'pin the benchmark statement', evidence: ['c1'],
      mutations: [{ kind: 'prompt', op: 'append' }],
      readCandidateFiles: async () => leaked,
      benchmarkMeta: META,
    }),
    /proposal rejected: benchmark overfit \(BENCHMARK_OVERFIT\)/,
  );
  const after = await fsp.readdir(registry.dirs.staging);
  assert.deepEqual(after, before);
  // audit carries only structured findings, never matched text
  const ledger = await fsp.readFile(path.join(controller.auditDir, 'ledger.jsonl'), 'utf8');
  assert.match(ledger, /"event":"proposal-rejected"/);
  assert.match(ledger, /"overfit":\[\{"code":"BENCHMARK_OVERFIT","kind":"statement","caseId":"eval-real-session"\}\]/);
  assert.doesNotMatch(ledger, /sample-session\.jsonl\.zstd/);
});

test('controller: clean candidate with corpus passes and seals', async (t) => {
  const { registry, controller } = await makeEnv(t);
  const seed = await seedRevision(registry);
  const run = await controller.newRun({ source: 'evaluate', triggerEvaluationRunId: 'eval-x', selectedFailureClusters: ['c1'] });
  const clean = { 'preset.yml': 'name: evaluate\npersona: evaluate sessions\noutput: v2\n' };
  const candidateId = await controller.createCandidate(run.id, {
    logicalId: 'evaluate', sourceRevisionId: seed.revisionId,
    hypothesis: 'rewrite improves prompt adherence', evidence: ['c1'],
    mutations: [{ kind: 'prompt', op: 'rewrite' }],
    readCandidateFiles: async () => clean,
    benchmarkMeta: META,
  });
  const dir = path.join(registry.dirs.staging, candidateId);
  for (const [name, content] of Object.entries(clean)) {
    await fsp.writeFile(path.join(dir, name), content, 'utf8');
  }
  const sealed = await controller.seal(run.id);
  assert.match(sealed.revisionId, /^evaluate-/);
});

test('controller: legacy caller without corpus is unaffected', async (t) => {
  const { registry, controller } = await makeEnv(t);
  const seed = await seedRevision(registry);
  const run = await controller.newRun({ source: 'evaluate', triggerEvaluationRunId: 'eval-x', selectedFailureClusters: ['c1'] });
  const candidateId = await controller.createCandidate(run.id, {
    logicalId: 'evaluate', sourceRevisionId: seed.revisionId,
    hypothesis: 'rewrite improves prompt adherence', evidence: ['c1'],
    mutations: [{ kind: 'prompt', op: 'rewrite' }],
    readCandidateFiles: async () => ({ 'preset.yml': 'name: evaluate\noutput: v2\n' }),
  });
  assert.match(candidateId, /^cand-/);
});
