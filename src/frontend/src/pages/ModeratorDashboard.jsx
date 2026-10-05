import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getToken, getMe, login, logout,
  listContent, addContent, editContent, removeContent, approveContent, rejectContent,
  listReports, resolveReport, sendReportNote, searchBooks, searchVideos, importContent, listTopicRequests, autoImportTopic,
  dismissTopicRequest, bulkImport,
  listAuditQueue, submitAudit,
} from '../api'
import {
  AlertIcon, BookIcon, ChartIcon, ChatIcon, CheckIcon, ChevronIcon, ClockIcon, CloseIcon, EditIcon, FlagIcon, GridIcon,
  InboxIcon, PlusIcon, RefreshIcon, SearchIcon, SparkleIcon, TrashIcon, VideoIcon,
} from '../icons'
import { useToast, ToastHost } from '../components/Toast'
import Select from '../components/Select'
import PasswordInput from '../components/PasswordInput'
import ConfirmDialog from '../components/ConfirmDialog'
import ReportNoteDialog from '../components/ReportNoteDialog'
import PromptDialog from '../components/PromptDialog'
import useScrolled from '../useScrolled'
import ApprovalRing from '../components/ApprovalRing'
import { firstMissingField } from '../formValidation'
import { timeAgo, logTime } from '../timeFormat'
import { toneStyle } from '../statTones'
import './parent.css'

const AGE_BANDS = ['5-8', '9-12']

// Turns raw catalogue/report records into a flat, time-sorted event list.
// A manually-added entry is auto-approved in the same action (see
// routers/content.py's add_entry) — created_at and reviewed_at land at
// the same instant, so it gets ONE "Added" event, not "Imported" +
// "Approved" back to back for a single click. An imported entry is a real
// two-step workflow (search/import now, approve/reject later, often by a
// different moderator) so it keeps both events, separately timestamped.
// Items from before this feature shipped have no created_at at all —
// left out entirely rather than shown with a fabricated "just now".
function buildActivity(items, reports) {
  const events = []
  for (const item of items) {
    const isManual = item.source === 'manual'
    if (isManual && item.reviewed_at) {
      events.push({ ts: item.reviewed_at, kind: 'added', item })
    } else {
      if (item.created_at) events.push({ ts: item.created_at, kind: 'imported', item })
      if (item.reviewed_at) events.push({ ts: item.reviewed_at, kind: item.status, item })
    }
  }
  for (const report of reports) {
    if (report.resolved_at) events.push({ ts: report.resolved_at, kind: 'report_resolved', report })
  }
  return events.sort((a, b) => b.ts - a.ts).slice(0, 8)
}

const ACTIVITY_META = {
  added: { icon: PlusIcon, tint: null, text: (e) => `Added "${e.item.title}" to the catalogue` },
  imported: { icon: SearchIcon, tint: null, text: (e) => `Imported "${e.item.title}" for review` },
  approved: { icon: CheckIcon, tint: 'success', text: (e) => `Approved "${e.item.title}"${e.item.reviewed_by ? ` — ${e.item.reviewed_by}` : ''}` },
  rejected: { icon: CloseIcon, tint: 'flag', text: (e) => `Rejected "${e.item.title}"${e.item.reviewed_by ? ` — ${e.item.reviewed_by}` : ''}` },
  report_resolved: { icon: FlagIcon, tint: 'flag', text: (e) => `Resolved report on "${e.report.content_title}"` },
}

export default function ModeratorDashboard() {
  const [account, setAccount] = useState(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (!getToken()) { setChecking(false); return }
    getMe().then((a) => { if (a.role === 'moderator') setAccount(a) }).catch(() => {}).finally(() => setChecking(false))
  }, [])

  if (checking) return <div className="parent"><p className="muted">Loading…</p></div>
  if (!account) return <ModLogin onAuthed={setAccount} />
  return <Tools account={account} onLogout={() => { logout(); setAccount(null) }} />
}

