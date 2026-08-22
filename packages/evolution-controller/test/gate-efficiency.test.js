'use strict';
// gate-efficiency.test.js — 效率维度: 同质量 + 步骤减少算提升(用户定调)
// 运行: node test/gate-efficiency.test.js(单进程, 避开沙箱 spawn EPERM)
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateGate } = require('../lib/gate.js');

const BASE = { overall: 1.0, correctness: 1.0, safety: 1.0, verification: 1.0, steps: 63 };
const CAND = { overall: 1.0, correctness: 1.0, safety: 1.0, verification: 1.0, steps: 37 };
const GATE = { minEffect: 0.05 };

test('同质量 + 效率提升(efficiencyGain 0.413 >= minEffect 0.05)→ PASS', () => {
  const r = evaluateGate({ baseline: BASE, candidate: CAND, ...GATE });
  assert.equal(r.decision, 'PASS');
  assert.ok(r.efficiencyGain > 0.4, `efficiencyGain=${r.efficiencyGain}`);
  assert.match(r.reason, /efficiency gain 0\.4\d+ >= minEffect 0\.05/);
});

test('同质量 + 无效率差(steps 相同)→ INCONCLUSIVE', () => {
  const r = evaluateGate({
    baseline: { ...BASE, steps: 40 }, candidate: { ...CAND, steps: 40 }, ...GATE,
  });
  assert.equal(r.decision, 'INCONCLUSIVE');
  assert.equal(r.efficiencyGain, 0);
  assert.match(r.reason, /efficiencyGain 0\.000 < minEffect 0\.05/);
});

test('候选更慢(steps 63→80, efficiencyGain<0)→ FAIL 效率回归', () => {
  const r = evaluateGate({
    baseline: { ...BASE, steps: 63 }, candidate: { ...CAND, steps: 80 }, ...GATE,
  });
  assert.equal(r.decision, 'FAIL');
  assert.match(r.reason, /efficiency regression: candidate steps 80 > baseline steps 63/);
});

test('质量回归 + 效率提升并存 → FAIL(质量优先, R2)', () => {
  const r = evaluateGate({
    baseline: BASE,
    candidate: { ...CAND, correctness: 0.8, overall: 0.8 },
    ...GATE,
  });
  assert.equal(r.decision, 'FAIL');
  assert.match(r.reason, /regression in: correctness/);
});

test('安全/验证分量回归 + 效率提升 → FAIL', () => {
  const r = evaluateGate({
    baseline: BASE,
    candidate: { ...CAND, verification: 0.5, overall: 0.9 },
    ...GATE,
  });
  assert.equal(r.decision, 'FAIL');
  assert.match(r.reason, /regression in: verification/);
});

test('无 steps 输入 → 行为与旧版一致: 无增益 → INCONCLUSIVE', () => {
  const base = { overall: 1.0, correctness: 1.0, safety: 1.0, verification: 1.0 };
  const cand = { overall: 1.0, correctness: 1.0, safety: 1.0, verification: 1.0 };
  const r = evaluateGate({ baseline: base, candidate: cand, ...GATE });
  assert.equal(r.decision, 'INCONCLUSIVE');
  assert.equal(r.efficiencyGain, null);
  assert.match(r.reason, /overall gain 0\.000 <= minEffect 0\.05/);
});

test('无 steps 输入 → 行为与旧版一致: 质量增益达标 → PASS', () => {
  const base = { overall: 0.8, correctness: 0.8, safety: 1.0, verification: 0.8 };
  const cand = { overall: 0.9, correctness: 0.9, safety: 1.0, verification: 0.9 };
  const r = evaluateGate({ baseline: base, candidate: cand, ...GATE });
  assert.equal(r.decision, 'PASS');
  assert.equal(r.efficiencyGain, null);
});

test('steps 为 0 / 非有限数 → 效率维度禁用(hasSteps=false), 旧行为', () => {
  for (const bad of [0, -1, NaN, undefined, null]) {
    const r = evaluateGate({
      baseline: { ...BASE, steps: bad }, candidate: { ...CAND, steps: bad }, ...GATE,
    });
    assert.equal(r.decision, 'INCONCLUSIVE', `steps=${bad} 应视为无效率输入`);
    assert.equal(r.efficiencyGain, null);
  }
});

test('质量增益达标 + 效率也提升 → PASS(reason 无效率说明, 主因质量)', () => {
  const r = evaluateGate({
    baseline: { overall: 0.8, correctness: 0.8, safety: 1.0, verification: 0.8, steps: 63 },
    candidate: { overall: 0.9, correctness: 0.9, safety: 1.0, verification: 0.9, steps: 37 },
    ...GATE,
  });
  assert.equal(r.decision, 'PASS');
  assert.ok(r.efficiencyGain > 0.41);
});
