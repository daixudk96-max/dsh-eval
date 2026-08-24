'use strict';

/**
 * UCB-Air — expand-vs-evaluate scheduling (pure functions).
 *
 * Absorbed from timwhitez/dsh-self-evolving specs/03-evolution-algorithm.md §7
 * (UCB-Air) and §2 (UCB score). Kept as stateless pure functions so the CLI
 * can apply them without a scheduler process:
 *
 *   - shouldExpand():  (N + P_eval)^alpha >= T, alpha = 0.6 — expand a new
 *     candidate arm only when completed trials plus pending evaluations can
 *     still support more arms; otherwise evaluate existing candidates.
 *     N  = completed trials that count toward utility (NOT proposal counts);
 *     P_eval = evaluations already reserved in the current wave;
 *     T  = admitted candidates (incl. baseline) + unique pending children
 *         upper bound.
 *   - ucbScore():  mean + sqrt(2 ln(totalN+1) / n) — the classic UCB1
 *     exploration bonus, used to pick which candidate arm to keep measuring.
 *
 * Not absorbed (per design.md): HGM Thompson clade-parent sampling (long-horizon
 * lineage search, not needed for single-round human-approved promotion) and the
 * wave-synchronous scheduler (our evaluations run in isolated child processes,
 * so no frozen-snapshot protocol is needed).
 *
 * @module evolution-controller/ucb
 */

const DEFAULT_ALPHA = 0.6;

/**
 * Whether to expand (generate a new candidate) or keep evaluating existing
 * arms. Returns true only when the budget curve can still support more arms
 * AND we are below the admission cap K (default Infinity).
 *
 * Convention: with zero completed trials and zero pending evaluations there is
 * nothing to evaluate yet, so the first wave always expands (admitted < K).
 *
 * @param {object} o
 * @param {number} [o.trials=0]     N — completed, utility-counted trials.
 * @param {number} [o.pendingEval=0] P_eval — evaluations already reserved.
 * @param {number} [o.admitted=1]   T — admitted candidates + pending children.
 * @param {number} [o.alpha=0.6]    UCB-Air exponent.
 * @param {number} [o.maxAdmitted=Infinity] K — expansion stops at K.
 * @returns {boolean}
 */
function shouldExpand({ trials = 0, pendingEval = 0, admitted = 1, alpha = DEFAULT_ALPHA, maxAdmitted = Infinity } = {}) {
  if (maxAdmitted !== Infinity && admitted >= maxAdmitted) return false;
  if (trials + pendingEval <= 0) return admitted < maxAdmitted; // first wave: nothing to evaluate yet
  return (trials + pendingEval) ** alpha >= admitted;
}

/**
 * UCB1 score for one candidate arm: mean observed utility plus an exploration
 * bonus that shrinks as the arm is measured more.
 *
 * @param {number} mean   observed mean utility of the arm (0..1).
 * @param {number} n      number of measurements of this arm.
 * @param {number} totalN total measurements across all arms.
 * @returns {number}
 */
function ucbScore(mean, n, totalN) {
  const m = Number(mean) || 0;
  const count = Math.max(1, Number(n) || 0);
  const all = Math.max(1, Number(totalN) || 0);
  return m + Math.sqrt((2 * Math.log(all + 1)) / count);
}

module.exports = { ucbScore, shouldExpand, DEFAULT_ALPHA };
