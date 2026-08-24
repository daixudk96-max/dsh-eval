'use strict';

/**
 * # absorbed-from: dsh-continual-harness/src/render.ts
 *
 * P3-6 injection: rank and render a compact overview of reusable notes for
 * prompt injection. Mirrors the constant-harness injector — at most
 * `maxPerKind` (default 6) entries per kind, each truncated to `maxChars`
 * (default 180), ranked by relevance to an optional query (title hit = 2,
 * content hit = 1), then by newest `updatedAt`, then by id. Reads nothing and
 * writes nothing: `rankNotes(notes, opts)` either returns the rendered string
 * or `''` (zero tokens) when the store is empty.
 *
 * Entry shape: `{ id, kind, version, content, updatedAt, title?, description?,
 * metadata?{ lifecycleState?, pinned? } }`. Kinds alias `subagent-spec` from
 * the P3-2 state-store onto the `subagent` section.
 *
 * @module evolution-controller/lib/injection
 */

/** Section order, matching the constant-harness kinds list. */
const KINDS = Object.freeze(['prompt', 'memory', 'skill', 'subagent']);
/** Max entries rendered per kind. */
const DEFAULT_MAX_PER_KIND = 6;
/** Max characters of each entry summary. */
const DEFAULT_MAX_CHARS = 180;

/** Map a state-store kind onto a rendered section kind. */
function displayKind(kind) {
  return kind === 'subagent-spec' ? 'subagent' : kind;
}

/** Truncate with a trailing ellipsis when over-length. */
function truncate(text, max) {
  const s = String(text === undefined || text === null ? '' : text);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** The one-line summary shown for an entry (description over content). */
function summaryOf(note) {
  return note.description !== undefined && note.description !== '' ? note.description : note.content;
}

/** Relevance rank: title contains the query → 2, content contains it → 1. */
function rankScore(note, query) {
  if (!query) return 0;
  const q = String(query).toLowerCase();
  if (String(note.title ?? '').toLowerCase().includes(q)) return 2;
  if (String(note.content ?? '').toLowerCase().includes(q)) return 1;
  return 0;
}

/** Comparator: score desc, newest `updatedAt` first, then id asc. */
function compareRanked(a, b, query) {
  return (
    rankScore(b, query) - rankScore(a, query)
    || String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))
    || String(a.id ?? '').localeCompare(String(b.id ?? ''))
  );
}

/** Render one entry line `- <id> v<version>: <summary>`. */
function formatEntry(note, maxChars) {
  return `- ${note.id ?? '?'} v${note.version === undefined ? 0 : note.version}: ${truncate(summaryOf(note), maxChars)}`;
}

/**
 * Rank the notes and render the compact injection overview.
 * @param {Array<object>} notes - harness entries (may be empty).
 * @param {{maxPerKind?: number, maxChars?: number, query?: string}} [opts] -
 *   per-kind cap, per-entry char cap, optional relevance query.
 * @returns {string} the rendered overview, or `''` when the store is empty.
 */
function rankNotes(notes, { maxPerKind = DEFAULT_MAX_PER_KIND, maxChars = DEFAULT_MAX_CHARS, query = '' } = {}) {
  const byKind = {};
  for (const note of notes || []) {
    if (note === null || typeof note !== 'object') continue;
    const kind = displayKind(note.kind);
    if (!KINDS.includes(kind)) continue;
    if (note.metadata && note.metadata.lifecycleState === 'archived') continue;
    if (typeof note.id === 'string' && note.id.startsWith('local:')) continue;
    (byKind[kind] || (byKind[kind] = [])).push(note);
  }
  let renderedAny = false;
  const lines = [];
  for (const kind of KINDS) {
    const active = byKind[kind] || [];
    const ranked = [...active].sort((a, b) => compareRanked(a, b, query));
    const selected = ranked.slice(0, maxPerKind);
    if (selected.length > 0) renderedAny = true;
    lines.push(`## ${kind} (${active.length})`);
    if (selected.length === 0) {
      lines.push('- none');
    } else {
      for (const entry of selected) lines.push(formatEntry(entry, maxChars));
      if (active.length > maxPerKind) lines.push(`- … ${active.length - maxPerKind} more`);
    }
    lines.push('');
  }
  if (!renderedAny) return '';
  return lines.join('\n');
}

module.exports = {
  KINDS,
  DEFAULT_MAX_PER_KIND,
  DEFAULT_MAX_CHARS,
  displayKind,
  truncate,
  summaryOf,
  rankScore,
  compareRanked,
  formatEntry,
  rankNotes,
};