/**
 * Audit timeline: evolution-audit ledger records -> EvalTimelineEvent[].
 *
 * Original work for the dsh-eval project (Apache-2.0). Pure transform,
 * unit-tested in isolation. Each evolution-audit record (op 'audit') becomes
 * one timeline entry; the event name drives a derived status (gate -> its
 * target status, promoted -> PROMOTED, sealed -> SEALED) and a human detail
 * (gate reason / decision / approval id).
 */

import { isEvalStatus, statusFromGateDecision, type EvalStatus } from './states.ts'
import type { AuditEntry } from './adapter.ts'
import type { EvalTimelineEvent } from './protocol.ts'

/** Human-readable detail for a status column, zh-first. */
function statusDetail(status: EvalStatus): string {
  switch (status) {
    case 'ACCEPTED': return 'gate PASS'
    case 'REJECTED': return 'gate FAIL'
    case 'INCONCLUSIVE': return 'gate INCONCLUSIVE'
    case 'EVALUATING': return 'evaluating'
    default: return ''
  }
}

/**
 * Map one audit record to a timeline event. Returns undefined for records the
 * timeline does not surface (non-audit ops, records without a usable event
 * name). The `index` seeds a stable event id.
 */
export function auditToTimelineEvent(entry: AuditEntry, index: number): EvalTimelineEvent | undefined {
  const event = entry.event
  if (typeof event !== 'string' || event === '') return undefined
  const ts = typeof entry.ts === 'string' ? entry.ts : ''
  const runId = typeof entry.runId === 'string' ? entry.runId : undefined
  const revisionId = typeof entry.revisionId === 'string' ? entry.revisionId : undefined

  let status: EvalStatus | undefined
  let detail: string | undefined

  if (event === 'gate') {
    const to = typeof entry.to === 'string' && isEvalStatus(entry.to) ? entry.to : undefined
    if (to !== undefined && to !== 'EVALUATING') status = to
    const decision = typeof entry.decision === 'string' ? entry.decision : undefined
    const reason = typeof entry.reason === 'string' ? entry.reason : undefined
    if (decision !== undefined && to !== undefined) {
      detail = statusDetail(to)
    } else if (decision !== undefined) {
      detail = statusFromGateDecision(decision) !== 'SEALED' ? `gate ${decision}` : undefined
    }
    if (reason !== undefined) detail = detail === undefined ? reason : `${detail}: ${reason}`
  } else if (event === 'promoted') {
    status = 'PROMOTED'
    if (typeof entry.approvalId === 'string' && entry.approvalId !== '') {
      detail = `approval ${entry.approvalId}`
    }
  } else if (event === 'sealed') {
    status = 'SEALED'
  } else if (event === 'resample') {
    status = 'EVALUATING'
  } else if (event === 'rollback-applied') {
    if (typeof entry.targetRevisionId === 'string') {
      detail = `target ${entry.targetRevisionId}`
    } else if (revisionId !== undefined) {
      detail = `target ${revisionId}`
    }
  }

  return {
    id: `evt-${index}`,
    ts,
    event,
    ...(status === undefined ? {} : { status }),
    ...(runId === undefined ? {} : { runId }),
    ...(revisionId === undefined ? {} : { revisionId }),
    ...(detail === undefined ? {} : { detail }),
  }
}

/**
 * Fold a whole audit ledger into a timeline (oldest first). Non-surfaced
 * records are skipped; the id is stable per input index so the client can key
 * React lists without collision.
 */
export function timelineEvents(audit: readonly AuditEntry[]): EvalTimelineEvent[] {
  const out: EvalTimelineEvent[] = []
  audit.forEach((entry, index) => {
    const event = auditToTimelineEvent(entry, index)
    if (event !== undefined) out.push(event)
  })
  return out
}
