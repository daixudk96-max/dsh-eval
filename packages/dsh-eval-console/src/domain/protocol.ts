/**
 * /eval wire protocol: EvalSnapshot, EvalEventPayload, EvalActionEnvelope and
 * the strict envelope parser.
 *
 * # absorbed-from: zhu1090093659/dsh-web-ui packages/dsh-task-board/src/protocol.ts (Apache-2.0)
 * Adapted: task-board's TaskSnapshot/EventPayload/ActionEnvelope are rewritten
 * to registry-revision semantics; the strict exactKeys envelope parser and the
 * "event frames never carry the big payload" SSE decision are kept.
 */

import { EVAL_STATUSES, isEvalStatus, type EvalStatus } from './states.ts'

export const EVAL_SCHEMA_VERSION = 1 as const
export const EVAL_API_PREFIX = '/eval'

/** The current-version bar: the registry pointer plus its promotion binding. */
export interface EvalCurrentBar {
  logicalId: string
  revisionId: string
  digest: string
  digestShort: string
  gateRunId: string | null
  approvalId: string | null
  /** Pointer updatedAt (ISO); null when the pointer lacks a timestamp. */
  updatedAt: string | null
  /** Whether the DSH agent-preset adapter could resolve the revision. */
  resolved: boolean
}

/** One history entry (registry history(): active + previous, rollback window). */
export interface EvalHistoryEntry {
  revisionId: string
  digest: string
  digestShort: string
  status: 'active' | 'previous'
  /** When the candidate was sealed (audit 'sealed' ts; ISO). */
  sealedAt?: string
  /** When the revision was promoted (audit 'promoted' ts; ISO). */
  promotedAt?: string
  /** One-line candidate hypothesis — what this revision changed. */
  summary?: string
}

/** One revision card on the board (belongs to exactly one column). */
export interface EvalStatusRow {
  revisionId: string
  digest: string
  digestShort: string
  status: EvalStatus
  /** Evolution run that sealed/evaluated this revision (when known). */
  runId?: string
  /** When the candidate was sealed (audit 'sealed' ts; ISO). */
  sealedAt?: string
  /** Gate outcome reason (audit 'gate' reason). */
  gateReason?: string
  /** When the revision was promoted (audit 'promoted' ts; ISO). */
  promotedAt?: string
  /** One-line candidate hypothesis — what this revision changed. */
  summary?: string
  /** True for the live current pointer. */
  isCurrent: boolean
  /**
   * True only for previous revisions on the registry history chain (the
   * rollback window). Current and audit-only rows (REJECTED / INCONCLUSIVE /
   * sealed-outside-window) must not offer rollback — the registry refuses
   * rollback targets outside the chain.
   */
  canRollback?: boolean
  /** Position in the history chain: 0 = newest (current), then previous. */
  order: number
}

/** One column with its rows (client renders columns directly). */
export interface EvalColumnView {
  status: EvalStatus
  label: string
  color: string
  rows: EvalStatusRow[]
}

/** One audit-timeline event (derived from one evolution-audit ledger record). */
export interface EvalTimelineEvent {
  id: string
  ts: string
  event: string
  status?: EvalStatus
  runId?: string
  revisionId?: string
  detail?: string
}

/** GET /eval/state response body. */
export interface EvalSnapshot {
  schemaVersion: typeof EVAL_SCHEMA_VERSION
  logicalId: string
  /** Monotonic audit revision counter (number of audit records read). */
  revision: number
  current: EvalCurrentBar | null
  history: EvalHistoryEntry[]
  columns: EvalColumnView[]
  timeline: EvalTimelineEvent[]
  /** Wall time the snapshot was assembled (ISO), for the header clock. */
  generatedAt: string
}

/**
 * SSE event frame: small fields only — never the big snapshot. The client
 * re-fetches /eval/state when the revision differs.
 */
export interface EvalEventPayload {
  revision: number
  logicalId: string
  currentRevisionId: string | null
  generatedAt: string
}

/**
 * Result of a read-only /eval/action. `kind` discriminates the payload:
 * 'detail' carries the revision content files; 'rollback' carries the
 * registry.rollbackContent result; 'refresh' carries a fresh snapshot;
 * 'switch-revision' carries the synced target directory (the registry
 * pointer is never moved — only the agent-presets install directory changes).
 */
