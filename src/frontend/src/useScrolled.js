import { useEffect, useState } from 'react'

// True once the page has scrolled past `threshold` px — drives the pinned
// dashboard header fading from transparent to frosted glass (same idea as
// the landing page's own nav, which does this inline in Home.jsx).
export default function useScrolled(threshold = 24) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])
  return scrolled
}
