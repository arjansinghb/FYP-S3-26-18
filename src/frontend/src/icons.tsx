// Small hand-built line-icon set — dev-session 2026-08-21. Replaces raw
// Unicode emoji (🔥😂🐾🚀🔬✨💔) that had crept into the streak badge,
// starter chips, and favourites shelf: functional, but generic — every
// other app's badge is a fire emoji, every "remove" button is a broken
// heart. These use `currentColor` (inherit whatever the button/badge's own
// text colour already is, light or dark theme, no separate palette to
// maintain) and a consistent stroke weight, same spirit as avatars.tsx's
// characters — considered marks, not a font's emoji glyphs standing in for
// missing art.
import type { JSX } from 'react'

const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

export function FlameIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path
        {...common}
        d="M12 2.5c.6 2.8-1.8 4-2.6 6.2-.6 1.7.1 3 1 3.7-.6-1.4-.2-2.4.6-3.3.2 1.3.9 2 1.8 2.4.9-1 1.3-1.9 1.1-3 1.4 1.2 2.1 2.8 1.7 4.6-.5 2.4-2.7 4-5.3 3.7-2.7-.3-4.6-2.6-4.3-5.2C6.4 8.2 10 6.6 12 2.5Z"
      />
    </svg>
  )
}

export function LaughIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <circle {...common} cx="12" cy="12" r="8.5" />
      <path {...common} d="M8 10.5c.3-.8.9-1.2 1.5-1.2s1.2.4 1.5 1.2M13 10.5c.3-.8.9-1.2 1.5-1.2s1.2.4 1.5 1.2" />
      <path {...common} d="M7.5 13.5c1 2.3 2.8 3.3 4.5 3.3s3.5-1 4.5-3.3" />
    </svg>
  )
}

export function PawIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <ellipse {...common} cx="12" cy="16" rx="5" ry="4.2" />
      <circle {...common} cx="6" cy="9.5" r="2" />
      <circle {...common} cx="10.5" cy="6.5" r="2" />
      <circle {...common} cx="15.5" cy="6.5" r="2" />
      <circle {...common} cx="18.5" cy="9.5" r="2" />
    </svg>
  )
}

export function CompassIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <circle {...common} cx="12" cy="12" r="8.5" />
      <path {...common} d="M15 9 13 13.2 9 15 11 10.8Z" strokeLinejoin="round" />
    </svg>
  )
}

export function FlaskIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path {...common} d="M10 3h4M10.5 3v5.5L6.3 16a2 2 0 0 0 1.7 3h8a2 2 0 0 0 1.7-3l-4.2-7.5V3" />
      <path {...common} d="M8 14.5h8" />
    </svg>
  )
}

export function SparkleIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path {...common} strokeLinejoin="round" d="M12 3.5c.6 3 1.9 4.3 4.9 4.9-3 .6-4.3 1.9-4.9 4.9-.6-3-1.9-4.3-4.9-4.9 3-.6 4.3-1.9 4.9-4.9Z" />
      <path {...common} strokeLinejoin="round" d="M18.5 14c.3 1.4.9 2 2.3 2.3-1.4.3-2 .9-2.3 2.3-.3-1.4-.9-2-2.3-2.3 1.4-.3 2-.9 2.3-2.3Z" />
    </svg>
  )
}

export function RemoveIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path {...common} d="M5 7h14M9.5 7V5.3c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3V7M7.5 7l.8 11.2c.1.9.9 1.6 1.8 1.6h3.8c.9 0 1.7-.7 1.8-1.6L16.5 7" />
    </svg>
  )
}

export function SpeakerIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path {...common} strokeLinejoin="round" d="M4 9.5h3.2L11 6v12l-3.8-3.5H4z" />
      <path {...common} d="M15 9.2c1 .9 1.5 1.8 1.5 2.8s-.5 1.9-1.5 2.8M17.3 6.8c1.8 1.6 2.7 3.3 2.7 5.2s-.9 3.6-2.7 5.2" />
    </svg>
  )
}

export function StarIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path
        {...common}
        fill={filled ? 'currentColor' : 'none'}
        strokeLinejoin="round"
        d="M12 3.5l2.5 5.6 6 .6-4.5 4.1 1.3 6-5.3-3.1-5.3 3.1 1.3-6L3.5 9.7l6-.6Z"
      />
    </svg>
  )
}

export const TOPIC_ICONS: Record<string, () => JSX.Element> = {
  laugh: LaughIcon,
  paw: PawIcon,
  compass: CompassIcon,
  flask: FlaskIcon,
  sparkle: SparkleIcon,
}
