'use strict';

/**
 * Review-input redaction for evolution evidence.
 *
 * # absorbed-from: lmzhen/dsh-evolution/packages/evolution-review/src/redact.ts
 * (TS → CJS rewrite, extended with path / session-id / known-value redaction)
 *
 * Failure evidence (session traces, error text) crosses the evaluation →
 * evolution trust boundary. Credential-shaped text must be masked before it
 * is written to the audit ledger or handed to a proposer. Redaction is
 * best-effort and conservative: it targets well-known secret shapes, inline
 * assignment patterns, absolute paths and session ids — never wholesale
 * content. Values explicitly listed by the caller (e.g. credential refs)
 * are additionally masked regardless of shape.
 *
 * @module evolution-controller/redact
 */

/** Well-known secret shapes (order matters: inline assignment runs last). */
const SECRET_PATTERNS = [
  ['openai-style key', /sk-[A-Za-z0-9_-]{16,}/g],
  ['aws access key', /AKIA[0-9A-Z]{16}/g],
  ['github token', /gh[pousr]_[A-Za-z0-9]{20,}/g],
  ['gitlab token', /glpat-[A-Za-z0-9_-]{16,}/g],
  ['slack token', /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['jwt', /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  ['bearer credential', /Bearer [A-Za-z0-9._~+/=-]{16,}/g],
  ['inline assignment', /(\b(?:token|api[_-]?key|secret|password|passwd)\b[\s]*[:=][\s]*["']?)([A-Za-z0-9._~+/=-]{12,})/gi],
];

/** Absolute local paths: drive letters, UNC, POSIX roots, home. */
const PATH_PATTERNS = [
  [/[A-Za-z]:\\[^\s"']+/g, 'path'],
  [/\\\\[A-Za-z0-9_.$-]+\\[^\s"']*/g, 'path'],
  [/\/(?:Users|home|tmp|opt|usr|var|etc)\/[^\s"']+/g, 'path'],
  [/(?:^|[\s("'])[~][A-Za-z0-9_./\\-]*/g, 'path'],
];

/** DSH session ids: `session-<32 hex>` (trace dirs contain them). */
const SESSION_PATTERN = /session-[0-9a-f]{32}/gi;

/**
 * Mask well-known secret shapes.
 * @param {string} text - raw text.
 * @returns {string} text with matched secrets replaced by `<redacted>`.
 */
function redactSecrets(text) {
  let out = String(text ?? '');
  for (const [, pattern] of SECRET_PATTERNS) {
    out = out.replace(pattern, (_match, p1) => (p1 === undefined ? '<redacted>' : `${p1}<redacted>`));
  }
  return out;
}

/**
 * Mask session ids.
 * @param {string} text - raw text.
 * @returns {string} text with session ids replaced by `<redacted:session>`.
 */
function redactSessionIds(text) {
  return String(text ?? '').replace(SESSION_PATTERN, '<redacted:session>');
}

/**
 * Mask absolute local paths.
 * @param {string} text - raw text.
 * @returns {string} text with paths replaced by `<redacted:path>`.
 */
function redactPaths(text) {
  let out = String(text ?? '');
  for (const [pattern, label] of PATH_PATTERNS) {
    out = out.replace(pattern, `<redacted:${label}>`);
  }
  return out;
}

/**
 * Mask explicit credential values (length > 0). Values are masked verbatim
 * wherever they appear (quoted or bare). A single value is skipped when its
 * own length is absurdly short to avoid mangling common words.
 * @param {string} text - raw text.
 * @param {string[]} values - known secret values.
 * @returns {string} masked text.
 */
function redactCredentials(text, values = []) {
  let out = String(text ?? '');
  for (const value of values) {
    if (typeof value !== 'string' || value.length < 4) continue;
    out = out.split(value).join('<redacted:credential>');
  }
  return out;
}

/**
 * Full review-input redaction: shapes + paths + session ids + known values.
 * @param {string} text - raw text.
 * @param {object} [opts]
 * @param {string[]} [opts.values] - known credential values to mask verbatim.
 * @returns {string} fully masked text.
 */
function redactReviewText(text, { values = [] } = {}) {
  let out = redactCredentials(text, values);
  out = redactSecrets(out);
  out = redactSessionIds(out);
  out = redactPaths(out);
  return out;
}

module.exports = {
  redactReviewText,
  redactSecrets,
  redactSessionIds,
  redactPaths,
  redactCredentials,
};
