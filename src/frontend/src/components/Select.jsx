import { useEffect, useRef, useState } from 'react'
import { ChevronIcon, CheckIcon } from '../icons'

// A drop-in replacement for <select> — same value/onChange/disabled API and
// the exact same <option value="x">Label</option> children every call site
// already used, so swapping the tag name is the only change needed at each
// usage. Exists because a plain <select>'s CLOSED state is stylable with
// CSS, but the OPEN option list is native browser/OS chrome no CSS can
// reach at all (flagged directly: "kalo kek gini tu terasa biasa aja" about
// exactly that native dropdown) — this renders its own listbox instead, so
// every dropdown in the app can actually look like part of the app.
export default function Select({ value, onChange, disabled, children, 'aria-label': ariaLabel }) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const rootRef = useRef(null)
  const listRef = useRef(null)

  // Accept the same <option> children a real <select> would — including
  // conditionals like `{x && <option .../>}` which show up as null/false
  // entries in `children`, same as they would inside a real <select>.
  const options = (Array.isArray(children) ? children : [children])
    .filter((c) => c && c.type === 'option')
    .map((c) => ({ value: c.props.value, label: c.props.children, disabled: c.props.disabled }))

  const selected = options.find((o) => o.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (open) setActiveIndex(Math.max(0, options.findIndex((o) => o.value === value)))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function pick(opt, e) {
    if (opt.disabled) return
    // Several call sites wrap <Select> in a plain <label>Text<Select>...
    // (the same shape they used around a real <select>) — a <label>'s own
    // browser behavior is to forward any click inside it to the first real
    // form control it contains, which here is .select-trigger itself.
    // Without preventDefault, clicking an option correctly closed the list
    // (this handler) and then the label's own forwarded click immediately
    // re-toggled the trigger open again — real, reproduced bug, not a
    // timing fluke: the value updated correctly every time, only `open`
    // ever got stuck back on.
    e?.preventDefault()
    onChange?.({ target: { value: opt.value } })
    setOpen(false)
  }

  function onTriggerKeyDown(e) {
    if (disabled) return
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
    }
  }

  function onListKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(options.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[activeIndex]) pick(options[activeIndex]) }
    else if (e.key === 'Tab') setOpen(false)
  }

  return (
    <div className={`select ${open ? 'select--open' : ''} ${disabled ? 'select--disabled' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="select-value">{selected?.label}</span>
        {/* ChevronIcon only knows 'left'/'right' — the down/up arrow this
            needs is just that same mark rotated in CSS (90deg resting =
            down, -90deg open = up), not a new icon variant. */}
        <ChevronIcon width={14} height={14} className="select-chevron" />
      </button>
      {open && (
        <ul className="select-list" role="listbox" ref={listRef} tabIndex={-1} onKeyDown={onListKeyDown}>
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`select-option ${o.value === value ? 'select-option--selected' : ''} ${i === activeIndex ? 'select-option--active' : ''} ${o.disabled ? 'select-option--disabled' : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={(e) => pick(o, e)}
            >
              <span>{o.label}</span>
              {o.value === value && <CheckIcon width={14} height={14} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
