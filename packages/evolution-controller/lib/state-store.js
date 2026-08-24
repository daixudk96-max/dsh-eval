'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * P3-2 state-store: a thin durable state layer over the existing
 * preset-registry. It maps a logicalId of the form `state:<kind>:<id>` (kinds
 * prompt | memory | skill | subagent-spec) onto the current Registry public
 * API (createCandidate / sealRevision / promote CAS / history /
 * rollbackContent). One registry entry is one immutable revision of a single
 * `entry.json` content file; the entry's own `version` counter and `updatedAt`
 * ride inside that record, so the registry's CAS-promote gives per-id
 * optimistic concurrency for free.
 *
 * Registry compatibility:
 * - No new registry API was added; state-store only consumes the existing
 *   public methods plus the public `registry.dirs` layout.
 * - Exactly one minimal, backward-compatible registry change was required:
 *   percent-encoding `:` / `%` in the pointer/logical FILE NAMES only
 *   (`registry.js` `_safeFileId`), because `state:<kind>:<id>` logical ids
 *   contain `:`, which is illegal in Windows file names. The encoding is
 *   identity for every existing preset id (e.g. `coding`, `evaluate`), and in
 *   all registry JSON files the logicalId is stored verbatim — only filesystem
 *   names are encoded. All existing registry behavior and layouts are
 *   unchanged.
 *
 * @module evolution-controller/lib/state-store
 */

/** The `state:<kind>:<id>` kinds this layer accepts. */
const STATE_KINDS = Object.freeze(['prompt', 'memory', 'skill', 'subagent-spec']);
/** File name inside each revision holding the entry record. */
const ENTRY_FILE = 'entry.json';

/** Validate a kind and return its `state:<kind>:<id>` logical id. */
function logicalIdFor(kind, id) {
  if (!STATE_KINDS.includes(kind)) throw new Error(`unknown state kind: ${kind} (expected one of ${STATE_KINDS.join(', ')})`);
  if (typeof id !== 'string' || id.trim() === '') throw new Error(`state id must be a non-empty string, got ${JSON.stringify(id)}`);
  if (id.includes(':') || id.includes('/') || id.includes('\\')) throw new Error(`state id must not contain ':', '/', or '\\': ${JSON.stringify(id)}`);
  return `state:${kind}:${id}`;
}

/** Returns `{ kind, id }` when a logicalId is a state id, else null. */
function parseLogicalId(logicalId) {
  const match = /^state:([a-z0-9-]+):(.+)$/u.exec(String(logicalId));
  if (!match) return null;
  const kind = match[1];
  if (!STATE_KINDS.includes(kind)) return null;
  return { kind, id: match[2] };
}

/** True when a logicalId is a state-store id. */
function isStateLogicalId(logicalId) {
  return parseLogicalId(logicalId) !== null;
}

/**
 * Parse and validate an entry record from the `entry.json` file content.
 * @param {string} json - the file text.
 * @returns {{id: string, kind: string, version: number, content: string, updatedAt: string}}
 */
function parseEntryRecord(json) {
  let record;
  try {
    record = JSON.parse(json);
  } catch (error) {
    throw new Error(`corrupt state entry: ${error.message}`);
  }
  if (!record || typeof record !== 'object') throw new Error('corrupt state entry: not an object');
  if (typeof record.id !== 'string' || typeof record.kind !== 'string') {
    throw new Error('corrupt state entry: missing string id/kind');
  }
  if (typeof record.version !== 'number' || !Number.isInteger(record.version) || record.version < 0) {
    throw new Error('corrupt state entry: version must be a non-negative integer');
  }
  if (typeof record.content !== 'string') throw new Error('corrupt state entry: content must be a string');
  if (typeof record.updatedAt !== 'string') throw new Error('corrupt state entry: updatedAt must be an ISO string');
  return {
    id: record.id,
    kind: record.kind,
    version: record.version,
    content: record.content,
    updatedAt: record.updatedAt,
  };
}

/**
 * Thin versioned state store.
 */
class StateStore {
  /**
   * @param {{ registry: object, now?: (() => Date | number | string),
   *   change?: string }} opts - `registry` is a preset-registry Registry; `now`
   *   overrides the timestamp source; `change` labels audit/gate runs.
   */
  constructor({ registry, now = () => new Date(), change = 'state-write' }) {
    if (!registry || typeof registry.resolveCurrent !== 'function') {
      throw new Error('StateStore requires a preset-registry Registry');
    }
    this.registry = registry;
    this._now = now;
    this._change = change;
  }

  _timestamp() {
    const value = this._now();
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString();
  }

  async _readContent(logicalId) {
    const current = await this.registry.resolveCurrent(logicalId);
    if (!current) return null;
    const content = await this.registry.revisionContent(current.digest);
    if (!content || !content.files || typeof content.files[ENTRY_FILE] !== 'string') return null;
    return { current, record: parseEntryRecord(content.files[ENTRY_FILE]) };
  }

  /**
   * Read the current entry record for (kind, id), or null when absent.
   * @returns {Promise<{id, kind, version, content, updatedAt, logicalId, revisionId, digest}|null>}
   */
  async read(kind, id) {
    const logicalId = logicalIdFor(kind, id);
    const found = await this._readContent(logicalId);
    if (!found) return null;
    return {
      ...found.record,
      logicalId,
      revisionId: found.current.revisionId,
      digest: found.current.digest,
    };
  }

