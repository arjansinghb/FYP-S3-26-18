import { useEffect, useState } from 'react'
import { CheckIcon, CloseIcon } from '../icons'

// A tiny, shared action-feedback surface for the staff consoles (moderator
// + admin) — every approve/reject/import/save/remove/resolve/suspend used
// to just silently reload a list with no confirmation at all, which reads
// as unresponsive even when it worked. One hook + one render target,
// reused by both consoles instead of each reinventing its own toast.
export function useToast() {
  const [toast, setToast] = useState(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2800)
    return () => clearTimeout(t)
  }, [toast])
  const notify = (message, tone = 'success') => setToast({ message, tone, id: Date.now() })
  return [toast, notify]
}

export function ToastHost({ toast }) {
  if (!toast) return null
  return (
    <div className={`toast toast-${toast.tone}`} key={toast.id}>
      {toast.tone === 'danger' ? <CloseIcon width={16} height={16} /> : <CheckIcon width={16} height={16} />}
      {toast.message}
    </div>
  )
}
