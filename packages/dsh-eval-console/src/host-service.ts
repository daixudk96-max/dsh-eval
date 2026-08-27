/**
 * EvalConsoleHostService: the Host half of the evolution console.
 *
 * Original work for the dsh-eval project (Apache-2.0). Wraps the real
 * preset-registry Registry + the evolution-audit JSONL ledger and exposes the
 * /eval channel data model:
 *
 *   - snapshot()   live-reads registry.resolveCurrent + history + the pointer
 *                  file (updatedAt) + the audit ledger and folds them through
 *                  the pure adapter into an EvalSnapshot (revision counter =
 *                  number of audit records read);
 *   - subscribe()  SSE push of lightweight event frames (never the big
 *                  snapshot) whenever the audit ledger grows;
 *   - apply()      the read-only-first action surface: detail (revision
 *                  content) and rollback (registry.rollbackContent, confirm-
 *                  gated). Promote is never reachable from here — the UI is
 *                  deliberately unable to advance the registry pointer.
 *
 * rollback is the only write and it mutates the real registry (content-level
 * rollback writes a new revision and promotes it), so it is kept behind an
 * explicit confirm token enforced upstream in parseActionEnvelope plus a
 * logicalId sanity check here.
 */

import type { AuditEntry, RegistryCurrentFacts } from './domain/adapter.ts'
import { buildSnapshot, shortDigest } from './domain/adapter.ts'
import type { EvalAction, EvalActionResult, EvalEventPayload, EvalHistoryEntry, EvalSnapshot, EvalTimelineEvent } from './domain/protocol.ts'
import { readAuditEntries, appendAuditLine } from './audit.ts'
import { syncRevision } from './version-sync.ts'

/** Structural subset of packages/preset-registry/lib/registry.js. */
export interface RegistryLike {
  resolveCurrent(logicalId: string): Promise<RegistryCurrentFacts | null>
  history(logicalId: string): Promise<EvalHistoryEntry[]>
  revisionContent(digest: string): Promise<{ files: Record<string, string>; text: string } | null>
  rollbackContent(
    logicalId: string,
    targetRevisionId: string,
    opts?: { detectConflicts?: boolean; force?: boolean; gateRunId?: string; approvalId?: string },
  ): Promise<{ ok: boolean; noop?: boolean; edits?: number; revisionId: string; digest: string }>
}

/**
 * Structural subset of the DSH sessionPersistence service (inspect only) —
 * the official API preset-switcher-style plugins use to read a stored
 * session's meta + events (handles the backend's multi-frame zstd container).
 */
export interface SessionPersistenceLike {
  inspect(sessionId: string): Promise<{ meta?: unknown; events?: unknown[] } | null>
}

export interface EvalConsoleHostOptions {
  /** The preset-registry Registry instance (owned by the caller). */
  registry: RegistryLike
  /** Registry root directory — used to read the pointer file for updatedAt. */
  registryRoot: string
  /** The logical model id, e.g. 'evaluate'. */
  logicalId: string
  /** Absolute path to the evolution-audit ledger.jsonl. */
  auditFile: string
  /** Agent-presets install root ($DSH_HOME/.agent-presets) for switch-revision. */
  agentPresetsRoot: string
  /**
   * Optional DSH sessionPersistence service. When present, the console can
   * resolve the preset a session runs with (last `agent-preset/selected`
   * event, else the session header) so the version control binds to the
   * session's actual preset. Absent → sessionPresetOf() returns null.
   */
  sessionPersistence?: SessionPersistenceLike
  /** Timeline tail cap (oldest first, newest kept). Default 120. */
  tailLimit?: number
  /** Audit poll interval. Default 5000ms. */
  pollMs?: number
}

export type EvalConsoleListener = (payload: EvalEventPayload) => void

interface PointerFile {
  revisionId?: string
  updatedAt?: string
}

const POINTER_DIR = 'pointers'

export class EvalConsoleHostService {
  private readonly registry: RegistryLike
  private readonly registryRoot: string
  readonly logicalId: string
  private readonly auditFile: string
  private readonly agentPresetsRoot: string
  private readonly tailLimit: number
  private readonly pollMs: number
  private readonly sessionPersistence: SessionPersistenceLike | undefined

  private readonly listeners = new Set<EvalConsoleListener>()
  private timer: ReturnType<typeof setInterval> | undefined
  private disposed = false

  /** Last observed audit entry count — the snapshot `revision` number. */
  private revision = 0
  private lastSnapshot: EvalSnapshot | undefined

