import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getToken, getMe, login, logout,
  adminStats, adminSearchUsers, adminUserDetails, adminResetPassword, adminSuspend, adminUnsuspend,
  adminGetConfig, adminSetConfig, adminTickets, adminResolveTicket,
  adminListReviews,
} from '../api'
import {
  AlertIcon, ChartIcon, CheckIcon, ChevronIcon, ClockIcon, CloseIcon, FlagIcon, GridIcon, HeartIcon,
  LifeBuoyIcon, LockIcon, RefreshIcon, SettingsIcon, StarIcon, UserIcon, UsersIcon,
} from '../icons'
import { useToast, ToastHost } from '../components/Toast'
import PasswordInput from '../components/PasswordInput'
import useScrolled from '../useScrolled'
import ApprovalRing from '../components/ApprovalRing'
import PromptDialog from '../components/PromptDialog'
import { firstMissingField } from '../formValidation'
import { timeAgo, logTime } from '../timeFormat'
import { toneStyle } from '../statTones'
import './parent.css'

// Turns raw review/ticket/user records into a flat, time-sorted event
// list — same shape as ModeratorDashboard's buildActivity, applied to the
// Admin console's own actions instead (review moderation, support
// tickets, account suspension). None of these timestamps existed before
// this pass, same "no 'when' to show" gap already closed on the
// Moderator side.
function buildAdminActivity(reviews, tickets, users) {
  const events = []
  for (const r of reviews) {
    if (r.reviewed_at && (r.status === 'approved' || r.status === 'rejected')) {
      events.push({ ts: r.reviewed_at, kind: r.status === 'approved' ? 'review_approved' : 'review_rejected', review: r })
    }
  }
  for (const t of tickets) {
    if (t.resolved_at) events.push({ ts: t.resolved_at, kind: 'ticket_resolved', ticket: t })
  }
  for (const u of users) {
    if (u.suspended_at) events.push({ ts: u.suspended_at, kind: 'user_suspended', user: u })
    if (u.unsuspended_at) events.push({ ts: u.unsuspended_at, kind: 'user_unsuspended', user: u })
  }
  return events.sort((a, b) => b.ts - a.ts).slice(0, 8)
}

const ADMIN_ACTIVITY_META = {
  review_approved: { icon: CheckIcon, tint: 'success', text: (e) => `Approved ${e.review.parent_name}'s review` },
  review_rejected: { icon: CloseIcon, tint: 'flag', text: (e) => `Rejected ${e.review.parent_name}'s review` },
  ticket_resolved: { icon: LifeBuoyIcon, tint: 'success', text: (e) => `Resolved ticket "${e.ticket.subject}"${e.ticket.resolved_by ? ` — ${e.ticket.resolved_by}` : ''}` },
  user_suspended: { icon: LockIcon, tint: 'flag', text: (e) => `Suspended ${e.user.email}${e.user.suspended_by ? ` — ${e.user.suspended_by}` : ''}` },
  user_unsuspended: { icon: CheckIcon, tint: null, text: (e) => `Unsuspended ${e.user.email}${e.user.unsuspended_by ? ` — ${e.user.unsuspended_by}` : ''}` },
}

export default function AdminDashboard() {
  const [account, setAccount] = useState(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (!getToken()) { setChecking(false); return }
    getMe().then((a) => { if (a.role === 'admin') setAccount(a) }).catch(() => {}).finally(() => setChecking(false))
  }, [])

  if (checking) return <div className="parent"><p className="muted">Loading…</p></div>
  if (!account) return <AdminLogin onAuthed={setAccount} />
  return <Tools account={account} onLogout={() => { logout(); setAccount(null) }} />
}

// SA01 — admin login (role-checked)
function AdminLogin({ onAuthed }) {
  const [email, setEmail] = useState('admin@pip.local')
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
      if (acc.role !== 'admin') { await logout(); setError('This area is for system administrators only.'); return }
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
      <h1>Admin Sign In</h1>
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
      <p className="muted">Demo login: <b>admin@pip.local</b> / <b>admin123</b></p>
    </div>
  )
}

const ADMIN_TABS = [
  { key: 'overview', label: 'Overview', icon: ChartIcon },
  { key: 'users', label: 'Users', icon: UsersIcon },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
  { key: 'support', label: 'Support', icon: LifeBuoyIcon, countKey: 'ticketsOpen' },
]

