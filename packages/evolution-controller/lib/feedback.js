'use strict';

/**
 * Quality feedback (P1-7) — pure function from a run's grading block.
 *
 * Computes a 0-100 `quality_score` from the graded signals in `run.grading`
 * (the shape produced by `packages/dsh-eval/src/runner.ts` `gradingOf`):
 *   - taskSuccessRate          0..1, fraction of trials that passed their task
 *   - toolSelectionAccuracyRate 0..1, fraction of tool choices judged correct
 *   - finalAnswerScore          0..finalAnswerMaxScore, judge's mean score
 *   - hallucinationRate         0..1, fraction of trials judged hallucinated
 *
 * Scoring design (documented, deterministic, no LLM):
 *   1. Normalize each present signal to a 0..1 "goodness" value.
 *      taskSuccessRate and toolSelectionAccuracyRate are already 0..1.
 *      finalAnswerScore is normalized by `finalAnswerMaxScore` (default 10).
 *      hallucinationRate is INVERTED (1 - rate) because a higher hallucination
 *      rate is worse.
 *   2. Weighted combination with fixed weights:
 *        taskSuccessRate           0.40
 *        toolSelectionAccuracyRate 0.30
 *        finalAnswerScore          0.20
 *        hallucinationRate         0.10
 *      Only signals that are present (non-null) contribute; the weights of the
 *      present signals are renormalized to sum to 1, so the score stays in
 *      0..100 regardless of how many signals exist. If no signal is present the
 *      score is null (nothing to score).
 *   3. `quality_score = Math.round(100 * weightedGoodness)`.
 *
 * `quality_warn` is a list of human-readable warnings. It is non-empty when the
 * score is below `warnThreshold` (default 60) or when critical signals are
 * missing (no grading at all, or a taskSuccessRate of 0 with no task signal).
 *
 * This function is pure and returns the feedback object; it does NOT write any
 * file. The caller decides how to surface it (usage log, report, gate input).
 */
// # absorbed-from: research/dsh-evolution/packages/evolution-feedback (adapted to
// # a pure CJS function over run.grading; the upstream is a Cordis plugin that
// # records positive/negative feedback events, not reusable here directly).

const DEFAULT_WEIGHTS = {
  taskSuccessRate: 0.40,
  toolSelectionAccuracyRate: 0.30,
  finalAnswerScore: 0.20,
  hallucinationRate: 0.10,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Compute quality feedback from a run's grading block.
 * @param {object} grading - `run.grading` (or null/undefined).
 * @param {object} [options]
 * @param {number} [options.finalAnswerMaxScore=10] - max of finalAnswerScore.
 * @param {number} [options.warnThreshold=60] - score below which warnings fire.
 * @returns {{ quality_score: number|null, quality_warn: string[], signals: object }}
 */
function computeQualityFeedback(grading, options = {}) {
  const finalAnswerMaxScore = options.finalAnswerMaxScore ?? 10;
  const warnThreshold = options.warnThreshold ?? 60;
  const warn = [];

  const signals = {};
  if (grading === null || grading === undefined) {
    return { quality_score: null, quality_warn: ['no grading signals available to score'], signals: {} };
  }

  const present = [];
  let goodness = {};

  if (typeof grading.taskSuccessRate === 'number') {
    const value = clamp(grading.taskSuccessRate, 0, 1);
    goodness.taskSuccessRate = value;
    signals.taskSuccessRate = value;
    present.push('taskSuccessRate');
  }
  if (typeof grading.toolSelectionAccuracyRate === 'number') {
    const value = clamp(grading.toolSelectionAccuracyRate, 0, 1);
    goodness.toolSelectionAccuracyRate = value;
    signals.toolSelectionAccuracyRate = value;
    present.push('toolSelectionAccuracyRate');
  }
  if (typeof grading.finalAnswerScore === 'number' && finalAnswerMaxScore > 0) {
    const value = clamp(grading.finalAnswerScore / finalAnswerMaxScore, 0, 1);
    goodness.finalAnswerScore = value;
    signals.finalAnswerScore = grading.finalAnswerScore;
    signals.finalAnswerMaxScore = finalAnswerMaxScore;
    present.push('finalAnswerScore');
  }
  if (typeof grading.hallucinationRate === 'number') {
    const value = 1 - clamp(grading.hallucinationRate, 0, 1);
    goodness.hallucinationRate = value;
    signals.hallucinationRate = grading.hallucinationRate;
    present.push('hallucinationRate');
  }

  if (present.length === 0) {
    return { quality_score: null, quality_warn: ['no grading signals available to score'], signals };
  }

  // Renormalize the weights of the present signals to sum to 1.
  let weightSum = 0;
  for (const key of present) weightSum += DEFAULT_WEIGHTS[key];
  let weightedGoodness = 0;
  for (const key of present) weightedGoodness += goodness[key] * (DEFAULT_WEIGHTS[key] / weightSum);

  const quality_score = Math.round(100 * clamp(weightedGoodness, 0, 1));

  if (quality_score < warnThreshold) {
    warn.push(`quality score ${quality_score} is below threshold ${warnThreshold}`);
  }
  if (signals.taskSuccessRate !== undefined && signals.taskSuccessRate < 0.5) {
    warn.push(`task success rate is low (${Math.round(signals.taskSuccessRate * 100)}%)`);
  }
  if (signals.toolSelectionAccuracyRate !== undefined && signals.toolSelectionAccuracyRate < 0.5) {
    warn.push(`tool selection accuracy is low (${Math.round(signals.toolSelectionAccuracyRate * 100)}%)`);
  }
  if (signals.hallucinationRate !== undefined && signals.hallucinationRate > 0.3) {
    warn.push(`hallucination rate is high (${Math.round(signals.hallucinationRate * 100)}%)`);
  }

  return { quality_score, quality_warn: warn, signals };
}

module.exports = { computeQualityFeedback };
