/**
 * Revision detail modal: content files (via the detail action) + the only
 * write path of the console — a confirm-gated content rollback.
 *
 * Original work for the dsh-eval project (Apache-2.0). Read-only-first: the
 * detail fetch is the only automatic request; rollback requires the exact
 * `ROLLBACK:<revisionId>` confirmation phrase typed by the user, matching the
 * Host-side parseActionEnvelope guard.
 */

import { useEffect, useState, type ReactElement } from 'react'
import type { EvalHostTransport } from './host-api.ts'
import type { EvalConsoleKey } from './locales.ts'
import { rollbackConfirmToken, type EvalStatusRow } from '../domain/protocol.ts'
import { statusLabel } from '../domain/states.ts'
import { fmtTime } from './EvalCard.tsx'

/** Detail modal props. */
export interface EvalDetailProps {
  row: EvalStatusRow
  logicalId: string
  t: (key: EvalConsoleKey) => string
  transport: EvalHostTransport
  onClose: () => void
  /** Called after a successful rollback so the board can refresh. */
  onRollbackDone: () => void
}

/** Revision detail overlay. */
export function EvalDetail({ row, logicalId, t, transport, onClose, onRollbackDone }: EvalDetailProps): ReactElement {
  const [files, setFiles] = useState<Record<string, string> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void transport
      .action({ kind: 'detail', revisionId: row.revisionId })
      .then((result) => {
        if (cancelled) return
        if (result.action !== 'detail') return
        setFiles(result.files)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [transport, row.revisionId])

  const runRollback = async (): Promise<void> => {
    if (phrase.trim() === '') {
      setNotice(t('rollback.required'))
      return
    }
    if (phrase !== rollbackConfirmToken(row.revisionId)) {
      setNotice(t('rollback.badConfirm'))
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const result = await transport.action({
        kind: 'rollback',
        logicalId,
        revisionId: row.revisionId,
        confirm: phrase,
      })
      if (result.action !== 'rollback') {
        setNotice(t('action.invalid'))
        return
      }
      if (result.ok && result.noop) {
        setNotice(t('rollback.noop'))
        onRollbackDone()
        return
      }
      if (!result.ok) {
        setNotice(t('rollback.failure'))
        return
      }
      setNotice(t('rollback.success'))
      setConfirmOpen(false)
      setPhrase('')
      onRollbackDone()
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const fileEntries = files === null ? [] : Object.entries(files)

  return (
    <div
      className="evc-modalBackdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="evc-detail" role="dialog" aria-label={t('detail.title')}>
        <header className="evc-detailHeader">
          <h2 className="evc-detailTitle">
            {row.revisionId}
            {row.isCurrent ? <span> {t('detail.isCurrent')}</span> : null}
          </h2>
          <span className="evc-statusBadge" data-status={row.status}>
            {statusLabel(row.status)}
          </span>
        </header>
        <div className="evc-detailBody">
          <section className="evc-detailSection">
            <h4>{t('detail.files')}</h4>
            {loading ? (
              <p className="evc-detailText">{t('detail.loading')}</p>
            ) : error !== null ? (
              <p className="evc-formError">{error}</p>
            ) : fileEntries.length === 0 ? (
              <p className="evc-detailText">{t('detail.noFiles')}</p>
            ) : (
              <ul className="evc-fileList">
                {fileEntries.map(([name, content]) => (
                  <li key={name} className="evc-fileItem">
                    <span className="evc-fileName">{name}</span>
                    <pre className="evc-filePreview">{preview(content)}</pre>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {row.sealedAt !== undefined ? (
            <section className="evc-detailSection">
              <h4>{t('card.sealedAt')}</h4>
              <p className="evc-detailText">{fmtTime(row.sealedAt)}</p>
            </section>
          ) : null}
          {row.gateReason !== undefined ? (
            <section className="evc-detailSection">
              <h4>{t('card.reason')}</h4>
              <p className="evc-detailText">{row.gateReason}</p>
            </section>
          ) : null}
          {notice !== null ? <p className="evc-formError">{notice}</p> : null}
        </div>
        <footer className="evc-detailFooter">
          {!row.isCurrent ? (
            <button
              type="button"
              className="evc-dangerButton"
              disabled={busy}
              onClick={() => setConfirmOpen(true)}
            >
              {busy ? t('rollback.busy') : t('detail.rollback')}
            </button>
          ) : null}
          <button type="button" className="evc-ghostButton" onClick={onClose}>
            {t('detail.close')}
          </button>
          <span className="evc-detailMeta">
            {row.digestShort} · {row.revisionId}
          </span>
        </footer>
      </div>
      {confirmOpen ? (
        <div className="evc-modalBackdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmOpen(false) }}>
          <div className="evc-modal" role="alertdialog" aria-label={t('rollback.title')}>
            <h2 className="evc-modalTitle">{t('rollback.title')}</h2>
            <p className="evc-confirmMessage">{t('rollback.prompt')}</p>
            <div className="evc-field">
              <label className="evc-fieldLabel" htmlFor="evc-rollback-phrase">
                {t('rollback.placeholder')}
              </label>
              <input
                id="evc-rollback-phrase"
                className="evc-input"
                value={phrase}
                placeholder={rollbackConfirmToken(row.revisionId)}
                autoFocus
                onChange={(event) => setPhrase(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void runRollback()
                }}
              />
            </div>
            <footer className="evc-modalFooter">
              <button type="button" className="evc-ghostButton" onClick={() => setConfirmOpen(false)}>
                {t('rollback.cancel')}
              </button>
              <button type="button" className="evc-dangerButton" disabled={busy} onClick={() => void runRollback()}>
                {busy ? t('rollback.busy') : t('rollback.confirm')}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Cap each file's preview so huge manifests do not blow up the modal. */
function preview(content: string): string {
  const lines = content.split('\n')
  const capped = lines.slice(0, 40)
  return capped.join('\n') + (lines.length > 40 ? `\n… (${lines.length - 40} more lines)` : '')
}
