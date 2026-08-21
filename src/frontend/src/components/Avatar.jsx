// A simple, self-contained SVG avatar character ("Pip").
// No external libraries — just inline SVG animated with CSS classes.
//
// Props:
//   speaking : boolean  -> animates the mouth as if talking
//   mood     : 'happy' | 'idle'  -> changes the expression
//
// This is the "face" the LLM will later speak through. Right now the words
// are hardcoded in the demo; later they'll come from the FastAPI backend.

// Colour variants the child can choose (CH19/CH20).
export const AVATAR_COLORS = {
  purple: '#9b6bff',
  blue: '#5a9bff',
  green: '#4bc98a',
  pink: '#ff7fb0',
  orange: '#ffa94d',
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
      </g>
    </svg>
  )
}
