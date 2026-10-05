import { useEffect, useRef, useState } from 'react'
import { ChatIcon } from '../icons'

const NOTE_MAX = 300

// Quick notes a moderator can drop in and edit before sending.
const QUICK_NOTES = [
  'We are looking into this and will update you soon.',
  'We reviewed it and the content is age-appropriate for the stated band.',
  'We reviewed it and found no issue.',
  'We removed it from the catalogue. Thank you for flagging it.',
  'There was not enough detail to act on. Feel free to report again with more.',
]

// A message from a moderator to the parent who made a report. It is its own
// action: it never closes or changes the report. Sending again replaces the
// note the parent sees.
export default function ReportNoteDialog({ open, title, initialNote = '', busy = false, onSend, onCancel }) {
  const [note, setNote] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setNote(initialNote || '')
    inputRef.current?.focus()
    function onKey(e) { if (e.key === 'Escape') onCancel?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, initialNote, onCancel])

  if (!open) return null
  const ready = note.trim().length > 0

  return (
    <div className="confirm-overlay" onClick={onCancel} role="presentation">
      <div
        className="confirm-dialog confirm-dialog--wide" role="dialog" aria-modal="true"
        aria-labelledby="report-note-title" onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-icon confirm-icon--primary"><ChatIcon width={20} height={20} /></div>
        <div>
          <h3 id="report-note-title">Note to the parent</h3>
          <p>{title}</p>
          <p className="muted">They will see this next to their report and in their notifications. The report itself stays as it is.</p>
        </div>
        <div className="report-note">
          <div className="report-note-quick">
            {QUICK_NOTES.map((q) => (
              <button type="button" className="chip-toggle" key={q} onClick={() => setNote(q)}>{q}</button>
            ))}
          </div>
          <textarea
            id="report-note-input" aria-label="Note to the parent" ref={inputRef} rows={4} maxLength={NOTE_MAX} value={note}
            onChange={(e) => setNote(e.target.value)} placeholder="Write a short note…"
          />
          <span className="report-note-count">{note.length}/{NOTE_MAX}</span>
        </div>
        <div className="confirm-actions">
          <button type="button" className="ghost small" onClick={onCancel}>Cancel</button>
          <button type="button" className="small" disabled={!ready || busy} onClick={() => onSend(note.trim())}>
            {busy ? 'Sending…' : 'Send note'}
          </button>
        </div>
      </div>
    </div>
  )
}
