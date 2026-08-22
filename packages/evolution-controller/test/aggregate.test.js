'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  aggregate,
  entryFromCells,
  decide,
  flagMaterialDrift,
  decisionReport,
  DEFAULT_AGGREGATE,
} = require('../lib/aggregate');

test('aggregate: failed cells excluded from means, counted separately', () => {
  const result = aggregate([
    { caseId: 'a', score: 80, status: 'ok' },
    { caseId: 'a', score: 60, status: 'ok' },
    { caseId: 'b', score: 40, status: 'failed' }, // excluded, never a zero
  ]);
  assert.equal(result.overall, 70); // (80+60)/2, NOT (80+60+0)/3
  assert.equal(result.perCase.a, 70);
  assert.equal(result.perCase.b, undefined); // all-failed case has no mean
  assert.equal(result.failed, 1);
  assert.equal(result.total, 3);
});

test('aggregate: all-failed case reports null overall; duration summed', () => {
  const result = aggregate([
    { caseId: 'a', score: 50, status: 'failed', durationMs: 1200 },
    { caseId: 'a', score: 30, status: 'failed', durationMs: 800 },
  ]);
  assert.equal(result.overall, null);
  assert.equal(result.failed, 2);
  assert.equal(result.totalDurationMs, 2000);
});

test('aggregate: scores clamped to 0..100, non-finite coerced to 0', () => {
  const result = aggregate([
    { caseId: 'a', score: 150, status: 'ok' },
    { caseId: 'a', score: -5, status: 'ok' },
    { caseId: 'a', score: Number.NaN, status: 'ok' },
  ]);
  assert.equal(result.perCase.a, 33.33); // (100+0+0)/3, clamped + coerced
});

test('entryFromCells: builds entry with aggregate + overall', () => {
  const entry = entryFromCells('baseline', [
    { caseId: 'a', score: 90, status: 'ok' },
    { caseId: 'b', score: 50, status: 'failed' },
  ], 'ref-1');
  assert.equal(entry.label, 'baseline');
  assert.equal(entry.refinementId, 'ref-1');
  assert.equal(entry.overall, 90);
  assert.equal(entry.aggregate.failed, 1);
});

test('decide: strict improvement required; regressions rejected', () => {
  const ref = entryFromCells('ref', [{ caseId: 'a', score: 80, status: 'ok' }]);
  const better = entryFromCells('cand', [{ caseId: 'a', score: 90, status: 'ok' }]);
  const worse = entryFromCells('cand', [{ caseId: 'a', score: 70, status: 'ok' }]);
  const equal = entryFromCells('cand', [{ caseId: 'a', score: 80, status: 'ok' }]);
  assert.equal(decide(ref, better).accepted, true);
  assert.equal(decide(ref, worse).accepted, false);
  assert.equal(decide(ref, equal).accepted, false); // strictly higher, not >=
});

test('decide: failed cells reject the round (maxFailedCells 0)', () => {
  const ref = entryFromCells('ref', [{ caseId: 'a', score: 80, status: 'ok' }]);
  const cand = entryFromCells('cand', [
    { caseId: 'a', score: 90, status: 'ok' },
    { caseId: 'b', score: 50, status: 'failed' },
  ]);
  const decision = decide(ref, cand);
  assert.equal(decision.accepted, false);
  assert.match(decision.reasons.join('; '), /failed cells/);
});

test('decide: per-case regression tolerance', () => {
  const ref = entryFromCells('ref', [
    { caseId: 'a', score: 90, status: 'ok' },
    { caseId: 'b', score: 90, status: 'ok' },
  ]);
  // overall improves (90→95) but case b drops 5 → rejected under tolerance 0
  const cand = entryFromCells('cand', [
    { caseId: 'a', score: 100, status: 'ok' },
    { caseId: 'b', score: 82, status: 'ok' },
  ]);
  assert.equal(cand.overall, 91); // (100+82)/2 = 91 > 90, so overall improves
  const strict = decide(ref, cand, { ...DEFAULT_AGGREGATE, regressionTolerance: 0 });
  assert.equal(strict.accepted, false);
  assert.match(strict.reasons.join('; '), /case b regressed/);
  // tolerance 10 → 8-point drop is allowed
  const loose = decide(ref, cand, { ...DEFAULT_AGGREGATE, regressionTolerance: 10 });
  assert.equal(loose.accepted, true);
});

test('flagMaterialDrift: hash change marks cell failed with reason', () => {
  const ref = entryFromCells('ref', [
    { caseId: 'a', score: 80, status: 'ok', caseHash: 'h1' },
  ]);
  const drifted = flagMaterialDrift(ref, [
    { caseId: 'a', score: 90, status: 'ok', caseHash: 'h2' },
  ]);
  assert.equal(drifted[0].status, 'failed');
  assert.match(drifted[0].notes, /materials changed/);
});

test('decisionReport: human-readable before → after', () => {
  const ref = entryFromCells('ref', [{ caseId: 'a', score: 80, status: 'ok', durationMs: 500 }]);
  const cand = entryFromCells('cand', [{ caseId: 'a', score: 90, status: 'ok', durationMs: 800 }]);
  const lines = decisionReport(ref, cand, { accepted: true, reasons: [] });
  assert.match(lines[0], /80 → 90/);
  assert.ok(lines.some((l) => l.includes('DECISION: ACCEPTED')));
});
