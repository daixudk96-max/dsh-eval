/**
 * One revision card on the six-column board.
 *
 * Original work for the dsh-eval project (Apache-2.0), following the
 * dsh-task-board TaskCard structure (title/meta rows over --dsw tokens).
 */

import type { ReactElement } from 'react'
import type { EvalConsoleKey } from './locales.ts'
import type { EvalStatusRow } from '../domain/protocol.ts'
import { fmtTime } from './format.ts'

export { fmtTime }

/** Card props. */
export interface EvalCardProps {
  row: EvalStatusRow
  /** Localized string resolver (bound to the active language). */
  t: (key: EvalConsoleKey) => string
  onSelect: (revisionId: string) => void
}

/** One revision card: revision chip, run id, seal time, gate reason. */
export function EvalCard({ row, t, onSelect }: EvalCardProps): ReactElement {
  return (
    <button
      type="button"
      className="evc-card"
      data-status={row.status}
      onClick={() => onSelect(row.revisionId)}
    >
      <div className="evc-cardTitle">
        <span className="evc-statusDot" data-status={row.status} aria-hidden="true" />
        <span className="evc-cardRevision" title={row.revisionId}>
          {row.digestShort || row.revisionId}
        </span>
        {row.isCurrent ? <span className="evc-cardChip" data-current>{t('view.current')}</span> : null}
      </div>
      <div className="evc-cardMeta">
        {row.sealedAt !== undefined ? <span className="evc-cardTime">{fmtTime(row.sealedAt)}</span> : null}
        {row.runId !== undefined ? (
          <span className="evc-cardRun" title={row.runId}>
            {row.runId}
          </span>
        ) : null}
      </div>
      {row.gateReason !== undefined ? <div className="evc-cardReason">{row.gateReason}</div> : null}
    </button>
  )
}
