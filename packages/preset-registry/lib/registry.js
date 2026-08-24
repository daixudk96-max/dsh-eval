'use strict';
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { ensureDir, writeJsonAtomic, readJson, appendLedger, readLedger, removeStrayTmp } = require('./fs-store');
const { sha256, digestObject } = require('./hash');

/**
 * Build the inverse edit list that transforms `currentFiles` back into
 * `targetFiles` (diff inversion). Pure data transform — no LLM. Each edit is
 * `{ action: 'create'|'update'|'delete', path, content? }`; create/update carry
 * the target content, delete restores by removing the file.
 * @param {Record<string,string>} currentFiles - applied (current) content files.
 * @param {Record<string,string>} targetFiles - revision to restore to.
 * @returns {Array<{action:string,path:string,content?:string}>} inverse edits.
 */
function buildInverseEdits(currentFiles, targetFiles) {
  const edits = [];
  const all = new Set([...Object.keys(currentFiles), ...Object.keys(targetFiles)]);
  for (const p of all) {
    const cur = currentFiles[p];
    const tgt = targetFiles[p];
    if (cur === tgt) continue;
    if (cur === undefined) edits.push({ action: 'create', path: p, content: tgt });
    else if (tgt === undefined) edits.push({ action: 'delete', path: p });
    else edits.push({ action: 'update', path: p, content: tgt });
  }
  return edits;
}

