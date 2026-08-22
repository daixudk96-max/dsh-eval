'use strict';
const path = require('node:path');
const { sha256 } = require('../../preset-registry/lib/hash');

/**
 * proposal-check — deterministic candidate quality gate for evolution runs.
 *
 * Absorbed from timwhitez/dsh-self-evolving specs/03-evolution-algorithm.md §9
 * (proposer protocol): trusted code rejects proposals that cannot be falsified
 * or add nothing — no-change, test-only, comment-only, missing hypothesis,
 * missing evidence, hypothesis-cap overflow (W_p = 3), and semantic
 * duplicates. The proposer (a model) proposes; this module's code guarantees
 * the quality floor.
 *
 * @module evolution-controller/proposal-check
 */

/** Maximum distinct main hypotheses per run (W_p in the upstream protocol). */
const MAX_HYPOTHESES = 3;

/** Files inside a revision/staging dir that are bookkeeping, not content. */
const CONTROL_FILES = new Set(['manifest.json', 'candidate.json', 'source.json']);

/**
 * Normalize one text document for semantic comparison: strip BOM, trim every
 * line, drop blank lines and `#` comment lines (YAML/README convention),
 * and join with newlines. Two documents that differ only in whitespace or
 * comments compare equal.
 * @param {string} text - raw file content.
 * @returns {string} normalized text.
 */
function normalizeText(text) {
  return String(text)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .join('\n');
}

/**
 * Map a directory's content files to their normalized text, keyed by
 * relative path (control files excluded). Non-file entries are ignored.
 * @param {object} files - { path -> content } of a revision or staging dir.
 * @returns {object} { path: normalizedText }.
 */
function normalizeFiles(files) {
  const out = {};
  for (const [name, content] of Object.entries(files)) {
    if (CONTROL_FILES.has(name)) continue;
    out[name] = normalizeText(content);
  }
  return out;
}

/**
 * Whether a mutation record looks like it only touches test/spec paths.
 * @param {object} mutation - { kind?, file?, path?, ... } as recorded.
 * @returns {boolean}
 */
function isTestOnly(mutation) {
  const target = mutation.file ?? mutation.path ?? '';
  return typeof target === 'string' && /(^|[/\\])(test|spec|tests?)([/\\]|\.)/iu.test(target);
}

/**
 * Whether a mutation record looks comment-only for a known content file
 * (the caller supplies the actual before/after contents to decide precisely;
 * this helper only rejects obvious comment-noise mutations on markdown/yaml).
 * @param {object} mutation - the mutation record.
 * @returns {boolean}
 */
function isCommentOnlyMutation(mutation) {
  if (typeof mutation.to !== 'string' || typeof mutation.from !== 'string') return false;
  const before = normalizeText(mutation.from);
  const after = normalizeText(mutation.to);
  return before === after && mutation.from !== mutation.to;
}

/**
 * Run the full proposal quality gate.
 * @param {object} args
 * @param {string} args.logicalId - logical preset id.
 * @param {string} args.sourceRevisionId - the revision the candidate is based on.
 * @param {string} args.hypothesis - falsifiable mechanism assertion (required).
 * @param {string[]} args.evidence - references to failure clusters / eval run ids (required).
 * @param {object[]} args.mutations - mutation records.
 * @param {string} args.sourceContent - normalized content map of the source revision.
 * @param {string} args.candidateContent - normalized content map of the staged candidate.
 * @param {object[]} [args.existingCandidates] - prior candidates in this run,
 *   each { candidateId, hypothesis, content } for hypothesis-cap and dedup.
 * @returns {{ ok: boolean, reasons: string[] }}
 */
function proposalCheck({
  logicalId, sourceRevisionId, hypothesis, evidence = [], mutations = [],
  sourceContent, candidateContent, existingCandidates = [],
}) {
  const reasons = [];
  if (!logicalId) reasons.push('logicalId is required');
  if (!sourceRevisionId) reasons.push('sourceRevisionId is required');
  if (typeof hypothesis !== 'string' || hypothesis.trim() === '') {
    reasons.push('proposal needs hypothesis (falsifiable mechanism claim)');
  }
  if (!Array.isArray(evidence) || evidence.length === 0) {
    reasons.push('proposal needs evidence (references to failure clusters / eval run ids)');
  }
  if (!Array.isArray(mutations) || mutations.length === 0) {
    reasons.push('proposal needs at least one mutation');
  }
  if (Object.keys(candidateContent).length === 0) {
    reasons.push('proposal has no content files (readCandidateFiles must expose staged content)');
  }
  // Content equality: normalized candidate == normalized source → no-change.
  const sameKeys = Object.keys(sourceContent).length === Object.keys(candidateContent).length;
  const contentIdentical = sameKeys
    && Object.entries(sourceContent).every(([name, text]) => candidateContent[name] === text);
  if (contentIdentical) {
    reasons.push(`proposal is a no-change copy of ${sourceRevisionId}`);
  }
  // Test-only: every changed path is a test/spec path.
  const changed = mutations.filter((m) => !isTestOnly(m));
  if (changed.length === 0 && mutations.length > 0) {
    reasons.push('proposal changes only tests');
  }
  // Comment-only: at least one mutation whose only delta is comments/whitespace.
  if (mutations.some((m) => isCommentOnlyMutation(m))) {
    reasons.push('proposal changes only comments');
  }
  // Hypothesis cap (W_p = 3 distinct main hypotheses per run).
  const seen = new Set(existingCandidates.map((c) => String(c.hypothesis ?? '').trim()));
  if (seen.has(hypothesis.trim())) {
    reasons.push(`duplicate hypothesis already proposed: ${hypothesis.trim()}`);
  } else if (seen.size >= MAX_HYPOTHESES) {
    reasons.push(`run already has ${MAX_HYPOTHESES} distinct hypotheses`);
  }
  // Semantic dedup against existing candidates' normalized content.
  const candText = Object.values(candidateContent).join('\n');
  const candHash = sha256(candText);
  for (const prior of existingCandidates) {
    if (prior.contentHash === candHash) {
      reasons.push(`duplicate of candidate ${prior.candidateId} (identical normalized content)`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

module.exports = { proposalCheck, normalizeText, normalizeFiles, MAX_HYPOTHESES, CONTROL_FILES };
