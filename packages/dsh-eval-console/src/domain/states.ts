/**
 * dsh-eval-console six-state model.
 *
 * Original work for the dsh-eval project (Apache-2.0). Framework-free: no
 * cordis, no runtime imports — the state machine and column table are
 * unit-tested in isolation.
 *
 * The six states mirror the evolution-controller Candidate lifecycle:
 * a revision is SEALED when its candidate is frozen, EVALUATING while the
 * Code Gate runs, ACCEPTED / REJECTED / INCONCLUSIVE by the gate outcome,
 * and PROMOTED once the registry pointer moves to it (CAS promote).
 */

/** One revision's board status (one kanban column). */
export type EvalStatus =
  | 'SEALED'
  | 'EVALUATING'
  | 'ACCEPTED'
  | 'PROMOTED'
  | 'REJECTED'
  | 'INCONCLUSIVE'

/** The six columns, in display order (SEALED -> ... -> INCONCLUSIVE). */
export const EVAL_STATUSES: readonly EvalStatus[] = [
  'SEALED',
  'EVALUATING',
  'ACCEPTED',
  'PROMOTED',
  'REJECTED',
  'INCONCLUSIVE',
]

/** Brand an unknown value as a status; undefined when it is not one. */
export function isEvalStatus(value: unknown): value is EvalStatus {
  return typeof value === 'string' && (EVAL_STATUSES as readonly string[]).includes(value)
}

/**
 * zh-first display labels for the six columns. Keyed by status so the client
 * and the Host share one vocabulary (the snapshot embeds them).
 */
export const STATUS_LABEL_ZH: Record<EvalStatus, string> = {
  SEALED: '已封存',
  EVALUATING: '评估中',
  ACCEPTED: '已通过',
  PROMOTED: '已提升',
  REJECTED: '已拒绝',
  INCONCLUSIVE: '无结论',
}

/** English display labels for the six columns. */
export const STATUS_LABEL_EN: Record<EvalStatus, string> = {
  SEALED: 'Sealed',
  EVALUATING: 'Evaluating',
  ACCEPTED: 'Accepted',
  PROMOTED: 'Promoted',
  REJECTED: 'Rejected',
  INCONCLUSIVE: 'Inconclusive',
}

/**
 * DSH --dsw-* design-token color for each status dot (carried by the
 * tokenized CSS; the snapshot embeds the token name so the client does not
 * have to know the mapping).
 */
export const STATUS_DOT_TOKEN: Record<EvalStatus, string> = {
  SEALED: 'var(--dsw-alias-label-tertiary)',
  EVALUATING: 'var(--dsw-alias-state-warn-primary)',
  ACCEPTED: 'var(--dsw-alias-state-success-primary)',
  PROMOTED: 'var(--dsw-alias-state-business-primary)',
  REJECTED: 'var(--dsw-alias-state-error-primary)',
  INCONCLUSIVE: 'var(--dsw-alias-label-secondary)',
}

/** One column declaration: status + labels + dot token. */
export interface EvalColumn {
  status: EvalStatus
  label: string
  color: string
}

/** The six columns with zh labels (default rendering language). */
export const EVAL_COLUMNS: readonly EvalColumn[] = EVAL_STATUSES.map((status) => ({
  status,
  label: STATUS_LABEL_ZH[status],
  color: STATUS_DOT_TOKEN[status],
}))

/** Translate one status to a display label (zh default, en on demand). */
export function statusLabel(status: EvalStatus, lang: 'zh' | 'en' = 'zh'): string {
  return (lang === 'en' ? STATUS_LABEL_EN : STATUS_LABEL_ZH)[status]
}

/**
 * Gate outcome -> status mapping used by the timeline/adapter when reading
 * evolution-controller audit records. Unknown decisions fall back to SEALED.
 */
export function statusFromGateDecision(decision: unknown, fallback: EvalStatus = 'SEALED'): EvalStatus {
  if (decision === 'PASS') return 'ACCEPTED'
  if (decision === 'INCONCLUSIVE') return 'INCONCLUSIVE'
  if (decision === 'INVALID') return 'SEALED'
  if (decision === 'FAIL') return 'REJECTED'
  return fallback
}
