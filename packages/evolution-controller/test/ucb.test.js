'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ucbScore, shouldExpand, DEFAULT_ALPHA } = require('../lib/ucb');

test('DEFAULT_ALPHA is 0.6 (upstream value)', () => {
  assert.equal(DEFAULT_ALPHA, 0.6);
});

test('ucbScore: same n, higher mean scores higher', () => {
  assert.ok(ucbScore(0.8, 3, 5) > ucbScore(0.4, 3, 5));
});

test('ucbScore: same mean, smaller n scores higher (exploration bonus)', () => {
  assert.ok(ucbScore(0.5, 1, 5) > ucbScore(0.5, 4, 5));
});

test('ucbScore: exploration bonus shrinks as n grows', () => {
  const bonus = (n, total) => ucbScore(0, n, total);
  assert.ok(bonus(1, 10) > bonus(5, 10) && bonus(5, 10) > bonus(10, 10));
});

test('ucbScore: guards zero/NaN inputs', () => {
  assert.equal(ucbScore(0, 0, 0), 0 + Math.sqrt(2 * Math.log(2))); // n,totalN clamped to 1
  assert.ok(Number.isFinite(ucbScore(NaN, NaN, NaN)));
});

test('shouldExpand: first wave with nothing measured always expands (below K)', () => {
  assert.equal(shouldExpand({ trials: 0, pendingEval: 0, admitted: 1 }), true);
  assert.equal(shouldExpand({ trials: 0, pendingEval: 0, admitted: 3 }), true);
});

test('shouldExpand: expansion stops at the admission cap K', () => {
  assert.equal(shouldExpand({ trials: 0, pendingEval: 0, admitted: 2, maxAdmitted: 2 }), false);
  assert.equal(shouldExpand({ trials: 100, pendingEval: 0, admitted: 2, maxAdmitted: 2 }), false);
});

test('shouldExpand: with measurements, follows (N+P_eval)^alpha >= T', () => {
  // (1)^0.6 = 1 >= 2? no -> evaluate (keep measuring existing arms)
  assert.equal(shouldExpand({ trials: 1, pendingEval: 0, admitted: 2 }), false);
  // (4)^0.6 = e^(0.6*ln4) = e^0.832 = 2.297 >= 2 -> expand
  assert.equal(shouldExpand({ trials: 4, pendingEval: 0, admitted: 2 }), true);
  // boundary: 3^0.6 = 1.933 < 2 -> evaluate; 2^0.6 = 1.516 < 2 -> evaluate
  assert.equal(shouldExpand({ trials: 3, pendingEval: 0, admitted: 2 }), false);
  assert.equal(shouldExpand({ trials: 2, pendingEval: 0, admitted: 2 }), false);
});

test('shouldExpand: pending evaluations count toward the curve', () => {
  // (1+2)^0.6 = 3^0.6 = 1.933 >= 2? no -> evaluate
  assert.equal(shouldExpand({ trials: 1, pendingEval: 2, admitted: 2 }), false);
  // (3+2)^0.6 = 5^0.6 = e^0.966 = 2.627 >= 2 -> expand
  assert.equal(shouldExpand({ trials: 3, pendingEval: 2, admitted: 2 }), true);
});

test('shouldExpand: alpha raises the expansion threshold', () => {
  // (4)^1.0 = 4 >= 2 -> expand even with alpha 1
  assert.equal(shouldExpand({ trials: 4, admitted: 2, alpha: 1 }), true);
  // (1)^1.0 = 1 >= 2? no
  assert.equal(shouldExpand({ trials: 1, admitted: 2, alpha: 1 }), false);
});
