'use strict';

/**
 * Proposer: turn evaluation failures into a concrete evolution proposal.
 *
 * # absorbed-from: timwhitez/dsh-self-evolving specs/03 §9 (proposer protocol)
 * (generation side; the checking side is proposal-check.js)
 *
 * The proposer reads the real run.json (failed cases + labels) plus the
 * current revision content, and asks an LLM to produce:
 *   - a falsifiable hypothesis about what is failing,
 *   - evidence references (redacted before leaving this module),
 *   - concrete content mutations (candidate files).
 * Everything it returns must still pass proposal-check before it becomes a
 * candidate — generation never bypasses the gate.
 *
 * @module evolution-controller/proposer
 */
const { redactReviewText } = require('./redact.js');

const PROPOSER_SYSTEM = `You are the evolution proposer of a preset-governance loop.
Your input is a real evaluation run (failed cases with grades) and the current
content of a logical preset (an agent preset). Your job is to propose ONE
concrete, falsifiable improvement.

Rules:
- Base every claim on the evidence you are given. No invented metrics.
- The mutation must be a real content change to the preset files (persona
  wording, tool selection, instructions) — not a test-only or comment-only edit.
- Return STRICT JSON with exactly these keys:
  {
    "hypothesis": "<one sentence: what is wrong and how the change fixes it>",
    "evidence": ["<short reference to a concrete failure, e.g. 'case fix-multiply: task failed (exit 1)'>"],
    "mutations": [{"file": "<relpath>", "op": "<append|replace|rewrite>", "summary": "<what changed>"}],
    "files": {"<relpath>": "<FULL new file content>"}
  }
- "files" must contain the FULL new content of every changed file (the whole
  file, not a diff). Keep files that do not change out of "files".
- Keep the change minimal and aligned with the preset's existing style.`;

/**
 * Extract failed cases from a dsh-eval run.json as short evidence lines.
 * @param {object} runJson - dsh-eval run report.
 * @returns {string[]} evidence lines (redacted by caller later).
 */
function failureEvidence(runJson) {
  const cases = Array.isArray(runJson.cases) ? runJson.cases : [];
  const lines = [];
  for (const c of cases) {
    const ok = c.grade && c.grade.taskSuccess === true;
    if (ok) continue;
    const parts = [`case ${c.caseId || '?'}`];
    if (c.status) parts.push(`status=${c.status}`);
    if (c.error) parts.push(`error=${String(c.error).slice(0, 200)}`);
    if (c.exitCode !== undefined) parts.push(`exit=${c.exitCode}`);
    if (c.metrics && c.metrics.steps !== undefined) parts.push(`steps=${c.metrics.steps}`);
    lines.push(parts.join(' '));
  }
  return lines;
}

/** Parse a (possibly fenced) JSON string; returns null on failure. */
function parseJsonLoose(text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/u, '$1');
  try {
    return JSON.parse(cleaned);
  } catch {
    // try to salvage the last {...} block
    const start = cleaned.lastIndexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* fallthrough */ }
    }
    return null;
  }
}

/**
 * Propose a candidate from a real run + current content.
 * @param {object} opts
 * @param {object} opts.runJson - dsh-eval run.json.
 * @param {object} opts.baselineFiles - current revision files {relPath: text}.
 * @param {string} opts.logicalId
 * @param {object} opts.llm - { complete(system, user) → string }.
 * @param {string[]} [opts.redactValues] - known credential values to mask.
 * @param {number} [opts.maxContentChars] - cap on baseline content sent (default 20000).
 * @param {string} [opts.variantHint] - optional hint asking for a candidate whose
 *   main hypothesis differs from earlier ones (used by proposeMultiple).
 * @returns {Promise<{ok: true, hypothesis, evidence, mutations, candidateFiles} | {ok: false, reason: string}>}
 */
