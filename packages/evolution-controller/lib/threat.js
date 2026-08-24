'use strict';

/**
 * Write-time threat scanning for evolution candidate content (P2-3).
 *
 * Three threat classes are matched with pure regex rules — prompt-injection,
 * exfiltration, and secret — so the scan is deterministic and unit-testable.
 * This is a code-level pattern match, NOT a security boundary (same stance as
 * the ecosystem's evolution-threat): it complements the post-hoc redaction in
 * redact.js by blocking suspicious content BEFORE it is staged, and it never
 * deletes data — a hit only blocks the candidate write.
 *
 * # absorbed-from: lmzhen/dsh-evolution/packages/evolution-core/src/threats.ts
 * (TS → CJS rewrite, scoped to the three classes this controller needs)
 *
 * @module evolution-controller/threat
 */

const FILLER = String.raw`(?:\w+\s+){0,8}`;

/** Threat patterns by class. Order matters only for which hit is reported first. */
const PATTERNS = [
  // ---- prompt injection / rule override / role hijack ----
  { label: 'prompt_injection_ignore', category: 'prompt_injection', regex: new RegExp(String.raw`ignore\s+${FILLER}(?:previous|above|prior|all)\s+${FILLER}instructions`, 'i') },
  { label: 'disregard_rules', category: 'prompt_injection', regex: /disregard\s+(?:your|all|any)\s+(?:instructions|rules|guidelines)/i },
  { label: 'system_prompt_override', category: 'prompt_injection', regex: /system\s+prompt\s+override/i },
  { label: 'bypass_restrictions', category: 'prompt_injection', regex: /act\s+as\s+(?:if|though)\s+(?:you\s+)?(?:have\s+no|don'?t\s+have)\s+(?:restrictions?|limits?|rules)/i },
  { label: 'new_system_prompt', category: 'prompt_injection', regex: new RegExp(String.raw`new\s+${FILLER}system\s+${FILLER}prompt`, 'i') },
  { label: 'forget_everything', category: 'prompt_injection', regex: new RegExp(String.raw`forget\s+${FILLER}(?:everything|all)\s+${FILLER}(?:discussed|you\s+know)`, 'i') },
  { label: 'role_hijack', category: 'prompt_injection', regex: /you\s+are\s+now\s+(?:a|an|the|acting|playing|pretending)/i },
  { label: 'identity_override', category: 'prompt_injection', regex: /\bname\s+yourself\s+\w+/i },
  { label: 'remove_filters', category: 'prompt_injection', regex: /(?:respond|answer|reply)\s+without\s+(?:restrictions?|limitations?|filters?|safety)/i },
  { label: 'leak_system_prompt', category: 'prompt_injection', regex: new RegExp(String.raw`output\s+${FILLER}(?:system|initial)\s+prompt`, 'i') },

  // ---- exfiltration (context / URL / shell-based secret theft) ----
  { label: 'context_exfil', category: 'exfiltration', regex: /(?:include|output|print|share)\s+(?:the\s+)?(?:conversation|chat\s+history|previous\s+messages|(?:full|entire)\s+context)/i },
  { label: 'send_to_url', category: 'exfiltration', regex: /(?:send|post|upload|transmit)\s+[^\n]{0,512}\s+(?:to|at)\s+https?:\/\//i },
  { label: 'exfil_curl', category: 'exfiltration', regex: /curl\s+[^\n]{0,512}\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i },
  { label: 'exfil_wget', category: 'exfiltration', regex: /wget\s+[^\n]{0,512}\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i },
  { label: 'read_secrets', category: 'exfiltration', regex: /cat\s+[^\n]{0,512}(?:\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i },
  { label: 'exfil_webhook', category: 'exfiltration', regex: /(?:exfiltrat|exfil|steal|send\s+the\s+contents|transmit)\s+[^\n]{0,256}(?:webhook|callback|https?:\/\/)/i },

  // ---- hardcoded secrets (shapes shared with redact.js) ----
  { label: 'openai_key', category: 'secret', regex: /sk-[A-Za-z0-9_-]{16,}/ },
  { label: 'aws_key', category: 'secret', regex: /AKIA[0-9A-Z]{16}/ },
  { label: 'github_token', category: 'secret', regex: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { label: 'gitlab_token', category: 'secret', regex: /glpat-[A-Za-z0-9_-]{16,}/ },
  { label: 'slack_token', category: 'secret', regex: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { label: 'jwt', category: 'secret', regex: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { label: 'bearer_credential', category: 'secret', regex: /Bearer [A-Za-z0-9._~+/=-]{16,}/ },
  { label: 'private_key_block', category: 'secret', regex: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/ },
  { label: 'inline_secret', category: 'secret', regex: /(\b(?:token|api[_-]?key|secret|password|passwd)\b[\s]*[:=][\s]*["']?)([A-Za-z0-9._~+/=-]{12,})/i },
];

/**
 * Scan text for threat patterns. Returns every finding (label + category).
 * @param {string} text - content to scan.
 * @param {number} [maxScanChars=65536] - max normalized characters scanned.
 * @returns {Array<{label:string,category:string}>} findings (empty when clean).
 */
function scanThreats(text, maxScanChars = 65_536) {
  const findings = [];
  const normalized = String(text ?? '').normalize('NFKC').slice(0, maxScanChars);
  for (const pattern of PATTERNS) {
    if (pattern.regex.test(normalized)) findings.push({ label: pattern.label, category: pattern.category });
  }
  return findings;
}

/**
 * Blocking scan: any hit returns a user-facing block reason, else null.
 * @param {string} text - content to scan.
 * @param {number} [maxScanChars=65536] - max normalized characters scanned.
 * @returns {string|null} block reason, or null when clean.
 */
function scanContentThreats(text, maxScanChars = 65_536) {
  const findings = scanThreats(text, maxScanChars);
  if (findings.length === 0) return null;
  return `Blocked by security scan (${findings[0].label}). This content appears to contain potentially malicious instructions.`;
}

module.exports = { scanThreats, scanContentThreats, PATTERNS };
