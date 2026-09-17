// Per-tile identity colours for Admin/Moderator Overview stat tiles —
// shared by both dashboards so the same tone name always maps to the same
// colour pair. 'danger'/'success' reuse the app's existing status tokens;
// the rest are the extended stat-tile-only palette (see index.css's
// STAT-TILE PALETTE comment for why these exist at all).
const TILE_TONES = {
  blue: ['var(--blue-700)', 'var(--blue-100)'],
  success: ['var(--success-700)', 'var(--success-100)'],
  pink: ['var(--pink-700)', 'var(--pink-100)'],
  danger: ['var(--danger-700)', 'var(--danger-100)'],
  amber: ['var(--amber-700)', 'var(--amber-100)'],
  teal: ['var(--teal-700)', 'var(--teal-100)'],
  indigo: ['var(--indigo-700)', 'var(--indigo-100)'],
  orange: ['var(--orange-700)', 'var(--orange-100)'],
  cyan: ['var(--cyan-700)', 'var(--cyan-100)'],
  brown: ['var(--brown-700)', 'var(--brown-100)'],
  magenta: ['var(--magenta-700)', 'var(--magenta-100)'],
}

// A style object carrying the two custom properties .stat--tone's CSS
// reads — spread this onto a tile's `style` prop alongside `className="stat
// stat--tone"`.
export function toneStyle(tone) {
  const [strong, tint] = TILE_TONES[tone] || []
  return strong ? { '--tone-700': strong, '--tone-100': tint } : undefined
}
