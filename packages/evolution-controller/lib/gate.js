'use strict';

/**
 * Code-owned Gate — pure function, no LLM self-certification.
 * Deterministic facts (digest/epoch/exitCode/regression/canary/holdout) are
 * judged by code; LLM judge output is advisory only and never gates here.
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

  return { decision: 'PASS', reason: 'all code gates passed', gain, ruleSetVersion };
}

module.exports = { evaluateGate };
