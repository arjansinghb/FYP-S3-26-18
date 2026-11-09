// A simple, self-contained SVG avatar character ("Pip").
// No external libraries — just inline SVG animated with CSS classes.
//
// Props:
//   speaking : boolean  -> animates the mouth as if talking
//   mood     : 'happy' | 'idle'  -> changes the expression
//
// This is the "face" the LLM speaks through — a pure presentational
// component, it doesn't know or care where `speaking`/`mood` come from.
// The words themselves are the real FastAPI backend's replies (see
// ChildChat.jsx's `ask()`), not anything hardcoded in here.

// Colour variants the child can choose (CH19/CH20).
export const AVATAR_COLORS = {
  purple: '#9b6bff',
  blue: '#5a9bff',
  green: '#4bc98a',
  pink: '#ff7fb0',
  orange: '#ffa94d',
}

// CH19/CH20 used to mean "pick a paint colour" — five identical faces with
// nothing else distinguishing them, which is thinner than it should be for
// the one character every child interacts with. Each colour now carries one
// small, considered accessory (same line-art language as `.avatar-stroke`
// elsewhere, not a sticker in a different visual style) so a choice actually
// reads as picking a *character*, not a hex code. Purple stays bare — it's
// the default "just Pip" option every child starts on before touching the
// picker at all.
const ACCESSORIES = {
  purple: null,
  // Round glasses, framing the existing eyes rather than covering them.
  blue: (
    <g className="avatar-accessory">
      <circle cx="78" cy="92" r="15" className="avatar-stroke" />
      <circle cx="122" cy="92" r="15" className="avatar-stroke" />
      <line x1="93" y1="92" x2="107" y2="92" className="avatar-stroke" />
    </g>
  ),
  // A tiny sprout between the ears — ties the "reading buddy" character to
  // something growing, without turning into a full plant-mascot redesign.
  green: (
    <g className="avatar-accessory">
      <path d="M100 30 L100 14" className="avatar-stroke" />
      <path d="M100 22 Q90 14 84 20" className="avatar-stroke" />
      <path d="M100 18 Q110 10 116 16" className="avatar-stroke" />
    </g>
  ),
  // A small bow, knot picked up in the avatar's own colour so it feels part
  // of the character rather than a separate coloured sticker.
  pink: (
    <g className="avatar-accessory">
      <path d="M88 24 L100 30 L88 36 Z" className="avatar-stroke" />
      <path d="M112 24 L100 30 L112 36 Z" className="avatar-stroke" />
      <circle cx="100" cy="30" r="3" className="avatar-fill" />
    </g>
  ),
  // A small sparkle by one ear — the exact mark icons.jsx's SparkleIcon
  // uses (same 24-unit proportions, not scaled down), just repositioned —
  // not a new decorative motif invented just for this.
  orange: (
    <g className="avatar-accessory" transform="translate(138,18)">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" className="avatar-stroke" />
    </g>
  ),
}

export default function Avatar({ speaking = false, mood = 'idle', color = 'purple' }) {
  const className = [
    'avatar',
    speaking ? 'is-speaking' : '',
    mood === 'happy' ? 'is-happy' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const fill = AVATAR_COLORS[color] || AVATAR_COLORS.purple
  const accessory = ACCESSORIES[color] || null

  return (
    <svg
      className={className}
      style={{ '--avatar-color': fill }}
      viewBox="0 0 200 200"
      width="220"
      height="220"
      role="img"
      aria-label="Pip, your reading buddy"
    >
      {/* soft shadow under the character */}
      <ellipse className="avatar-shadow" cx="100" cy="182" rx="52" ry="10" />

      {/* body */}
      <g className="avatar-body">
        <circle cx="100" cy="100" r="70" className="avatar-fill" />

        {/* little ears / antennae */}
        <circle cx="60" cy="42" r="12" className="avatar-fill" />
        <circle cx="140" cy="42" r="12" className="avatar-fill" />

        {/* cheeks */}
        <circle cx="66" cy="118" r="11" className="avatar-cheek" />
        <circle cx="134" cy="118" r="11" className="avatar-cheek" />

        {/* eyes (blink via CSS scaleY) */}
        <g className="avatar-eyes">
          <circle cx="78" cy="92" r="9" className="avatar-eye" />
          <circle cx="122" cy="92" r="9" className="avatar-eye" />
          <circle cx="81" cy="89" r="3" className="avatar-glint" />
          <circle cx="125" cy="89" r="3" className="avatar-glint" />
        </g>

        {/* happy arced eyes (shown only in happy mood) */}
        <g className="avatar-eyes-happy">
          <path d="M70 94 Q78 84 86 94" className="avatar-stroke" />
          <path d="M114 94 Q122 84 130 94" className="avatar-stroke" />
        </g>

        {/* mouth: a smile normally, an open oval while speaking */}
        <path d="M84 122 Q100 138 116 122" className="avatar-mouth-smile" />
        <ellipse cx="100" cy="126" rx="12" ry="9" className="avatar-mouth-open" />

        {accessory}
      </g>
    </svg>
  )
}
