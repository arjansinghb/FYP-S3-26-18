// Small, hand-drawn *illustration* shapes — deliberately NOT the same
// visual language as icons.jsx's uniform-stroke line icons. Those are UI
// chrome (buttons, labels, tags); these are flat filled "sticker" pieces
// meant to read as illustration in the hero cluster, so the hero doesn't
// lean on the app's own UI icon set for its one illustrative moment.
// currentColor-based, same as icons.jsx, so they still inherit the
// cluster piece's background/foreground pairing from CSS.

export function ClusterBookGlyph(props) {
  return (
    <svg viewBox="0 0 48 40" fill="none" {...props}>
      <path
        d="M24 8C20 4 12 3 5 5v27c7-2 15-1 19 3 4-4 12-5 19-3V5c-7-2-15-1-19 3z"
        fill="currentColor"
      />
      <path
        d="M24 8v27"
        stroke="rgba(0,0,0,0.12)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function ClusterPlayGlyph(props) {
  return (
    <svg viewBox="0 0 40 40" fill="none" {...props}>
      <path
        d="M20 2c-6 5-13 7-18 6 1 5 1 12 0 17-1 7 1 11 4 12 5 2 11-3 14-9 3 6 9 11 14 9 3-1 5-5 4-12-1-5-1-12 0-17-5 1-12-1-18-6z"
        fill="currentColor"
      />
      <path d="M16 15v10l10-5-10-5z" fill="rgba(0,0,0,0.16)" />
    </svg>
  )
}

export function ClusterSparkleGlyph(props) {
  return (
    <svg viewBox="0 0 40 40" fill="none" {...props}>
      <path
        d="M20 2c1 7 3 11 6 14 3 3 7 5 14 6-7 1-11 3-14 6-3 3-5 7-6 14-1-7-3-11-6-14-3-3-7-5-14-6 7-1 11-3 14-6 3-3 5-7 6-14z"
        fill="currentColor"
      />
    </svg>
  )
}
