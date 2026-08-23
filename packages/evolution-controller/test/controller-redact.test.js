'use strict';
// controller-redact.test.js — createCandidate 的 hypothesis/evidence 脱敏后才入审计
// 运行: node test/controller-redact.test.js(单进程)
const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Registry } = require('../../preset-registry');
const { EvolutionController } = require('../lib/controller');

function makeEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-redact-'));
  const registry = new Registry({ root });
  const auditDir = path.join(root, 'audit');
  return { root, registry, auditDir };
}

async function seedRevision(registry, logicalId = 'evaluate') {
  const candidateId = await registry.createCandidate(logicalId, { sourceRevisionId: null, evolutionRunId: 'seed' });
  const dir = path.join(registry.dirs.staging, candidateId);
  await fsp.writeFile(path.join(dir, 'preset.yml'), 'name: evaluate\n', 'utf8');
  const sealed = await registry.sealRevision(candidateId);
  await registry.promote(logicalId, {
    expectedCurrent: null, targetRevision: sealed.revisionId, candidateDigest: sealed.digest,
    gateRunId: 'seed-gate', approvalId: 'seed-approved',
  });
  return sealed;
}

async function readAudit(auditDir) {
  return fs.readFileSync(path.join(auditDir, 'ledger.jsonl'), 'utf8');
}

test('evidence 含凭证/路径/session 时, 审计 ledger 只留脱敏文本', async () => {
  const { registry, auditDir } = makeEnv();
  const controller = new EvolutionController({
    registry, auditDir,
    redactValues: ['dai123456'],
  });
  const seed = await seedRevision(registry);
  const run = await controller.newRun({ source: 's', triggerEvaluationRunId: 'e1', selectedFailureClusters: [] });
  const secret = 'sk-abcdefghijklmnopqrstuvwxyz0123456789';
  const leaker = `run C:\\Users\\daixu\\AppData\\Local\\Temp\\x session-a1b2c3d4e5f60718293a4b5c6d7e8f90 token=dai123456`;
  const candidateId = await controller.createCandidate(run.id, {
    logicalId: 'evaluate',
    sourceRevisionId: seed.revisionId,
    hypothesis: `fix failures seen in ${leaker}`,
    evidence: ['cluster-a', leaker, secret],
    mutations: [{ kind: 'patch', path: 'agent.cordis.yml', op: 'append', from: 'a', to: 'b' }],
    readCandidateFiles: async () => ({ 'agent.cordis.yml': 'b\n' }),
  });
  assert.ok(candidateId);
  const audit = await readAudit(auditDir);
  assert.ok(!audit.includes(secret), 'openai key 不得残留');
  assert.ok(!audit.includes('dai123456'), '已知凭证值不得残留');
  assert.ok(!audit.includes('daixu'), '路径不得残留');
  assert.ok(!audit.includes('session-a1b2c3'), 'session id 不得残留');
  assert.ok(audit.includes('<redacted:'), 'ledger 应含脱敏占位');
  // run 对象内存态也是脱敏后的
  const stored = controller.getRun(run.id);
  assert.ok(!stored.hypothesis.includes('daixu'));
  assert.ok(stored.hypothesis.includes('<redacted:path>'));
  assert.ok(stored.evidence.every((e) => !e.includes('sk-abc')));
});

test('无已知值时仍按形状脱敏', async () => {
  const { registry, auditDir } = makeEnv();
  const controller = new EvolutionController({ registry, auditDir });
  const seed = await seedRevision(registry);
  const run = await controller.newRun({ source: 't', triggerEvaluationRunId: 'e' });
  const candidateId = await controller.createCandidate(run.id, {
    logicalId: 'evaluate',
    sourceRevisionId: seed.revisionId,
    hypothesis: 'h',
    evidence: ['Bearer abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'],
    mutations: [{ kind: 'patch', path: 'a.yml', op: 'append', to: 'x', from: 'y' }],
    readCandidateFiles: async () => ({ 'a.yml': 'x\n' }),
  });
  assert.ok(candidateId);
  const audit = await readAudit(auditDir);
  // ledger 只记 evidence 条数不记全文; run 对象的 evidence 必须是脱敏后文本
  assert.ok(!audit.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ'));
  const stored = controller.getRun(run.id);
  assert.equal(stored.evidence.length, 1);
  assert.ok(stored.evidence[0].includes('<redacted'), 'Bearer 形状应按形状脱敏');
});
