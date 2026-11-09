// Frontend-only content curation for real (unedited) catalogue data.
//
// This product's own principle is "never show fake/placeholder content" —
// titles and descriptions come from real Google Books/YouTube imports, not
// invented copy, and that stays true here: nothing below fabricates or
// rewrites content. But some real listings are themselves messy at the
// source (multi-book "box set" bundles joined with " & ", long ad-copy
// descriptions written for a store page) — showing that raw to a 5-year-old
// breaks this product's hard constraint that it must never read as a
// search engine. This does the minimum honest cleanup on the frontend:
// shortens an obviously-bundled title rather than rewriting or inventing
// anything, and leaves everything else untouched. A genuinely messy single
// title is a catalogue/moderation-pipeline concern (CM03/CM04), not
// something a frontend regex should try to silently rewrite — see
// child.css's line-clamp rules for how a long-but-real single title is
// handled instead (visual truncation at a word boundary, not content
// rewriting).

// Only trims when there are genuinely multiple " & "-joined segments AND
// the whole title is long enough that it's clearly a bundle listing, not a
// short legitimate title that happens to contain "&" (e.g. a real book
// called "Jekyll & Hyde" is left completely alone).
export function curateTitle(rawTitle) {
  if (!rawTitle) return rawTitle
  const segments = rawTitle.split(/\s*&\s*/)
  if (segments.length < 2 || rawTitle.length < 60) return rawTitle
  const first = segments[0].replace(/^box\s*set\s*(children'?s\s*books?)?:?\s*/i, '').trim()
  return first ? `${first} (and more)` : rawTitle
}
