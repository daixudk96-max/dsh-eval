/**
 * Data adapter: real preset-registry + evolution-audit -> /eval/state shape.
 *
 * Original work for the dsh-eval project (Apache-2.0). Framework-free pure
 * transforms (unit-tested in isolation): the Host service feeds registry
 * facts (resolveCurrent/history) and parsed audit ledger records in, and gets
 * the six-column row set, history chain, current bar and timeline out.
 *
 * Status derivation (see statusOfRow):
 *   - history (current + previous) entries are always PROMOTED — they are the
 *     live pointer chain, whatever their gate history was;
 *   - audit-only revisions (sealed outside the rollback window) derive from
 *     their run's latest gate outcome (ACCEPTED / REJECTED / INCONCLUSIVE /
 *     EVALUATING), falling back to SEALED when only a seal exists.
 */

import { EVAL_COLUMNS, isEvalStatus, type EvalStatus } from './states.ts'
import {
  type EvalCurrentBar,
  type EvalColumnView,
  type EvalHistoryEntry,
  type EvalSnapshot,
  type EvalStatusRow,
  type EvalTimelineEvent,
} from './protocol.ts'
import { timelineEvents } from './timeline.ts'

/** One raw evolution-audit ledger record (op === 'audit'). */
export interface AuditEntry {
  op?: string
  ts?: string
  runId?: string
  event?: string
  [key: string]: unknown
}

/** The registry facts the adapter consumes (shaped by the Host service). */
export interface RegistryCurrentFacts {
  logicalId: string
  revisionId: string
  digest: string
  gateRunId: string | null
  approvalId: string | null
  /** The agent-presets resolver result (null without agentPresets). */
  resolved: unknown
  /** Pointer updatedAt (ISO) — read from the pointer file, may be absent. */
  updatedAt?: string | null
}

/** First 8 hex chars of a content digest, for compact display. */
export function shortDigest(digest: string): string {
  return digest.length > 8 ? digest.slice(0, 8) : digest
}