  constructor(options: EvalConsoleHostOptions) {
    this.registry = options.registry
    this.registryRoot = options.registryRoot
    this.logicalId = options.logicalId
    this.auditFile = options.auditFile
    this.agentPresetsRoot = options.agentPresetsRoot
    this.sessionPersistence = options.sessionPersistence
    this.tailLimit = options.tailLimit ?? 120
    this.pollMs = options.pollMs ?? 5000
  }

  /** Begin polling the audit ledger; idempotent. */
  start(): void {
    if (this.timer !== undefined || this.disposed) return
    void this.refresh().catch(() => undefined)
    this.timer = setInterval(() => {
      void this.pollOnce().catch(() => undefined)
    }, this.pollMs)
    this.timer.unref?.()
  }

  /** Poll the ledger; emit a frame only when new records arrived. */
  private async pollOnce(): Promise<void> {
    const count = (await readAuditEntries(this.auditFile)).length
    if (count > this.revision) {
      await this.refresh()
      this.emit(await this.eventPayload())
    }
  }

  /**
   * Read the pointer file for updatedAt (tolerant of absence).
   * Parameterised so a snapshot can be assembled for any logical preset.
   */
  private async readPointerUpdatedAt(logicalId: string = this.logicalId): Promise<string | null> {
    const file = `${this.registryRoot}/${POINTER_DIR}/${logicalId}.current.json`
    try {
      const { readFile } = await import('node:fs/promises')
      const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
      const pointer = parsed as PointerFile
      return typeof pointer.updatedAt === 'string' && pointer.updatedAt !== '' ? pointer.updatedAt : null
    } catch {
      return null
    }
  }

  /**
   * Assemble a fresh snapshot from live registry + audit reads.
   *
   * The logical preset defaults to the configured one (config.logicalId) but
   * can be overridden per request — the UI asks for the *current session's*
   * preset and renders the version control only when that preset actually has
   * a revision chain (current or history non-empty).
   */
  async snapshot(logicalId: string = this.logicalId): Promise<EvalSnapshot> {
    const [current, history, audit, updatedAt] = await Promise.all([
      this.registry.resolveCurrent(logicalId),
      this.registry.history(logicalId),
      readAuditEntries(this.auditFile),
      this.readPointerUpdatedAt(logicalId),
    ])
    const currentFacts: RegistryCurrentFacts | null =
      current === null
        ? null
        : {
            logicalId: current.logicalId,
            revisionId: current.revisionId,
            digest: current.digest,
            gateRunId: current.gateRunId ?? null,
            approvalId: current.approvalId ?? null,
            resolved: current.resolved,
            ...(updatedAt === null ? {} : { updatedAt }),
          }
    const snapshot = buildSnapshot({
      logicalId,
      revision: audit.length,
      current: currentFacts,
      history,
      audit,
      tailLimit: this.tailLimit,
    })
    this.revision = audit.length
    this.lastSnapshot = snapshot
    return snapshot
  }

  /** Recompute the snapshot cache (no emit). */
  private async refresh(): Promise<void> {
    await this.snapshot()
  }

  /**
   * Lightweight SSE frame — never the big snapshot. Frames always describe
   * the configured logical preset (the default chain), never an arbitrary
   * per-request snapshot another client asked for.
   */
  async eventPayload(): Promise<EvalEventPayload> {
    const snapshot =
      this.lastSnapshot !== undefined && this.lastSnapshot.logicalId === this.logicalId
        ? this.lastSnapshot
        : await this.snapshot()
    return {
      revision: snapshot.revision,
      logicalId: snapshot.logicalId,
      currentRevisionId: snapshot.current?.revisionId ?? null,
      generatedAt: new Date().toISOString(),
    }
  }

