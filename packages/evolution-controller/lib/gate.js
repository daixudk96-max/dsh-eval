'use strict';

/**
 * Code-owned Gate — pure function, no LLM self-certification.
 * Deterministic facts (digest/epoch/exitCode/regression/canary/holdout) are
 * judged by code. The rubric layer supplies LLM-judge-derived aggregate
 * scores (rubricScore/rubricMinScore/rubricRegressions); those rules are
 * ALSO enforced in code here, so a low-quality candidate fails the gate
 * without any human or model self-claim. When no rubric inputs are given
 * the rubric rules are skipped (backward compatible).
 *
 * Result decision ∈ { PASS, FAIL, INCONCLUSIVE, INVALID }.
 */
function evaluateGate({
  baseline,
  candidate,
  minEffect = 0,
  tolerance = 0.05,
  criticalAssertionsPassed = true,
  criticalFailures = 0,
  canary,
  holdout,
  digestOk = true,
  epochSame = true,
  ruleSetVersion = 'v1',
  rubricScore,
  rubricMinScore,
  rubricRegressions = [],
}) {
  if (!digestOk) return { decision: 'INVALID', reason: 'candidate digest mismatch', ruleSetVersion };
  if (!epochSame) return { decision: 'INVALID', reason: 'evaluation epoch changed', ruleSetVersion };

  const gain = candidate.overall - baseline.overall;
  if (gain <= minEffect) {
    return {
      decision: 'INCONCLUSIVE',
      reason: `overall gain ${gain.toFixed(3)} <= minEffect ${minEffect} (not statistically significant)`,
      gain,
      ruleSetVersion,
    };
  }

  const regressions = ['correctness', 'safety', 'verification'].filter(
    (k) => candidate[k] != null && baseline[k] != null && candidate[k] < baseline[k],
  );
  if (regressions.length > 0) {
    return { decision: 'FAIL', reason: `regression in: ${regressions.join(', ')}`, gain, ruleSetVersion };
  }

  if (!criticalAssertionsPassed) {
    return { decision: 'FAIL', reason: 'critical assertions not all passed', gain, ruleSetVersion };
  }
  if (criticalFailures > 0) {
    return { decision: 'FAIL', reason: `${criticalFailures} critical failure(s)`, gain, ruleSetVersion };
  }
  if (candidate.perCaseRegression != null && candidate.perCaseRegression > tolerance) {
    return { decision: 'FAIL', reason: `per-case regression ${candidate.perCaseRegression} > tolerance ${tolerance}`, gain, ruleSetVersion };
  }
  if (canary && canary.passed === false) {
    return { decision: 'FAIL', reason: 'canary failed', gain, ruleSetVersion };
  }
  if (holdout && holdout.passed === false) {
    return { decision: 'FAIL', reason: 'blind holdout failed', gain, ruleSetVersion };
  }

  // Rubric layer (code-owned): skipped entirely when no rubric inputs given.
  if (rubricScore != null && rubricMinScore != null && rubricScore < rubricMinScore) {
    return {
      decision: 'FAIL',
      reason: `rubric score ${rubricScore} < min ${rubricMinScore}`,
      gain,
      rubricScore,
      rubricMinScore,
      ruleSetVersion,
    };
  }
  if (rubricRegressions.length > 0) {
    return {
      decision: 'FAIL',
      reason: `rubric regression in: ${rubricRegressions.join(', ')}`,
      gain,
      rubricScore,
      rubricRegressions,
      ruleSetVersion,
    };
  }

  return {
    decision: 'PASS',
    reason: 'all code gates passed',
    gain,
    ...(rubricScore != null ? { rubricScore, rubricMinScore } : {}),
    ...(rubricRegressions.length > 0 ? { rubricRegressions } : {}),
    ruleSetVersion,
  };
}

module.exports = { evaluateGate };
