import { useEffect, useRef } from 'react'

// A themed stand-in for window.confirm() — the admin console's own
// destructive actions (delete/unpublish a review, etc.) used the browser's
// bare native dialog, which looks like an unstyled part of the OS chrome,
// not this app ("gw ga mau cuman kek bagian bawaan web doang polos gitu
// aja"). One shared component instead of a one-off per action: same
// backdrop/card/animation everywhere, tone-coloured icon so the visual
// weight matches how serious the action actually is.
export default function ConfirmDialog({
  open, title, message, tone = 'danger', icon,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel,
}) {
  const cancelRef = useRef(null)

  // Cancel is the safe default focus target — an accidental Enter press
  // should back out of a destructive action, not commit it.
  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()
    function onKey(e) {
      if (e.key === 'Escape') onCancel?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="confirm-overlay" onClick={onCancel} role="presentation">
      <div
        className="confirm-dialog" role="alertdialog" aria-modal="true"
        aria-labelledby="confirm-dialog-title" onClick={(e) => e.stopPropagation()}
      >
        <div className={`confirm-icon confirm-icon--${tone}`}>{icon}</div>
        <div>
          <h3 id="confirm-dialog-title">{title}</h3>
          <p>{message}</p>
        </div>
        <div className="confirm-actions">
          <button type="button" className="ghost small" ref={cancelRef} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={`${tone} small`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
