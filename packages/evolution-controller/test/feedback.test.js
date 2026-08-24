'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeQualityFeedback } = require('../lib/feedback');

test('feedback: perfect grading yields a high score with no warnings', () => {
  const { quality_score, quality_warn } = computeQualityFeedback({
    taskSuccessRate: 1,
    toolSelectionAccuracyRate: 1,
    finalAnswerScore: 10,
    hallucinationRate: 0,
  });
  assert.equal(quality_score, 100);
  assert.deepEqual(quality_warn, []);
});

test('feedback: all-zero grading yields a low score and warnings', () => {
  const { quality_score, quality_warn } = computeQualityFeedback({
    taskSuccessRate: 0,
    toolSelectionAccuracyRate: 0,
    finalAnswerScore: 0,
    hallucinationRate: 0,
  });
  assert.ok(quality_score < 60); // zero task/tool/final, hallucination 0 inverts to 1
  assert.ok(quality_warn.some((w) => w.includes('below threshold')));
  assert.ok(quality_warn.some((w) => w.includes('task success rate is low')));
  assert.ok(quality_warn.some((w) => w.includes('tool selection accuracy is low')));
});

test('feedback: null grading yields null score with a warning', () => {
  const { quality_score, quality_warn, signals } = computeQualityFeedback(null);
  assert.equal(quality_score, null);
  assert.deepEqual(signals, {});
  assert.ok(quality_warn.some((w) => w.includes('no grading signals')));
});

test('feedback: empty grading object yields null score', () => {
  const { quality_score } = computeQualityFeedback({});
  assert.equal(quality_score, null);
});

test('feedback: finalAnswerScore is normalized by finalAnswerMaxScore (default 10)', () => {
  // 0.5 taskSuccess + 0.5 toolAcc + 5/10 finalAnswer → moderate score, but
  // still below 60 at the renormalized weighted mix, so warnings fire.
  const { quality_score, quality_warn } = computeQualityFeedback({
    taskSuccessRate: 0.5,
    toolSelectionAccuracyRate: 0.5,
    finalAnswerScore: 5,
  });
  assert.equal(quality_score, 50);
  assert.ok(quality_warn.some((w) => w.includes('below threshold')));
});

test('feedback: custom finalAnswerMaxScore rescales the score', () => {
  // taskSuccess 1, toolAcc 1, finalAnswer 10/100 → final normalized 0.1.
  const low = computeQualityFeedback(
    { taskSuccessRate: 1, toolSelectionAccuracyRate: 1, finalAnswerScore: 10 },
    { finalAnswerMaxScore: 100 },
  );
  // taskSuccess 1, toolAcc 1, finalAnswer 10/10 → final normalized 1.
  const high = computeQualityFeedback(
    { taskSuccessRate: 1, toolSelectionAccuracyRate: 1, finalAnswerScore: 10 },
    { finalAnswerMaxScore: 10 },
  );
  assert.ok(low.quality_score < high.quality_score);
});

test('feedback: high hallucination rate triggers a warning', () => {
  const { quality_warn } = computeQualityFeedback({
    taskSuccessRate: 1,
    toolSelectionAccuracyRate: 1,
    finalAnswerScore: 10,
    hallucinationRate: 0.6,
  });
  assert.ok(quality_warn.some((w) => w.includes('hallucination rate is high')));
});

test('feedback: partial signals are renormalized and stay in 0..100', () => {
  const onlyTask = computeQualityFeedback({ taskSuccessRate: 0.8 });
  assert.equal(onlyTask.quality_score, 80); // single signal → its goodness * 100
  const clamped = computeQualityFeedback({ taskSuccessRate: 5 }); // out-of-range
  assert.equal(clamped.quality_score, 100);
});

test('feedback: returns an object and does not write files', () => {
  const result = computeQualityFeedback({
    taskSuccessRate: 0.7,
    toolSelectionAccuracyRate: 0.6,
    finalAnswerScore: 8,
  });
  assert.equal(typeof result, 'object');
  assert.equal(typeof result.quality_score, 'number');
  assert.ok(Array.isArray(result.quality_warn));
  assert.equal(typeof result.signals, 'object');
});
