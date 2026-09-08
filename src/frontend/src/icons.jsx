// Small hand-built line-icon set — currentColor-based so every icon inherits
// whatever button/text colour it's placed in (no separate palette to keep in
// sync, themes automatically). Deliberately not an emoji or an icon-font:
// consistent stroke weight (1.8), considered marks instead of font glyphs
// standing in for missing art. Same spirit as components/Avatar.jsx's
// hand-built character — a real design decision, not a placeholder.

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function MicIcon(props) {
  return (
    <svg {...base} {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M9 21h6" />
    </svg>
  )
}

export function SendIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 12 20 4l-6 16-3-7-7-1Z" />
    </svg>
  )
}

export function SparkleIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
    </svg>
  )
}

export function BookIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 5.5C4 4.7 4.7 4 5.5 4H12v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" />
      <path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H12v16h6.5a1.5 1.5 0 0 0 1.5-1.5v-13Z" />
    </svg>
  )
}

export function VideoIcon(props) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10.5 5-3v9l-5-3" />
    </svg>
  )
}

export function CompassIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m14.5 9.5-2 5-5 2 2-5 5-2Z" />
    </svg>
  )
}

export function PawIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="8" cy="8" r="1.6" />
      <circle cx="12.5" cy="6" r="1.6" />
      <circle cx="17" cy="8" r="1.6" />
      <path d="M12.5 10.5c3 0 5 2.1 5 4.4 0 1.9-1.6 3.1-3.6 3.1-.9 0-1.4-.4-1.9-.4s-1 .4-1.9.4c-2 0-3.6-1.2-3.6-3.1 0-2.3 2-4.4 5-4.4Z" />
    </svg>
  )
}

export function MoonIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
    </svg>
  )
}

export function FlaskIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M9 3h6M10 3v6l-5 9.5A2 2 0 0 0 6.7 21h10.6a2 2 0 0 0 1.7-3l-5-9V3" />
      <path d="M8 15h8" />
    </svg>
  )
}

export function HeartIcon({ filled = false, ...props }) {
  return (
    <svg {...base} fill={filled ? 'currentColor' : 'none'} {...props}>
      <path d="M12 20s-7-4.4-9.3-8.8C1.2 8 2.6 5 5.7 5c1.9 0 3.3 1 4.3 2.5C11 6 12.4 5 14.3 5c3.1 0 4.5 3 3 6.2C17 15.6 12 20 12 20Z" />
    </svg>
  )
}

export function PaletteIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3a9 8 0 0 0 0 16c1.1 0 2-.7 2-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H16a4 3.5 0 0 0 4-3.5C20 6 16.4 3 12 3Z" />
      <circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="7" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function PlayIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M7 4.5v15l13-7.5-13-7.5Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
    </svg>
  )
}

export function ThumbsUpIcon({ filled = false, ...props }) {
  return (
    <svg {...base} fill={filled ? 'currentColor' : 'none'} {...props}>
      <path d="M7 11v9H4v-9h3Zm0 0 4-7c1 0 2 .8 2 2v3h4.5c1 0 1.7.9 1.4 1.8l-2 6a2 2 0 0 1-1.9 1.2H7" />
    </svg>
  )
}

export function ThumbsDownIcon({ filled = false, ...props }) {
  return (
    <svg {...base} fill={filled ? 'currentColor' : 'none'} {...props}>
      <path d="M7 13V4H4v9h3Zm0 0-4 7c1 0 2-.8 2-2v-3h4.5c1 0 1.7-.9 1.4-1.8l-2-6a2 2 0 0 0-1.9-1.2H7" />
    </svg>
  )
}

export function RefreshIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 12a8 8 0 0 1 13.7-5.7L20 8" />
      <path d="M20 4v4h-4" />
      <path d="M20 12a8 8 0 0 1-13.7 5.7L4 16" />
      <path d="M4 20v-4h4" />
    </svg>
  )
}

export function CloseIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M5 5l14 14M19 5 5 19" />
    </svg>
  )
}

export function ShieldIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5 5 6v5.5c0 4.3 3 7.4 7 9 4-1.6 7-4.7 7-9V6l-7-2.5Z" />
      <path d="m9.2 12 1.9 2 3.7-4" />
    </svg>
  )
}

export function UsersIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20c0-3 2.5-5.5 5.5-5.5S14.5 17 14.5 20" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M15 14.3c2.4.4 4.5 2.5 4.5 5.7" />
    </svg>
  )
}