  /** Register an SSE listener; returns a disposer. */
  subscribe(listener: EvalConsoleListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(payload: EvalEventPayload): void {
    for (const listener of this.listeners) {
      try {
        listener(payload)
      } catch {
        // A listener's throw must not break the other SSE clients.
      }
    }
  }

  /** Resolve a revisionId -> digest from current/history/audit facts. */
  private async digestForRevision(revisionId: string): Promise<string | null> {
    const [current, history, audit] = await Promise.all([
      this.registry.resolveCurrent(this.logicalId),
      this.registry.history(this.logicalId),
      readAuditEntries(this.auditFile),
    ])
    if (current !== null && current.revisionId === revisionId) return current.digest
    for (const entry of history) {
      if (entry.revisionId === revisionId) return entry.digest
    }
    for (const entry of audit) {
      if (entry.revisionId === revisionId && typeof entry.digest === 'string') return entry.digest
    }
    return null
  }

  /**
   * Apply a validated action envelope (parseActionEnvelope ran upstream).
   * Read-only except rollback, which is confirm-gated and logicalId-checked.
   */
  async apply(requestId: string, action: EvalAction): Promise<EvalActionResult> {
    switch (action.kind) {
      case 'detail': {
        const digest = await this.digestForRevision(action.revisionId)
        if (digest === null) {
          throw new Error(`unknown revision: ${action.revisionId}`)
        }
        const content = await this.registry.revisionContent(digest)
        const files = content?.files ?? {}
        return { ok: true, action: 'detail', revisionId: action.revisionId, digest, files }
      }
      case 'rollback': {
        if (action.logicalId !== this.logicalId) {
          throw new Error(`rollback logicalId mismatch: ${action.logicalId} != ${this.logicalId}`)
        }
        const result = await this.registry.rollbackContent(action.logicalId, action.revisionId, {
          detectConflicts: true,
          force: false,
          gateRunId: `eval-console-${requestId.slice(0, 8)}`,
          approvalId: `eval-console-${requestId.slice(0, 8)}`,
        })
        return {
          ok: result.ok === true,
          action: 'rollback',
          logicalId: action.logicalId,
          targetRevisionId: action.revisionId,
          revisionId: result.revisionId,
          digest: result.digest,
          edits: result.edits ?? 0,
          noop: result.noop === true,
        }
      }
      case 'refresh': {
        return { ok: true, action: 'refresh', snapshot: await this.snapshot() }
      }
      case 'switch-revision': {
        const digest = await this.digestForRevision(action.revisionId)
        if (digest === null) throw new Error(`unknown revision: ${action.revisionId}`)
        const content = await this.registry.revisionContent(digest)
        if (content === null) {
          throw new Error(`revision content unavailable: ${digest.slice(0, 8)}`)
        }
        const result = await syncRevision({
          agentPresetsRoot: this.agentPresetsRoot,
          logicalId: this.logicalId,
          digest,
          files: content.files,
        })
        // Best-effort audit: a ledger failure is logged by appendAuditLine and
        // never blocks the sync result (the sync itself already succeeded).
        await appendAuditLine(this.auditFile, {
          op: 'audit',
          ts: new Date().toISOString(),
          event: 'switch-to-revision',
          logicalId: this.logicalId,
          revisionId: action.revisionId,
          digest,
          targetDir: result.dir,
        })
        return {
          ok: true,
          action: 'switch-revision',
          revisionId: action.revisionId,
          digest,
          targetDir: result.dir,
          files: content.files,
        }
      }
    }
  }

  /**
   * Resolve the preset a stored session runs with — the last
   * `agent-preset/selected` event (newest wins, mirroring DSH's own
   * resolveSessionPreset), else the session header's agentPreset, else null.
   *
   * Requires the injected sessionPersistence service; unreadable/unknown
   * sessions and a missing service both yield null (the caller then renders
   * no version control — a preset we cannot identify has no versions).
   */
  async sessionPresetOf(sessionId: string): Promise<string | null> {
    const persistence = this.sessionPersistence
    if (persistence === undefined) return null
    // DSH session ids carry the 'session-' prefix in the session header id
    // itself (e.g. "session-94a9fca3-..."); inspect keys on that exact id, so
    // the id is passed through verbatim — never stripped.
    let inspected: { meta?: unknown; events?: unknown[] } | null
    try {
      inspected = await persistence.inspect(sessionId)
    } catch {
      return null
    }
    if (inspected === null || typeof inspected !== 'object') return null
    const events = Array.isArray(inspected.events) ? inspected.events : []
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i]
      if (event === null || typeof event !== 'object') continue
      const record = event as { type?: unknown; data?: unknown }
      if (record.type !== 'agent-preset/selected') continue
      const data = record.data
      if (data === null || typeof data !== 'object') continue
      const value = (data as { agentPreset?: unknown }).agentPreset
      if (typeof value === 'string' && value !== '') return value
    }
    const meta = inspected.meta
    if (meta !== null && typeof meta === 'object') {
      const value = (meta as { agentPreset?: unknown }).agentPreset
      if (typeof value === 'string' && value !== '') return value
    }
    return null
  }

  /** Current timeline (for tests/debugging); tail capped. */
  async timeline(): Promise<EvalTimelineEvent[]> {
    const audit = await readAuditEntries(this.auditFile)
    const snapshot = buildSnapshot({
      logicalId: this.logicalId,
      revision: audit.length,
      current: null,
      history: [],
      audit,
      tailLimit: this.tailLimit,
    })
    return snapshot.timeline
  }

  /** Stop polling and drop listeners. */
  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    this.listeners.clear()
  }
}

export { shortDigest }
export type { AuditEntry }
