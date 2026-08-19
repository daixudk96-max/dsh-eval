'use strict';

/**
 * Blind holdout — service-level isolation for the Gate (M6).
 *
 * Guarantees (NOT prompt-level; enforced by Host capability + filesystem):
 *  - holdout raw cases / answers / evaluator prompts are never exposed to system-evolver;
 *  - only aggregated results (pass/fail + pooled rates) cross the boundary;
 *  - the runner provides `evaluate(gateInput)` that yields { passed, n, metrics }.
 */
class Holdout {
  /**
   * @param {object} opts
   * @param {() => Promise<{passed: boolean, n: number, metrics?: object}>} opts.runner
   *   runner receives NO holdout raw data — it is wired by the evaluator side only.
   */
  constructor({ runner }) {
    if (!runner) throw new Error('runner is required (evaluator-side only)');
    this.runner = runner;
  }

  /** Aggregated holdout verdict consumed by the Code Gate (no raw data). */
  async evaluate() {
    return this.runner();
  }
}

module.exports = { Holdout };
