import { useEffect, useState } from 'react'

// Landing-page section rail: a vertical line of dots down the left edge, one
// per section, each with its name beside it (always visible — never
// hover-only). It reads as a progress timeline: dots for sections you've
// scrolled past are filled and the line fills in down to the one you're on;
// click any name/dot to glide there. `items` is [{ id, label }] where `id`
// is the DOM id of the section; sections that aren't rendered (e.g. reviews
// before the first approved one) are left out by the caller.
export default function SideNav({ items }) {
  const [active, setActive] = useState(items[0]?.id)

  useEffect(() => {
    const update = () => {
      // The last section whose top has crossed 35% down the viewport is
      // "current". Pinned to the last item at the very bottom, since the
      // final short sections may never get that far up the screen.
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
      let current = items[0]?.id
      if (atBottom) {
        current = items[items.length - 1]?.id
      } else {
        const line = window.innerHeight * 0.35
        for (const item of items) {
          const el = document.getElementById(item.id)
          if (el && el.getBoundingClientRect().top <= line) current = item.id
        }
      }
      setActive(current)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [items])

  function go(e, id) {
    e.preventDefault()
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }

  const activeIndex = Math.max(0, items.findIndex((i) => i.id === active))

  return (
    <nav className="side-nav" aria-label="Page sections">
      <div className="side-nav-track" aria-hidden="true">
        <span style={{ height: `${items.length > 1 ? (activeIndex / (items.length - 1)) * 100 : 0}%` }} />
      </div>
      <ol>
        {items.map((item, i) => (
          <li key={item.id} className={i < activeIndex ? 'is-past' : i === activeIndex ? 'is-active' : ''}>
            <a href={`#${item.id}`} onClick={(e) => go(e, item.id)} aria-current={i === activeIndex ? 'true' : undefined}>
              <span className="side-nav-dot" aria-hidden="true" />
              <span className="side-nav-label">{item.label}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