export type EvalActionResult =
  | { ok: true; action: 'detail'; revisionId: string; digest: string; files: Record<string, string> }
  | {
      ok: boolean
      action: 'rollback'
      logicalId: string
      targetRevisionId: string
      revisionId: string
      digest: string
      edits: number
      noop: boolean
    }
  | { ok: true; action: 'refresh'; snapshot: EvalSnapshot }
  | {
      ok: true
      action: 'switch-revision'
      revisionId: string
      digest: string
      targetDir: string
      files: Record<string, string>
    }

/**
 * Read-only-first action surface. Rollback is the only registry write and
 * requires an explicit confirm token (see {@link rollbackConfirmToken});
 * promote is never reachable from the UI — it stays on the CLI/approval path.
 * switch-revision writes the agent-presets install directory only; it never
 * moves the registry pointer (promote semantics unchanged).
 */
export type EvalAction =
  /** Read a revision's content files (detail modal). */
  | { kind: 'detail'; revisionId: string }
  /** Content-level rollback to a previous revision, gated by confirm. */
  | { kind: 'rollback'; logicalId: string; revisionId: string; confirm: string }
  /** Force a fresh snapshot (used after a rollback lands). */
  | { kind: 'refresh' }
  /** Sync one revision's content into the agent-presets install directory. */
  | { kind: 'switch-revision'; revisionId: string }

/** The requestId envelope wrapping one action. */
export interface EvalActionEnvelope {
  requestId: string
  action: EvalAction
}

/** The exact confirm token the UI must echo for a rollback. */
export function rollbackConfirmToken(revisionId: string): string {
  return `ROLLBACK:${revisionId}`
}

// --- strict envelope validation ---------------------------------------------

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

/**
 * Parse + validate an action envelope. Returns undefined on any shape
 * violation (strict exactKeys per action kind). The rollback confirm token is
 * enforced here too, so an unconfirmed rollback never reaches the service.
 */
export function parseActionEnvelope(value: unknown): EvalActionEnvelope | undefined {
  const envelope = record(value)
  if (envelope === undefined || !exactKeys(envelope, ['requestId', 'action'])) return undefined
  if (typeof envelope.requestId !== 'string' || envelope.requestId.trim() === '' || envelope.requestId.length > 256) {
    return undefined
  }
  const action = record(envelope.action)
  if (action === undefined || typeof action.kind !== 'string') return undefined
  switch (action.kind) {
    case 'detail': {
      if (!exactKeys(action, ['kind', 'revisionId'])) return undefined
      return typeof action.revisionId === 'string' && action.revisionId !== ''
        ? { requestId: envelope.requestId, action: { kind: 'detail', revisionId: action.revisionId } }
        : undefined
    }
    case 'rollback': {
      if (!exactKeys(action, ['kind', 'logicalId', 'revisionId', 'confirm'])) return undefined
      if (typeof action.logicalId !== 'string' || action.logicalId === '') return undefined
      if (typeof action.revisionId !== 'string' || action.revisionId === '') return undefined
      if (typeof action.confirm !== 'string') return undefined
      if (action.confirm !== rollbackConfirmToken(action.revisionId)) return undefined
      return {
        requestId: envelope.requestId,
        action: { kind: 'rollback', logicalId: action.logicalId, revisionId: action.revisionId, confirm: action.confirm },
      }
    }
    case 'refresh': {
      if (!exactKeys(action, ['kind'])) return undefined
      return { requestId: envelope.requestId, action: { kind: 'refresh' } }
    }
    case 'switch-revision': {
      if (!exactKeys(action, ['kind', 'revisionId'])) return undefined
      return typeof action.revisionId === 'string' && action.revisionId !== ''
        ? { requestId: envelope.requestId, action: { kind: 'switch-revision', revisionId: action.revisionId } }
        : undefined
    }
    default:
      return undefined
  }
}

/** Narrow an unknown value to a status row (client-side guard). */
export function isStatusRow(value: unknown): value is EvalStatusRow {
  const row = record(value)
  if (row === undefined) return false
  return typeof row.revisionId === 'string' && isEvalStatus(row.status)
}

export { EVAL_STATUSES }
