import { useEffect, useId, useRef } from 'react'
import { CloseIcon } from '../icons'

export default function Overlay({ title, icon: Icon, children, onClose }) {
  const titleId = useId()
  const closeRef = useRef(null)
  const triggerRef = useRef(document.activeElement)

  useEffect(() => {
    // Move focus into the dialog on open, restore it to whatever opened
    // the dialog on close, and let Escape dismiss it — none of that
    // existed before (a keyboard/screen-reader user had no signal a
    // modal had even opened, and no way out but a mouse click).
    closeRef.current?.focus()
    const trigger = triggerRef.current
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      trigger?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <button ref={closeRef} className="pill close" onClick={onClose} aria-label="Close"><CloseIcon width={16} height={16} /></button>
        <h2 id={titleId}>{Icon && <Icon width={20} height={20} />} {title}</h2>
        {children}
      </div>
    </div>
  )
}
