'use strict';
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { ensureDir, writeJsonAtomic, readJson, appendLedger, readLedger, removeStrayTmp } = require('./fs-store');
const { sha256, digestObject } = require('./hash');

/**
 * preset-registry — Logical Preset + Immutable Revision + Current Pointer.
 *
 * Layout (root, default ~/.dsh/preset-registry/):
 *   logical/<logicalId>.json        current/previous/candidates index
 *   revisions/<digest>/             content-addressed, immutable (digest-verified)
 *   pointers/<logicalId>.current.json  { revisionId, digest, updatedAt, gateRunId, approvalId }
 *   staging/<candidateId>/          DRAFT candidates (writable until SEALED)
 *   ledger/ledger.jsonl             append-only WAL
 */
class Registry {
  /**
   * @param {object} opts
   * @param {string} opts.root registry root (override for tests)
   * @param {object} [opts.agentPresets] injected DSH AgentPresets adapter { resolve, copy, mount, list }
   * @param {number} [opts.rollbackWindow] previous revisions to retain for rollback/GC (default 3)
   */
  constructor({ root, agentPresets, rollbackWindow = 3 }) {
    this.root = root;
    this.agentPresets = agentPresets || null;
    this.rollbackWindow = rollbackWindow;
    this._lock = Promise.resolve();
    this.dirs = {
      logical: path.join(root, 'logical'),
      revisions: path.join(root, 'revisions'),
      pointers: path.join(root, 'pointers'),
      ledger: path.join(root, 'ledger'),
      staging: path.join(root, 'staging'),
    };
  }

  // ---- internal -----------------------------------------------------------

  _withLock(fn) {
    const run = this._lock.then(fn);
    this._lock = run.then(() => undefined, () => undefined);
    return run;
  }

  _pointerFile(logicalId) { return path.join(this.dirs.pointers, `${logicalId}.current.json`); }
  _logicalFile(logicalId) { return path.join(this.dirs.logical, `${logicalId}.json`); }
  _revisionDir(digest) { return path.join(this.dirs.revisions, digest); }
  _candidateDir(candidateId) { return path.join(this.dirs.staging, candidateId); }

  async _ensure() {
    for (const d of Object.values(this.dirs)) await ensureDir(d);
    await this._recover();
  }

  /** Crash recovery: drop stray .tmp (atomic rename never half-applies) and replay
   *  WAL for any pointer that is missing/older than its last promote/rollback entry. */
  async _recover() {
    await removeStrayTmp(this.dirs.pointers);
    const ledger = await readLedger(this.dirs.ledger);
    const byLogical = {};
    for (const entry of ledger) {
      if (entry.op !== 'promote' && entry.op !== 'rollback') continue;
      if (!entry.logicalId) continue;
      if (!byLogical[entry.logicalId] || entry.ts > byLogical[entry.logicalId].ts) byLogical[entry.logicalId] = entry;
    }
    for (const [logicalId, entry] of Object.entries(byLogical)) {
      const pointer = await readJson(this._pointerFile(logicalId), null);
      const needsReplay = !pointer || (entry.ts && pointer.updatedAt && entry.ts > pointer.updatedAt) || !pointer.revisionId;
      if (!needsReplay) continue;
      const target = { revisionId: entry.targetRevision, digest: entry.candidateDigest || entry.digest };
      await writeJsonAtomic(this._pointerFile(logicalId), {
        ...target, updatedAt: entry.ts, gateRunId: entry.gateRunId || null, approvalId: entry.approvalId || null, recovered: true,
      });
    }
  }

  // ---- public API ---------------------------------------------------------

  /** Resolve the current revision of a logical preset (incl. the gate run and approval that promoted it). */
  async resolveCurrent(logicalId) {
    await this._ensure();
    const pointer = await readJson(this._pointerFile(logicalId), null);
    if (!pointer || !pointer.revisionId) return null;
    const resolved = this.agentPresets ? await this.agentPresets.resolve(pointer.revisionId) : null;
    return {
      logicalId, revisionId: pointer.revisionId, digest: pointer.digest,
      gateRunId: pointer.gateRunId || null, approvalId: pointer.approvalId || null,
      resolved,
    };
  }

