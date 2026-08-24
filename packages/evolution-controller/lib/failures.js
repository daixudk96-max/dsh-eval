'use strict';

/**
 * Failure-class aggregation for dsh-evolve (P2-4): turn the free-text failure
 * cases in dsh-eval run.json reports into a structured count by failure CLASS.
 * Classes are extracted with pure prefix rules (see classifyFailure), so the
 * aggregation is deterministic and unit-testable: the same failure text always
 * lands in the same class. This is the data layer that lets a later patch
 * decide whether a failure class recurs often enough to deserve one.
 *
 * # absorbed-from: timwhitez/dsh-continual-evolve/src/failures.ts
 * (TS → CJS rewrite, adapted to dsh-eval run.json case records)
 *
 * @module evolution-controller/failures
 */

/** Failure classes, most specific first (order matters). */
const FAILURE_CLASSES = [
  ['rubric-decrypt', /rubric decrypt failed/i],
  ['material-drift', /materials changed/i],
  ['executor', /executor failed|executor stopped/i],
  ['reviewer', /reviewer failed|reviewer stopped/i],
  ['fate-assessor', /fate assessment error/i],
  ['trajectory', /trajectory unavailable/i],
  ['max-tokens', /output budget exhausted|max-tokens/i],
  ['aborted', /llm call aborted|aborted/i],
  ['llm', /llm call failed/i],
  ['gate', /gate error/i],
  ['casecheck', /casecheck|case check/i],
  ['timed-out', /timed out|timeout/i],
  ['task-failed', /task failed|task success|grade/i],
];

/**
 * Classify a failure message by prefix rules. Deterministic and additive:
 * unknown text falls into "other" so the summary never drops a failure.
 * @param {string} message - the failure text.
 * @returns {string} the failure class.
 */
function classifyFailure(message) {
  const text = String(message ?? '').trim();
  for (const [kind, re] of FAILURE_CLASSES) {
    if (re.test(text)) return kind;
  }
  return 'other';
}

/**
 * Extract failure records from a dsh-eval run.json. A case is a failure when
 * it is not completed (error/failed) or is completed but graded task-failed.
 * @param {object} run - a dsh-eval run report.
 * @param {string} sourceLabel - the run.json path (for the source field).
 * @returns {Array<{source:string,kind:string,message:string}>}
 */
function failureRecordsFromRun(run, sourceLabel) {
  const records = [];
  const benchmark = run.benchmark || '?';
  for (const c of run.cases || []) {
    if (c.status === 'completed' && !(c.grade && c.grade.taskSuccess === false)) continue;
    let message = c.error || '';
    if (c.timedOut) message = `${message} timed out`.trim();
    if (!message && c.status === 'completed') message = 'task failed (grade)';
    if (!message) message = `status ${c.status}`;
    records.push({
      source: `run:${sourceLabel}:${benchmark}:${c.caseId}`,
      kind: classifyFailure(message),
      message,
    });
  }
  return records;
}

/**
 * Aggregate failure records into counts. Empty input yields an all-zero summary.
 * @param {Array<{kind:string,source:string}>} records
 * @returns {{total:number,byKind:Record<string,number>,bySource:Record<string,number>}}
 */
function summarizeFailures(records) {
  const byKind = {};
  const bySource = {};
  for (const record of records) {
    byKind[record.kind] = (byKind[record.kind] ?? 0) + 1;
    bySource[record.source] = (bySource[record.source] ?? 0) + 1;
  }
  const sortDesc = (obj) => Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]));
  return { total: records.length, byKind: sortDesc(byKind), bySource: sortDesc(bySource) };
}

/**
 * Human-readable report for the command line.
 * @param {{total:number,byKind:Record<string,number>,bySource:Record<string,number>}} summary
 * @returns {string} formatted summary.
 */
function formatFailureSummary(summary) {
  const lines = [`failure summary: ${summary.total} total`];
  const kinds = Object.entries(summary.byKind);
  lines.push('by class:');
  if (kinds.length === 0) lines.push('  (none)');
  for (const [kind, count] of kinds) lines.push(`  ${kind}: ${count}`);
  const sources = Object.entries(summary.bySource);
  lines.push('by source:');
  if (sources.length === 0) lines.push('  (none)');
  for (const [source, count] of sources) lines.push(`  ${source}: ${count}`);
  return lines.join('\n');
}

module.exports = { classifyFailure, failureRecordsFromRun, summarizeFailures, formatFailureSummary };
