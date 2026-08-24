'use strict';
// # absorbed-from: timwhitez/dsh-self-evolving specs/03 §9 (proposer protocol:
//   trusted code filters proposals against real evidence, never hand rules that
//   become the capability ceiling)
// mechanism reference: research/dsh-self-evolution/src/candidate.ts:201-239
//   (overfit detection on candidate content vs benchmark materials)

/**
 * Overfit / contamination inspection for evolution candidates.
 *
 * Pure, deterministic, exact-text protection: the detector scans only the
 * candidate-added/modified text (delta vs the source revision) for benchmark
 * material leakage. It is intentionally NOT semantic paraphrase detection.
 *
 * Findings carry only stable codes/kinds — never matched text, and never the
 * private rubric itself. `benchmarkMeta` is an in-memory corpus only; it is
 * never written to run/audit/error output.
 */

/** Normalize text for line-level comparison: BOM strip, trim, drop empties. */
function normalizeText(text) {
  return String(text ?? '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Extract candidate-added/modified lines: per file, the normalized lines of
 * the candidate that are absent from the source revision's normalized lines.
 * Unchanged source content is never scanned.
 * @param {Record<string,string>} sourceFiles - source revision content files.
 * @param {Record<string,string>} candidateFiles - candidate content files.
 * @returns {Array<{rel: string, line: string}>} added lines.
 */
function addedLines(sourceFiles, candidateFiles) {
  const source = new Map();
  for (const [rel, text] of Object.entries(sourceFiles ?? {})) {
    source.set(rel, new Set(normalizeText(text).split('\n')));
  }
  const added = [];
  for (const [rel, text] of Object.entries(candidateFiles ?? {})) {
    const base = source.get(rel) ?? new Set();
    for (const line of normalizeText(text).split('\n')) {
      if (!base.has(line)) added.push({ rel, line });
    }
  }
  return added;
}

/**
 * Inspect a candidate for benchmark overfit / contamination.
 * @param {object} args
 * @param {Record<string,string>} args.sourceFiles - source revision content files.
 * @param {Record<string,string>} args.candidateFiles - candidate content files.
 * @param {object|null} [args.benchmarkMeta] - in-memory corpus:
 *   { benchmarkDigest: string, cases: [{ id, statement, privateRubric? }] }.
 *   Omitted/null = no corpus (legacy callers) → always ok.
 * @returns {{ ok: boolean, findings: Array<{code: string, kind: string, caseId?: string, path?: string}> }}
 */
function inspectOverfit({ sourceFiles, candidateFiles, benchmarkMeta }) {
  const findings = [];
  if (benchmarkMeta === null || benchmarkMeta === undefined) return { ok: true, findings };
  const added = addedLines(sourceFiles, candidateFiles);
  const addedText = added.map((entry) => entry.line).join('\n');
  const cases = Array.isArray(benchmarkMeta.cases) ? benchmarkMeta.cases : [];

  // 1. Benchmark digest exact match in added text.
  if (typeof benchmarkMeta.benchmarkDigest === 'string' && benchmarkMeta.benchmarkDigest.length > 0) {
    if (addedText.includes(benchmarkMeta.benchmarkDigest)) {
      findings.push({ code: 'BENCHMARK_OVERFIT', kind: 'digest' });
    }
  }

  for (const c of cases) {
    const id = typeof c.id === 'string' ? c.id : '';
    // 2. Trimmed statement (>= 40 chars) contained in added text.
    const statement = typeof c.statement === 'string' ? c.statement.trim() : '';
    if (statement.length >= 40 && addedText.includes(statement)) {
      findings.push({ code: 'BENCHMARK_OVERFIT', kind: 'statement', caseId: id });
    }
    // 3. `case_id: <id>` marker with id length >= 8.
    if (id.length >= 8 && addedText.includes(`case_id: ${id}`)) {
      findings.push({ code: 'BENCHMARK_OVERFIT', kind: 'case-id', caseId: id });
    }
    // 4. Trimmed private rubric (>= 20 chars) contained in added text.
    const rubric = typeof c.privateRubric === 'string' ? c.privateRubric.trim() : '';
    if (rubric.length >= 20 && addedText.includes(rubric)) {
      findings.push({ code: 'BENCHMARK_CONTAMINATION', kind: 'private-rubric', caseId: id });
    }
  }

  return { ok: findings.length === 0, findings };
}

module.exports = { inspectOverfit, addedLines, normalizeText };