  /** Create a DRAFT candidate staged from a source revision. */
  async createCandidate(logicalId, { sourceRevisionId, evolutionRunId }) {
    await this._ensure();
    const candidateId = `cand-${sha256(`${logicalId}:${sourceRevisionId}:${evolutionRunId}:${Date.now()}`).slice(0, 16)}`;
    const dir = this._candidateDir(candidateId);
    await ensureDir(dir);
    if (this.agentPresets && this.agentPresets.copy) {
      await this.agentPresets.copy(sourceRevisionId, dir);
    } else {
      await writeJsonAtomic(path.join(dir, 'source.json'), { sourceRevisionId, note: 'no adapter' });
    }
    await writeJsonAtomic(path.join(dir, 'candidate.json'), {
      candidateId, logicalId, sourceRevisionId, evolutionRunId,
      status: 'DRAFT', createdAt: new Date().toISOString(), mutations: [],
    });
    await appendLedger(this.dirs.ledger, { op: 'createCandidate', candidateId, logicalId, sourceRevisionId, evolutionRunId });
    return candidateId;
  }

  /** Append a MutationRecord to a DRAFT candidate (SEALED candidates are frozen). */
  async patchCandidate(candidateId, mutation) {
    const dir = this._candidateDir(candidateId);
    const cand = await readJson(path.join(dir, 'candidate.json'), null);
    if (!cand) throw new Error(`candidate not found: ${candidateId}`);
    if (cand.status !== 'DRAFT') throw new Error(`candidate not DRAFT (${cand.status}): ${candidateId}`);
    cand.mutations.push(mutation);
    await writeJsonAtomic(path.join(dir, 'candidate.json'), cand);
    await appendLedger(this.dirs.ledger, { op: 'patchCandidate', candidateId, mutation });
    return cand;
  }

  /** Seal a candidate into an immutable, content-addressed revision. */
  async sealRevision(candidateId) {
    const dir = this._candidateDir(candidateId);
    const cand = await readJson(path.join(dir, 'candidate.json'), null);
    if (!cand) throw new Error(`candidate not found: ${candidateId}`);
    if (cand.status !== 'DRAFT') throw new Error(`already sealed (${cand.status}): ${candidateId}`);
    const manifest = {
      logicalId: cand.logicalId, sourceRevisionId: cand.sourceRevisionId,
      evolutionRunId: cand.evolutionRunId, mutations: cand.mutations,
      sealedAt: new Date().toISOString(),
    };
    const digest = digestObject(manifest);
    cand.status = 'SEALED';
    cand.revisionId = `${cand.logicalId}-${digest.slice(0, 8)}`;
    cand.digest = digest;
    cand.sealedAt = manifest.sealedAt;
    await writeJsonAtomic(path.join(dir, 'candidate.json'), cand);
    const revDir = this._revisionDir(digest);
    await ensureDir(revDir);
    await this._copyDir(dir, revDir);
    await writeJsonAtomic(path.join(revDir, 'manifest.json'), { ...manifest, digest, revisionId: cand.revisionId });
    await appendLedger(this.dirs.ledger, { op: 'sealRevision', candidateId, revisionId: cand.revisionId, digest });
    return { revisionId: cand.revisionId, digest };
  }

  /** CAS promote: only succeeds if expectedCurrent still matches the live pointer. */
  async promote(logicalId, { expectedCurrent, targetRevision, candidateDigest, gateRunId, approvalId }) {
    return this._withLock(async () => {
      await this._ensure();
      const pointer = await readJson(this._pointerFile(logicalId), null);
      const current = pointer && pointer.revisionId ? { revisionId: pointer.revisionId, digest: pointer.digest } : null;
      if (expectedCurrent) {
        if (!current) throw new Error(`CAS failed: expected current ${expectedCurrent.revisionId} but none exists`);
        if (current.revisionId !== expectedCurrent.revisionId) {
          throw new Error(`CAS failed: current=${current.revisionId} expected=${expectedCurrent.revisionId}`);
        }
        if (expectedCurrent.digest && current.digest !== expectedCurrent.digest) {
          throw new Error(`CAS failed: digest mismatch (${current.digest} != ${expectedCurrent.digest})`);
        }
      }
      const revDir = this._revisionDir(candidateDigest);
      if (!fs.existsSync(path.join(revDir, 'manifest.json'))) {
        throw new Error(`target revision not sealed: digest ${candidateDigest}`);
      }
      const next = {
        revisionId: targetRevision, digest: candidateDigest,
        updatedAt: new Date().toISOString(), gateRunId: gateRunId || null, approvalId: approvalId || null,
      };
      await appendLedger(this.dirs.ledger, { op: 'promote', logicalId, targetRevision, candidateDigest, gateRunId, approvalId });
      await writeJsonAtomic(this._pointerFile(logicalId), next);
      const logical = await readJson(this._logicalFile(logicalId), { logicalId, current: null, previous: [], candidates: [] });
      if (logical.current) logical.previous.unshift(logical.current);
      logical.previous = logical.previous.slice(0, this.rollbackWindow);
      logical.current = { revisionId: targetRevision, digest: candidateDigest };
      await writeJsonAtomic(this._logicalFile(logicalId), logical);
      return { ok: true, revisionId: targetRevision, digest: candidateDigest };
    });
  }

