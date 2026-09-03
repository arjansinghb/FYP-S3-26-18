// CH19/CH20 (Choose/Edit Avatar) — dev-session 2026-08-17: replaced the
// original emoji placeholders (see agent-context/CLAUDE.md §15.9) with
// small hand-built inline SVG character icons, matching the child theme's
// existing "Storybook Sticker" look (Baloo 2 font, warm cream paper,
// considered accent colours — §15.4). Every render site (`avatar.icon`)
// already sits inside a container that sets its own `font-size` — these
// SVGs use `width/height: 1em` specifically so they inherit that sizing for
// free, exactly like the emoji they replaced, with no CSS changes needed.
//
// dev-session 2026-08-21: every icon below gained an `avatar-eyes` group and
// a smile/open-mouth pair, class-named to match `arjansinghb`'s standalone
// "Pip" avatar prototype (`763f318` on `main`, src/frontend/src/components/
// Avatar.jsx — a teammate's earlier concept, shown to Claude as a visual
// reference, not merged/used directly since it's a single fixed voice-only
// character and this build already has CH19's 6-way avatar picker working).
// Ported technique, not the character: CSS in index.css drives an always-on
// blink (`.avatar-eyes`, pure CSS, every avatar everywhere) and a talking
// mouth-flap that only activates under `.chat-companion--speaking` (the big
// avatar in ChatScreen.tsx) — see that file's docstring. No prop-threading
// needed for either; both are plain CSS selectors reaching into whichever
// icon happens to be mounted, so this stays a drop-in visual upgrade with no
// changes required at any of the many call sites that render `avatar.icon`.
import type { JSX } from 'react'

export interface Avatar {
  id: string
  icon: JSX.Element
  name: string
  color: string
}

const CREAM = '#fffaf0'
const INK = '#3a2e2e'

function FoxIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 3 L9 10 L4 9 Z" fill={CREAM} />
      <path d="M20 3 L15 10 L20 9 Z" fill={CREAM} />
      <path d="M12 6 C17 6 20 10 19 15 C18 19 15 21 12 21 C9 21 6 19 5 15 C4 10 7 6 12 6 Z" fill={CREAM} />
      <ellipse cx="12" cy="16.3" rx="3.4" ry="2.4" fill="#f4d9b8" />
      <path d="M12 14.6 L10.9 16 L13.1 16 Z" fill={INK} />
      <g className="avatar-eyes">
        <circle cx="8.7" cy="12.5" r="1.4" fill={INK} />
        <circle cx="15.3" cy="12.5" r="1.4" fill={INK} />
      </g>
      <path className="avatar-mouth-smile" d="M9.7 17.2 Q12 18.6 14.3 17.2" stroke={INK} strokeWidth="1" strokeLinecap="round" fill="none" />
      <ellipse className="avatar-mouth-open" cx="12" cy="17.6" rx="1.9" ry="1.6" fill={INK} opacity="0" />
    </svg>
  )
}

function OwlIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 4 L8.5 8" stroke={CREAM} strokeWidth="2" strokeLinecap="round" />
      <path d="M18 4 L15.5 8" stroke={CREAM} strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="12" cy="14" rx="8" ry="8.5" fill={CREAM} />
      <g className="avatar-eyes">
        <circle cx="8.5" cy="13" r="3.2" fill="#fff" />
        <circle cx="15.5" cy="13" r="3.2" fill="#fff" />
        <circle cx="8.5" cy="13" r="1.5" fill={INK} />
        <circle cx="15.5" cy="13" r="1.5" fill={INK} />
      </g>
      <path className="avatar-mouth-smile" d="M12 15.5 L10.3 18 L13.7 18 Z" fill="#f4a259" />
      <path className="avatar-mouth-open" d="M12 15.3 L9.6 18.6 L14.4 18.6 Z" fill="#e08a3a" opacity="0" />
    </svg>
  )
}

function DragonIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M9.5 2 L10.3 7 L8.5 6.7 Z" fill="#cdeee8" />
      <path d="M14.5 2 L13.7 7 L15.5 6.7 Z" fill="#cdeee8" />
      <path
        d="M12 6.5 C17 6.5 19.5 10.5 18.5 15 C17.7 18.7 15 21 12 21 C9 21 6.3 18.7 5.5 15 C4.5 10.5 7 6.5 12 6.5 Z"
        fill={CREAM}
      />
      <path d="M4.5 12 C3.5 12 3 12.7 3 13.5 C3.6 13.6 4.6 13.4 5.2 12.8 Z" fill={CREAM} />
      <path d="M19.5 12 C20.5 12 21 12.7 21 13.5 C20.4 13.6 19.4 13.4 18.8 12.8 Z" fill={CREAM} />
      <g className="avatar-eyes">
        <circle cx="9" cy="13" r="1.4" fill={INK} />
        <circle cx="15" cy="13" r="1.4" fill={INK} />
      </g>
      <path
        className="avatar-mouth-smile"
        d="M12 17.3 C10.8 17.3 9.8 18 9.5 19.1 C10.7 19.7 13.3 19.7 14.5 19.1 C14.2 18 13.2 17.3 12 17.3 Z"
        fill="#cdeee8"
      />
      <ellipse className="avatar-mouth-open" cx="12" cy="18.2" rx="2.3" ry="1.9" fill={INK} opacity="0" />
    </svg>
  )
}

function PandaIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="6" cy="6" r="3" fill={INK} />
      <circle cx="18" cy="6" r="3" fill={INK} />
      <circle cx="12" cy="14" r="8" fill={CREAM} />
      <g className="avatar-eyes">
        <ellipse cx="8.5" cy="13" rx="2.3" ry="2.8" fill={INK} />
        <ellipse cx="15.5" cy="13" rx="2.3" ry="2.8" fill={INK} />
        <circle cx="8.7" cy="13.3" r="0.8" fill="#fff" />
        <circle cx="15.7" cy="13.3" r="0.8" fill="#fff" />
      </g>
      <path className="avatar-mouth-smile" d="M10 17.3 Q12 18.6 14 17.3" stroke={INK} strokeWidth="1" strokeLinecap="round" fill="none" />
      <ellipse className="avatar-mouth-open" cx="12" cy="17.6" rx="1.7" ry="1.5" fill={INK} opacity="0" />
    </svg>
  )
}

function UnicornIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2 L13.5 9 L10.5 9 Z" fill="#ffe9a8" />
      <path
        d="M12 3 L12.7 6 L11.3 6 Z M12 5 L12.7 8 L11.3 8 Z"
        fill="#f4d060"
      />
      <path d="M4 8 C4 6 6 4.5 8 5.5 C6.5 6.5 6 8 6.5 9.5 Z" fill="#e07a9e" />
      <path d="M5 6 C5 4.5 6.5 3.5 8 4.3 C7 5 6.6 6.2 7 7.3 Z" fill="#f2a9c2" />
      <path
        d="M11.5 7 C16.5 7 19 11 18 15.5 C17.2 19 14.5 21 11.5 21 C8.5 21 5.8 19 5 15.5 C4 11 6.5 7 11.5 7 Z"
        fill={CREAM}
      />
      <g className="avatar-eyes">
        <circle cx="9" cy="13.5" r="1.4" fill={INK} />
        <circle cx="14.5" cy="13.5" r="1.4" fill={INK} />
      </g>
      <path className="avatar-mouth-smile" d="M10.5 16.5 Q11.7 17.4 13 16.5" stroke={INK} strokeWidth="1" strokeLinecap="round" fill="none" />
      <ellipse className="avatar-mouth-open" cx="11.7" cy="17" rx="1.7" ry="1.4" fill={INK} opacity="0" />
    </svg>
  )
}

function RobotIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="12" y1="2" x2="12" y2="5" stroke={CREAM} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="2" r="1.4" fill={CREAM} />
      <rect x="4.5" y="5" width="15" height="15" rx="4" fill={CREAM} />
      <g className="avatar-eyes">
        <rect x="7.5" y="10" width="4" height="4.5" rx="1" fill={INK} />
        <rect x="12.5" y="10" width="4" height="4.5" rx="1" fill={INK} />
      </g>
      <rect className="avatar-mouth-smile" x="9" y="16.5" width="6" height="1.8" rx="0.9" fill={INK} />
      <rect className="avatar-mouth-open" x="9.5" y="16" width="5" height="3" rx="1.2" fill={INK} opacity="0" />
    </svg>
  )
}

export const AVATARS: Avatar[] = [
  { id: 'fox', icon: <FoxIcon />, name: 'Fox', color: '#f4a259' },
  { id: 'owl', icon: <OwlIcon />, name: 'Owl', color: '#8d6a9f' },
  { id: 'dragon', icon: <DragonIcon />, name: 'Dragon', color: '#5fa8d3' },
  { id: 'panda', icon: <PandaIcon />, name: 'Panda', color: '#6a8caf' },
  { id: 'unicorn', icon: <UnicornIcon />, name: 'Unicorn', color: '#e07a9e' },
  { id: 'robot', icon: <RobotIcon />, name: 'Robot', color: '#6fbf73' },
]

export function getAvatar(id: string | null): Avatar {
  return AVATARS.find((a) => a.id === id) ?? AVATARS[0]
}
