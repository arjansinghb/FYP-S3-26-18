import { useEffect, useRef, useState } from 'react'

// A themed stand-in for window.prompt() — same overlay/card language as
// ConfirmDialog (see that file's own docstring for why the native browser
// dialog had to go), but for the one admin action that actually needs a
// typed value back: setting a user's new password (SA03).
export default function PromptDialog({
  open, title, message, icon, label, placeholder, minLength = 0,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel,
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setValue('')
    // The input is already in the DOM by the time this effect runs (React
    // commits the DOM before firing effects), so a direct focus() here is
    // enough — no rAF/timeout indirection needed.
    inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onCancel?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const valid = value.trim().length >= minLength
  function submit() {
    if (valid) onConfirm(value.trim())
  }

  return (
    <div className="confirm-overlay" onClick={onCancel} role="presentation">
      <div
        className="confirm-dialog" role="dialog" aria-modal="true"
        aria-labelledby="prompt-dialog-title" onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-icon confirm-icon--primary">{icon}</div>
        <div>
          <h3 id="prompt-dialog-title">{title}</h3>
          {message && <p>{message}</p>}
        </div>
        <label>
          {label}
          <input
            ref={inputRef} type="password" value={value} placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
        <div className="confirm-actions">
          <button type="button" className="ghost small" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className="small" disabled={!valid} onClick={submit}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
