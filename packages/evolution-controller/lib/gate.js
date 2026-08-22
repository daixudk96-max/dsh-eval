'use strict';

/**
 * Code-owned Gate — pure function, no LLM self-certification.
 * Code-owned Gate — pure function, no LLM self-certification.
 * Deterministic facts (digest/epoch/exitCode/regression/canary/holdout) are
 * judged by code. The rubric layer supplies LLM-judge-derived aggregate
 * scores (rubricScore/rubricMinScore/rubricRegressions); those rules are
 * ALSO enforced in code here, so a low-quality candidate fails the gate
 * without any human or model self-claim. When no rubric inputs are given
 * the rubric rules are skipped (backward compatible).
 *
 * Efficiency dimension (optional): when BOTH baseline.steps and
 * candidate.steps are positive numbers, efficiencyGain =
 * 1 - candidate.steps / baseline.steps is computed. A slower candidate is an
 * efficiency regression (FAIL). Same-quality candidates may PASS on
 * efficiency alone (efficiencyGain >= minEffect) — "same goal, fewer steps
 * counts as an improvement". Without steps inputs behaviour is unchanged.
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

  // Efficiency dimension (only when both step counts are positive numbers).
  const hasSteps = Number.isFinite(baseline.steps) && Number.isFinite(candidate.steps)
    && baseline.steps > 0 && candidate.steps > 0;
  const efficiencyGain = hasSteps ? 1 - candidate.steps / baseline.steps : null;
  const efficiencyField = (obj) => (hasSteps ? { ...obj, efficiencyGain } : { ...obj, efficiencyGain: null });

  // Regressions are FAIL regardless of gain sign: a worse candidate must never
  // be labelled INCONCLUSIVE (checked BEFORE the minEffect threshold).
  const regressions = ['correctness', 'safety', 'verification'].filter(
    (k) => candidate[k] != null && baseline[k] != null && candidate[k] < baseline[k],
  );
  if (regressions.length > 0) {
    return efficiencyField({ decision: 'FAIL', reason: `regression in: ${regressions.join(', ')}`, gain, ruleSetVersion });
  }

  // Efficiency regression: same quality but MORE steps is a FAIL too.
  if (hasSteps && efficiencyGain < 0) {
    return efficiencyField({
      decision: 'FAIL',
      reason: `efficiency regression: candidate steps ${candidate.steps} > baseline steps ${baseline.steps}`,
      gain,
      ruleSetVersion,
    });
  }

  // INCONCLUSIVE only when neither quality nor efficiency moved enough.
  if (gain <= minEffect && (!hasSteps || efficiencyGain < minEffect)) {
    return efficiencyField({
      decision: 'INCONCLUSIVE',
      reason: hasSteps
        ? `overall gain ${gain.toFixed(3)} <= minEffect ${minEffect} and efficiencyGain ${efficiencyGain.toFixed(3)} < minEffect ${minEffect} (no significant improvement)`
        : `overall gain ${gain.toFixed(3)} <= minEffect ${minEffect} (not statistically significant)`,
      gain,
      ruleSetVersion,
    });
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

  const passBase = {
    decision: 'PASS',
    reason: hasSteps
      ? `all code gates passed (overall gain ${gain.toFixed(3)}${gain <= minEffect ? `, efficiency gain ${efficiencyGain.toFixed(3)} >= minEffect ${minEffect}` : ''})`
      : 'all code gates passed',
    gain,
    ...(rubricScore != null ? { rubricScore, rubricMinScore } : {}),
    ...(rubricRegressions.length > 0 ? { rubricRegressions } : {}),
    ruleSetVersion,
  };
  return efficiencyField(passBase);
}

module.exports = { evaluateGate };
