/**
 * Generic confirm overlay for the evolution console (rollback confirmations).
 *
 * # absorbed-from: zhu1090093659/dsh-web-ui packages/dsh-task-board/src/client/board/ConfirmDialog.tsx (Apache-2.0)
 * Adapted: css-module class names are replaced with the global `evc-` classes;
 * cancel/confirm labels become props so the caller supplies localized text.
 */

import type { ReactElement } from 'react'

/** Confirm overlay props. */
export interface ConfirmDialogProps {
  title: string
  message: string
  cancelLabel: string
  confirmLabel: string
  /** Render the confirm button in the danger style. */
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** Small confirm overlay (backdrop click cancels). */
export function ConfirmDialog({
  title,
  message,
  cancelLabel,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: ConfirmDialogProps): ReactElement {
  return (
    <div
      className="evc-modalBackdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div className="evc-modal" role="alertdialog" aria-label={title}>
        <h2 className="evc-modalTitle">{title}</h2>
        <p className="evc-confirmMessage">{message}</p>
        <footer className="evc-modalFooter">
          <button type="button" className="evc-ghostButton" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'evc-dangerButton' : 'evc-primaryButton'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}
