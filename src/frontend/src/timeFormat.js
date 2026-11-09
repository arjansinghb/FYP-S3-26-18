// Shared by Moderator/Admin Overview — two different jobs, kept as two
// functions rather than one with a "mode" flag:

// "Submitted 2h ago" style — used on list items (Submissions/Catalogue/
// Reports rows, etc.) where what matters is how long something's been
// waiting, not the exact clock time.
export function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() / 1000 - ts
  if (diff < 45) return 'just now'
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// A "Recent activity" log's own timestamp — flagged directly ("jangan kek
// 1m ago, jadi kek log time aja"): a log is read back days later, when
// "3d ago" has long since stopped being useful and an exact date/time is
// what's actually needed.
export function logTime(ts) {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
