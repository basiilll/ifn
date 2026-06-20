import { useState } from 'react'
import ModalShell from './ModalShell'

// Confirmation dialog built on ModalShell. Replaces native confirm()/prompt() so
// destructive and audited admin actions speak the same accessible, on-brand
// vocabulary as the rest of the app. Set withReason for flows that capture an
// (optionally required) audited reason; onConfirm receives the trimmed reason.
// onConfirm should close the dialog itself (success and failure both), surfacing
// any error on the page's own banner. Busy state is managed here.
export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default', // 'default' | 'danger'
  withReason = false,
  reasonRequired = false,
  reasonLabel = 'Reason',
  reasonHint,
  reasonPlaceholder = '',
  reasonMaxLength = 300,
  onConfirm,
  onClose,
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const blocked = busy || (withReason && reasonRequired && !reason.trim())
  const confirmClass =
    tone === 'danger'
      ? 'btn border border-down/40 text-down hover:bg-down/10 px-4 py-2 text-sm min-h-9'
      : 'btn-primary min-h-9'

  async function confirmNow() {
    if (blocked) return
    setBusy(true)
    try {
      await onConfirm(reason.trim())
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell onRequestClose={() => !busy && onClose()} labelledBy="confirm-title" className="max-w-md">
      <h2 id="confirm-title" className="text-lg font-bold">{title}</h2>
      {message && <p className="mt-2 text-sm text-muted">{message}</p>}
      {withReason && (
        <div className="mt-4">
          <label htmlFor="confirm-reason" className="mb-1 block text-xs font-medium text-muted">
            {reasonLabel}{reasonRequired ? '' : ' (optional)'}
          </label>
          <textarea
            id="confirm-reason"
            className="input min-h-[72px] resize-y"
            maxLength={reasonMaxLength}
            placeholder={reasonPlaceholder}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
          {reasonHint && <p className="mt-1 text-xs text-faint">{reasonHint}</p>}
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost min-h-9" onClick={onClose} disabled={busy}>{cancelLabel}</button>
        <button className={confirmClass} onClick={confirmNow} disabled={blocked}>
          {busy ? 'Working...' : confirmLabel}
        </button>
      </div>
    </ModalShell>
  )
}
