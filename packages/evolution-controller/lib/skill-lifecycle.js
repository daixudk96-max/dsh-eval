'use strict';

/**
 * # absorbed-from: evolution-core/src/curator.ts
 *
 * P3-3 skill lifecycle: pure state transitions for reusable skills —
 * `active` → `stale` → `archived`, driven by idle time against configurable
 * day thresholds (defaults 30 / 90). A skill that comes back into use while
 * `stale` reactivates to `active`; a `stale` skill that keeps idling falls to
 * `archived`; an `archived` skill can be explicitly restored. Pinned skills
 * are exempt from automatic archival. `consolidate` merges several `stale`
 * skills into one combined record (first step of "merge stale→one").
 *
 * Purity contract: this module performs no I/O and mutates nothing — every
 * function returns fresh records / transition descriptors from the inputs.
 *
 * @module evolution-controller/lib/skill-lifecycle
 */

const DAY_MS = 86_400_000;
/** Built-in skills that are never auto-archived (ported from PROTECTED_BUILTIN_SKILLS). */
const PROTECTED_SKILLS = Object.freeze(['plan']);

/** Default lifecycle thresholds, in days. */
const DEFAULT_CONFIG = Object.freeze({
  staleAfterDays: 30,
  archiveAfterDays: 90,
  qualityWarnStaleAfterDays: undefined, // override stale threshold when qualityWarn
  excludeSkillNames: undefined,         // Set of names never auto-managed
  manageUnmanaged: false,               // also handle records whose createdBy !== 'agent'
  qualityWarn: false,                   // evaluate against the qualityWarn threshold
});

/**
 * Normalize a skill record, filling defaulted fields.
 * @param {object} record - {name, created, state, lastUsedAt?, pinned?,
 *   qualityWarn?, createdBy?}.
 * @returns {object} the normalized record.
 */
function normalizeRecord(record) {
  if (!record || typeof record !== 'object') throw new Error('skill lifecycle: record must be an object');
  if (typeof record.name !== 'string' || record.name === '') throw new Error('skill lifecycle: record.name required');
  return {
    name: record.name,
    created: record.created || null,
    state: record.state || 'active',
    lastUsedAt: record.lastUsedAt || null,
    pinned: record.pinned === true,
    qualityWarn: record.qualityWarn === true,
    createdBy: record.createdBy || 'agent',
    content: typeof record.content === 'string' ? record.content : '',
    description: typeof record.description === 'string' ? record.description : '',
  };
}

/** Validate the day thresholds (stale < archive, both positive). */
function validateConfig(config) {
  const resolved = { ...DEFAULT_CONFIG, ...(config || {}) };
  const stale = resolved.staleAfterDays;
  const archive = resolved.archiveAfterDays;
  if (!Number.isFinite(stale) || stale <= 0) throw new Error('staleAfterDays must be a positive number');
  if (!Number.isFinite(archive) || archive <= 0 || archive <= stale) {
    throw new Error('archiveAfterDays must exceed staleAfterDays');
  }
  return resolved;
}

/**
 * Days since a stored ISO timestamp compared to `now`.
 * @param {string|null} iso - an ISO timestamp, or null.
 * @param {Date} now - the reference date.
 * @returns {number} whole days elapsed (0 when no timestamp).
 */
function daysSinceIso(iso, now) {
  if (iso === null || iso === undefined || iso === '') return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (now.getTime() - t) / DAY_MS);
}

/** Age of the skill (since `created`). */
function ageDays(record, now) {
  return daysSinceIso(record.created, now);
}

/** Idle time: since the last use, or since creation when never used. */
function idleDays(record, now) {
  return daysSinceIso(record.lastUsedAt || record.created, now);
}

/** Effective stale threshold, honoring the qualityWarn override. */
function staleThresholdDays(record, config) {
  if (record.qualityWarn && config.qualityWarnStaleAfterDays !== undefined) {
    return config.qualityWarnStaleAfterDays;
  }
  return config.staleAfterDays;
}

/**
 * Is this record exempt from automatic lifecycle management?
 * @returns {boolean} true when pinned, protected, excluded, unmanaged, or
 *   already archived (all cases that must not transition).
 */
function isExempt(record, config) {
  if (record.pinned) return true;
  if (PROTECTED_SKILLS.includes(record.name)) return true;
  if (config.excludeSkillNames && config.excludeSkillNames.has(record.name)) return true;
  if (record.createdBy !== 'agent' && !config.manageUnmanaged) return true;
  if (record.state === 'archived') return true;
  return false;
}

/**
 * Decides the next lifecycle state of one skill.
 * @param {object} record - normalized skill record.
 * @param {object} config - resolved config.
 * @param {Date} now - reference date.
 * @returns {{next: string, reason: string}}
 */
