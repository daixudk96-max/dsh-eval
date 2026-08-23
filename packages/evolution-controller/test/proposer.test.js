'use strict';
// proposer.test.js — LLM proposer: 失败证据→假设+变异; 门槛校验; redact 生效
// 运行: node test/proposer.test.js(单进程)
const test = require('node:test');
const assert = require('node:assert/strict');
const { propose, failureEvidence, parseJsonLoose } = require('../lib/proposer.js');

const BASELINE = { 'preset.yml': 'name: evaluate\n', 'agent.cordis.yml': 'persona: ...\n' };

function fakeLLM(reply) {
  return {
    complete: async () => reply,
    calls: 0,
  };
}

function runResult() {
  return {
    benchmark: 'fix-multiply-short', model: 'deepseek-v4-flash', provider: 'clipa',
    cases: [
      { caseId: 'fix-multiply', status: 'completed', exitCode: 1,
        metrics: { steps: 3 }, grade: { taskSuccess: false } },
    ],
    grading: { taskSuccessRate: 0 },
  };
}

test('propose: 正常路径返回 hypothesis/evidence/mutations/candidateFiles', async () => {
  const llm = fakeLLM(JSON.stringify({
    hypothesis: 'persona lacks explicit test loop instruction; add it',
    evidence: ['case fix-multiply: task failed (exit 1)'],
    mutations: [{ file: 'agent.cordis.yml', op: 'append', summary: 'add test loop line' }],
    files: { 'agent.cordis.yml': 'persona: ...\n- run tests until PASS\n' },
  }));
  const out = await propose({ runJson: runResult(), baselineFiles: BASELINE, logicalId: 'evaluate', llm });
  assert.equal(out.ok, true);
  assert.match(out.hypothesis, /test loop/);
  assert.ok(out.evidence.length > 0);
  assert.equal(out.candidateFiles['agent.cordis.yml'], 'persona: ...\n- run tests until PASS\n');
  assert.equal(out.mutations[0].file, 'agent.cordis.yml');
});

test('propose: 无失败 case → 拒绝(不生成)', async () => {
  const llm = fakeLLM('unused');
  const result = await propose({
    runJson: { cases: [{ caseId: 'a', grade: { taskSuccess: true } }] },
    baselineFiles: BASELINE, logicalId: 'evaluate', llm,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no failed cases/);
});

test('propose: 非 JSON 回复 → 拒绝(不伪造)', async () => {
  const llm = fakeLLM('sorry, I cannot do that');
  const result = await propose({ runJson: runResult(), baselineFiles: BASELINE, logicalId: 'evaluate', llm });
  assert.equal(result.ok, false);
  assert.match(result.reason, /non-JSON/);
});

test('propose: LLM 调用失败 → 拒绝', async () => {
  const llm = { complete: async () => { throw new Error('connection refused'); } };
  const result = await propose({ runJson: runResult(), baselineFiles: BASELINE, logicalId: 'evaluate', llm });
  assert.equal(result.ok, false);
  assert.match(result.reason, /llm call failed/);
});

test('propose: 空 hypothesis 或空 files → 拒绝', async () => {
  const emptyHypo = await propose({
    runJson: runResult(), baselineFiles: BASELINE, logicalId: 'evaluate',
    llm: fakeLLM(JSON.stringify({ hypothesis: '', evidence: [], files: { 'a.yml': 'x' } })),
  });
  assert.equal(emptyHypo.ok, false);
  const emptyFiles = await propose({
    runJson: runResult(), baselineFiles: BASELINE, logicalId: 'evaluate',
    llm: fakeLLM(JSON.stringify({ hypothesis: 'h', files: {} })),
  });
  assert.equal(emptyFiles.ok, false);
  assert.match(emptyFiles.reason, /no changed files/);
});

test('propose: evidence/失败文本先 redact(凭证不泄漏)', async () => {
  const runWithLeak = {
    cases: [
      { caseId: 'fix-multiply', status: 'completed', exitCode: 1,
        error: 'auth failed with sk-abcdefghijklmnopqrstuvwxyz012345 and token=dai123456' },
    ],
  };
  const llm = fakeLLM(JSON.stringify({
    hypothesis: 'h', evidence: ['sk-abcdefghijklmnopqrstuvwxyz012345 dai123456'],
    mutations: [], files: { 'a.yml': 'x' },
  }));
  const result = await propose({ runJson: runWithLeak, baselineFiles: BASELINE, logicalId: 'evaluate', llm, redactValues: ['dai123456'] });
  assert.equal(result.ok, true);
  assert.ok(!result.evidence.join(' ').includes('sk-abcdefghijklmnopqrstuvwxyz012345'));
  assert.ok(!result.evidence.join(' ').includes('dai123456'));
  assert.ok(result.evidence.join(' ').includes('<redacted'));
});

test('failureEvidence: 提取失败 case 摘要', () => {
  const lines = failureEvidence(runResult());
  assert.equal(lines.length, 1);
  assert.match(lines[0], /case fix-multiply/);
  assert.match(lines[0], /exit=1/);
});

test('parseJsonLoose: 处理围栏/前缀文本', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('here is the result {"a":2} thanks'), { a: 2 });
  assert.equal(parseJsonLoose('no json here'), null);
});