async function propose({ runJson, baselineFiles, logicalId, llm, redactValues = [], maxContentChars = 20000, variantHint = null }) {
  if (!llm || typeof llm.complete !== 'function') return { ok: false, reason: 'proposer: llm client is required' };
  const failures = failureEvidence(runJson);
  const failureLines = redactReviewText(failures.join('\n'), { values: redactValues }).split('\n').filter(Boolean);
  if (failureLines.length === 0) {
    return { ok: false, reason: 'proposer: no failed cases in run.json (nothing to fix)' };
  }
  const names = Object.keys(baselineFiles || {});
  if (names.length === 0) return { ok: false, reason: 'proposer: baselineFiles is empty' };
  const contentPreview = names
    .map((name) => `--- ${name} ---\n${String(baselineFiles[name]).slice(0, maxContentChars)}`)
    .join('\n')
    .slice(0, maxContentChars * 2);
  const user = [
    `logical preset: ${logicalId}`,
    `files: ${names.join(', ')}`,
    ...(variantHint ? ['', `NOTE: ${variantHint}`] : []),
    '',
    'FAILED CASES (evidence):',
    failureLines.join('\n'),
    '',
    'CURRENT CONTENT:',
    contentPreview,
    '',
    'Return the STRICT JSON proposal now.',
  ].join('\n');
  let text;
  try {
    text = await llm.complete(PROPOSER_SYSTEM, user);
  } catch (err) {
    return { ok: false, reason: `proposer llm call failed: ${err.message}` };
  }
  const proposal = parseJsonLoose(text);
  if (!proposal) return { ok: false, reason: `proposer returned non-JSON: ${text.slice(0, 200)}` };
  const hypothesis = String(proposal.hypothesis ?? '').trim();
  const files = proposal.files && typeof proposal.files === 'object' ? proposal.files : null;
  if (!hypothesis) return { ok: false, reason: 'proposer returned empty hypothesis' };
  if (!files || Object.keys(files).length === 0) {
    return { ok: false, reason: 'proposer returned no changed files' };
  }
  // Normalize: keep string-valued file contents; reject non-files.
  const candidateFiles = {};
  for (const [name, content] of Object.entries(files)) {
    if (typeof content === 'string') candidateFiles[name] = content;
  }
  if (Object.keys(candidateFiles).length === 0) {
    return { ok: false, reason: 'proposer returned no usable files' };
  }
  const evidence = Array.isArray(proposal.evidence)
    ? proposal.evidence.map((e) => redactReviewText(String(e ?? ''), { values: redactValues })).filter(Boolean)
    : failureLines;
  const mutations = Array.isArray(proposal.mutations)
    ? proposal.mutations.map((m) => ({
        file: String(m?.file ?? ''),
        op: String(m?.op ?? 'unknown'),
        summary: String(m?.summary ?? ''),
      })).filter((m) => m.file)
    : [{ file: Object.keys(candidateFiles)[0], op: 'rewrite', summary: 'proposer rewrite' }];
  return { ok: true, hypothesis, evidence, mutations, candidateFiles };
}

/** Content fingerprint used to de-duplicate candidates from the same proposer run. */
function candidateKey(proposal) {
  const files = proposal.candidateFiles || {};
  return JSON.stringify([proposal.hypothesis, Object.keys(files).sort().map((k) => [k, files[k]])]);
}

/**
 * Propose up to `count` candidates with distinct main hypotheses (W_p cap).
 *
 * Wraps propose() with per-attempt variant hints; candidates that come back
 * identical (same hypothesis + same file contents) are dropped and the LLM is
 * re-asked with a stronger hint. The real quality/duplicate floor is enforced
 * later by controller.createCandidate → proposal-check; this only avoids
 * wasting LLM calls on carbon copies. Stops early when the LLM refuses or the
 * attempt budget (2×count) is exhausted, returning the candidates gathered so
 * far — an honest partial result, never a padded one.
 *
 * @param {object} opts - same as propose(), plus { count }.
 * @param {number} opts.count - how many distinct candidates to request (≤ 3).
 * @returns {Promise<{ok: boolean, candidates: object[], reason?: string}>}
 */
async function proposeMultiple({ count = 1, runJson, baselineFiles, logicalId, llm, redactValues = [], maxContentChars = 20000 }) {
  const want = Math.max(1, Math.min(3, Number(count) || 1));
  const out = [];
  const seen = new Set();
  const maxAttempts = want * 2;
  const retryable = (reason) => /llm call failed|fetch failed|timeout|ECONNRESET|ETIMEDOUT|aborted/u.test(String(reason));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let attempt = 0; attempt < maxAttempts && out.length < want; attempt += 1) {
    const variantHint = out.length === 0
      ? null
      : `This is candidate ${out.length + 1} of ${want}. Your main hypothesis MUST differ from the earlier one(s): ${out.map((c) => `"${c.hypothesis}"`).join('; ')}.`;
    // Transient LLM/infra failures (connection reset, timeout) are retried up to
    // twice with a short backoff; content-level refusals are not (re-asking
    // cannot change the evidence).
    let proposal = null;
    for (let tries = 0; tries < 3; tries += 1) {
      proposal = await propose({
        runJson, baselineFiles, logicalId, llm, redactValues, maxContentChars,
        ...(variantHint ? { variantHint } : {}),
      });
      if (proposal.ok || !retryable(proposal.reason)) break;
      await sleep(2000 * (tries + 1));
    }
    if (!proposal.ok) {
      // LLM refusal is not recoverable by re-asking with a hint. If we already
      // have candidates, stop with an honest partial result; otherwise surface
      // the original refusal reason.
      if (out.length > 0) break;
      return { ok: false, reason: proposal.reason, candidates: out };
    }
    const key = candidateKey(proposal);
    if (seen.has(key)) continue; // carbon copy — re-ask with hint next round
    seen.add(key);
    out.push(proposal);
  }
  return { ok: out.length > 0, candidates: out, ...(out.length > 0 ? {} : { reason: 'proposer: no distinct candidates produced' }) };
}

module.exports = { propose, proposeMultiple, failureEvidence, parseJsonLoose };
