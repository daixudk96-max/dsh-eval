/**
 * Evolution console board: the conversation.view tab content.
 *
 * Original work for the dsh-eval project (Apache-2.0), following the
 * dsh-task-board TaskBoard architecture (controller-driven transport, data-
 * driven columns, header current-version display, tokenized CSS) without the
 * center-column takeover: this is a real conversation.view slot tab.
 *
 * Renders: header (title, audit revision, snapshot time), the current-version
 * bar (revision/digest + GATE/PROMOTED/APPROVAL chips), the six columns
 * (SEALED..INCONCLUSIVE), the audit timeline, and the detail modal (files +
 * confirm-gated rollback). The snapshot is fetched from /eval/state and kept
 * fresh by /eval/events revision-delta frames.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { EvalHostTransport } from './host-api.ts'
import { HttpEvalHostTransport } from './host-api.ts'
import { detectLang, tr, type EvalConsoleKey } from './locales.ts'
import type { EvalSnapshot, EvalStatusRow } from '../domain/protocol.ts'
import { EvalCard, fmtTime } from './EvalCard.tsx'
import { EvalDetail } from './EvalDetail.tsx'

/** Session binding the console needs: none (it reads the Host, not the chat). */
export interface EvalConsoleInjected {
  // intentionally empty
}

/** Composed props (session runtime + injected face + locale seat). */
export interface EvalConsoleViewProps
  extends ConvViewProps,
    InjectFace<EvalConsoleInjected>,
    PropsLocale<'eval-console'> {}

/** Polling + SSE driver for one snapshot source. */
function useEvalState(transport: EvalHostTransport): {
  snapshot: EvalSnapshot | null
  error: string | null
  loading: boolean
  refresh: () => Promise<void>
} {
  const [snapshot, setSnapshot] = useState<EvalSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const revisionRef = useRef(-1)

  const refresh = useCallback(async () => {
    try {
      const next = await transport.state()
      revisionRef.current = next.revision
      setSnapshot(next)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [transport])

  useEffect(() => {
    revisionRef.current = -1
    void refresh()
    return transport.subscribe((event) => {
      // SSE frames are revision deltas; skip when the board is already current.
      if (event !== undefined && event.revision === revisionRef.current) return
      void refresh()
    })
  }, [transport, refresh])

  return { snapshot, error, loading, refresh }
}

/** The evolution console tab. */
export function EvalConsoleView(_props: EvalConsoleViewProps): ReactElement {
  const transport = useMemo(() => new HttpEvalHostTransport(), [])
  const { snapshot, error, loading, refresh } = useEvalState(transport)
  const [selected, setSelected] = useState<string | null>(null)
  const lang = useMemo(() => detectLang(), [])
  const t = useCallback((key: EvalConsoleKey) => tr(lang, key), [lang])

  const selectedRow: EvalStatusRow | null = useMemo(() => {
    if (selected === null || snapshot === null) return null
    for (const column of snapshot.columns) {
      const row = column.rows.find((candidate) => candidate.revisionId === selected)
      if (row !== undefined) return row
    }
    return null
  }, [selected, snapshot])

  if (error !== null) {
    return (
      <div className="evc-board" data-dsh-plugin="eval-console">
        <div className="evc-error">
          <span>{t('view.error')}</span>
          <button type="button" className="evc-primaryButton" onClick={() => void refresh()}>
            {t('view.retry')}
          </button>
        </div>
      </div>
    )
  }

  if (snapshot === null) {
    return (
      <div className="evc-board" data-dsh-plugin="eval-console">
        <span className="evc-empty">{loading ? t('view.loading') : t('view.error')}</span>
      </div>
    )
  }

  const current = snapshot.current

  return (
    <div className="evc-root" data-dsh-plugin="eval-console">
      <div className="evc-board">
        <header className="evc-boardHeader">
          <h1 className="evc-boardTitle">{t('view.title')}</h1>
          <span className="evc-boardMeta">
            {t('view.revision')} {snapshot.revision} · {t('view.generatedAt')} {fmtTime(snapshot.generatedAt)}
          </span>
        </header>

        {current !== null ? (
          <section className="evc-currentBar" aria-label={t('view.current')}>
            <div className="evc-currentRow">
              <span className="evc-currentLabel">{t('view.current')}</span>
              <span className="evc-statusDot" data-status="PROMOTED" aria-hidden="true" />
              <span className="evc-currentRevision" title={current.revisionId}>
                {current.revisionId}
              </span>
              <span className="evc-chip" data-kind="promoted">{t('view.digest')} {current.digestShort}</span>
              {current.gateRunId !== null ? (
                <span className="evc-chip" data-kind="gate" title={current.gateRunId}>
                  {t('view.gateRun')} {current.gateRunId}
                </span>
              ) : null}
              {current.approvalId !== null ? (
                <span className="evc-chip" data-kind="approval" title={current.approvalId}>
                  {t('view.approval')}
                </span>
              ) : null}
            </div>
            <div className="evc-currentMeta">
              {current.updatedAt !== null ? `${t('view.updatedAt')} ${fmtTime(current.updatedAt)} · ` : ''}
              {current.logicalId}
            </div>
          </section>
        ) : (
          <section className="evc-currentBar" aria-label={t('view.current')}>
            <div className="evc-currentRow">
              <span className="evc-currentLabel">{t('view.current')}</span>
              <span className="evc-currentMeta">{t('view.currentNone')}</span>
            </div>
          </section>
        )}

        <div className="evc-columns" role="list" aria-label={t('view.columns')}>
          {snapshot.columns.map((column) => (
            <section key={column.status} className="evc-column" role="listitem">
              <header className="evc-columnHeader">
                <span className="evc-statusDot" data-status={column.status} aria-hidden="true" />
                <h2 className="evc-columnTitle">{column.label}</h2>
                <span className="evc-columnCount">{column.rows.length}</span>
              </header>
              <div className="evc-cards">
                {column.rows.length === 0 ? (
                  <div className="evc-columnEmpty">{t('view.noRows')}</div>
                ) : (
                  column.rows.map((row) => (
                    <EvalCard key={row.revisionId} row={row} t={t} onSelect={setSelected} />
                  ))
                )}
              </div>
            </section>
          ))}
        </div>

        <section className="evc-timeline" aria-label={t('view.timeline')}>
          <h3 className="evc-timelineTitle">{t('view.timeline')}</h3>
          {snapshot.timeline.length === 0 ? (
            <div className="evc-empty">{t('view.emptyTimeline')}</div>
          ) : (
            <ol className="evc-timelineList">
              {snapshot.timeline.slice(-40).map((event) => (
                <li key={event.id} className="evc-timelineItem">
                  <time className="evc-timelineTime">{fmtTime(event.ts)}</time>
                  <span className="evc-timelineEvent">{event.event}</span>
                  {event.revisionId !== undefined ? (
                    <span className="evc-timelineDetail" title={event.revisionId}>
                      {event.revisionId}
                    </span>
                  ) : null}
                  {event.detail !== undefined ? (
                    <span className="evc-timelineDetail" title={event.detail}>
                      {event.detail}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {selectedRow !== null ? (
        <EvalDetail
          row={selectedRow}
          logicalId={snapshot.logicalId}
          t={t}
          transport={transport}
          onClose={() => setSelected(null)}
          onRollbackDone={() => {
            setSelected(null)
            void refresh()
          }}
        />
      ) : null}
    </div>
  )
}
