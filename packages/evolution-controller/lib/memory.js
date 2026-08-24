'use strict';

/**
 * # absorbed-from: evolution-core/src/memory-store.ts + dsh-continual-harness
 *
 * P3-5 memory: write MEMORY.md / USER.md content under a character budget with
 * dedup and LRU-ish eviction. The upstream MemoryStore refuses an overflowing
 * addition and asks for consolidation; this P3-5 variant instead auto-evicts
 * the oldest entries (front of the list — entries are appended newest-last) to
 * fit the budget, mirroring an LRU discipline.
 *
 * `updateMemoryFile(existing, newLines, { budget })` returns
 * `{ content, added, evicted }`; it never mutates its inputs and performs no
 * I/O.
 *
 * @module evolution-controller/lib/memory
 */

/** Entry separator used in the memory file (upstream ENTRY_DELIMITER). */
const ENTRY_DELIMITER = '\n§\n';
/** Default character budget for a memory file. */
const DEFAULT_BUDGET = 4000;
/** Non-content characters reserved for separators. */
const SEPARATOR_COST = ENTRY_DELIMITER.length + 1;

/**
 * Split a memory file into its entries (trimmed, blanks removed).
 * @param {string} content - the current file text.
 * @returns {Array<string>} the entries in file order.
 */
function parseEntries(content) {
  if (content === undefined || content === null || content === '') return [];
  return String(content)
    .split(ENTRY_DELIMITER)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/**
 * Render entries back into file text. Empty store renders `''` (zero tokens).
 * @param {Array<string>} entries - entries in file order.
 * @returns {string} the rendered content.
 */
function renderEntries(entries) {
  const clean = (entries || []).map((entry) => String(entry).trim()).filter((entry) => entry !== '');
  if (clean.length === 0) return '';
  return `${clean.join(ENTRY_DELIMITER)}\n`;
}

/**
 * Character length of the rendered content (entry chars + separator overhead).
 * @param {Array<string>} entries - entries in file order.
 * @returns {number} total characters the file would occupy.
 */
function contentChars(entries) {
  if (!entries || entries.length === 0) return 0;
  return entries.reduce((sum, entry) => sum + String(entry).length, 0) + SEPARATOR_COST * (entries.length - 1);
}

/**
 * Normalize a line for near-identical dedup: strip an optional leading
 * `## YYYY-MM-DD` date prefix, then collapse whitespace runs and trim.
 * @param {string} line - a candidate entry.
 * @returns {string} the dedup identity.
 */
function normalizeLine(line) {
  let value = String(line).trim();
  value = value.replace(/^##\s*\d{4}-\d{2}-\d{2}\s*\n?/u, '');
  return value.replace(/\s+/gu, ' ').trim();
}

/**
 * Update a memory file: append new, previously-unseen lines (exact-trimmed or
 * near-identical matches are not re-appended), then evict the oldest entries
 * from the front until the rendered content fits the budget.
 * @param {string} existing - current file content (may be '').
 * @param {string | Array<string>} newLines - one line or several to append.
 * @param {{budget?: number}} [opts] - `budget` in characters (default 4000).
 * @returns {{content: string, added: string[], evicted: string[]}}
 *   the new content plus what was appended and what was evicted.
 */
function updateMemoryFile(existing, newLines, { budget = DEFAULT_BUDGET } = {}) {
  if (!Number.isFinite(budget) || budget <= 0) throw new Error(`memory budget must be a positive number, got ${budget}`);
  const entries = parseEntries(existing);
  const incoming = (Array.isArray(newLines) ? newLines : [newLines])
    .map((line) => String(line).trim())
    .filter((line) => line !== '');
  const added = [];
  const seenKeys = (existing === '' || existing === null ? [] : entries.map(normalizeLine)).reduce((acc, key) => (acc[key] = true, acc), {});
  for (const line of incoming) {
    const key = normalizeLine(line);
    if (seenKeys[key] || entries.some((entry) => entry === line)) continue; // identical / near-identical
    seenKeys[key] = true;
    entries.push(line); // newest appended last
    added.push(line);
  }
  const evicted = [];
  while (contentChars(entries) > budget && entries.length > 1) {
    evicted.push(entries.shift()); // oldest (front) goes first
  }
  return { content: renderEntries(entries), added, evicted };
}

/** Read-only summary of a memory file's shape. */
function describe(content) {
  const entries = parseEntries(content);
  return { entries: entries.length, chars: contentChars(entries) };
}

module.exports = {
  ENTRY_DELIMITER,
  DEFAULT_BUDGET,
  SEPARATOR_COST,
  parseEntries,
  renderEntries,
  contentChars,
  normalizeLine,
  updateMemoryFile,
  describe,
};