  /** O(1) pointer switch back to a previous revision; history is never deleted. */
  async rollback(logicalId, oldRevisionId) {
    return this._withLock(async () => {
      await this._ensure();
      const logical = await readJson(this._logicalFile(logicalId), null);
      if (!logical || !logical.previous.length) throw new Error(`nothing to roll back for ${logicalId}`);
      const target = logical.previous.find((r) => r.revisionId === oldRevisionId) || logical.previous[0];
      const pointer = await readJson(this._pointerFile(logicalId), null);
      await appendLedger(this.dirs.ledger, { op: 'rollback', logicalId, from: pointer && pointer.revisionId, to: target.revisionId, digest: target.digest });
      await writeJsonAtomic(this._pointerFile(logicalId), {
        ...(pointer || {}), revisionId: target.revisionId, digest: target.digest,
        updatedAt: new Date().toISOString(), rolledBack: true,
      });
      // History is never deleted: the revision we rolled back from becomes a previous entry,
      // and the target (previously previous) becomes current again.
      logical.previous = logical.previous.filter((r) => r.revisionId !== target.revisionId);
      if (logical.current) logical.previous.unshift(logical.current);
      logical.previous = logical.previous.slice(0, this.rollbackWindow);
      logical.current = target;
      await writeJsonAtomic(this._logicalFile(logicalId), logical);
      return { ok: true, revisionId: target.revisionId, digest: target.digest };
    });
  }

  /** Query revision history (active + previous). */
  async history(logicalId) {
    await this._ensure();
    const logical = await readJson(this._logicalFile(logicalId), null);
    if (!logical || !logical.current) return [];
    const out = [{ revisionId: logical.current.revisionId, digest: logical.current.digest, status: 'active' }];
    for (const r of logical.previous) out.push({ revisionId: r.revisionId, digest: r.digest, status: 'previous' });
    return out;
  }

  /** GC candidates. MVP: only unsealed DRAFT candidates are removable;
   *  SEALED candidates (which own revisions) and anything referenced by
   *  pointer/logical/rollback-window/SessionHeader are protected. */
  async gcCandidates() {
    await this._ensure();
    let removed = 0;
    const entries = await fsp.readdir(this.dirs.staging).catch(() => []);
    for (const name of entries) {
      const cand = await readJson(path.join(this.dirs.staging, name, 'candidate.json'), null);
      if (!cand) continue;
      if (cand.status === 'SEALED') continue; // owns an immutable revision — protected
      await fsp.rm(this._candidateDir(name), { recursive: true, force: true });
      await appendLedger(this.dirs.ledger, { op: 'gcCandidate', candidateId: name });
      removed += 1;
    }
    return removed;
  }

  /** Verify an immutable revision's content still matches its recorded digest. */
  async verifyRevisionDigest(digest) {
    const manifest = await readJson(path.join(this._revisionDir(digest), 'manifest.json'), null);
    if (!manifest) return { ok: false, reason: 'missing manifest' };
    const recomputed = digestObject({ ...manifest, digest: undefined, revisionId: undefined });
    return { ok: recomputed === digest, recorded: digest, recomputed };
  }

  /**
   * Read an immutable revision's content files (everything except control
   * bookkeeping: manifest.json / candidate.json / source.json), for semantic
   * comparison such as near-duplicate detection.
   * @param {string} digest - content-addressed revision digest.
   * @returns {Promise<{ files: Record<string,string>, text: string } | null>}
   *   null when the revision does not exist.
   */
  async revisionContent(digest) {
    const dir = this._revisionDir(digest);
    if (!fs.existsSync(dir)) return null;
    const control = new Set(['manifest.json', 'candidate.json', 'source.json']);
    const files = {};
    const walk = async (rel) => {
      const abs = rel === '' ? dir : path.join(dir, rel);
      const st = await fsp.stat(abs);
      if (st.isDirectory()) {
        for (const name of await fsp.readdir(abs)) await walk(path.join(rel, name));
        return;
      }
      if (control.has(path.basename(abs))) return;
      files[rel.split(path.sep).join('/')] = await fsp.readFile(abs, 'utf8');
    };
    await walk('');
    const text = Object.values(files).join('\n');
    return { files, text };
  }

  // ---- helpers ------------------------------------------------------------

  async _copyDir(src, dest) {
    await ensureDir(dest);
    const entries = await fsp.readdir(src).catch(() => []);
    for (const name of entries) {
      const s = path.join(src, name);
      const d = path.join(dest, name);
      const st = await fsp.stat(s);
      if (st.isDirectory()) await this._copyDir(s, d);
      else await fsp.copyFile(s, d);
    }
  }
}

module.exports = { Registry };
