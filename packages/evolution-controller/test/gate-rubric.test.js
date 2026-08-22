'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateGate } = require('../lib/gate');

const base = { overall: 0.6, correctness: 0.8, safety: 0.9, verification: 0.7 };
const good = { overall: 0.8, correctness: 0.85, safety: 0.9, verification: 0.75 };

test('gate rubric: PASS when rubric score >= min and no rubric regressions', () => {
  const result = evaluateGate({
    baseline: base,
    candidate: good,
    rubricScore: 82,
    rubricMinScore: 60,
    rubricRegressions: [],
  });
  assert.equal(result.decision, 'PASS');
});

test('gate rubric: FAIL when rubric score below min', () => {
  const result = evaluateGate({
    baseline: base,
    candidate: good,
    rubricScore: 55,
    rubricMinScore: 60,
    rubricRegressions: [],
  });
  assert.equal(result.decision, 'FAIL');
  assert.match(result.reason, /rubric score 55 < min 60/);
  assert.equal(result.rubricScore, 55);
});

test('gate rubric: FAIL on rubric dimension regression', () => {
  const result = evaluateGate({
    baseline: base,
    candidate: good,
    rubricScore: 90,
    rubricMinScore: 60,
    rubricRegressions: ['clarity'],
  });
  assert.equal(result.decision, 'FAIL');
  assert.match(result.reason, /rubric regression in: clarity/);
});

test('gate rubric: skipped entirely when no rubric inputs given (backward compat)', () => {
  const result = evaluateGate({ baseline: base, candidate: good });
  assert.equal(result.decision, 'PASS');
  assert.equal(result.rubricScore, undefined);
});

test('gate rubric: deterministic rules still precede rubric rules', () => {
  // digest invalid wins over rubric PASS
  assert.equal(evaluateGate({ baseline: base, candidate: good, digestOk: false, rubricScore: 99, rubricMinScore: 60 }).decision, 'INVALID');
  // gain too small wins over rubric PASS
  const lowGain = evaluateGate({ baseline: base, candidate: { ...good, overall: 0.62 }, minEffect: 0.05, rubricScore: 99, rubricMinScore: 60 });
  assert.equal(lowGain.decision, 'INCONCLUSIVE');
  // deterministic regression wins over rubric PASS
  const regress = evaluateGate({ baseline: base, candidate: { ...good, correctness: 0.4 }, rubricScore: 99, rubricMinScore: 60 });
  assert.equal(regress.decision, 'FAIL');
  assert.match(regress.reason, /regression in: correctness/);
});