// CM01 — moderator login (role-checked)
function ModLogin({ onAuthed }) {
  const [email, setEmail] = useState('moderator@pip.local')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    const missing = firstMissingField([[email, 'Email'], [password, 'Password']])
    if (missing) { setError(missing); return }
    setError(''); setBusy(true)
    try {
      const acc = await login(email, password)
      if (acc.role !== 'moderator') { await logout(); setError('This area is for content moderators only.'); return }
      onAuthed(acc)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Same field-routing pattern as ParentDashboard.jsx's AuthPanel: login's
  // "Wrong email or password" mentions "email" so it lands under that
  // field, "Incorrect password" lands under Password, anything else falls
  // through to a plain banner (e.g. the role-check message below).
  const isEmailError = /email/i.test(error || '')
  const isWrongPassword = error === 'Incorrect password'

  return (
    <div className="parent auth">
      <Link className="home-link" to="/">← Home</Link>
      <h1>Moderator Sign In</h1>
      <form onSubmit={submit} className="card" noValidate>
        <label>Email
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className={isEmailError ? 'field-invalid' : ''}
            aria-invalid={isEmailError || undefined}
          />
        </label>
        {isEmailError && (
          <p className="field-error"><AlertIcon width={14} height={14} /> {error}</p>
        )}
        <label>Password
          <PasswordInput
            value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
            className={isWrongPassword ? 'field-invalid' : ''}
            aria-invalid={isWrongPassword || undefined}
          />
        </label>
        {isWrongPassword && (
          <p className="field-error"><AlertIcon width={14} height={14} /> {error}</p>
        )}
        {error && !isEmailError && !isWrongPassword && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Sign In'}</button>
      </form>
      <p className="muted">Demo login: <b>moderator@pip.local</b> / <b>moderator123</b></p>
    </div>
  )
}

const TABS = [
  { key: 'overview', label: 'Overview', icon: ChartIcon },
  { key: 'submissions', label: 'Submissions', icon: InboxIcon, countKey: 'pending' },
  { key: 'catalogue', label: 'Catalogue', icon: GridIcon },
  { key: 'audit', label: 'AI Audit', icon: SparkleIcon, countKey: 'auditPending' },
  { key: 'reports', label: 'Reports', icon: FlagIcon, countKey: 'reportsOpen' },
]

function Tools({ account, onLogout }) {
  const scrolled = useScrolled()
  const [tab, setTab] = useState('overview')
  const [toast, notify] = useToast()
  // Live counts feed the little badges on the Submissions/Reports tabs —
  // a moderator lands on Overview and can already see "3 waiting" without
  // clicking into the tab, and the number stays in sync as items are
  // actioned (each tab calls onCountsChange after approve/reject/resolve).
  const [counts, setCounts] = useState({ pending: 0, reportsOpen: 0, auditPending: 0 })

  async function refreshCounts() {
    try {
      const [pending, reports, audit] = await Promise.all([
        listContent({ status: 'pending' }),
        listReports(),
        listAuditQueue(),
      ])
      setCounts({
        pending: pending.length, reportsOpen: reports.filter((r) => r.status === 'open').length,
        auditPending: audit.pending_count,
      })
    } catch {
      // Best-effort — badges just stay at their last known value.
    }
  }
  useEffect(() => { refreshCounts() }, [])

  return (
    <div className="parent dash-tight">
      <div className={`dash-top ${scrolled ? 'dash-top--scrolled' : ''}`}>
      <Link className="home-link" to="/">← Home</Link>
      <header className="parent-header">
        <div className="parent-header-who">
          <div className="parent-header-role"><GridIcon width={20} height={20} /></div>
          <div>
            <h1>Moderator Console</h1>
          </div>
        </div>
        <button className="ghost" onClick={onLogout}>Log out</button>
      </header>

      <div className="tabs">
        {TABS.map((t) => {
          const count = t.countKey ? counts[t.countKey] : 0
          return (
            <button key={t.key} className={tab === t.key ? 'tab active' : 'tab'} onClick={() => setTab(t.key)}>
              <t.icon width={16} height={16} /> {t.label}
              {count > 0 && <span className="tab-count">{count}</span>}
            </button>
          )
        })}
      </div>

      </div>

      <div className="tab-panel" key={tab}>
        {tab === 'overview' && <Overview counts={counts} onNavigate={setTab} onRefreshCounts={refreshCounts} />}
        {tab === 'submissions' && <Submissions notify={notify} onCountsChange={refreshCounts} />}
        {tab === 'catalogue' && <Catalogue notify={notify} />}
        {tab === 'audit' && <AuditQueue notify={notify} onCountsChange={refreshCounts} />}
        {tab === 'reports' && <Reports notify={notify} onCountsChange={refreshCounts} />}
      </div>

      <ToastHost toast={toast} />
    </div>
  )
}

// A small circular progress ring — the one place on Overview that isn't a
// bar or a number-in-a-box, flagged directly (the page read as "sepi" /
// "kurang menarik" next to the other consoles) as needing more visual
// variety, not just more content. Plain SVG stroke-dasharray trick, no
// charting library for one ring.
// A lightweight console home — mirrors AdminDashboard's Overview (same
// .stat-grid tiles + Refresh/updated-at pattern) so the moderator console
// reads as the same level of tool, not a lesser cousin of it. Computed
// client-side from the same listContent/listReports calls the other tabs
// already make (no new backend endpoint needed) since there's no
// moderator-scoped /stats route.
//
// Made more interactive (flagged directly: "keliatan simple bgt") beyond
// that shared pattern in four ways: every tile that maps to an actual tab
// is now a real button (keyboard-operable, not just decoration) that jumps
// straight there; a manual Refresh re-runs the same counts/stats calls
// on demand instead of only ever loading once on mount; a books/videos
// composition bar turns two of the tiles' numbers into an actual
// at-a-glance ratio instead of two more isolated digits; and a "Recent
// activity" feed (below) turns the numbers into an actual timeline —
// also directly closes the "no time log for imports" gap flagged
// alongside the "too simple" request: content/report timestamps
// (created_at/reviewed_at/resolved_at) weren't tracked by the backend at
// all before this pass, so there was never any "when" to show.
function Overview({ counts, onNavigate, onRefreshCounts }) {
  const [stats, setStats] = useState(null)
  const [activity, setActivity] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [showAllGenres, setShowAllGenres] = useState(false)

  async function load() {
    setRefreshing(true)
    try {
      const [items, reports] = await Promise.all([listContent({}), listReports(), onRefreshCounts()])
      const approved = items.filter((i) => i.status === 'approved').length
      const rejected = items.filter((i) => i.status === 'rejected').length
      // Age-band + genre breakdowns — same "what does the live catalogue
      // actually look like" question the books/videos bar already answers,
      // just two more angles on it. Only counts approved (live) items —
      // a pending/rejected item isn't part of the catalogue a child can
      // actually be recommended yet, so it shouldn't skew what's meant to
      // describe what's live right now.
      const live = items.filter((i) => i.status === 'approved')
      const ageBandCounts = { '5-8': 0, '9-12': 0 }
      const genreCounts = {}
      for (const item of live) {
        for (const band of item.age_bands || []) {
          if (band in ageBandCounts) ageBandCounts[band] += 1
        }
        for (const g of item.genres || []) {
          genreCounts[g] = (genreCounts[g] || 0) + 1
        }
      }
      const genres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      setStats({
        total: items.length,
        books: items.filter((i) => i.type === 'book').length,
        videos: items.filter((i) => i.type === 'video').length,
        approved,
        rejected,
        approvalRate: approved + rejected > 0 ? Math.round((approved / (approved + rejected)) * 100) : null,
        ageBandCounts,
        genres,
      })
      setActivity(buildActivity(items, reports))
      setUpdatedAt(new Date())
    } finally {
      setRefreshing(false)
    }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const tiles = stats && [
    { label: 'Pending review', val: counts.pending, icon: ClockIcon, nav: 'submissions', tone: 'cyan' },
    { label: 'Open reports', val: counts.reportsOpen, icon: FlagIcon, nav: 'reports', tone: 'orange' },
    { label: 'Live catalogue', val: stats.approved, icon: CheckIcon, nav: 'catalogue', tone: 'success' },
    { label: 'Books', val: stats.books, icon: BookIcon, nav: 'catalogue', tone: 'brown' },
    { label: 'Videos', val: stats.videos, icon: VideoIcon, nav: 'catalogue', tone: 'magenta' },
    { label: 'Rejected', val: stats.rejected, icon: CloseIcon, nav: 'catalogue', tone: 'danger' },
  ]
  const booksPct = stats && stats.books + stats.videos > 0
    ? Math.round((stats.books / (stats.books + stats.videos)) * 100)
    : null
  const ageBandTotal = stats && stats.ageBandCounts['5-8'] + stats.ageBandCounts['9-12']
  const ageBandPct = ageBandTotal > 0
    ? Math.round((stats.ageBandCounts['5-8'] / ageBandTotal) * 100)
    : null

  // Three visually distinct cards (flagged directly: everything read as
  // one big "Moderation overview" block) instead of one continuous
  // section — stats, catalogue composition, and recent activity are three
  // different questions ("what needs me now", "what does the catalogue
  // look like", "what just happened"), so each gets its own bordered card
  // + icon + heading, same as every other multi-panel screen in this app
  // (e.g. ParentDashboard's Account/Children/Notifications cards).
  return (
    <>
      <section className="card">
        <div className="child-top child-top--wrap">
          <h2><ChartIcon width={20} height={20} /> Moderation overview</h2>
          <button className="ghost small" onClick={load} disabled={refreshing}>
            <RefreshIcon width={14} height={14} className={refreshing ? 'spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {updatedAt && <p className="muted" style={{ marginTop: '-8px' }}>Updated {updatedAt.toLocaleTimeString()}</p>}
        {!stats ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            {stats.approvalRate !== null && (
              <div className="approval-row">
                <ApprovalRing pct={stats.approvalRate} />
                <div>
                  <div className="approval-row-headline">{stats.approvalRate}% approval rate</div>
                  <p className="muted">{stats.approved} approved · {stats.rejected} rejected, out of every submission reviewed so far.</p>
                </div>
              </div>
            )}
            <div className="stat-grid">
              {tiles.map(({ label, val, icon: Icon, tone, nav }) => (
                <button
                  type="button"
                  className="stat stat--clickable stat--tone"
                  style={toneStyle(tone)}
                  key={label}
                  onClick={() => onNavigate(nav)}
                >
                  <ChevronIcon width={14} height={14} className="stat-goto" />
                  <div className="stat-icon"><Icon width={18} height={18} /></div>
                  <div className="stat-num">{val}</div>
                  <div className="stat-label">{label}</div>
                </button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 'var(--space-2)' }}>
              {counts.pending > 0 && (
                <button style={{ gap: 'var(--space-2)' }} onClick={() => onNavigate('submissions')}>
                  <InboxIcon width={16} height={16} /> Review {counts.pending} waiting submission{counts.pending === 1 ? '' : 's'}
                </button>
              )}
              {counts.reportsOpen > 0 && (
                <button className="danger" onClick={() => onNavigate('reports')}>
                  <FlagIcon width={16} height={16} /> Handle {counts.reportsOpen} open report{counts.reportsOpen === 1 ? '' : 's'}
                </button>
              )}
              {counts.pending === 0 && counts.reportsOpen === 0 && (
                <p className="empty-state"><CheckIcon width={18} height={18} /> Nothing needs your attention right now.</p>
              )}
            </div>
          </>
        )}
      </section>

      {stats && booksPct !== null && (
        <section className="card">
          <h2><GridIcon width={20} height={20} /> Catalogue composition</h2>
          <div className="stat-split">
            <div className="stat-split-label">
              <span><BookIcon width={14} height={14} /> Books {stats.books}</span>
              <span>Videos {stats.videos} <VideoIcon width={14} height={14} /></span>
            </div>
            <div className="stat-split-bar">
              <div className="stat-split-fill" style={{ width: `${booksPct}%` }} />
            </div>
          </div>
          {ageBandPct !== null && (
            <div className="stat-split">
              <div className="stat-split-label">
                <span>Age 5–8 · {stats.ageBandCounts['5-8']}</span>
                <span>Age 9–12 · {stats.ageBandCounts['9-12']}</span>
              </div>
              <div className="stat-split-bar stat-split-bar--alt">
                <div className="stat-split-fill stat-split-fill--alt" style={{ width: `${ageBandPct}%` }} />
              </div>
            </div>
          )}
          {stats.genres.length > 0 && (
            <div className="genre-bars">
              <div className="genre-bars-head">
                <span className="review-field-label">Genres in the live catalogue</span>
                <span className="muted">Genres with {LOW_GENRE_COUNT} items or fewer are marked, so you can see where to add more.</span>
              </div>
              <ul className="genre-bar-list">
                {(showAllGenres ? stats.genres : stats.genres.slice(0, GENRES_SHOWN)).map(([genre, count]) => (
                  <li className={count <= LOW_GENRE_COUNT ? 'genre-bar genre-bar--low' : 'genre-bar'} key={genre}>
                    <span className="genre-bar-name">{cap(genre)}</span>
                    <span className="genre-bar-track" aria-hidden="true">
                      <span className="genre-bar-fill" style={{ width: `${Math.max(3, (count / stats.genres[0][1]) * 100)}%` }} />
                    </span>
                    <span className="genre-bar-count">{count}</span>
                    {count <= LOW_GENRE_COUNT && <span className="genre-bar-flag">Few</span>}
                  </li>
                ))}
              </ul>
              {stats.genres.length > GENRES_SHOWN && (
                <button type="button" className="ghost small genre-bars-more" onClick={() => setShowAllGenres(!showAllGenres)}>
                  {showAllGenres ? 'Show fewer genres' : `Show all ${stats.genres.length} genres`}
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {stats && (
        <section className="card">
          <h2><ClockIcon width={20} height={20} /> Recent activity</h2>
          {!activity || activity.length === 0 ? (
            <p className="muted">Nothing logged yet — approvals, imports and resolved reports will show up here as they happen.</p>
          ) : (
            <div className="panel">
              {activity.map((e, i) => {
                const meta = ACTIVITY_META[e.kind]
                const Icon = meta.icon
                return (
                  <div className="fav-item activity-item" key={i}>
                    <span className="fav-info">
                      <span className={`fav-icon ${meta.tint ? `fav-icon--${meta.tint}` : ''}`}><Icon width={16} height={16} /></span>
                      <span className="fav-text">
                        <span className="fav-title activity-title">{meta.text(e)}</span>
                      </span>
                    </span>
                    <span className="report-date activity-time">{logTime(e.ts)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}
    </>
  )
}

// A book/video type icon in a tinted chip — the same "icon-led title"
// pattern the child/landing surfaces already use for catalogue cards,
// instead of an emoji standing in for the type.
function TypeIcon({ type }) {
  const Icon = type === 'book' ? BookIcon : VideoIcon
  return <span className="item-type-icon"><Icon width={16} height={16} /></span>
}

// CM03 — search Google Books/YouTube for real import candidates, then land
// one as a "pending" submission (CM06) for the review queue below. This
// was the actual missing half of the moderator console: the backend
// search/import endpoints already existed (content_sources.py — real
// Google Books/YouTube Data API calls), but nothing in the frontend ever
// called them. Without this, the only way to grow the catalogue was to
// hand-type every field into "Add catalogue entry," which is not what
// CM03's own docstring describes ("search + import... a real editorial
// judgement call a human makes here").
function SearchImport({ onImported, notify, prefill, onAutoImport, autoBusy }) {
  const sectionRef = useRef(null)
  const [type, setType] = useState('book')
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(null) // the search result being turned into a real entry
  // The AI pre-screen (ai_assist.screen_import_candidates) flags results it
  // expects the moderator to reject anyway. They're hidden by default but
  // never gone — this toggle reveals them, and any one can still be imported.
  const [showFiltered, setShowFiltered] = useState(false)

  async function runSearch(searchType, query) {
    if (!query.trim()) return
    setBusy(true); setError(''); setShowFiltered(false)
    try {
      if (searchType === 'any') {
        // No format was asked for: look in both and interleave, so neither kind buries the other.
        const [books, videos] = await Promise.all([searchBooks(query), searchVideos(query)])
        const merged = []
        for (let i = 0; i < Math.max(books.length, videos.length); i++) {
          if (books[i]) merged.push({ ...books[i], _type: 'book' })
          if (videos[i]) merged.push({ ...videos[i], _type: 'video' })
        }
        setResults(merged)
      } else {
        setResults(searchType === 'book' ? await searchBooks(query) : await searchVideos(query))
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  function search(e) { e.preventDefault(); runSearch(type, q) }

  // "Find content" on a requested topic (TopicRequests above) fills the box
  // and runs the search straight away — `nonce` makes asking for the same
  // topic twice still count as a new request.
  useEffect(() => {
    if (!prefill) return
    setImporting(null); setType(prefill.type); setQ(prefill.q); setResults(null)
    // Land with the section heading just below the pinned header and tabs
    // (.dash-top), not behind them, which is where a plain scrollIntoView
    // leaves it.
    if (sectionRef.current) {
      const pinned = document.querySelector('.dash-top')
      const offset = (pinned ? pinned.offsetHeight : 0) + 12
      const top = sectionRef.current.getBoundingClientRect().top + window.scrollY - offset
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    }
    runSearch(prefill.type, prefill.q)
  }, [prefill?.nonce]) // eslint-disable-line react-hooks/exhaustive-deps

  // Picking a result opens the same EntryForm used everywhere else,
  // pre-filled from the real search data — the moderator still has to
  // pick age bands/genres themselves (CM09/CM10), never auto-assigned.
  if (importing) {
    const importType = importing._type || type
    return (
      <EntryForm
        isNew
        initial={{
          type: importType,
          title: importing.title,
          description: importing.description,
          thumbnail: importing.thumbnail,
          external_ref: importing.external_ref,
          age_bands: [],
          genres: [],
          source: importType === 'book' ? 'google_books' : 'youtube',
        }}
        onSave={async (payload) => {
          await importContent(payload)
          setImporting(null); setResults(null); setQ('')
          notify?.(`“${payload.title}” imported — now waiting for review below.`)
          onImported()
        }}
        onCancel={() => setImporting(null)}
      />
    )
  }

  return (
    <section ref={sectionRef}>
      <h2><SearchIcon width={20} height={20} /> Search &amp; import</h2>
      <form className="row" onSubmit={search}>
        <Select value={type} onChange={(e) => { setType(e.target.value); setResults(null) }}>
          <option value="book">Books</option>
          <option value="video">Videos</option>
          <option value="any">Books &amp; videos</option>
        </Select>
        <input
          type="search"
          placeholder={type === 'any' ? 'Search Google Books and YouTube…' : `Search Google Books/YouTube for ${type}s…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: '1 1 220px' }}
        />
        <button type="submit" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
        <button
          type="button" className="ghost" disabled={!q.trim() || autoBusy}
          title="Import the top results and let AI triage them"
          onClick={() => onAutoImport?.(q.trim(), type)}
        >
          <SparkleIcon width={15} height={15} /> Auto-import
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {results && results.length === 0 && !error && (
        <p className="muted">No results — try a different search, or check the {type === 'book' ? 'Google Books' : type === 'video' ? 'YouTube Data' : 'Google Books and YouTube Data'} API key{type === 'any' ? 's are' : ' is'} configured.</p>
      )}
      {results && results.length > 0 && (() => {
        const kept = results.filter((r) => !r.ai_filtered)
        const filtered = results.filter((r) => r.ai_filtered)
        return (
          <>
            {filtered.length > 0 && (
              <div className="ai-filter-bar">
                <span className="ai-filter-bar-text">
                  <SparkleIcon width={15} height={15} />
                  <span><b>AI filtered out {filtered.length} result{filtered.length === 1 ? '' : 's'}</b> it expects you'd reject.</span>
                </span>
                <button type="button" className="ghost small" onClick={() => setShowFiltered((v) => !v)}>
                  {showFiltered ? 'Hide them' : 'Show them'}
                </button>
              </div>
            )}
            {kept.length === 0 && !showFiltered && (
              <p className="muted">Every result on this page was filtered out — show them to review anyway, or try a different search.</p>
            )}
            <div className="search-results">
              {kept.map((r) => <SearchResultCard key={`${r._type || type}-${r.external_id}`} r={r} type={r._type || type} onImport={setImporting} />)}
              {showFiltered && filtered.map((r) => <SearchResultCard key={`${r._type || type}-${r.external_id}`} r={r} type={r._type || type} onImport={setImporting} />)}
            </div>
          </>
        )
      })()}
    </section>
  )
}

function SearchResultCard({ r, type, onImport }) {
  return (
    <div className={`search-result ${r.ai_filtered ? 'search-result--filtered' : ''}`}>
      {r.thumbnail ? (
        <img className="search-result-cover" src={r.thumbnail} alt="" />
      ) : (
        <div className="search-result-cover search-result-cover-empty"><TypeIcon type={type} /></div>
      )}
      <div className="search-result-body">
        <h4>{r.title}</h4>
        <p className="muted">{truncate(r.description, 150)}</p>
        {type === 'video' && r.channel && <p className="muted">Channel: {r.channel}</p>}
        {r.ai_filtered && (
          <AiNote tone="reject" title="AI would reject this" reason={r.ai_filter_reason} />
        )}
        <button className={r.ai_filtered ? 'ghost small' : 'small'} onClick={() => onImport(r)}>
          <PlusIcon width={14} height={14} /> {r.ai_filtered ? 'Import anyway' : 'Import for review'}
        </button>
      </div>
    </div>
  )
}

// CM06/CM07/CM08 — review new submissions, approve or reject
// Unmet demand: topics children asked Pip for that the catalogue couldn't
// serve, most-asked first (GET /api/content/topic-requests). Each row jumps
// into Search & import below, pre-filled — the moderator's cue for what to
// import next. A topic drops off this list by itself once approved content
// covers it. Counts only: nothing about which child asked is stored.
function TopicRequests({ onFind, onAutoImport, busy }) {
  const [rows, setRows] = useState(null)
  const [dismissing, setDismissing] = useState(null)
  const [confirmingDismiss, setConfirmingDismiss] = useState(null)
  useEffect(() => {
    listTopicRequests().then(setRows).catch(() => setRows([]))
    // Fire-and-forget, not awaited by the list load above: lets a
    // popular-enough topic (see backend's _AUTO_IMPORT_THRESHOLD) import
    // itself instead of waiting for a moderator to notice it below and
    // click Auto-import themselves — same pipeline that button already
    // runs, see POST /topic-requests/auto-import's own docstring for why
    // this is a separate call rather than a side effect of the GET above.
    // Only re-fetches the list if it actually imported something, so a
    // moderator who was already reading doesn't see it flicker for
    // nothing.
    autoImportTopic()
      .then((r) => { if (r.imported_topic) listTopicRequests().then(setRows).catch(() => {}) })
      .catch(() => {})
  }, [])
  if (rows === null) return null

  // Confirms first — a moderator clicked Dismiss by accident and lost the
  // row with no way back (Kiefer, 2026-09-24). Dismissing only forgets a
  // demand tally, never touches real catalogue content, and would
  // naturally re-appear if children keep asking — but "instant, no undo"
  // still isn't the right default when the only recovery is asking a
  // child to repeat themselves 3 more times.
  async function handleDismiss(r) {
    setConfirmingDismiss(null)
    setDismissing(r.key)
    try {
      await dismissTopicRequest(r.key)
      setRows((cur) => cur.filter((x) => x.key !== r.key))
    } catch {
      // leave the row in place — the moderator can just try again
    } finally {
      setDismissing(null)
    }
  }

  return (
    <section>
      <h2><ChartIcon width={20} height={20} /> Requested topics {rows.length > 0 && `(${rows.length})`}</h2>
      <p className="muted topic-requests-hint">Things children asked Pip for that the catalogue doesn't have yet.</p>
      {rows.length === 0 ? (
        <p className="empty-state"><CheckIcon width={18} height={18} /> No unmet requests — everything children asked for is covered.</p>
      ) : (
        <div className="topic-requests">
          {rows.map((r) => {
            const formatLabel = r.format === 'any' ? 'no format given, so books and videos' : r.format === 'video' ? 'videos' : 'books'
            const threshold = r.auto_import_threshold
            // Why the manual button is still here even though this feature
            // auto-imports on its own — real confusion (Kiefer, 2026-09-24):
            // every row showed the same "Auto-import" button whether it was
            // genuinely below the threshold (still waiting on more asks) or
            // had already had its one automatic shot and just didn't fully
            // resolve, which read as the automation being broken.
            let statusNote = null
            if (r.auto_imported) {
              statusNote = 'Already auto-imported once — see the moderation queue, or search manually below'
            } else if (threshold && r.count < threshold) {
              statusNote = `${r.count}/${threshold} asked — auto-imports on its own once it reaches ${threshold}, or import it now`
            } else if (threshold) {
              statusNote = 'At the threshold — auto-importing shortly, or import it now'
            }
            return (
              <div className="topic-request" key={r.topic}>
                <span className={`topic-tile ${r.format === 'any' ? 'topic-tile--pair' : ''}`} title={`Asked for ${formatLabel}`}>
                  {r.format !== 'video' && <BookIcon width={r.format === 'any' ? 14 : 18} height={r.format === 'any' ? 14 : 18} />}
                  {r.format !== 'book' && <VideoIcon width={r.format === 'any' ? 14 : 18} height={r.format === 'any' ? 14 : 18} />}
                </span>
                <div className="topic-request-main">
                  <div className="topic-request-title">
                    <b>{r.topic}</b>
                    <span className="topic-format">{r.format === 'any' ? 'Books & videos' : r.format === 'video' ? 'Videos' : 'Books'}</span>
                  </div>
                  <span className="topic-request-meta">
                    Asked {r.count} time{r.count === 1 ? '' : 's'} · last {timeAgo(r.last_requested_at)}
                  </span>
                  {!r.auto_imported && threshold && (
                    <span className="topic-meter" title={statusNote}>
                      <span className="topic-meter-segs" aria-hidden="true">
                        {Array.from({ length: threshold }).map((_, i) => (
                          <span key={i} className={i < r.count ? 'topic-seg topic-seg--on' : 'topic-seg'} />
                        ))}
                      </span>
                      <span className="topic-meter-label">
                        {Math.min(r.count, threshold)}/{threshold} asked · auto-imports at {threshold}
                      </span>
                    </span>
                  )}
                  {(r.auto_imported || (threshold && r.count >= threshold)) && statusNote && (
                    <span className="topic-note">{statusNote}</span>
                  )}
                </div>
                <div className="topic-request-actions">
                  <button type="button" className="ghost small" onClick={() => onFind(r)}>
                    <SearchIcon width={14} height={14} /> Find content
                  </button>
                  <button type="button" className="small" disabled={busy} onClick={() => onAutoImport(r)}>
                    <SparkleIcon width={14} height={14} /> {r.auto_imported ? 'Import again' : 'Import now'}
                  </button>
                  <button
                    type="button" className="danger small" disabled={dismissing === r.key}
                    onClick={() => setConfirmingDismiss(r)} title="Dismiss — not relevant, or a one-off/test message"
                  >
                    <TrashIcon width={14} height={14} /> Dismiss
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <ConfirmDialog
        open={!!confirmingDismiss}
        icon={<TrashIcon width={20} height={20} />}
        title="Dismiss this topic request?"
        message={confirmingDismiss ? `“${confirmingDismiss.topic}” will drop off this list. It'll come back on its own if children keep asking for it.` : ''}
        confirmLabel="Dismiss"
        onConfirm={() => handleDismiss(confirmingDismiss)}
        onCancel={() => setConfirmingDismiss(null)}
      />
    </section>
  )
}

// What an auto-import run did, item by item — nothing the AI decided is
// hidden from the moderator. Approved/rejected ones were settled without a
// human (and are stamped "AI auto-triage"); the "needs review" ones are now in
// the queue below.
const OUTCOME_LABEL = { approved: 'AI approved', rejected: 'AI rejected', pending: 'Needs review' }

function BulkResult({ result, onDismiss }) {
  return (
    <section className="bulk-result card">
      <div className="bulk-result-head">
        <h3><SparkleIcon width={18} height={18} /> Auto-import: “{result.topic}”</h3>
        <button type="button" className="ghost small" onClick={onDismiss}><CloseIcon width={14} height={14} /> Dismiss</button>
      </div>
      {result.topic_flagged && (
        <p className="bulk-flagged-note">
          <AlertIcon width={16} height={16} /> This topic was flagged by content moderation — nothing was
          auto-approved, every result below needs your review regardless of how confident the AI was.
        </p>
      )}
      <div className="chip-row bulk-summary">
        <span className="badge badge-approved">{result.approved} approved</span>
        <span className="badge badge-rejected">{result.rejected} rejected</span>
        <span className="badge badge-pending">{result.pending} for you to review</span>
      </div>
      <p className="muted bulk-note">
        Found {result.found}.{' '}
        {result.skipped_duplicates > 0 && `${result.skipped_duplicates} already in the catalogue. `}
        {result.skipped_off_topic > 0 && `${result.skipped_off_topic} skipped as off-topic. `}
        {result.found === 0 && 'Nothing came back — check the Google Books / YouTube API keys, or try another topic.'}
      </p>
      {result.items.length > 0 && (
        <ul className="bulk-items">
          {result.items.map((i) => (
            <li className="bulk-item" key={i.id}>
              <span className={`badge badge-${i.outcome}`}>{OUTCOME_LABEL[i.outcome]}</span>
              <div className="bulk-item-main">
                <b>{i.title}</b>
                <span className="muted">{i.reason}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Submissions({ notify, onCountsChange }) {
  const [prefill, setPrefill] = useState(null)
  // Auto-import: ask first (it can approve content without a human), then run.
  const [bulkAsk, setBulkAsk] = useState(null) // {topic, type} awaiting confirmation
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkResult, setBulkResult] = useState(null)
  const [topicsKey, setTopicsKey] = useState(0) // remount TopicRequests so a covered topic drops off // set by a requested topic's "Find content"
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  // The item mid-transition, so its card can fade/slide out instead of
  // just vanishing the instant the list refetches — the one place this
  // console genuinely felt static, since approve/reject had zero motion
  // and zero confirmation beyond the row disappearing.
  const [leaving, setLeaving] = useState(null)
  const [confirmingReject, setConfirmingReject] = useState(null) // the submission awaiting a "reject this?" answer

  async function reload() {
    setLoading(true)
    try { setItems(await listContent({ status: 'pending' })) } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [])

  async function act(item, fn, message, tone) {
    setLeaving(item.id)
    try {
      await fn(item.id)
      notify?.(message, tone)
      onCountsChange?.()
    } catch (err) {
      notify?.(err.message, 'danger')
      setLeaving(null)
      return
    }
    // Real bug, reported directly: `leaving` never got cleared on the
    // success path, so a resolved/approved item whose card is still in
    // view after reload (Reports keeps both open AND resolved rows, unlike
    // this pending-only queue) kept rendering with .card-leaving's
    // opacity:0 forever — looked like it vanished, only fixed itself on a
    // full page refresh (a fresh mount resets `leaving` back to null).
    // Clearing it once the post-fade reload actually lands fixes that.
    setTimeout(async () => {
      await reload() // let the fade play before the fresh data replaces the row
      setLeaving(null)
    }, 220)
  }

  return (
    <section>
      <TopicRequests
        key={topicsKey} busy={bulkBusy}
        onFind={(r) => setPrefill({ q: r.topic, type: r.format, nonce: Date.now() })}
        onAutoImport={(r) => setBulkAsk({ topic: r.topic, type: r.format })}
      />
      <SearchImport
        onImported={() => { reload(); onCountsChange?.() }} notify={notify} prefill={prefill}
        autoBusy={bulkBusy} onAutoImport={(topic, type) => setBulkAsk({ topic, type })}
      />
      {bulkBusy && (
        <p className="bulk-busy"><RefreshIcon width={16} height={16} /> Importing and triaging — this takes about 10 seconds…</p>
      )}
      {bulkResult && <BulkResult result={bulkResult} onDismiss={() => setBulkResult(null)} />}
      <h2><InboxIcon width={20} height={20} /> New submissions {!loading && `(${items.length})`}</h2>
      {loading && <p className="muted">Loading…</p>}
      {!loading && items.length === 0 && (
        <p className="empty-state"><CheckIcon width={18} height={18} /> Nothing waiting for review — you're all caught up.</p>
      )}
      {items.map((i) => (
        <div className={`card ${leaving === i.id ? 'card-leaving' : ''}`} key={i.id}>
          <div className="child-top child-top--wrap">
            <div className="item-with-thumb">
              {i.thumbnail && <img className={`item-thumb item-thumb--${i.type}`} src={i.thumbnail} alt="" />}
              <div>
                <h3 className="item-title"><TypeIcon type={i.type} /> {i.title}</h3>
                <p className="muted">{i.description}</p>
                {i.created_at && <p className="muted">Submitted {timeAgo(i.created_at)}</p>}
              </div>
            </div>
            <span className="badge badge-pending">pending</span>
          </div>
          <div className="chip-row">
            {i.age_bands.map((b) => <span className="chip" key={b}>{b}</span>)}
            {i.genres.map((g) => <span className="chip chip-muted" key={g}>{cap(g)}</span>)}
            {i.genres.length === 0 && <span className="chip chip-muted">No genres tagged</span>}
          </div>
          {/* CM06 triage aid — a first-pass AI read (app/ai_assist.py),
              never a decision: the moderator's own Approve/Reject below is
              what actually decides this item's status. Only rendered when
              the AI call actually ran (i.tag ai_suggestion is null when the
              key isn't configured or the call failed) — no "AI unavailable"
              noise on every card. */}
          {i.ai_suggestion && (
            <AiNote
              tone={i.ai_suggestion}
              title={`AI suggests: ${i.ai_suggestion === 'approve' ? 'Approve' : 'Reject'}`}
              reason={i.ai_reason} confidence={i.ai_confidence}
            />
          )}
          <div className="row">
            <button className="success" disabled={leaving === i.id}
              onClick={() => act(i, approveContent, `“${i.title}” approved — now live in the catalogue.`)}>
              <CheckIcon width={16} height={16} /> Approve
            </button>
            <button className="danger" disabled={leaving === i.id}
              onClick={() => setConfirmingReject(i)}>
              <CloseIcon width={16} height={16} /> Reject
            </button>
          </div>
        </div>
      ))}
      <ConfirmDialog
        open={!!bulkAsk}
        tone="primary"
        icon={<SparkleIcon width={20} height={20} />}
        title="Auto-import this topic?"
        message={bulkAsk ? `Up to ${bulkAsk.type === 'any' ? '5 books and 5 videos' : `10 ${bulkAsk.type === 'book' ? 'books' : 'videos'}`} about “${bulkAsk.topic}” will be searched and checked by AI. Clear, child-safe matches are approved straight away, clearly unsuitable ones are rejected, and anything unsure waits here for you.` : ''}
        confirmLabel="Import"
        onConfirm={async () => {
          const ask = bulkAsk
          setBulkAsk(null); setBulkBusy(true); setBulkResult(null)
          try {
            setBulkResult(await bulkImport({ topic: ask.topic, type: ask.type, limit: 10, auto_approve: true }))
            reload(); onCountsChange?.(); setTopicsKey((k) => k + 1)
          } catch (err) {
            notify?.(err.message, 'danger')
          } finally {
            setBulkBusy(false)
          }
        }}
        onCancel={() => setBulkAsk(null)}
      />
      <ConfirmDialog
        open={!!confirmingReject}
        icon={<AlertIcon width={20} height={20} />}
        title="Reject this submission?"
        message={confirmingReject ? `“${confirmingReject.title}” will be rejected and won’t appear in the catalogue.` : ''}
        confirmLabel="Reject"
        onConfirm={() => {
          const item = confirmingReject
          setConfirmingReject(null)
          act(item, rejectContent, `“${item.title}” rejected.`, 'danger')
        }}
        onCancel={() => setConfirmingReject(null)}
      />
    </section>
  )
}

// CM13 browse + CM03 add + CM04 edit + CM05 remove (CM09/CM10 tags via the form)
// CM13 said "browse content database" — a flat, unfiltered list with the
// full multi-paragraph description of every item rendered inline was a
// reasonable read at 15 seed items; at 48 (and growing, see the catalogue-
// expansion pass) it's a long scroll of repeated re-reading just to find
// one title. Real search/type/status filtering already existed on the
// backend (content.py's `browse` takes q/type/status/genre) — the frontend
// just never called it with anything but `{}`. Wired up now, plus a
// truncated description in the list (Edit still shows the full text in
// its own textarea) so a card reads as one scannable line, not a wall of
// marketing copy.
const GENRES_SHOWN = 8
const LOW_GENRE_COUNT = 3 // a genre with this many live items or fewer is flagged as thin
const cap = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text)

// The AI's opinion on a catalogue item (never a decision). Header line with an
// optional confidence pill, then the reason as its own full-width paragraph so
// long reasons read as a clean block instead of breaking around the label.
function AiNote({ tone, title, reason, confidence }) {
  return (
    <div className={`ai-note ai-note--${tone}`}>
      <SparkleIcon width={15} height={15} />
      <div className="ai-note-body">
        <div className="ai-note-head">
          <b>{title}</b>
          {confidence && <span className="ai-note-conf">{cap(confidence)} confidence</span>}
        </div>
        {reason && <p className="ai-note-text">{reason}</p>}
      </div>
    </div>
  )
}

function truncate(text, max = 140) {
  if (!text || text.length <= max) return text
  return text.slice(0, max).trimEnd() + '…'
}

function Catalogue({ notify }) {
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)
  const [confirmingRemove, setConfirmingRemove] = useState(null)
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [genreFilter, setGenreFilter] = useState('')
  // The dropdown's own option list — fetched once, unfiltered, so it
  // always offers every genre in the catalogue regardless of whatever
  // type/status/genre the list below is currently narrowed to (narrowing
  // by genre would otherwise shrink the genre picker itself down to one
  // option the moment it's used).
  const [allGenres, setAllGenres] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listContent({}).then((items) => {
      const genres = new Set()
      for (const i of items) for (const g of i.genres || []) genres.add(g)
      setAllGenres([...genres].sort((a, b) => a.localeCompare(b)))
    })
  }, [])

  async function reload(overrides = {}) {
    const params = {}
    const query = overrides.q ?? q
    const type = overrides.typeFilter ?? typeFilter
    const status = overrides.statusFilter ?? statusFilter
    const genre = overrides.genreFilter ?? genreFilter
    if (query.trim()) params.q = query.trim()
    if (type) params.type = type
    if (status) params.status = status
    if (genre) params.genre = genre
    setLoading(true)
    try { setItems(await listContent(params)) } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced — a real API call per keystroke would be chatty; 300ms feels
  // instant to type against without firing on every letter.
  useEffect(() => {
    const id = setTimeout(() => reload(), 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, typeFilter, statusFilter, genreFilter])

  return (
    <section>
      <AddEntry onAdded={reload} notify={notify} />
      <h2><GridIcon width={20} height={20} /> Catalogue ({items.length})</h2>

      <div className="row" style={{ marginBottom: 12 }}>
        <input
          type="search"
          placeholder="Search title or description…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: '1 1 220px' }}
        />
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          <option value="book">Books</option>
          <option value="video">Videos</option>
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
          <option value="rejected">Rejected</option>
        </Select>
        {allGenres.length > 0 && (
          <Select value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}>
            <option value="">All categories</option>
            {allGenres.map((g) => <option key={g} value={g}>{g}</option>)}
          </Select>
        )}
      </div>

      {loading && <p className="muted">Loading…</p>}
      {!loading && items.length === 0 && <p className="muted">No catalogue items match that search.</p>}

      {items.map((i) => (
        editing === i.id ? (
          <EntryForm
            key={i.id}
            initial={i}
            onSave={async (payload) => {
              await editContent(i.id, payload)
              setEditing(null)
              notify?.(`“${payload.title}” saved.`)
              reload()
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div className="card" key={i.id}>
            <div className="child-top child-top--wrap">
              <div className="item-with-thumb">
                {i.thumbnail && <img className={`item-thumb item-thumb--${i.type}`} src={i.thumbnail} alt="" />}
                <div>
                  <h3 className="item-title"><TypeIcon type={i.type} /> {i.title}</h3>
                  <p className="muted">{truncate(i.description)}</p>
                  {i.reviewed_at ? (
                    <p className="muted">{i.status === 'approved' ? 'Approved' : 'Rejected'} {timeAgo(i.reviewed_at)}{i.reviewed_by && ` — ${i.reviewed_by}`}</p>
                  ) : i.created_at ? (
                    <p className="muted">Added {timeAgo(i.created_at)}</p>
                  ) : null}
                </div>
              </div>
              <span className={`badge badge-${i.status}`}>{i.status}</span>
            </div>
            <div className="chip-row">
              {i.age_bands.map((b) => <span className="chip" key={b}>{b}</span>)}
              {i.genres.map((g) => <span className="chip chip-muted" key={g}>{cap(g)}</span>)}
              {i.reading_level && <span className="chip chip-muted">{cap(i.reading_level)}</span>}
            </div>
            {/* Inline, two-step confirmation instead of a native confirm()
                popup — matches the rest of the app's own convention of
                never dropping into raw browser chrome for anything the
                child or a staff member sees. */}
            {confirmingRemove === i.id ? (
              <div className="row inline-confirm">
                <span>Remove “{i.title}” from the catalogue?</span>
                <button className="danger small" onClick={async () => {
                  await removeContent(i.id)
                  setConfirmingRemove(null)
                  notify?.(`“${i.title}” removed.`, 'danger')
                  reload()
                }}>Yes, remove</button>
                <button className="ghost small" onClick={() => setConfirmingRemove(null)}>Cancel</button>
              </div>
            ) : (
              <div className="row">
                <button className="ghost small" onClick={() => setEditing(i.id)}><EditIcon width={15} height={15} /> Edit</button>
                <button className="danger small" onClick={() => setConfirmingRemove(i.id)}>
                  <TrashIcon width={15} height={15} /> Remove
                </button>
              </div>
            )}
          </div>
        )
      ))}
    </section>
  )
}

function AddEntry({ onAdded, notify }) {
  const [open, setOpen] = useState(false)
  if (!open) return <button className="add-btn" onClick={() => setOpen(true)}><PlusIcon width={16} height={16} /> Add catalogue entry</button>
  return (
    <EntryForm
      isNew
      onSave={async (payload) => {
        await addContent(payload)
        setOpen(false)
        notify?.(`“${payload.title}” added to the catalogue.`)
        onAdded()
      }}
      onCancel={() => setOpen(false)}
    />
  )
}

function EntryForm({ initial = {}, onSave, onCancel, isNew }) {
  const [type, setType] = useState(initial.type || 'book')
  const [title, setTitle] = useState(initial.title || '')
  const [description, setDescription] = useState(initial.description || '')
  const [bands, setBands] = useState(initial.age_bands || ['5-8'])
  const [genres, setGenres] = useState((initial.genres || []).join(', '))
  const [level, setLevel] = useState(initial.reading_level || '')
  // Was never carried at all — a manually-added entry (or one imported from
  // search, see SearchImport below) had no cover image and, for videos, no
  // actual video to play; CH12's "Watch" button fell back to the sample-
  // catalogue placeholder text even for a real, moderator-approved item.
  const [thumbnail, setThumbnail] = useState(initial.thumbnail || '')
  const [externalRef, setExternalRef] = useState(initial.external_ref || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function toggleBand(b) {
    setBands(bands.includes(b) ? bands.filter((x) => x !== b) : [...bands, b])
  }

  async function submit(e) {
    e.preventDefault()
    const missing = firstMissingField([[title, 'Title'], [description, 'Description']])
    if (missing) { setError(missing); return }
    if (bands.length === 0) { setError('Pick at least one age band'); return }
    setError(''); setBusy(true)
    const payload = {
      type, title, description,
      age_bands: bands,
      genres: genres.split(',').map((g) => g.trim()).filter(Boolean),
      reading_level: level || null,
      thumbnail: thumbnail || null,
      external_ref: externalRef || null,
      source: initial.source || 'manual',
    }
    try { await onSave(payload) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <form className="card" onSubmit={submit} noValidate>
      <h3>{isNew ? 'New entry' : 'Edit entry'}</h3>
      <label>Type
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="book">Book</option>
          <option value="video">Video</option>
        </Select>
      </label>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Description<input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label>Cover image URL<input value={thumbnail} onChange={(e) => setThumbnail(e.target.value)} placeholder="https://…" /></label>
      <label>{type === 'video' ? 'YouTube video ID (what actually plays)' : 'External link (e.g. a library/store page)'}
        <input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} placeholder={type === 'video' ? 'dQw4w9WgXcQ' : 'https://…'} />
      </label>
      <div>
        <span className="muted">Age bands</span>
        <div className="row">
          {AGE_BANDS.map((b) => (
            <label key={b} className="toggle">
              <input type="checkbox" checked={bands.includes(b)} onChange={() => toggleBand(b)} />{b}
            </label>
          ))}
        </div>
      </div>
      <label>Genres, comma-separated<input value={genres} onChange={(e) => setGenres(e.target.value)} placeholder="funny, space" /></label>
      <label>Reading level<input value={level} onChange={(e) => setLevel(e.target.value)} placeholder="early, middle" /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

// CM11 review reported content + CM12 resolve
// QA audit (step 4 of the catalogue-scale plan): a random slice of what
// bulk import auto-approved/auto-rejected (app/bulk_import.py's
// AUDIT_SAMPLE_RATE), waiting for a moderator to confirm or overturn the
// AI's call. Not a second gate before publish — an overturned "approved"
// item is already live until this action pulls it; an overturned "rejected"
// one only goes live once confirmed here. That's why every row shows the
// AI's own decision and reason before asking for a verdict.
function AuditQueue({ notify, onCountsChange }) {
  const [data, setData] = useState(null)
  const [acting, setActing] = useState(null) // id mid-request
  const [overturning, setOverturning] = useState(null) // the item awaiting an overturn reason
  // Client-side only — the sample itself already fits in one page (see
  // listAuditQueue's own default `limit`), so a second round-trip just to
  // filter by a field already in hand would be waste. Real ask (Kiefer,
  // 2026-09-24): a queue mixing AI-approved and AI-rejected spot-checks
  // made it hard to tell at a glance whether the AI's approve calls or its
  // reject calls needed more scrutiny.
  const [statusFilter, setStatusFilter] = useState('')

  async function reload() {
    try { setData(await listAuditQueue()) } catch { setData({ items: [], pending_count: 0, confirmed: 0, overturned: 0, accuracy: null }) }
  }
  useEffect(() => { reload() }, [])

  async function decide(item, decision, decisionNote) {
    setActing(item.id)
    try {
      await submitAudit(item.id, { decision, note: decisionNote || undefined })
      notify?.(
        decision === 'confirm'
          ? `Confirmed — the AI's call on “${item.title}” stands.`
          : `Overturned — “${item.title}” is now ${item.status === 'approved' ? 'rejected' : 'approved'}.`,
        decision === 'confirm' ? 'success' : 'danger',
      )
      await reload()
      onCountsChange?.()
    } catch (err) {
      notify?.(err.message, 'danger')
    } finally {
      setActing(null)
    }
  }

  if (!data) return <p className="muted">Loading…</p>

  const visibleItems = statusFilter ? data.items.filter((i) => i.status === statusFilter) : data.items
  const approvedCount = data.items.filter((i) => i.status === 'approved').length
  const rejectedCount = data.items.filter((i) => i.status === 'rejected').length

  return (
    <section>
      <h2><SparkleIcon width={20} height={20} /> AI audit {data.pending_count > 0 && `(${data.pending_count})`}</h2>
      <div className="audit-intro">
        <p className="muted">A random sample of what the AI approved or rejected on its own during bulk import.</p>
        <p className="muted">It is a spot-check after the fact, not a second gate before publishing.</p>
      </div>
      {data.accuracy !== null && (
        <div className="chip-row audit-accuracy">
          <span className="badge badge-approved">{Math.round(data.accuracy * 100)}% confirmed</span>
          <span className="muted">{data.confirmed} confirmed · {data.overturned} overturned, out of {data.confirmed + data.overturned} audited so far</span>
        </div>
      )}
      {data.items.length > 0 && (
        <div className="audit-filter">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by AI decision">
            <option value="">All ({data.items.length})</option>
            <option value="approved">AI approved ({approvedCount})</option>
            <option value="rejected">AI rejected ({rejectedCount})</option>
          </Select>
        </div>
      )}
      {data.items.length === 0 && (
        <p className="empty-state"><CheckIcon width={18} height={18} /> Nothing sampled right now — check back after the next bulk import.</p>
      )}
      {data.items.length > 0 && visibleItems.length === 0 && (
        <p className="empty-state"><CheckIcon width={18} height={18} /> No {statusFilter} items in the current sample.</p>
      )}
      {visibleItems.map((item) => (
        <div className="card" key={item.id}>
          <div className="child-top child-top--wrap">
            <div className="item-with-thumb">
              {item.thumbnail && <img className={`item-thumb item-thumb--${item.type}`} src={item.thumbnail} alt="" />}
              <div>
                <h3 className="item-title"><TypeIcon type={item.type} /> {item.title}</h3>
                <p className="muted">{truncate(item.description, 140)}</p>
              </div>
            </div>
            <span className={`badge badge-${item.status}`}>AI {item.status}</span>
          </div>
          <AiNote
            tone={item.status === 'approved' ? 'approve' : 'reject'}
            title="AI reasoning" reason={item.ai_reason || 'No reason was recorded.'} confidence={item.ai_confidence}
          />
          <div className="chip-row">
            {item.age_bands.map((b) => <span className="chip" key={b}>{b}</span>)}
            {item.genres.map((g) => <span className="chip chip-muted" key={g}>{cap(g)}</span>)}
          </div>
          <div className="confirm-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" disabled={acting === item.id} onClick={() => decide(item, 'confirm')}>
              <CheckIcon width={16} height={16} /> AI got it right
            </button>
            <button type="button" className="ghost" disabled={acting === item.id} onClick={() => setOverturning(item)}>
              <CloseIcon width={16} height={16} /> AI got it wrong
            </button>
          </div>
        </div>
      ))}

      <PromptDialog
        open={!!overturning}
        icon={<AlertIcon width={20} height={20} />}
        title="Overturn this decision?"
        message={overturning ? `“${overturning.title}” will be ${overturning.status === 'approved' ? 'removed from the catalogue' : 'published'} right away. Say why, for the record.` : ''}
        label="Reason" type="text"
        placeholder="e.g. too intense for 5-8 after all"
        minLength={3}
        confirmLabel="Overturn"
        onConfirm={(value) => {
          const item = overturning
          setOverturning(null)
          decide(item, 'overturn', value)
        }}
        onCancel={() => setOverturning(null)}
      />
    </section>
  )
}


function Reports({ notify, onCountsChange }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [leaving, setLeaving] = useState(null)
  const [confirming, setConfirming] = useState(null) // { report, action: 'dismiss' | 'remove' }
  const [noting, setNoting] = useState(null) // the report a note is being written for
  const [noteBusy, setNoteBusy] = useState(false)

  async function reload() {
    setLoading(true)
    try { setItems(await listReports()) } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [])

  async function act(r, action, message) {
    setLeaving(r.id)
    try {
      await resolveReport(r.id, action)
      notify?.(message, action === 'remove' ? 'danger' : 'success')
      onCountsChange?.()
    } catch (err) {
      notify?.(err.message, 'danger')
      setLeaving(null)
      return
    }
    // Real bug, reported directly: "gw pencet dismiss... malah ilang...
    // refresh baru statusnya resolved". `leaving` was never cleared on the
    // success path — a resolved report stays in this list (unlike
    // Submissions' pending-only queue, a resolved report doesn't drop out
    // of listReports()), so its card kept matching `leaving === r.id`
    // forever and rendering at .card-leaving's opacity:0. Only a full page
    // reload (fresh mount, `leaving` back to null) ever revealed it again.
    setTimeout(async () => {
      await reload() // let the fade play before the fresh data replaces the row
      setLeaving(null)
    }, 220)
  }

  return (
    <section>
      <h2><FlagIcon width={20} height={20} /> Reported content {!loading && `(${items.length})`}</h2>
      {loading && <p className="muted">Loading…</p>}
      {!loading && items.length === 0 && (
        <p className="empty-state"><CheckIcon width={18} height={18} /> No reports right now.</p>
      )}
      {(() => {
        // Open reports first, then the ones already resolved (most recently
        // resolved first), so the two never mix.
        const openList = items.filter((r) => r.status === 'open')
        const resolvedList = items
          .filter((r) => r.status !== 'open')
          .sort((x, y) => (y.resolved_at || y.ts) - (x.resolved_at || x.ts))
        const both = openList.length > 0 && resolvedList.length > 0
        const renderCard = (r) => (
        <div className={`card ${leaving === r.id ? 'card-leaving' : ''}`} key={r.id}>
          <div className="child-top child-top--wrap">
            <div className="item-with-thumb">
              {r.thumbnail && <img className={`item-thumb item-thumb--${r.content_type || 'book'}`} src={r.thumbnail} alt="" />}
              <div>
              <h3 className="item-title">{r.content_type ? <TypeIcon type={r.content_type} /> : null} {r.content_title}</h3>
              <p className="muted">Reason: {r.reason}</p>
              <p className="muted">
                Reported {timeAgo(r.ts)}
                {r.resolved_at && <> · Resolved {timeAgo(r.resolved_at)}</>}
              </p>
              {((r.status === 'resolved' && r.outcome) || r.note) && (
                <div className="report-decision">
                  {r.status === 'resolved' && r.outcome && (
                    <span className={`report-decision-outcome report-decision-outcome--${r.outcome}`}>
                      {r.outcome === 'removed' ? 'Content removed' : 'Dismissed, no change'}
                    </span>
                  )}
                  {r.note && <span className="report-decision-note"><b>Note to the parent:</b> {r.note}</span>}
                </div>
              )}
              </div>
            </div>
            <span className={`badge badge-${r.status === 'open' ? 'pending' : 'approved'}`}>{r.status}</span>
          </div>
          {r.status === 'open' && (
            <div className="row">
              <button className="ghost small" disabled={leaving === r.id} onClick={() => setConfirming({ report: r, action: 'dismiss' })}>Dismiss</button>
              <button className="danger small" disabled={leaving === r.id} onClick={() => setConfirming({ report: r, action: 'remove' })}>
                <TrashIcon width={15} height={15} /> Remove content
              </button>
              <button className="ghost small report-note-btn" disabled={leaving === r.id} onClick={() => setNoting(r)}>
                <ChatIcon width={16} height={16} /> <span>{r.note ? 'Edit note to parent' : 'Note to parent'}</span>
              </button>
            </div>
          )}
        </div>
        )
        return (
          <>
            {openList.length > 0 && (
              <div className="report-group">
                {both && <h4 className="report-group-label">Open ({openList.length})</h4>}
                {openList.map(renderCard)}
              </div>
            )}
            {resolvedList.length > 0 && (
              <div className="report-group">
                {both && <h4 className="report-group-label">Resolved ({resolvedList.length})</h4>}
                {resolvedList.map(renderCard)}
              </div>
            )}
          </>
        )
      })()}
      <ConfirmDialog
        open={!!confirming}
        tone={confirming?.action === 'remove' ? 'danger' : 'primary'}
        icon={confirming?.action === 'remove' ? <TrashIcon width={20} height={20} /> : <FlagIcon width={20} height={20} />}
        title={confirming?.action === 'remove' ? 'Remove this content?' : 'Dismiss this report?'}
        message={confirming
          ? (confirming.action === 'remove'
            ? `“${confirming.report.content_title}” will be removed from the catalogue and children will no longer see it. The report will be marked resolved.`
            : `The report on “${confirming.report.content_title}” will be marked resolved and the content stays in the catalogue.`)
          : ''}
        confirmLabel={confirming?.action === 'remove' ? 'Remove content' : 'Dismiss report'}
        onConfirm={() => {
          const { report, action } = confirming
          setConfirming(null)
          act(report, action, action === 'remove'
            ? `“${report.content_title}” removed from the catalogue.`
            : `Report on “${report.content_title}” dismissed.`)
        }}
        onCancel={() => setConfirming(null)}
      />
      <ReportNoteDialog
        open={!!noting}
        title={noting ? `About your report on “${noting.content_title}”.` : ''}
        initialNote={noting?.note || ''}
        busy={noteBusy}
        onSend={async (note) => {
          setNoteBusy(true)
          try {
            await sendReportNote(noting.id, note)
            notify?.('Note sent to the parent.')
            setNoting(null)
            reload()
          } catch (err) {
            notify?.(err.message, 'danger')
          } finally {
            setNoteBusy(false)
          }
        }}
        onCancel={() => setNoting(null)}
      />
    </section>
  )
}