function Tools({ account, onLogout }) {
  const scrolled = useScrolled()
  const [tab, setTab] = useState('overview')
  const [toast, notify] = useToast()
  // Same idea as the moderator console's tab badges — an open-ticket count
  // on the Support tab, so an admin sees what's waiting without opening
  // every tab in turn.
  const [counts, setCounts] = useState({ ticketsOpen: 0 })

  async function refreshCounts() {
    try {
      const s = await adminStats()
      setCounts({ ticketsOpen: s.tickets_open })
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
          <div className="parent-header-role"><SettingsIcon width={20} height={20} /></div>
          <div>
            <h1>Admin Console</h1>
          </div>
        </div>
        <button className="ghost" onClick={onLogout}>Log out</button>
      </header>

      <div className="tabs">
        {ADMIN_TABS.map((t) => {
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
        {tab === 'overview' && <Overview onNavigate={setTab} />}
        {tab === 'users' && <Users notify={notify} />}
        {tab === 'settings' && <Settings notify={notify} />}
        {tab === 'support' && <Support notify={notify} onCountsChange={refreshCounts} />}
      </div>

      <ToastHost toast={toast} />
    </div>
  )
}

// SA08 — system health. Each tile gets an icon (same tinted-chip language
// as the rest of the product, not a bare number) and the tiles that
// represent something needing a human look (pending review/reviews, open
// reports/tickets, suspended accounts) switch to the danger tint the
// moment they're non-zero — real signal ("something here needs you"), not
// decoration; a tile that's always the same colour regardless of value
// would just be noise.
//
// Restructured into three cards (flagged directly: this whole page still
// "terasa sederhana dan simple" next to the Moderator console's own
// Overview redesign) instead of one long flat section — same three
// questions that redesign answered, aimed at the admin's own domain this
// time: "what needs me now" (system health), "what does the user base
// look like" (account composition), "what just happened" (recent
// activity). Tiles that map to an actual tab in this console are real
// buttons that jump straight there, same as Moderator's; System health
// and Performance stay informational-only (Catalogue/reports belong to
// the Moderator console, not this one).
function Overview({ onNavigate }) {
  const [s, setS] = useState(null)
  const [reviewStats, setReviewStats] = useState(null)
  const [activity, setActivity] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  async function load() {
    setRefreshing(true)
    try {
      const [stats, reviews, tickets, users] = await Promise.all([
        adminStats(), adminListReviews(), adminTickets(), adminSearchUsers(''),
      ])
      setS(stats)
      const approved = reviews.filter((r) => r.status === 'approved').length
      const rejected = reviews.filter((r) => r.status === 'rejected').length
      const pending = reviews.filter((r) => r.status === 'pending').length
      setReviewStats({
        pending, approved, rejected,
        approvalRate: approved + rejected > 0 ? Math.round((approved / (approved + rejected)) * 100) : null,
      })
      setActivity(buildAdminActivity(reviews, tickets, users))
      setUpdatedAt(new Date())
    } finally {
      setRefreshing(false)
    }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!s || !reviewStats) return <p className="muted">Loading…</p>
  const tiles = [
    { label: 'Users', val: s.users, icon: UserIcon, nav: 'users', tone: 'blue' },
    { label: 'Parents', val: s.parents, icon: UsersIcon, nav: 'users', tone: 'success' },
    { label: 'Children', val: s.children, icon: HeartIcon, tone: 'pink' },
    { label: 'Suspended', val: s.suspended, icon: LockIcon, nav: 'users', tone: 'danger' },
    { label: 'Reviews pending', val: reviewStats.pending, icon: StarIcon, tone: 'amber' },
    { label: 'Open tickets', val: s.tickets_open, icon: LifeBuoyIcon, nav: 'support', tone: 'teal' },
    { label: 'Catalogue', val: s.content_total, icon: GridIcon, tone: 'indigo' },
    { label: 'Open reports', val: s.reports_open, icon: FlagIcon, tone: 'orange' },
  ]
  // SA08's URS wording is specific — "API uptime, error rates, NLP/
  // recommendation service latency" — so these three are real, computed
  // numbers from app/metrics.py's rolling window, not just process uptime.
  // Rolling window starts empty on a fresh boot, so latency/error tiles
  // show "—" rather than a fabricated 0 until real traffic exists.
  // Round, clearly-a-heuristic cutoffs (not a measured SLA/platform limit)
  // — "noticeably slow," not "about to hit a serverless timeout." Chat/NLP
  // calls are naturally slower than a plain REST call, hence the higher bar.
  const SLOW_MS = 2000
  const SLOW_NLP_MS = 6000
  const perfTiles = [
    { label: 'Error rate', val: `${(s.error_rate * 100).toFixed(1)}%`, icon: FlagIcon, attention: s.error_rate > 0 },
    { label: 'Avg latency', val: s.avg_latency_ms != null ? `${s.avg_latency_ms} ms` : '—', icon: ClockIcon, attention: s.avg_latency_ms > SLOW_MS },
    { label: 'NLP latency', val: s.nlp_avg_latency_ms != null ? `${s.nlp_avg_latency_ms} ms` : '—', icon: ChartIcon, attention: s.nlp_avg_latency_ms > SLOW_NLP_MS },
  ]
  const paidTotal = s.tier_premium
  const freeVsPaidTotal = s.tier_free + paidTotal
  const paidPct = freeVsPaidTotal > 0 ? Math.round((paidTotal / freeVsPaidTotal) * 100) : null

  return (
    <>
      <section className="card">
        <div className="child-top">
          <h2><ChartIcon width={20} height={20} /> System health</h2>
          <button className="ghost small" onClick={load} disabled={refreshing}>
            <RefreshIcon width={14} height={14} className={refreshing ? 'spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {updatedAt && <p className="muted" style={{ marginTop: '-8px' }}>Updated {updatedAt.toLocaleTimeString()}</p>}
        <div className="stat-grid">
          {tiles.map(({ label, val, icon: Icon, tone, nav }) =>
            nav ? (
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
            ) : (
              <div className="stat stat--tone" style={toneStyle(tone)} key={label}>
                <div className="stat-icon"><Icon width={18} height={18} /></div>
                <div className="stat-num">{val}</div>
                <div className="stat-label">{label}</div>
              </div>
            )
          )}
        </div>
        <h3 className="admin-subhead">Performance <span className="muted">(last {s.sample_size} requests{s.nlp_sample_size ? `, ${s.nlp_sample_size} chat` : ''})</span></h3>
        <div className="stat-grid">
          {perfTiles.map(({ label, val, icon: Icon, attention }) => (
            <div className={`stat ${attention ? 'stat--attention' : ''}`} key={label}>
              <div className="stat-icon"><Icon width={18} height={18} /></div>
              <div className="stat-num">{val}</div>
              <div className="stat-label">{label}</div>
            </div>
          ))}
        </div>
        <p className="muted">AI brain: <b>{s.brain}</b> · Uptime: {s.uptime_seconds}s</p>
      </section>

      <section className="card">
        <h2><UsersIcon width={20} height={20} /> Account composition</h2>
        {reviewStats.approvalRate !== null && (
          <div className="approval-row">
            <ApprovalRing pct={reviewStats.approvalRate} />
            <div>
              <div className="approval-row-headline">{reviewStats.approvalRate}% review approval rate</div>
              <p className="muted">{reviewStats.approved} approved · {reviewStats.rejected} rejected, out of every parent review moderated so far.</p>
            </div>
          </div>
        )}
        {paidPct !== null && (
          <div className="stat-split">
            <div className="stat-split-label">
              <span>Free · {s.tier_free}</span>
              <span>Premium · {paidTotal}</span>
            </div>
            <div className="stat-split-bar">
              <div className="stat-split-fill" style={{ width: `${paidPct}%` }} />
            </div>
          </div>
        )}
        <div className="genre-cloud">
          <span className="review-field-label">Users by role</span>
          <div className="chip-row">
            <span className="chip">Parents · {s.parents}</span>
            <span className="chip chip-muted">Moderators · {s.moderators}</span>
            <span className="chip chip-muted">Admins · {s.admins}</span>
          </div>
        </div>
        <div className="genre-cloud">
          <span className="review-field-label">Parents by plan</span>
          <div className="chip-row">
            <span className="chip">Free · {s.tier_free}</span>
            <span className="chip chip-muted">Premium · {s.tier_premium}</span>
          </div>
        </div>
      </section>

      <section className="card">
        <h2><ClockIcon width={20} height={20} /> Recent activity</h2>
        {!activity || activity.length === 0 ? (
          <p className="muted">Nothing logged yet — review decisions, resolved tickets and account suspensions will show up here as they happen.</p>
        ) : (
          <div className="panel">
            {activity.map((e, i) => {
              const meta = ADMIN_ACTIVITY_META[e.kind]
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
    </>
  )
}

// SA03-SA07 — user management
function Users({ notify }) {
  const [q, setQ] = useState('')
  const [users, setUsers] = useState([])
  const [details, setDetails] = useState({}) // id -> detail object
  const [loading, setLoading] = useState(true)
  const [confirmingSuspend, setConfirmingSuspend] = useState(null)
  const [resetting, setResetting] = useState(null) // the user currently mid "new password" dialog

  async function search() {
    setLoading(true)
    try { setUsers(await adminSearchUsers(q)) } finally { setLoading(false) }
  }
  useEffect(() => { search() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function showDetails(u) {
    if (details[u.id]) { const d = { ...details }; delete d[u.id]; setDetails(d); return }
    setDetails({ ...details, [u.id]: await adminUserDetails(u.id) })
  }
  async function doReset(pw) {
    const u = resetting
    setResetting(null)
    try {
      await adminResetPassword(u.id, pw)
      notify?.(`Password reset for ${u.email}.`)
    } catch (e) {
      notify?.(e.message, 'danger')
    }
  }
  async function suspend(u) {
    try {
      await adminSuspend(u.id)
      setConfirmingSuspend(null)
      notify?.(`${u.email} suspended.`, 'danger')
      search()
    } catch (e) { notify?.(e.message, 'danger') }
  }
  async function unsuspend(u) {
    try {
      await adminUnsuspend(u.id)
      notify?.(`${u.email} unsuspended.`)
      search()
    } catch (e) { notify?.(e.message, 'danger') }
  }

  return (
    <section>
      <div className="row" style={{ marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email"
          onKeyDown={(e) => e.key === 'Enter' && search()} style={{ flex: 1 }} />
        <button onClick={search}>Search</button>
      </div>
      {loading && <p className="muted">Loading…</p>}
      {!loading && users.length === 0 && <p className="muted">No accounts match that search.</p>}
      {users.map((u) => (
        <div className="card" key={u.id}>
          <div className="child-top">
            <div>
              <h3>{u.name}</h3>
              <p className="muted">{u.email} · role: {u.role}</p>
              {u.suspended && u.suspended_at ? (
                <p className="muted">Suspended {timeAgo(u.suspended_at)}{u.suspended_by && ` — ${u.suspended_by}`}</p>
              ) : u.unsuspended_at ? (
                <p className="muted">Unsuspended {timeAgo(u.unsuspended_at)}{u.unsuspended_by && ` — ${u.unsuspended_by}`}</p>
              ) : null}
            </div>
            <div className="row">
              {u.suspended && <span className="badge badge-rejected">suspended</span>}
              {u.verified && <span className="badge badge-approved">verified</span>}
            </div>
          </div>
          {confirmingSuspend === u.id ? (
            <div className="row inline-confirm">
              <span>Suspend {u.email}? They won't be able to log in.</span>
              <button className="danger small" onClick={() => suspend(u)}>Yes, suspend</button>
              <button className="ghost small" onClick={() => setConfirmingSuspend(null)}>Cancel</button>
            </div>
          ) : (
          <div className="row">
            <button className="ghost small" onClick={() => showDetails(u)}>{details[u.id] ? 'Hide' : 'Details'}</button>
            <button className="ghost small" onClick={() => setResetting(u)}><LockIcon width={14} height={14} /> Reset password</button>
            {u.role !== 'admin' && (
              <button className={u.suspended ? 'small' : 'danger small'} onClick={() => u.suspended ? unsuspend(u) : setConfirmingSuspend(u.id)}>
                {u.suspended ? 'Unsuspend' : <><LockIcon width={14} height={14} /> Suspend</>}
              </button>
            )}
          </div>
          )}
          {details[u.id] && (
            <p className="muted" style={{ marginTop: 8 }}>
              ID: {details[u.id].id} · Verified: {String(details[u.id].verified)} ·
              Suspended: {String(details[u.id].suspended)} · Child profiles: {details[u.id].children}
            </p>
          )}
        </div>
      ))}
      <PromptDialog
        open={!!resetting}
        icon={<LockIcon width={20} height={20} />}
        title="Set a new password"
        message={resetting ? `This immediately replaces ${resetting.email}’s current password.` : ''}
        label="New password"
        placeholder="Min. 6 characters"
        minLength={6}
        confirmLabel="Reset password"
        onConfirm={doReset}
        onCancel={() => setResetting(null)}
      />
    </section>
  )
}

// SA09-SA13 — editable config sections
const CONFIG_SECTIONS = [
  { key: 'settings', title: 'System Settings', fields: [
    { name: 'app_name', label: 'App name', type: 'text' },
    { name: 'support_email', label: 'Support email', type: 'text' },
    { name: 'maintenance_mode', label: 'Maintenance mode', type: 'bool' },
  ] },
  { key: 'integrations', title: 'API Integrations', fields: [
    { name: 'llm_provider', label: 'LLM provider', type: 'text' },
    { name: 'openai_enabled', label: 'OpenAI enabled', type: 'bool' },
    { name: 'firebase_enabled', label: 'Firebase enabled', type: 'bool' },
    { name: 'google_books_enabled', label: 'Google Books enabled', type: 'bool' },
    { name: 'youtube_enabled', label: 'YouTube enabled', type: 'bool' },
    { name: 'youtube_channel_allowlist', label: 'YouTube curated channel allowlist (comma-separated channel IDs — empty = open search, still moderator-gated)', type: 'list' },
    { name: 'trusted_book_publishers', label: 'Trusted book publishers for bulk import (comma-separated, e.g. "DK Children, Scholastic, Usborne") — an easier auto-approve bar, never a skipped one', type: 'list' },
  ] },
  { key: 'compliance', title: 'Compliance & Data Retention', fields: [
    { name: 'data_retention_days', label: 'Data retention (days)', type: 'number' },
    { name: 'pdpa_mode', label: 'PDPA mode', type: 'bool' },
    { name: 'allow_under_13', label: 'Allow under-13 users', type: 'bool' },
  ] },
  { key: 'website', title: 'Project Website', fields: [
    { name: 'site_title', label: 'Site title', type: 'text' },
    { name: 'tagline', label: 'Tagline', type: 'text' },
    { name: 'announcement', label: 'Announcement banner', type: 'text' },
  ] },
  { key: 'billing', title: 'Billing Configuration', fields: [
    { name: 'provider', label: 'Payment provider', type: 'text' },
    { name: 'currency', label: 'Currency', type: 'text' },
    // These are the real prices `subscribe()` charges (see storage.py's
    // `subscribe()` docstring). A 2nd, "Ultra" price pair existed briefly
    // (2026-09-07) — held back out of the prototype for now, planned for
    // the final product instead (Kiefer's call, 2026-09-23; see
    // ParentDashboard.jsx's TIER_INFO comment).
    { name: 'premium_monthly_price', label: 'Premium — monthly price', type: 'number' },
    { name: 'premium_annual_price', label: 'Premium — annual price', type: 'number' },
    { name: 'billing_enabled', label: 'Billing enabled', type: 'bool' },
  ] },
]

function Settings({ notify }) {
  return (
    <section className="settings-stack">
      {CONFIG_SECTIONS.map((s) => <ConfigCard key={s.key} section={s} notify={notify} />)}
    </section>
  )
}

function ConfigCard({ section, notify }) {
  const [values, setValues] = useState(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { adminGetConfig(section.key).then(setValues) }, [section.key])

  if (!values) return null
  function set(name, val) { setValues({ ...values, [name]: val }); setSaved(false) }
  async function save() {
    try {
      setValues(await adminSetConfig(section.key, values))
      setSaved(true)
      notify?.(`${section.title.replace(/\s*\([A-Z0-9-]+\)$/, '')} saved.`)
    } catch (err) {
      notify?.(err.message, 'danger')
    }
  }

  return (
    <div className="card">
      <h3>{section.title}</h3>
      {section.key === 'compliance' && (
        <div
          className="card"
          style={{
            margin: '0 0 8px', padding: 12,
            background: values.openai_zdr_status === 'confirmed' ? 'var(--success-100)' : 'var(--danger-100)',
          }}
        >
          <p style={{ margin: 0 }}>
            <b>OpenAI Zero Data Retention: {values.openai_zdr_status}</b>
          </p>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {values.openai_zdr_status === 'confirmed'
              ? 'A real ZDR agreement with OpenAI is in place.'
              : values.openai_zdr_status === 'accepted_risk'
                ? "The team has knowingly decided to proceed without ZDR for now."
                : "Real child chat text is sent to OpenAI's standard API (30-day retention, no ZDR agreement). Set via ZDR_STATUS in the backend .env — this is a real compliance/business decision, not something to toggle here."}
          </p>
        </div>
      )}
      {section.fields.map((f) => (
        f.type === 'bool' ? (
          <label key={f.name} className="toggle">
            <input type="checkbox" checked={!!values[f.name]} onChange={(e) => set(f.name, e.target.checked)} />
            {f.label}
          </label>
        ) : f.type === 'list' ? (
          <label key={f.name}>{f.label}
            <input
              type="text"
              value={(values[f.name] ?? []).join(', ')}
              onChange={(e) => set(f.name, e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
            />
          </label>
        ) : (
          <label key={f.name}>{f.label}
            <input
              type={f.type === 'number' ? 'number' : 'text'}
              value={values[f.name] ?? ''}
              onChange={(e) => set(f.name, f.type === 'number' ? Number(e.target.value) : e.target.value)}
            />
          </label>
        )
      ))}
      <div className="row">
        <button onClick={save}>Save</button>
        {saved && <span className="muted"><CheckIcon width={14} height={14} /> Saved</span>}
      </div>
    </div>
  )
}

// SA14 — escalated support tickets
function Support({ notify, onCountsChange }) {
  const [tix, setTix] = useState([])
  const [loading, setLoading] = useState(true)
  const [leaving, setLeaving] = useState(null)

  async function reload() {
    setLoading(true)
    try { setTix(await adminTickets()) } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [])

  async function resolve(t) {
    setLeaving(t.id)
    try {
      await adminResolveTicket(t.id)
      notify?.(`“${t.subject}” marked resolved.`)
      onCountsChange?.()
    } catch (err) {
      notify?.(err.message, 'danger')
      setLeaving(null)
      return
    }
    // Same real bug as Moderator's Reports tab (flagged directly there:
    // "gw pencet dismiss... malah ilang... refresh baru statusnya
    // resolved") — `leaving` never got cleared on the success path, and
    // adminTickets() returns resolved tickets too (not filtered out like
    // Reviews' status-scoped reload), so a resolved ticket kept rendering
    // at .card-leaving's opacity:0 forever until a full page refresh.
    setTimeout(async () => {
      await reload() // let the fade play before the fresh data replaces the row
      setLeaving(null)
    }, 220)
  }

  return (
    <section>
      <h2><LifeBuoyIcon width={20} height={20} /> Support tickets {!loading && `(${tix.filter((t) => t.status === 'open').length} open)`}</h2>
      {loading && <p className="muted">Loading…</p>}
      {!loading && tix.length === 0 && <p className="empty-state"><CheckIcon width={18} height={18} /> No tickets.</p>}
      {tix.map((t) => (
        <div className={`card ${leaving === t.id ? 'card-leaving' : ''}`} key={t.id}>
          <div className="child-top">
            <div>
              <h3>{t.subject}</h3>
              <p className="muted">From: {t.from_email}</p>
              <p className="muted">
                Received {timeAgo(t.ts)}
                {t.resolved_at && <> · Resolved {timeAgo(t.resolved_at)}{t.resolved_by && ` — ${t.resolved_by}`}</>}
              </p>
            </div>
            <span className={`badge badge-${t.status === 'open' ? 'pending' : 'approved'}`}>{t.status}</span>
          </div>
          <p className="muted">{t.message}</p>
          {t.status === 'open' && (
            <div className="row">
              <button className="small" disabled={leaving === t.id} onClick={() => resolve(t)}>
                <CheckIcon width={14} height={14} /> Mark resolved
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  )
}
