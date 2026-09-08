// Frontend-only daily-streak tracker. This branch's backend (storage.py's
// Database) has no last-active/streak field on the child record, and this
// pass isn't adding one there — this lives entirely in the child's own
// browser via localStorage, keyed per child id. Honest scope: it resets if
// the child switches devices or clears site data, and it isn't visible to
// the parent dashboard. It's a lightweight "welcome back" touch, not a
// tracked/reportable metric.

const KEY_PREFIX = 'pip_streak_'

function dateKey(d) {
  // YYYY-MM-DD in the browser's own local time — good enough for "did you
  // open the app today", which is the only thing this needs to answer.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Call once per chat session mount. Returns the current streak length
// (1 on a first-ever or broken streak, incrementing only once per calendar
// day, never twice for the same day's re-visits).
export function recordVisit(childId) {
  if (!childId) return 1
  const key = KEY_PREFIX + childId
  let data = null
  try { data = JSON.parse(localStorage.getItem(key)) } catch { /* private mode, corrupt value, etc. */ }

  const today = dateKey(new Date())
  const yesterday = dateKey(new Date(Date.now() - 24 * 60 * 60 * 1000))

  let next
  if (!data || !data.lastDate) {
    next = { lastDate: today, streak: 1 }
  } else if (data.lastDate === today) {
    next = data // already counted today
  } else if (data.lastDate === yesterday) {
    next = { lastDate: today, streak: (data.streak || 0) + 1 }
  } else {
    next = { lastDate: today, streak: 1 } // gap of 2+ days — streak resets
  }

  try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* ignore */ }
  return next.streak
}
