// A small circular progress ring — shared by Moderator Overview
// (catalogue approval rate) and Admin Overview (review approval rate).
// The one non-bar, non-tile shape on either page (flagged directly on the
// Moderator side — the page read as "sepi"/"kurang menarik" next to bars
// and stat tiles alone). Plain SVG stroke-dasharray trick, no charting
// library for one ring.
export default function ApprovalRing({ pct }) {
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div className="approval-ring">
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--border)" strokeWidth="6" />
        <circle
          cx="32" cy="32" r={r} fill="none" stroke="var(--primary-700)" strokeWidth="6"
          strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} strokeLinecap="round"
          transform="rotate(-90 32 32)"
        />
      </svg>
      <span className="approval-ring-pct">{pct}%</span>
    </div>
  )
}
