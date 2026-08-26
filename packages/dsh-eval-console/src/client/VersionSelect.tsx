/**
 * Preset version selector: the session header's «Version ▾» dropdown.
 *
 * Original work for the dsh-eval project (Apache-2.0). Registered on
 * `conversation.session.header.actions` (id 'eval-version', order 30) by
 * src/client/index.tsx; the component is self-sufficient — it owns a private
 * HttpEvalHostTransport, so the registrant's inject face stays empty.
 *
 * Behavior (task 08-25-feat-08-25-preset-version-selector, D5):
 *   - mount + SSE: GET /eval/state once, then /eval/events revision deltas
 *     trigger a re-fetch (the Host never pushes the big snapshot);
 *   - list: the current line (✓ + evaluate-<digest8>) plus previous lines in
 *     history order, each with its digestShort;
 *   - clicking the current line is a no-op; clicking a previous line POSTs
 *     /eval/action { kind: 'switch-revision', revisionId } and shows the
 *     synced target dir on success, the error message on failure;
 *   - read-only first: switching never moves the registry pointer — it only
 *     syncs the agent-presets install directory, which is why the success
 *     copy says "selectable in new sessions" rather than "now active".
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the header actions).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { EvalSnapshot } from '../domain/protocol.ts'
import { HttpEvalHostTransport } from './host-api.ts'
import { fmtTime } from './format.ts'

/** Registration-side business face: none — the control reads the Host itself. */
export interface VersionSelectInjected {
  // intentionally empty
}

/** Full props: the session-header runtime seat + the empty inject face + locale. */
export type VersionSelectProps =
  PropsRuntime<'conversation.session.header.actions'>
  & InjectFace<VersionSelectInjected>
  & PropsLocale<'eval-console'>

/** One dropdown row, derived from the snapshot's current + history. */
interface VersionRow {
  revisionId: string
  digestShort: string
  current: boolean
  /** Local display timestamp (pointer updatedAt, else promotedAt, else sealedAt). */
  ts: string | null
  /** One-line candidate hypothesis — what this revision changed. */
  summary: string | null
}

/** The session header's preset-version dropdown. */
export function VersionSelect({ t }: VersionSelectProps): ReactElement {
  const transport = useMemo(() => new HttpEvalHostTransport(), [])
  const [snapshot, setSnapshot] = useState<EvalSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const revisionRef = useRef(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await transport.state()
      revisionRef.current = next.revision
      setSnapshot(next)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [transport])

  useEffect(() => {
    revisionRef.current = -1
    void refresh()
    return transport.subscribe((event) => {
      // SSE frames are revision deltas; skip when this control is already current.
      if (event !== undefined && event.revision === revisionRef.current) return
      void refresh()
    })
  }, [transport, refresh])

  useDismissOnOutsidePointer(rootRef, open, setOpen)

  // The header action strip stays compact: with nothing to offer yet, render
  // nothing at all — an empty trigger for a data source that never arrives is
  // worse than no control. (The board tab still shows load errors in full.)
  if (error !== null) return <></>

  const rows: VersionRow[] = []
  if (snapshot !== null) {
    if (snapshot.current !== null) {
      const currentSummary =
        snapshot.history.find((entry) => entry.revisionId === snapshot.current?.revisionId)?.summary ?? null
      rows.push({
        revisionId: snapshot.current.revisionId,
        digestShort: snapshot.current.digestShort,
        current: true,
        ts: snapshot.current.updatedAt,
        summary: currentSummary,
      })
    }
    for (const entry of snapshot.history) {
      if (entry.revisionId === snapshot.current?.revisionId) continue
      rows.push({
        revisionId: entry.revisionId,
        digestShort: entry.digestShort,
        current: false,
        ts: entry.promotedAt ?? entry.sealedAt ?? null,
        summary: entry.summary ?? null,
      })
    }
  }

  const switchTo = async (row: VersionRow): Promise<void> => {
    if (row.current) return
    setBusyId(row.revisionId)
    setNotice(null)
    try {
      const result = await transport.action({ kind: 'switch-revision', revisionId: row.revisionId })
      if (result.action !== 'switch-revision') {
        setNotice(t('action.invalid'))
        return
      }
      setNotice(t('version.synced', { targetDir: result.targetDir }))
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyId(null)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div ref={rootRef} className="evc-versionRoot" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="evc-versionTrigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('version.triggerAria')}
        title={t('version.triggerAria')}
        onClick={() => {
          setNotice(null)
          setOpen(current => !current)
        }}
      >
        <span className="evc-versionTriggerLabel">{t('version.trigger')}</span>
      </button>
      {open ? (
        <ul className="evc-versionMenu" role="menu" aria-label={t('version.listAria')}>
          {snapshot === null ? (
            <li className="evc-versionEmpty" role="menuitem" aria-disabled="true">{t('version.loading')}</li>
          ) : rows.length === 0 ? (
            <li className="evc-versionEmpty" role="menuitem" aria-disabled="true">{t('version.empty')}</li>
          ) : (
            rows.map((row) => {
              const busy = busyId === row.revisionId
              return (
                <li key={row.revisionId} className="evc-versionRow" role="menuitem">
                  <button
                    type="button"
                    className="evc-versionRowButton"
                    disabled={row.current || busy}
                    title={row.current ? undefined : t('version.switch')}
                    onClick={() => void switchTo(row)}
                  >
                    <span className="evc-versionRowLine">
                      <span className="evc-versionRowMark" aria-hidden="true">{row.current ? '✓' : ''}</span>
                      <span className="evc-versionRowId" title={row.revisionId}>
                        {row.revisionId}
                      </span>
                      <span className="evc-versionRowShort">{row.digestShort}</span>
                      {row.ts !== null ? (
                        <span className="evc-versionRowTime" title={row.ts}>{fmtTime(row.ts)}</span>
                      ) : null}
                      {row.current ? (
                        <span className="evc-versionRowTag">{t('version.current')}</span>
                      ) : busy ? (
                        <span className="evc-versionRowBusy">{t('version.syncing')}</span>
                      ) : null}
                    </span>
                    {row.summary !== null ? (
                      <span className="evc-versionRowSummary" title={row.summary}>{row.summary}</span>
                    ) : null}
                  </button>
                </li>
              )
            })
          )}
          {notice !== null ? (
            <li className="evc-versionNotice" role="status" aria-live="polite">{notice}</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
