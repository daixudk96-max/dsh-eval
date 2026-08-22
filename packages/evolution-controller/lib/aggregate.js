'use strict';

/**
 * Code-owned scoring: aggregation and acceptance decisions. The model only
 * produces per-cell raw scores; every average and every accept/reject call
 * happens here, in deterministic code.
 *
 * # absorbed-from: ZK-Andy/dsh-continual-evolve/src/score.ts (TS→CJS rewrite)
 * Kept: aggregate (failure-cell protocol), entryFromCells, decide, decisionReport,
 *       flagMaterialDrift. Dropped: branded TypeScript types (plain JS here),
 *       formatDuration kept for decisionReport.
 */

/**
 * @typedef {object} CellScore
 * @property {string} caseId
 * @property {number} score raw score (0..100)
 * @property {'ok'|'failed'} status
 * @property {number} [durationMs]
 * @property {string} [caseHash] - optional material hash for drift detection
 * @property {string} [notes]
 */

/**
 * @typedef {object} AggregateOptions
 * @property {number} passThreshold  a cell is "passed" if its raw score is at least this
 * @property {number} regressionTolerance  per-case regression tolerance
 * @property {number} maxFailedCells  failure-cell protocol: a round with more failed
 *   cells than this is rejected outright (failed cells are NEVER averaged in as zeros)
 */

/** @type {AggregateOptions} */
const DEFAULT_AGGREGATE = Object.freeze({
  passThreshold: 60,
  regressionTolerance: 0,
  maxFailedCells: 0,
});

/**
 * Aggregate raw cells into code-owned per-case means + overall mean.
 * Failure-cell protocol: failed cells are EXCLUDED from means and counted
 * separately — a crashed cell can never silently drag the mean down like a
 * zero. A case whose cells all failed reports null (no mean).
 * @param {readonly CellScore[]} cells
 * @returns {{overall: (number|null), perCase: object, failed: number, total: number, totalDurationMs: number}}
 */
function aggregate(cells) {
  const byCase = new Map();
  let failed = 0;
  for (const cell of cells) {
    if (cell.status === 'failed') {
      failed += 1;
      continue;
    }
    const list = byCase.get(cell.caseId) ?? [];
    list.push(clampScore(cell.score));
    byCase.set(cell.caseId, list);
  }
  const perCase = {};
  for (const [caseId, scores] of byCase) {
    perCase[caseId] = mean(scores);
  }
  const all = [...byCase.values()].flat();
  let totalDurationMs = 0;
  for (const cell of cells) {
    if (cell.durationMs !== undefined && cell.durationMs >= 0) {
      totalDurationMs += cell.durationMs;
    }
  }
  return {
    ...perCase,
    perCase,
    overall: all.length > 0 ? mean(all) : null,
    failed,
    total: cells.length,
    totalDurationMs,
  };
}

/**
 * Build an EvaluationEntry (reference or candidate) from raw cells.
 * @param {string} label
 * @param {readonly CellScore[]} cells
 * @param {string} [refinementId]
 * @returns {{label: string, refinementId?: string, createdAt: string, cells: CellScore[], aggregate: object, overall: (number|null)}}
 */
function entryFromCells(label, cells, refinementId) {
  const aggr = aggregate(cells);
  return {
    label,
    ...(refinementId ? { refinementId } : {}),
    createdAt: new Date().toISOString(),
    cells: [...cells],
    aggregate: aggr,
    overall: aggr.overall,
  };
}

/**
 * @typedef {object} Decision
 * @property {boolean} accepted
 * @property {string[]} reasons
 */

/**
 * Non-regressive acceptance rule: the candidate is accepted iff its overall
 * mean is STRICTLY higher than the reference, no case regresses by more than
 * `regressionTolerance` points, and neither side has more failed cells than
 * `maxFailedCells` (failure-cell protocol — a partial/invalid round is never
 * accepted).
 * @param {object} reference  EvaluationEntry
 * @param {object} candidate  EvaluationEntry
 * @param {AggregateOptions} [opts]
 * @returns {Decision}
 */
