import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getToken, getMe, login, logout,
  adminStats, adminSearchUsers, adminUserDetails, adminResetPassword, adminSuspend, adminUnsuspend,
  adminGetConfig, adminSetConfig, adminTickets, adminResolveTicket,
  adminListReviews, adminApproveReview, adminRejectReview,
} from '../api'
import {
  ChartIcon, CheckIcon, ClockIcon, CloseIcon, FlagIcon, GridIcon, HeartIcon, LifeBuoyIcon, LockIcon,
  RefreshIcon, SettingsIcon, SparkleIcon, StarIcon, UserIcon, UsersIcon,
} from '../icons'
import { useToast, ToastHost } from '../components/Toast'
import './parent.css'

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

  return (
    <div className="parent auth">
      <Link className="home-link" to="/">← Home</Link>
      <h1>Admin Sign In</h1>
      <form onSubmit={submit} className="card">
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Sign In'}</button>
      </form>
      <p className="muted">Demo login: <b>admin@pip.local</b> / <b>admin123</b></p>
    </div>
  )
}

const ADMIN_TABS = [
  { key: 'overview', label: 'Overview', icon: ChartIcon },
  { key: 'users', label: 'Users', icon: UsersIcon },
  { key: 'reviews', label: 'Reviews', icon: StarIcon, countKey: 'reviewsPending' },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
  { key: 'support', label: 'Support', icon: LifeBuoyIcon, countKey: 'ticketsOpen' },
]

function Tools({ account, onLogout }) {
  const [tab, setTab] = useState('overview')
  const [toast, notify] = useToast()
  // Same idea as the moderator console's tab badges — a pending-review
  // count and an open-ticket count on the Reviews/Support tabs, so an
  // admin sees what's waiting without opening every tab in turn.
  const [counts, setCounts] = useState({ reviewsPending: 0, ticketsOpen: 0 })

  async function refreshCounts() {
    try {
      const [reviews, s] = await Promise.all([adminListReviews('pending'), adminStats()])
      setCounts({ reviewsPending: reviews.length, ticketsOpen: s.tickets_open })
    } catch {
      // Best-effort — badges just stay at their last known value.
    }
  }
  useEffect(() => { refreshCounts() }, [])

  return (
    <div className="parent">
      <Link className="home-link" to="/">← Home</Link>
      <header className="parent-header">
        <div className="parent-header-who">
          <div className="parent-header-role"><SettingsIcon width={20} height={20} /></div>
          <div>
            <h1>Admin Console</h1>
            <p className="muted">Signed in as {account.name}</p>
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

      <div className="tab-panel" key={tab}>
        {tab === 'overview' && <Overview />}
        {tab === 'users' && <Users notify={notify} />}
        {tab === 'reviews' && <Reviews notify={notify} onCountsChange={refreshCounts} />}
        {tab === 'settings' && <Settings notify={notify} />}
        {tab === 'support' && <Support notify={notify} onCountsChange={refreshCounts} />}
      </div>

      <ToastHost toast={toast} />
    </div>
  )
}

