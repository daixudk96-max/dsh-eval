'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Registry } = require('../../preset-registry');
const { EvolutionController } = require('../lib/controller');
const { readLedger } = require('../lib/fs-store');

async function makeEnv(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'evc-rubric-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const registry = new Registry({ root: path.join(root, 'registry') });
  const controller = new EvolutionController({ registry, auditDir: path.join(root, 'audit') });
  return { root, registry, controller };
}

test('controller: evaluate passes rubric into gate and audit ledger', async (t) => {
  const { controller, root } = await makeEnv(t);
  const run = await controller.newRun({ source: 'coding', triggerEvaluationRunId: 'eval-1' });
  await controller.createCandidate(run.id, { logicalId: 'coding', sourceRevisionId: 'src-1' });
  await controller.seal(run.id);
  const baseline = { overall: 0.6, correctness: 0.8, safety: 0.9, verification: 0.7 };
  const candidate = { overall: 0.8, correctness: 0.85, safety: 0.9, verification: 0.75 };
  await controller.evaluate(run.id, {
    baseline,
    candidate,
    rubric: { score: 82, minScore: 60, regressions: [] },
  });
  assert.equal(run.state, 'ACCEPTED');
  assert.equal(run.rubric.score, 82);
  assert.equal(run.gateResult.rubricScore, 82);

  // audit ledger carries the rubric evidence
  const ledger = await readLedger(path.join(root, 'audit'));
  const gateEvent = ledger.find((e) => e.event === 'gate');
  assert.ok(gateEvent, 'gate event exists');
  assert.equal(gateEvent.rubric.score, 82);
  assert.equal(gateEvent.rubric.minScore, 60);
  assert.deepEqual(gateEvent.rubric.regressions, []);
});

test('controller: rubric score below min rejects the run', async (t) => {
  const { controller } = await makeEnv(t);
  const run = await controller.newRun({ source: 'coding', triggerEvaluationRunId: 'eval-2' });
  await controller.createCandidate(run.id, { logicalId: 'coding', sourceRevisionId: 'src-1' });
  await controller.seal(run.id);
  const baseline = { overall: 0.6, correctness: 0.8, safety: 0.9, verification: 0.7 };
  const candidate = { overall: 0.8, correctness: 0.85, safety: 0.9, verification: 0.75 };
  await controller.evaluate(run.id, {
    baseline,
    candidate,
    rubric: { score: 40, minScore: 60, regressions: [] },
  });
  assert.equal(run.state, 'REJECTED');
  assert.match(run.gateResult.reason, /rubric score 40 < min 60/);
  await assert.rejects(
    () => controller.promote(run.id, { logicalId: 'coding', approvalId: 'a' }),
    /cannot promote run in state REJECTED/,
  );
});