function decide(reference, candidate, opts = DEFAULT_AGGREGATE) {
  const reasons = [];
  if (reference.overall === null || candidate.overall === null) {
    return { accepted: false, reasons: ['reference or candidate evaluation is incomplete'] };
  }
  const refFailed = reference.aggregate.failed ?? 0;
  const candFailed = candidate.aggregate.failed ?? 0;
  if (refFailed > opts.maxFailedCells) {
    reasons.push(`reference has ${refFailed} failed cells (max ${opts.maxFailedCells})`);
  }
  if (candFailed > opts.maxFailedCells) {
    reasons.push(`candidate has ${candFailed} failed cells (max ${opts.maxFailedCells})`);
  }
  if (reasons.length > 0) {
    return { accepted: false, reasons };
  }
  if (candidate.overall <= reference.overall) {
    reasons.push(`overall not improved: ${candidate.overall} <= ${reference.overall}`);
  }
  // Per-case regression is judged ONLY over the cases that actually exist in
  // the evaluation — aggregate() mixes per-case means with metadata keys
  // (failed/total/totalDurationMs), and iterating raw keys would treat
  // totalDurationMs as a case score. Derived from reference.cells, never from
  // the aggregate key set.
  for (const caseId of new Set(reference.cells.map((cell) => cell.caseId))) {
    const refScore = reference.aggregate[caseId];
    if (refScore === null || refScore === undefined) {
      continue; // case had no comparable mean (all cells failed) — nothing to regress
    }
    const candScore = candidate.aggregate[caseId];
    if (candScore === null || candScore === undefined) {
      reasons.push(`candidate missing case ${caseId}`);
      continue;
    }
    if (candScore < refScore - opts.regressionTolerance) {
      reasons.push(`case ${caseId} regressed: ${candScore} < ${refScore} - ${opts.regressionTolerance}`);
    }
  }
  return { accepted: reasons.length === 0, reasons };
}

/**
 * Detect cells whose case material changed between the reference and
 * candidate runs. A candidate cell whose `caseHash` differs from the
 * reference cell of the SAME case means the statement/rubric was edited
 * between the two runs — its score is not comparable to the baseline and
 * must not count toward the decision. Conservative: cells without a hash on
 * either side and already-failed cells are left untouched; mismatched cells
 * are returned re-marked as `failed` with a reason in notes.
 * @param {object} reference  EvaluationEntry
 * @param {readonly CellScore[]} candidateCells
 * @returns {CellScore[]}
 */
function flagMaterialDrift(reference, candidateCells) {
  const referenceHashes = new Map();
  for (const cell of reference.cells) {
    if (cell.status !== 'failed' && cell.caseHash !== undefined && !referenceHashes.has(cell.caseId)) {
      referenceHashes.set(cell.caseId, cell.caseHash);
    }
  }
  if (referenceHashes.size === 0) {
    return [...candidateCells];
  }
  return candidateCells.map((cell) => {
    if (cell.status === 'failed' || cell.caseHash === undefined) {
      return cell;
    }
    const refHash = referenceHashes.get(cell.caseId);
    if (refHash !== undefined && refHash !== cell.caseHash) {
      return {
        ...cell,
        status: 'failed',
        passed: false,
        notes: `materials changed: case ${cell.caseId} hash ${cell.caseHash} ≠ reference ${refHash} (re-run the reference or fix the material)`,
      };
    }
    return cell;
  });
}

function mean(values) {
  const sum = values.reduce((acc, value) => acc + value, 0);
  return round2(sum / values.length);
}

function clampScore(score) {
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, score));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function isCaseFailed(entry, caseId) {
  return entry.cells.some((cell) => cell.caseId === caseId && cell.status === 'failed');
}

/** Gap C3: human-readable duration (ms → "1.2s" or "340ms"). */
function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Human-readable decision report with per-case before → after deltas.
 * @param {object} reference  EvaluationEntry
 * @param {object} candidate  EvaluationEntry
 * @param {Decision} decision
 * @returns {string[]}
 */
function decisionReport(reference, candidate, decision) {
  const lines = [`overall: ${reference.overall ?? '?'} → ${candidate.overall ?? '?'}`];
  for (const caseId of new Set(reference.cells.map((cell) => cell.caseId))) {
    const refScore = reference.aggregate[caseId];
    if (refScore === null || refScore === undefined) continue;
    const candScore = candidate.aggregate[caseId];
    const failedMark = isCaseFailed(reference, caseId) || isCaseFailed(candidate, caseId) ? ' (failed)' : '';
    lines.push(`  ${caseId}: ${refScore} → ${candScore ?? '?'}${failedMark}`);
  }
  const refFailed = reference.aggregate.failed ?? 0;
  const candFailed = candidate.aggregate.failed ?? 0;
  if (refFailed > 0 || candFailed > 0) {
    lines.push(`failed cells: reference ${refFailed}/${reference.aggregate.total ?? 0} · candidate ${candFailed}/${candidate.aggregate.total ?? 0}`);
  }
  const refDuration = reference.aggregate.totalDurationMs ?? 0;
  const candDuration = candidate.aggregate.totalDurationMs ?? 0;
  if (refDuration > 0 || candDuration > 0) {
    lines.push(`duration: ${formatDuration(refDuration)} → ${formatDuration(candDuration)}`);
  }
  lines.push(
    decision.accepted
      ? 'DECISION: ACCEPTED — overall improved, no regression'
      : `DECISION: REJECTED — ${decision.reasons.join('; ')}`,
  );
  return lines;
}

module.exports = {
  DEFAULT_AGGREGATE,
  aggregate,
  entryFromCells,
  decide,
  flagMaterialDrift,
  decisionReport,
};