/** Per-revision facts derived from the audit ledger. */
export interface RevisionFacts {
  revisionId: string
  digest: string
  runId?: string
  /** Candidate hypothesis (audit 'candidate-created' text) — one-line "what
   * this revision changed" summary shown in version pickers. */
  hypothesis?: string
  sealedAt?: string
  promotedAt?: string
  /** Latest gate outcome for the run (to: status, reason). */
  gate?: { to: EvalStatus; reason?: string }
  /** True when the run's latest status is EVALUATING (gate/resample). */
  evaluatingAt?: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * Fold the audit ledger into per-revision facts, keyed by revisionId. A run
 * index maps runId -> revisionId so gate/promote events (which name the run,
 * not always the revision) can be attached to their revision.
 */
export function buildRevisionFacts(audit: readonly AuditEntry[]): Map<string, RevisionFacts> {
  const facts = new Map<string, RevisionFacts>()
  const byRun = new Map<string, string>()
  // hypothesis rides candidate-created (before sealed), keyed by runId.
  const hypothesisByRun = new Map<string, string>()

  const ensure = (revisionId: string): RevisionFacts => {
    let fact = facts.get(revisionId)
    if (fact === undefined) {
      fact = { revisionId, digest: '' }
      facts.set(revisionId, fact)
    }
    return fact
  }

  for (const entry of audit) {
    const event = entry.event
    if (typeof event !== 'string') continue
    const runId = typeof entry.runId === 'string' ? entry.runId : undefined
    const ts = typeof entry.ts === 'string' ? entry.ts : undefined
    if (event === 'candidate-created') {
      if (runId !== undefined && typeof entry.hypothesis === 'string' && entry.hypothesis !== '') {
        hypothesisByRun.set(runId, entry.hypothesis)
      }
    } else if (event === 'sealed') {
      const revisionId = typeof entry.revisionId === 'string' ? entry.revisionId : undefined
      const digest = typeof entry.digest === 'string' ? entry.digest : ''
      if (revisionId === undefined) continue
      const fact = ensure(revisionId)
      fact.digest = digest
      if (runId !== undefined) {
        fact.runId = runId
        byRun.set(runId, revisionId)
        const hypothesis = hypothesisByRun.get(runId)
        if (hypothesis !== undefined) fact.hypothesis = hypothesis
      }
      if (ts !== undefined) fact.sealedAt = ts
    } else if (event === 'gate') {
      const to = typeof entry.to === 'string' && isEvalStatus(entry.to) ? entry.to : undefined
      if (runId === undefined || to === undefined) continue
      const revisionId = byRun.get(runId)
      if (revisionId === undefined) continue
      const fact = ensure(revisionId)
      fact.gate = {
        to,
        ...(typeof entry.reason === 'string' ? { reason: entry.reason } : {}),
      }
      if (to === 'EVALUATING' && ts !== undefined) fact.evaluatingAt = ts
    } else if (event === 'promoted') {
      const revisionId = typeof entry.revisionId === 'string' ? entry.revisionId : undefined
      if (revisionId === undefined) continue
      const fact = ensure(revisionId)
      if (ts !== undefined) fact.promotedAt = ts
    } else if (event === 'resample' && runId !== undefined) {
      const revisionId = byRun.get(runId)
      if (revisionId === undefined) continue
      const fact = ensure(revisionId)
      if (ts !== undefined) fact.evaluatingAt = ts
    }
  }
  return facts
}

/** Map a gate outcome (or status) to a board column status. */
function columnStatusOf(fact: RevisionFacts): EvalStatus {
  const gate = fact.gate
  if (gate === undefined) return fact.evaluatingAt !== undefined ? 'EVALUATING' : 'SEALED'
  switch (gate.to) {
    case 'ACCEPTED': return 'ACCEPTED'
    case 'REJECTED': return 'REJECTED'
    case 'INCONCLUSIVE': return 'INCONCLUSIVE'
    case 'EVALUATING': return 'EVALUATING'
    default: return 'SEALED'
  }
}

/**
 * Build the six-column row set. History entries become PROMOTED rows (the
 * live pointer chain); audit-only revisions derive their status from the
 * gate/run record.
 */
export function buildRows(
  history: readonly EvalHistoryEntry[],
  audit: readonly AuditEntry[],
  currentRevisionId: string | null,
): EvalStatusRow[] {
  const facts = buildRevisionFacts(audit)
  const inHistory = new Set(history.map((h) => h.revisionId))
  const rows: EvalStatusRow[] = []

  // History chain first (current = order 0, then previous by list order).
  history.forEach((entry, index) => {
    const fact = facts.get(entry.revisionId)
    rows.push({
      revisionId: entry.revisionId,
      digest: entry.digest,
      digestShort: shortDigest(entry.digest),
      status: 'PROMOTED',
      isCurrent: entry.revisionId === currentRevisionId,
      order: index,
      ...(fact?.runId === undefined ? {} : { runId: fact.runId }),
      ...(fact?.sealedAt === undefined ? {} : { sealedAt: fact.sealedAt }),
      ...(fact?.promotedAt === undefined ? {} : { promotedAt: fact.promotedAt }),
      ...(fact?.hypothesis === undefined ? {} : { summary: fact.hypothesis }),
    })
  })

  // Audit-only revisions, newest-sealed first, ordered after the chain.
  const auditOnly = [...facts.values()]
    .filter((fact) => !inHistory.has(fact.revisionId) && fact.digest !== '')
    .sort((a, b) => (b.sealedAt ?? '').localeCompare(a.sealedAt ?? ''))
  auditOnly.forEach((fact, index) => {
    rows.push({
      revisionId: fact.revisionId,
      digest: fact.digest,
      digestShort: shortDigest(fact.digest),
      status: fact.promotedAt !== undefined ? 'PROMOTED' : columnStatusOf(fact),
      isCurrent: false,
      order: 1000 + index,
      ...(fact.runId === undefined ? {} : { runId: fact.runId }),
      ...(fact.sealedAt === undefined ? {} : { sealedAt: fact.sealedAt }),
      ...(fact.gate === undefined || fact.gate.reason === undefined ? {} : { gateReason: fact.gate.reason }),
      ...(fact.promotedAt === undefined ? {} : { promotedAt: fact.promotedAt }),
      ...(fact.hypothesis === undefined ? {} : { summary: fact.hypothesis }),
    })
  })

  return rows
}

/** Group rows into the six column views, display order preserved. */
export function buildColumns(rows: readonly EvalStatusRow[]): EvalColumnView[] {
  const byStatus = new Map<EvalStatus, EvalStatusRow[]>()
  for (const column of EVAL_COLUMNS) byStatus.set(column.status, [])
  for (const row of rows) {
    const bucket = byStatus.get(row.status)
    if (bucket === undefined) continue
    bucket.push(row)
  }
  return EVAL_COLUMNS.map((column) => ({
    status: column.status,
    label: column.label,
    color: column.color,
    rows: [...(byStatus.get(column.status) ?? [])].sort((a, b) => a.order - b.order),
  }))
}

/** Build the current-version bar from registry facts (null when absent). */
export function buildCurrentBar(current: RegistryCurrentFacts | null): EvalCurrentBar | null {
  if (current === null) return null
  return {
    logicalId: current.logicalId,
    revisionId: current.revisionId,
    digest: current.digest,
    digestShort: shortDigest(current.digest),
    gateRunId: current.gateRunId,
    approvalId: current.approvalId,
    updatedAt: current.updatedAt ?? null,
    resolved: Boolean(current.resolved),
  }
}

/** Assemble a full /eval/state snapshot from the adapter inputs. */
export function buildSnapshot(args: {
  logicalId: string
  revision: number
  current: RegistryCurrentFacts | null
  history: readonly EvalHistoryEntry[]
  audit: readonly AuditEntry[]
  tailLimit?: number
  now?: () => string
}): EvalSnapshot {
  const { logicalId, revision, current, history, audit, tailLimit = 120 } = args
  const currentBar = buildCurrentBar(current)
  const rows = buildRows(history, audit, currentBar?.revisionId ?? null)
  const timeline = timelineEvents(audit).slice(-tailLimit)
  const facts = buildRevisionFacts(audit)
  return {
    schemaVersion: 1,
    logicalId,
    revision,
    current: currentBar,
    history: history.map((entry) => {
      const fact = facts.get(entry.revisionId)
      return {
        revisionId: entry.revisionId,
        digest: entry.digest,
        digestShort: shortDigest(entry.digest),
        status: entry.status,
        ...(fact?.sealedAt === undefined ? {} : { sealedAt: fact.sealedAt }),
        ...(fact?.promotedAt === undefined ? {} : { promotedAt: fact.promotedAt }),
        ...(fact?.hypothesis === undefined ? {} : { summary: fact.hypothesis }),
      }
    }),
    columns: buildColumns(rows),
    timeline,
    generatedAt: (args.now ?? (() => new Date().toISOString()))(),
  }
}

export type { EvalTimelineEvent }
export { record }