function decideLifecycle(record, config, now) {
  const idle = idleDays(record, now);
  const staleDays = staleThresholdDays(record, config);
  const archiveDays = config.archiveAfterDays;
  if (record.state === 'active') {
    if (idle >= archiveDays) return { next: 'archived', reason: `idle ${idle.toFixed(1)}d >= archive ${archiveDays}d` };
    if (idle >= staleDays) return { next: 'stale', reason: `idle ${idle.toFixed(1)}d >= stale ${staleDays}d` };
    return { next: 'active', reason: `idle ${idle.toFixed(1)}d < stale ${staleDays}d` };
  }
  if (record.state === 'stale') {
    if (idle < staleDays) return { next: 'active', reason: `reused: idle ${idle.toFixed(1)}d < stale ${staleDays}d` };
    if (idle >= archiveDays) return { next: 'archived', reason: `idle ${idle.toFixed(1)}d >= archive ${archiveDays}d` };
    return { next: 'stale', reason: `idle ${idle.toFixed(1)}d between ${staleDays}d and ${archiveDays}d` };
  }
  return { next: 'archived', reason: 'archived skills stay archived until restored' };
}

/**
 * Compute lifecycle transitions for a set of skills.
 * @param {Array<object>} records - skill records.
 * @param {object} [config] - day thresholds and guard options.
 * @param {Date|number|string} [now=new Date()] - reference date.
 * @returns {{transitions: Array<{name, from, to, reason}>, archive: string[],
 *   reactivate: string[], markStale: string[]}}
 */
function computeLifecycleTransitions(records, config, now = new Date()) {
  const resolved = validateConfig(config);
  const reference = now instanceof Date ? now : new Date(now);
  const transitions = [];
  const archive = [];
  const reactivate = [];
  const markStale = [];
  for (const input of records) {
    const record = normalizeRecord(input);
    if (isExempt(record, resolved)) continue;
    const { next, reason } = decideLifecycle(record, resolved, reference);
    if (next !== record.state) {
      transitions.push({ name: record.name, from: record.state, to: next, reason });
      if (next === 'archived') archive.push(record.name);
      else if (next === 'active') reactivate.push(record.name);
      else if (next === 'stale') markStale.push(record.name);
    }
  }
  return { transitions, archive, reactivate, markStale };
}

/**
 * Apply transitions to records, returning updated copies. Pinned / protected /
 * excluded records are returned unchanged; archived records are left alone.
 * @param {Array<object>} records - skill records.
 * @param {object} [config] - day thresholds.
 * @param {Date|number|string} [now=new Date()] - reference date.
 * @returns {Array<object>} updated records (each either unchanged or a copy).
 */
function applyLifecycle(records, config, now = new Date()) {
  const resolved = validateConfig(config);
  const reference = now instanceof Date ? now : new Date(now);
  const byName = new Map(computeLifecycleTransitions(records, resolved, reference).transitions.map((t) => [t.name, t]));
  const out = [];
  for (const input of records) {
    const record = normalizeRecord(input);
    const transition = byName.get(record.name);
    if (transition) out.push({ ...record, state: transition.to, archivedAt: transition.to === 'archived' ? reference.toISOString() : record.archivedAt });
    else out.push(record);
  }
  return out;
}

/**
 * Merge several stale skills into one consolidated record ("merge stale→one").
 * @param {Array<object>} staleRecords - the stale skills to merge.
 * @param {{name?: string, now?: Date}} [opts] - `name` overrides the new name;
 *   default `consolidated`.
 * @returns {{name: string, state: string, created: string, updatedAt: string,
 *   content: string, description: string, mergedFrom: string[], pinned: boolean}}
 *   a single combined record; the caller persists it and drops the originals.
 */
function consolidate(staleRecords, { name = 'consolidated', now = new Date() } = {}) {
  if (!Array.isArray(staleRecords) || staleRecords.length === 0) {
    throw new Error('consolidate requires at least one stale skill');
  }
  const normalized = staleRecords.map((r) => normalizeRecord(r));
  const reference = now instanceof Date ? now : new Date(now);
  const contents = normalized.map((r) => r.content).filter((c) => c !== '');
  const created = normalized
    .map((r) => r.created)
    .filter(Boolean)
    .sort()[0] || reference.toISOString();
  return {
    name,
    state: 'active',
    created,
    updatedAt: reference.toISOString(),
    content: contents.length > 0 ? contents.join('\n\n') : '',
    description: normalized.map((r) => r.description).filter(Boolean).join('; ') || name,
    mergedFrom: normalized.map((r) => r.name),
    pinned: false,
  };
}

/**
 * Restore an archived (or any) skill to `active`. Returns a fresh record copy.
 * @param {object} record - the skill record.
 * @param {Date|number|string} [now=new Date()] - reference date.
 * @returns {object} the restored record with `state: 'active'`.
 */
function restore(record, now = new Date()) {
  const normalized = normalizeRecord(record);
  const reference = now instanceof Date ? now : new Date(now);
  return { ...normalized, state: 'active', restoredAt: reference.toISOString() };
}

module.exports = {
  DAY_MS,
  PROTECTED_SKILLS,
  DEFAULT_CONFIG,
  normalizeRecord,
  validateConfig,
  daysSinceIso,
  ageDays,
  idleDays,
  staleThresholdDays,
  isExempt,
  decideLifecycle,
  computeLifecycleTransitions,
  applyLifecycle,
  consolidate,
  restore,
};