export function CheckIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  )
}

export function StarIcon({ filled = true, ...props }) {
  return (
    <svg {...base} fill={filled ? 'currentColor' : 'none'} {...props}>
      <path d="m12 3.5 2.6 5.5 6 .7-4.4 4.1 1.2 5.9-5.4-3-5.4 3 1.2-5.9-4.4-4.1 6-.7 2.6-5.5Z" strokeLinejoin="round" />
    </svg>
  )
}

export function QuoteIcon(props) {
  return (
    <svg {...base} fill="currentColor" stroke="none" {...props}>
      <path d="M9.5 6C6.5 7.2 5 9.5 5 12.3c0 2.3 1.4 3.9 3.4 3.9 1.7 0 3-1.3 3-3 0-1.6-1.1-2.8-2.6-2.9.3-1.4 1.5-2.6 3.2-3.3L9.5 6Zm9 0c-3 1.2-4.5 3.5-4.5 6.3 0 2.3 1.4 3.9 3.4 3.9 1.7 0 3-1.3 3-3 0-1.6-1.1-2.8-2.6-2.9.3-1.4 1.5-2.6 3.2-3.3L18.5 6Z" />
    </svg>
  )
}

export function LogoutIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
      <path d="M15 16l4-4-4-4" />
      <path d="M19 12H9" />
    </svg>
  )
}

// The daily-streak badge (see streak.js) — the one filled icon in this
// otherwise-stroke set, same exception QuoteIcon/StarIcon already make for
// a mark that reads better solid than outlined.
export function FlameIcon(props) {
  return (
    <svg {...base} fill="currentColor" stroke="none" {...props}>
      <path d="M12 2c1 3-3 4.5-3 8a3 3 0 0 0 6 0c1 1 1.5 2.4 1.5 3.5A4.5 4.5 0 0 1 12 22a5 5 0 0 1-5-5c0-3 1.8-4.3 2.5-6.5C10 8.5 11 5 12 2Z" />
    </svg>
  )
}

// Pip's voice on/off toggle. `muted` swaps in a slash instead of a second
// icon component, same pattern HeartIcon/StarIcon use for their own boolean.
export function SpeakerIcon({ muted = false, ...props }) {
  return (
    <svg {...base} {...props}>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      {!muted && <path d="M17 8a5 5 0 0 1 0 8" />}
      {muted && <path d="M19 8l-5 8M14 8l5 8" />}
    </svg>
  )
}

// ---------- moderator/staff console set ----------
export function PlusIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function EditIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 20h4l11-11a2.5 2.5 0 0 0-4-4L4 16v4Z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  )
}

export function TrashIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M5 7h14" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M7 7l1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

export function FlagIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M5 3v18" />
      <path d="M5 4h11l-2.5 4L16 12H5" />
    </svg>
  )
}

export function InboxIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 12h4l2 3h4l2-3h4" />
      <path d="M5.5 5h13l2.5 7v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6l2.5-7Z" />
    </svg>
  )
}

export function GridIcon(props) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  )
}

// ---------- parent/admin console set ----------
export function BellIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c0.5-0.5 2-2 2-6Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  )
}

export function LockIcon(props) {
  return (
    <svg {...base} {...props}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

export function ClockIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </svg>
  )
}

export function AlertIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5 21 19H3L12 3.5Z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function ChatIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 6h16v10H9l-5 4V6Z" />
    </svg>
  )
}

export function UserIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1-4 4-6 7-6s6 2 7 6" />
    </svg>
  )
}

export function ChartIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M5 19V10M12 19V5M19 19v-6" />
      <path d="M3 19h18" />
    </svg>
  )
}

export function SettingsIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3H9.8l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9c.6.5 1.3.9 2 1.2l.4 2.6h4.4l.4-2.6c.7-.3 1.4-.7 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />
    </svg>
  )
}

export function LifeBuoyIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M6.2 6.2l3.3 3.3M18 18l-3.3-3.3M6.2 18l3.3-3.3M18 6l-3.3 3.3" />
    </svg>
  )
}

// Staff-facing only (CM03 search & import) — the child/landing surfaces
// deliberately never show a magnifying glass anywhere (see §2.1's "not a
// search engine" rule); a moderator searching Google Books/YouTube for
// import candidates is a completely different, legitimate use.
export function SearchIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  )
}
