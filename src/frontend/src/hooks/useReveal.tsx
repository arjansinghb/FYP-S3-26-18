// Scroll-triggered reveal — fades/slides an element in the first time it
// enters the viewport (IntersectionObserver, disconnects after firing once).
// Used to break up the "everything painted at once" static-page feel on the
// landing page (dev-session 2026-08-11 engagement pass).
import { useEffect, useRef, useState } from 'react'

export function useReveal<T extends HTMLElement>(threshold = 0.15) {
  const ref = useRef<T | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true) // graceful fallback — no JS-driven hide-until-scroll without it
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [threshold])

  return { ref, visible }
}

// True once the page has scrolled past a 1px sentinel placed at the very
// top of the document — drives the glass/blur nav treatment. Deliberately
// IntersectionObserver-based rather than a `scroll` listener: no per-frame
// scroll-handler overhead, and it keeps working under scroll-position
// restoration / programmatic scrolls that don't always fire a `scroll`
// event in every environment. Render `<ScrollTopSentinel />` once, near the
// top of the page.
export function useScrolled() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const sentinel = document.getElementById('scroll-top-sentinel')
    if (!sentinel || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting))
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  return scrolled
}

export function ScrollTopSentinel() {
  return <div id="scroll-top-sentinel" aria-hidden="true" style={{ position: 'absolute', top: 0, height: 1, width: 1 }} />
}