/** Set of file paths whose content differs between two file maps. */
function changedFiles(aFiles, bFiles) {
  const all = new Set([...Object.keys(aFiles), ...Object.keys(bFiles)]);
  const changed = new Set();
  for (const p of all) {
    if (aFiles[p] !== bFiles[p]) changed.add(p);
  }
  return changed;
}

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
    return this._withLock(() => this._promoteLocked(logicalId, { expectedCurrent, targetRevision, candidateDigest, gateRunId, approvalId }));
  }

  /** Promote core; assumes the registry lock is already held (call via promote or rollbackContent). */
  async _promoteLocked(logicalId, { expectedCurrent, targetRevision, candidateDigest, gateRunId, approvalId }) {
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

  /**
   * Content-level deterministic rollback (P2-1/2): rebuild the inverse edits
   * that transform the applied current content back to a target revision's
   * content (diff inversion, no LLM), then write the restored content back as
   * a NEW content-addressed revision and promote it via CAS. This deepens the
   * pointer-level `rollback` to a content-level restore that is byte-for-byte
   * reproducible from the revisions themselves.
   *
   * Conflict detection (P2-2): when `detectConflicts` (default true) and not
   * `force`, any intermediate revision between current and target that changed
   * a file the rollback touches raises a conflict error — conservative, human
   * decides. `force` overrides.
   * @param {string} logicalId
   * @param {string} targetRevisionId - revision to restore to (must be in history).
   * @param {object} [opts]
   * @param {boolean} [opts.detectConflicts=true] - reject when an intermediate
   *   revision changed a file the rollback touches.
   * @param {boolean} [opts.force=false] - skip conflict detection.
   * @param {string} [opts.gateRunId='rollback-content'] - gate binding for the new revision.
   * @param {string} [opts.approvalId='rollback-content'] - approval binding for the new revision.
   * @returns {Promise<{ok:boolean,noop?:boolean,edits:Array,revisionId:string,digest:string}>}
   */
  async rollbackContent(logicalId, targetRevisionId, { detectConflicts = true, force = false, gateRunId = 'rollback-content', approvalId = 'rollback-content' } = {}) {
    return this._withLock(async () => {
      await this._ensure();
      const current = await this.resolveCurrent(logicalId);
      if (!current) throw new Error(`no current revision for ${logicalId}`);
      const history = await this.history(logicalId);
      const target = history.find((r) => r.revisionId === targetRevisionId);
      if (!target) throw new Error(`target revision not in history: ${targetRevisionId}`);
      const currentContent = await this.revisionContent(current.digest);
      const targetContent = await this.revisionContent(target.digest);
      if (!currentContent || !targetContent) throw new Error('rollback: revision content missing');
      const edits = buildInverseEdits(currentContent.files, targetContent.files);
      if (edits.length === 0) {
        await appendLedger(this.dirs.ledger, { op: 'rollbackContent', logicalId, targetRevisionId, edits: 0, noop: true });
        return { ok: true, noop: true, edits, revisionId: current.revisionId, digest: current.digest };
      }
      if (detectConflicts && !force) {
        const conflict = await this._detectRollbackConflict(logicalId, current, target, edits);
        if (conflict) throw new Error(`rollback conflict: ${conflict}`);
      }
      // Write back: stage the restored (target) content, seal a new revision, promote via CAS.
      const candidateId = await this.createCandidate(logicalId, { sourceRevisionId: current.revisionId, evolutionRunId: 'rollback-content' });
      const dir = this._candidateDir(candidateId);
      for (const [name, content] of Object.entries(targetContent.files)) {
        const abs = path.join(dir, name);
        await ensureDir(path.dirname(abs));
        await fsp.writeFile(abs, content, 'utf8');
      }
      const sealed = await this.sealRevision(candidateId);
      await this._promoteLocked(logicalId, {
        expectedCurrent: { revisionId: current.revisionId, digest: current.digest },
        targetRevision: sealed.revisionId, candidateDigest: sealed.digest,
        gateRunId, approvalId,
      });
      await appendLedger(this.dirs.ledger, { op: 'rollbackContent', logicalId, targetRevisionId, edits: edits.length, revisionId: sealed.revisionId, digest: sealed.digest });
      return { ok: true, edits, revisionId: sealed.revisionId, digest: sealed.digest };
    });
  }

  /**
   * Conservative partial-rollback conflict detection: any intermediate revision
   * between current and target that changed a file the rollback touches is a
   * conflict (human decides). Returns a human-readable reason or null.
   */
  async _detectRollbackConflict(logicalId, current, target, edits) {
    const history = await this.history(logicalId);
    const targetIdx = history.findIndex((r) => r.revisionId === target.revisionId);
    if (targetIdx < 0) return null;
    const touched = new Set(edits.map((e) => e.path));
    for (let i = 1; i < targetIdx; i += 1) {
      const rev = history[i];
      const pred = history[i + 1];
      const revContent = await this.revisionContent(rev.digest);
      const predContent = await this.revisionContent(pred.digest);
      if (!revContent || !predContent) continue;
      const changed = changedFiles(revContent.files, predContent.files);
      const intersect = [...changed].filter((f) => touched.has(f));
      if (intersect.length > 0) {
        return `intermediate revision ${rev.revisionId} changed ${intersect.join(', ')}`;
      }
    }
    return null;
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

  // ---- archive (P0-4): export / import -----------------------------------

  /**
   * Export the whole registry (logical/** , pointers/**, revisions/** and the
   * byte-preserved ledger) into one self-verifying JSON package. staging/**,
   * .tmp files and live adapter state are excluded. ALL revisions are
   * exported, not only the rollback window.
   * @param {string} outPath - destination JSON path.
   * @returns {Promise<{ schemaVersion: number, packageDigest: string, fileCount: number }>}
   */
  async exportSnapshot(outPath) {
    await this._ensure();
    const files = [];
    const walk = async (rel) => {
      const abs = path.join(this.root, rel);
      const st = await fsp.stat(abs).catch(() => null);
      if (!st) return;
      if (st.isDirectory()) {
        for (const name of await fsp.readdir(abs)) await walk(path.join(rel, name));
        return;
      }
      if (rel.endsWith('.tmp')) return;
      const bytes = await fsp.readFile(abs);
      files.push({
        path: rel.split(path.sep).join('/'),
        encoding: 'base64',
        content: bytes.toString('base64'),
        sha256: sha256(bytes.toString('utf8')),
      });
    };
    for (const d of ['logical', 'pointers', 'revisions', 'ledger']) await walk(d);
    files.sort((a, b) => a.path.localeCompare(b.path));
    const packageDigest = digestObject({ schemaVersion: 1, files });
    const pkg = { schemaVersion: 1, exportedAt: new Date().toISOString(), files, packageDigest };
    await writeJsonAtomic(outPath, pkg);
    return { schemaVersion: 1, packageDigest, fileCount: files.length };
  }

  /**
   * Import a snapshot package into a NEW or EMPTY registry root. Validates
   * schema/version, path safety (no traversal/absolute/duplicate), per-file
   * hashes, the package digest, revision manifest digests, and pointer/logical
   * references BEFORE writing anything. A temporary sibling root is populated
   * and recovered, then renamed over an absent target; an existing empty
   * target is filled only after all validation. Any failure leaves an
   * existing target untouched.
   * @param {object} args
   * @param {string} args.root - target registry root (must be absent or empty).
   * @param {string} args.inPath - snapshot JSON path.
   * @param {boolean} [args.verify=true] - run full integrity verification.
   * @returns {Promise<{ imported: number, packageDigest: string, revisions: string[] }>}
   */
  static async importSnapshot({ root, inPath, verify = true }) {
    const pkg = await readJson(inPath, null);
    if (!pkg) throw new Error(`import: cannot read ${inPath}`);
    if (pkg.schemaVersion !== 1) throw new Error(`import: unsupported schemaVersion ${pkg.schemaVersion}`);
    if (!Array.isArray(pkg.files)) throw new Error('import: missing files array');
    const seen = new Set();
    for (const f of pkg.files) {
      if (typeof f.path !== 'string' || f.path === '') throw new Error('import: invalid file path');
      const norm = path.normalize(f.path);
      if (path.isAbsolute(norm) || norm.startsWith('..') || norm.includes(`..${path.sep}`)) {
        throw new Error(`import: unsafe path ${f.path}`);
      }
      if (seen.has(norm)) throw new Error(`import: duplicate path ${f.path}`);
      seen.add(norm);
      if (f.encoding !== 'base64' || typeof f.content !== 'string') throw new Error(`import: bad encoding for ${f.path}`);
      if (verify) {
        const bytes = Buffer.from(f.content, 'base64');
        if (sha256(bytes.toString('utf8')) !== f.sha256) throw new Error(`import: hash mismatch for ${f.path}`);
      }
    }
    if (verify) {
      const computed = digestObject({ schemaVersion: 1, files: pkg.files });
      if (computed !== pkg.packageDigest) throw new Error('import: package digest mismatch');
    }
    const targetExists = fs.existsSync(root);
    if (targetExists) {
      const entries = await fsp.readdir(root);
      if (entries.length > 0) throw new Error(`import: target root not empty: ${root}`);
    }
    const parent = path.dirname(root);
    const tmpRoot = path.join(parent, `.import-${Date.now().toString(36)}`);
    await ensureDir(tmpRoot);
    try {
      for (const f of pkg.files) {
        const abs = path.join(tmpRoot, f.path);
        await ensureDir(path.dirname(abs));
        await fsp.writeFile(abs, Buffer.from(f.content, 'base64'));
      }
      if (verify) {
        const revDir = path.join(tmpRoot, 'revisions');
        for (const d of await fsp.readdir(revDir).catch(() => [])) {
          const manifest = await readJson(path.join(revDir, d, 'manifest.json'), null);
          if (!manifest) throw new Error(`import: revision ${d} missing manifest`);
          if (manifest.digest !== d) throw new Error(`import: revision manifest digest mismatch for ${d}`);
        }
        const pointersDir = path.join(tmpRoot, 'pointers');
        for (const name of await fsp.readdir(pointersDir).catch(() => [])) {
          const pointer = await readJson(path.join(pointersDir, name), null);
          if (pointer && pointer.digest && !fs.existsSync(path.join(tmpRoot, 'revisions', pointer.digest))) {
            throw new Error(`import: pointer ${name} references missing revision ${pointer.digest}`);
          }
        }
        const logicalDir = path.join(tmpRoot, 'logical');
        for (const name of await fsp.readdir(logicalDir).catch(() => [])) {
          const logical = await readJson(path.join(logicalDir, name), null);
          if (logical && logical.current && logical.current.digest
            && !fs.existsSync(path.join(tmpRoot, 'revisions', logical.current.digest))) {
            throw new Error(`import: logical ${name} references missing revision ${logical.current.digest}`);
          }
        }
      }
      if (targetExists) {
        for (const f of pkg.files) {
          const abs = path.join(root, f.path);
          await ensureDir(path.dirname(abs));
          await fsp.writeFile(abs, Buffer.from(f.content, 'base64'));
        }
        await fsp.rm(tmpRoot, { recursive: true, force: true });
      } else {
        await fsp.rename(tmpRoot, root);
      }
    } catch (error) {
      await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    const revisions = await fsp.readdir(path.join(root, 'revisions')).catch(() => []);
    return { imported: pkg.files.length, packageDigest: pkg.packageDigest, revisions };
  }
}

module.exports = { Registry, buildInverseEdits, changedFiles };
