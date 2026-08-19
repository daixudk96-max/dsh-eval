'use strict';

/**
 * Trace redaction + untrusted-input guard (M6).
 * Every EvaluationRun trace is redacted by default before storage/sharing:
 * secrets, user data and reference answers must never leak into traces that
 * system-evolver (or later consumers) can read.
 */

const DEFAULT_PATTERNS = [
  { name: 'api-key', re: /(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9_\-\.]{8,}/gi, replacement: '$1=<redacted>' },
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9\-._~+\/]+=*/gi, replacement: 'Bearer <redacted>' },
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: '<private-key-redacted>' },
];

/**
 * @param {string|object} input trace content (stringified if object)
 * @returns {string} redacted content
 */
function redact(input, { extraPatterns = [] } = {}) {
  let s = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
  for (const p of [...DEFAULT_PATTERNS, ...extraPatterns]) {
    s = s.replace(p.re, p.replacement);
  }
  return s;
}

/**
 * Untrusted-input guard for judge prompts: candidate output is data, not
 * instructions. Strip instruction-looking directives and fail-closed.
 */
function sanitizeJudgeInput(text, { maxLength = 20000 } = {}) {
  if (typeof text !== 'string') return { ok: false, reason: 'non-string candidate output' };
  if (text.length > maxLength) return { ok: false, reason: `exceeds maxLength ${maxLength}` };
  // remove embedded "instruction" blocks that could hijack the judge
  const cleaned = text
    .replace(/<\|?im_start\|?>/gi, '')
    .replace(/<\|?im_end\|?>/gi, '')
    .replace(/\b(ignore (all )?(previous|prior) instructions)\b/gi, '<filtered>');
  return { ok: true, value: cleaned };
}

module.exports = { redact, sanitizeJudgeInput, DEFAULT_PATTERNS };