// SA08 — system health. Each tile gets an icon (same tinted-chip language
// as the rest of the product, not a bare number) and the four tiles that
// represent something needing a human look (pending review, open reports/
// tickets, suspended accounts) switch to the danger tint the moment
// they're non-zero — real signal ("something here needs you"), not
// decoration; a tile that's always the same colour regardless of value
// would just be noise.
function Overview() {
  const [s, setS] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  async function load() {
    setRefreshing(true)
    try { setS(await adminStats()); setUpdatedAt(new Date()) } finally { setRefreshing(false) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) return <p className="muted">Loading…</p>
  const tiles = [
    { label: 'Users', val: s.users, icon: UserIcon },
    { label: 'Parents', val: s.parents, icon: UsersIcon },
    { label: 'Children', val: s.children, icon: HeartIcon },
    { label: 'Catalogue', val: s.content_total, icon: GridIcon },
    { label: 'Approved', val: s.content_approved, icon: CheckIcon },
    { label: 'Pending', val: s.content_pending, icon: ClockIcon, attention: true },
    { label: 'Open reports', val: s.reports_open, icon: FlagIcon, attention: true },
    { label: 'Open tickets', val: s.tickets_open, icon: LifeBuoyIcon, attention: true },
    { label: 'Suspended', val: s.suspended, icon: LockIcon, attention: true },
  ]
  // SA08's URS wording is specific — "API uptime, error rates, NLP/
  // recommendation service latency" — so these three are real, computed
  // numbers from app/metrics.py's rolling window, not just process uptime.
  // Rolling window starts empty on a fresh boot, so latency/error tiles
  // show "—" rather than a fabricated 0 until real traffic exists.
  const perfTiles = [
    { label: 'Error rate', val: `${(s.error_rate * 100).toFixed(1)}%`, icon: FlagIcon, attention: s.error_rate > 0 },
    { label: 'Avg latency', val: s.avg_latency_ms != null ? `${s.avg_latency_ms} ms` : '—', icon: ClockIcon },
    { label: 'NLP latency', val: s.nlp_avg_latency_ms != null ? `${s.nlp_avg_latency_ms} ms` : '—', icon: ChartIcon },
  ]
  return (
    <section>
      <div className="child-top">
        <h2><ChartIcon width={20} height={20} /> System health</h2>
        <button className="ghost small" onClick={load} disabled={refreshing}>
          <RefreshIcon width={14} height={14} className={refreshing ? 'spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {updatedAt && <p className="muted" style={{ marginTop: '-8px' }}>Updated {updatedAt.toLocaleTimeString()}</p>}
      <div className="stat-grid">
        {tiles.map(({ label, val, icon: Icon, attention }) => (
          <div className={`stat ${attention && val > 0 ? 'stat--attention' : ''}`} key={label}>
            <div className="stat-icon"><Icon width={18} height={18} /></div>
            <div className="stat-num">{val}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
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
  )
}

// SA03-SA07 — user management
function Users({ notify }) {
  const [q, setQ] = useState('')
  const [users, setUsers] = useState([])
  const [details, setDetails] = useState({}) // id -> detail object
  const [loading, setLoading] = useState(true)
  const [confirmingSuspend, setConfirmingSuspend] = useState(null)

  async function search() {
    setLoading(true)
    try { setUsers(await adminSearchUsers(q)) } finally { setLoading(false) }
  }
  useEffect(() => { search() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function showDetails(u) {
    if (details[u.id]) { const d = { ...details }; delete d[u.id]; setDetails(d); return }
    setDetails({ ...details, [u.id]: await adminUserDetails(u.id) })
  }
  async function reset(u) {
    const pw = prompt(`New password for ${u.email} (min 6 characters):`)
    if (!pw) return
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
            <div><h3>{u.name}</h3><p className="muted">{u.email} · role: {u.role}</p></div>
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
            <button className="ghost small" onClick={() => reset(u)}><LockIcon width={14} height={14} /> Reset password</button>
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
    </section>
  )
}

// SA09-SA13 — editable config sections
const CONFIG_SECTIONS = [
  { key: 'settings', title: 'System Settings (SA11)', fields: [
    { name: 'app_name', label: 'App name', type: 'text' },
    { name: 'support_email', label: 'Support email', type: 'text' },
    { name: 'maintenance_mode', label: 'Maintenance mode', type: 'bool' },
  ] },
  { key: 'integrations', title: 'API Integrations (SA09)', fields: [
    { name: 'llm_provider', label: 'LLM provider', type: 'text' },
    { name: 'openai_enabled', label: 'OpenAI enabled', type: 'bool' },
    { name: 'firebase_enabled', label: 'Firebase enabled', type: 'bool' },
    { name: 'google_books_enabled', label: 'Google Books enabled', type: 'bool' },
    { name: 'youtube_enabled', label: 'YouTube enabled', type: 'bool' },
    { name: 'youtube_channel_allowlist', label: 'YouTube curated channel allowlist (comma-separated channel IDs — empty = open search, still moderator-gated)', type: 'list' },
  ] },
  { key: 'compliance', title: 'Compliance & Data Retention (SA10)', fields: [
    { name: 'data_retention_days', label: 'Data retention (days)', type: 'number' },
    { name: 'pdpa_mode', label: 'PDPA mode', type: 'bool' },
    { name: 'allow_under_13', label: 'Allow under-13 users', type: 'bool' },
  ] },
  { key: 'website', title: 'Project Website (SA12)', fields: [
    { name: 'site_title', label: 'Site title', type: 'text' },
    { name: 'tagline', label: 'Tagline', type: 'text' },
    { name: 'announcement', label: 'Announcement banner', type: 'text' },
  ] },
  { key: 'billing', title: 'Billing Configuration (SA13)', fields: [
    { name: 'provider', label: 'Payment provider', type: 'text' },
    { name: 'currency', label: 'Currency', type: 'text' },
    // One price pair per paid tier (Ultra tier, 2026-09-07) — these are
    // the real prices `subscribe()` charges now, not just display copy
    // (see storage.py's `subscribe()` docstring on the bug that fixed).
    { name: 'premium_monthly_price', label: 'Premium — monthly price', type: 'number' },
    { name: 'premium_annual_price', label: 'Premium — annual price', type: 'number' },
    { name: 'ultra_monthly_price', label: 'Ultra — monthly price', type: 'number' },
    { name: 'ultra_annual_price', label: 'Ultra — annual price', type: 'number' },
    { name: 'billing_enabled', label: 'Billing enabled', type: 'bool' },
  ] },
]

function Settings({ notify }) {
  return (
    <section>
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
                ? "The team has knowingly decided to proceed without ZDR for now — see URS §2.5."
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
// UV04 — the human gate behind account.py's AI safety screen: a review
// only reaches the public landing page once an admin explicitly approves
// it here, same "human still decides" shape as the moderator's own
// catalogue queue (CM06-08), just for review text instead of a book/video.
const REVIEW_SORTS = {
  ai_first: { label: 'AI-recommended first', fn: (a, b) => Number(b.ai_recommend === true) - Number(a.ai_recommend === true) || b.rating - a.rating || b.created_at - a.created_at },
  newest: { label: 'Newest first', fn: (a, b) => b.created_at - a.created_at },
  rating_desc: { label: 'Highest rated first', fn: (a, b) => b.rating - a.rating || b.created_at - a.created_at },
  rating_asc: { label: 'Lowest rated first', fn: (a, b) => a.rating - b.rating || b.created_at - a.created_at },
}

function Reviews({ notify, onCountsChange }) {
  const [status, setStatus] = useState('pending')
  const [sort, setSort] = useState('ai_first')
  // A pending queue with 100+ reviews isn't realistic to read one by one —
  // this narrows straight to app/ai_assist.py's suggest_review picks
  // without hiding anything permanently: it's a client-side filter over
  // the same fetched list, one click away from turning back off, and the
  // admin still makes every actual approve/reject call themselves.
  const [aiOnly, setAiOnly] = useState(false)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [leaving, setLeaving] = useState(null)

  async function reload() {
    setLoading(true)
    try { setItems(await adminListReviews(status)) } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  async function act(r, fn, message, tone) {
    setLeaving(r.id)
    try {
      await fn(r.id)
      notify?.(message, tone)
      onCountsChange?.()
    } catch (err) {
      notify?.(err.message, 'danger')
      setLeaving(null)
      return
    }
    setTimeout(reload, 220)
  }

  const aiRecommendedCount = items.filter((r) => r.ai_recommend === true).length
  const filtered = aiOnly ? items.filter((r) => r.ai_recommend === true) : items
  const sorted = [...filtered].sort(REVIEW_SORTS[sort].fn)

  return (
    <section>
      <h2><StarIcon width={20} height={20} /> Parent reviews</h2>
      <p className="muted">Approved reviews show on the public landing page, best-rated first — up to 10 at a time.</p>
      <div className="row" style={{ marginBottom: 16, justifyContent: 'space-between' }}>
        <div className="tabs" style={{ margin: 0 }}>
          {['pending', 'approved', 'rejected'].map((s) => (
            <button key={s} className={status === s ? 'tab active' : 'tab'} onClick={() => setStatus(s)}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 'var(--space-4)' }}>
          {aiRecommendedCount > 0 && (
            <label className="toggle" style={{ padding: 0 }}>
              <input type="checkbox" checked={aiOnly} onChange={(e) => setAiOnly(e.target.checked)} />
              <SparkleIcon width={14} height={14} /> AI-recommended only ({aiRecommendedCount})
            </label>
          )}
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--space-2)' }}>
            Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {Object.entries(REVIEW_SORTS).map(([key, { label }]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {loading && <p className="muted">Loading…</p>}
      {!loading && sorted.length === 0 && (
        <p className="empty-state"><CheckIcon width={18} height={18} /> {aiOnly ? 'No AI-recommended reviews in this filter.' : `No ${status} reviews.`}</p>
      )}
      {sorted.map((r) => (
        <div className={`card ${leaving === r.id ? 'card-leaving' : ''}`} key={r.id}>
          <div className="child-top">
            <div>
              <h3 className="item-title">
                {Array.from({ length: 5 }).map((_, i) => (
                  <StarIcon key={i} width={14} height={14} filled={i < r.rating} />
                ))}
              </h3>
              <p className="muted">by {r.parent_name}</p>
            </div>
            <span className={`badge badge-${r.status === 'approved' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'pending'}`}>{r.status}</span>
          </div>
          <p>{r.text}</p>
          {r.rejection_reason && <p className="muted">Reason: {r.rejection_reason}</p>}
          {/* UV04/admin triage aid (app/ai_assist.py) — advisory only, see
              REVIEW_SORTS/aiOnly above for the filter this backs. */}
          {r.ai_recommend !== null && r.ai_recommend !== undefined && (
            <div className={`ai-note ${r.ai_recommend ? 'ai-note--recommend' : 'ai-note--skip'}`}>
              <SparkleIcon width={15} height={15} />
              <span>
                <b>AI suggests: {r.ai_recommend ? 'Feature this' : 'Skip'}</b>
                {r.ai_reason && <> — {r.ai_reason}</>}
              </span>
            </div>
          )}
          {r.status !== 'approved' && (
            <div className="row">
              <button className="success small" disabled={leaving === r.id}
                onClick={() => act(r, adminApproveReview, `${r.parent_name}’s review approved — now live on the landing page.`)}>
                <CheckIcon width={14} height={14} /> Approve
              </button>
              {r.status !== 'rejected' && (
                <button className="danger small" disabled={leaving === r.id}
                  onClick={() => act(r, adminRejectReview, `${r.parent_name}’s review rejected.`, 'danger')}>
                  <CloseIcon width={14} height={14} /> Reject
                </button>
              )}
            </div>
          )}
          {r.status === 'approved' && (
            <div className="row">
              <button className="danger small" disabled={leaving === r.id}
                onClick={() => act(r, adminRejectReview, `${r.parent_name}’s review unpublished.`, 'danger')}>
                <CloseIcon width={14} height={14} /> Unpublish
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  )
}

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
    setTimeout(reload, 220)
  }

  return (
    <section>
      <h2><LifeBuoyIcon width={20} height={20} /> Support tickets {!loading && `(${tix.filter((t) => t.status === 'open').length} open)`}</h2>
      {loading && <p className="muted">Loading…</p>}
      {!loading && tix.length === 0 && <p className="empty-state"><CheckIcon width={18} height={18} /> No tickets.</p>}
      {tix.map((t) => (
        <div className={`card ${leaving === t.id ? 'card-leaving' : ''}`} key={t.id}>
          <div className="child-top">
            <div><h3>{t.subject}</h3><p className="muted">From: {t.from_email}</p></div>
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