  /**
   * Write (create or update) an entry. Appends a new immutable revision and
   * CAS-promotes it against the current pointer, so a stale overwrite fails.
   * @param {string} kind - one of STATE_KINDS.
   * @param {string} id - entry id within the kind.
   * @param {string} content - the entry content.
   * @returns {Promise<{id, kind, version, content, updatedAt, logicalId, revisionId, digest}>}
   */
  async write(kind, id, content, { expectedCurrent } = {}) {
    const logicalId = logicalIdFor(kind, id);
    if (typeof content !== 'string') throw new Error(`state content must be a string for ${logicalId}`);
    const found = await this._readContent(logicalId);
    const current = found ? found.current : null;
    if (expectedCurrent !== undefined) {
      const actual = current ? `${current.revisionId}:${current.digest}` : null;
      const wanted = expectedCurrent ? `${expectedCurrent.revisionId}:${expectedCurrent.digest}` : null;
      if (actual !== wanted) {
        throw new Error(`state write conflict for ${logicalId}: expected ${wanted ?? '(none)'}, got ${actual ?? '(none)'}`);
      }
    }
    const priorVersion = found ? found.record.version : 0;
    const record = {
      id,
      kind,
      version: priorVersion + 1,
      content,
      updatedAt: this._timestamp(),
    };
    const candidateId = await this.registry.createCandidate(logicalId, {
      sourceRevisionId: current ? current.revisionId : null,
      evolutionRunId: this._change,
    });
    await fsp.writeFile(
      path.join(this.registry.dirs.staging, candidateId, ENTRY_FILE),
      `${JSON.stringify(record, null, 2)}\n`,
      'utf8',
    );
    const sealed = await this.registry.sealRevision(candidateId);
    await this.registry.promote(logicalId, {
      expectedCurrent: current ? { revisionId: current.revisionId, digest: current.digest } : null,
      targetRevision: sealed.revisionId,
      candidateDigest: sealed.digest,
      gateRunId: `state:${this._change}`,
      approvalId: this._change,
    });
    return { ...record, logicalId, revisionId: sealed.revisionId, digest: sealed.digest };
  }

  /**
   * Version history for one entry, oldest first, with the registry revision
   * metadata per version.
   * @returns {Promise<Array<{id, kind, version, updatedAt, revisionId, digest, status}>>}
   */
  async versions(kind, id) {
    const logicalId = logicalIdFor(kind, id);
    const history = await this.registry.history(logicalId);
    const out = [];
    for (const item of history) {
      const content = await this.registry.revisionContent(item.digest);
      if (!content || typeof content.files[ENTRY_FILE] !== 'string') continue;
      const record = parseEntryRecord(content.files[ENTRY_FILE]);
      out.push({ ...record, revisionId: item.revisionId, digest: item.digest, status: item.status });
    }
    return out.sort((a, b) => a.version - b.version);
  }

  /**
   * Content-level rollback of one entry to a previous revision id (as returned
   * by `versions`). Restores the target's `entry.json` content through the
   * registry's rollbackContent (new revision + CAS promote).
   * @param {string} targetRevisionId - a revision id from `versions(kind, id)`.
   * @returns {Promise<{logicalId, revisionId, digest, record}>}
   */
  async rollback(kind, id, targetRevisionId, { detectConflicts = true, force = false } = {}) {
    const logicalId = logicalIdFor(kind, id);
    const versions = await this.versions(kind, id);
    if (!versions.some((v) => v.revisionId === targetRevisionId)) {
      throw new Error(`no revision ${targetRevisionId} in history of ${logicalId}`);
    }
    const result = await this.registry.rollbackContent(logicalId, targetRevisionId, {
      detectConflicts,
      force,
      gateRunId: 'state-rollback',
      approvalId: 'state-rollback',
    });
    const found = await this._readContent(logicalId);
    return {
      logicalId,
      revisionId: result.revisionId,
      digest: result.digest,
      record: found ? found.record : null,
    };
  }

  /**
   * List all entries, optionally narrowed to one kind, sorted by kind then id.
   * Scans the registry's logical index directory (file-safe names are decoded
   * back to `state:<kind>:<id>`).
   * @param {string|null} kind - one of STATE_KINDS, or null for all.
   * @returns {Promise<Array<{id, kind, version, content, updatedAt, logicalId, revisionId, digest}>>}
   */
  async list(kind = null) {
    if (kind !== null && !STATE_KINDS.includes(kind)) throw new Error(`unknown state kind: ${kind}`);
    const names = await fsp.readdir(this.registry.dirs.logical).catch(() => []);
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const decoded = name
        .slice(0, -'.json'.length)
        .replace(/%3A/gu, ':')
        .replace(/%25/gu, '%');
      const parsed = parseLogicalId(decoded);
      if (!parsed) continue;
      if (kind !== null && parsed.kind !== kind) continue;
      const found = await this._readContent(`state:${parsed.kind}:${parsed.id}`);
      if (!found) continue;
      out.push({
        ...found.record,
        logicalId: `state:${parsed.kind}:${parsed.id}`,
        revisionId: found.current.revisionId,
        digest: found.current.digest,
      });
    }
    return out.sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind)));
  }
}

module.exports = {
  STATE_KINDS,
  ENTRY_FILE,
  logicalIdFor,
  parseLogicalId,
  isStateLogicalId,
  parseEntryRecord,
  StateStore,
};