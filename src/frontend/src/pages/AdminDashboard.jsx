import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getToken, getMe, login, logout,
  adminStats, adminSearchUsers, adminUserDetails, adminResetPassword, adminSuspend, adminUnsuspend,
  adminGetConfig, adminSetConfig, adminTickets, adminResolveTicket,
} from '../api'
import {
  CheckIcon, ChartIcon, ClockIcon, FlagIcon, GridIcon, HeartIcon,
  LifeBuoyIcon, LockIcon, SettingsIcon, UserIcon, UsersIcon,
} from '../icons'
import { useToast, ToastHost } from '../components/Toast'
import PromptDialog from '../components/PromptDialog'
import { firstMissingField } from '../formValidation'
import { timeAgo } from '../timeFormat'
import './parent.css'

// trimmed-demo branch: Admin console covers Overview, Users, Settings, and
// Support (SA03-SA13) — matching exactly what's pictured in the Preliminary
// User Manual's Admin Dashboard screenshot (4 tabs: Overview, Users,
// Settings, Support). The Reviews-moderation tab from the full
// prototype-real-integrations branch isn't pictured there, so it stays out.

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

  return (
    <div className="parent auth">
      <Link className="home-link" to="/">← Home</Link>
      <h1>Admin Sign In</h1>
      <form onSubmit={submit} className="card" noValidate>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
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
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
  { key: 'support', label: 'Support', icon: LifeBuoyIcon },
]

function Tools({ account, onLogout }) {
  const [tab, setTab] = useState('overview')
  const [toast, notify] = useToast()

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
        {ADMIN_TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'tab active' : 'tab'} onClick={() => setTab(t.key)}>
            <t.icon width={16} height={16} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview />}
      {tab === 'users' && <Users notify={notify} />}
      {tab === 'settings' && <Settings notify={notify} />}
      {tab === 'support' && <Support notify={notify} />}

      <ToastHost toast={toast} />
    </div>
  )
}

// SA08 — system health. Matches the Preliminary User Manual's Admin
// Dashboard screenshot: one System health card (Users/Parents/Children/
// Catalogue/Approved/Pending/Open reports/Open tickets/Suspended), a
// Performance row (real numbers from app/metrics.py's rolling window, not
// guesses), and the AI brain + uptime line underneath.
function Overview() {
  const [s, setS] = useState(null)

  useEffect(() => { adminStats().then(setS) }, [])

  if (!s) return <p className="muted">Loading…</p>

  const tiles = [
    { label: 'Users', val: s.users, icon: UserIcon },
    { label: 'Parents', val: s.parents, icon: UsersIcon },
    { label: 'Children', val: s.children, icon: HeartIcon },
    { label: 'Catalogue', val: s.content_total, icon: GridIcon },
    { label: 'Approved', val: s.content_approved, icon: CheckIcon },
    { label: 'Pending', val: s.content_pending, icon: ClockIcon },
    { label: 'Open reports', val: s.reports_open, icon: FlagIcon },
    { label: 'Open tickets', val: s.tickets_open, icon: LifeBuoyIcon },
    { label: 'Suspended', val: s.suspended, icon: LockIcon },
  ]
  const perfTiles = [
    { label: 'Error rate', val: `${(s.error_rate * 100).toFixed(1)}%`, icon: FlagIcon },
    { label: 'Avg latency', val: s.avg_latency_ms != null ? `${s.avg_latency_ms} ms` : '—', icon: ClockIcon },
    { label: 'NLP latency', val: s.nlp_avg_latency_ms != null ? `${s.nlp_avg_latency_ms} ms` : '—', icon: ChartIcon },
  ]

  return (
    <section className="card">
      <h2><ChartIcon width={20} height={20} /> System health</h2>
      <div className="stat-grid">
        {tiles.map(({ label, val, icon: Icon }) => (
          <div className="stat" key={label}>
            <div className="stat-icon"><Icon width={18} height={18} /></div>
            <div className="stat-num">{val}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </div>
      <h3 className="admin-subhead">Performance <span className="muted">(last {s.sample_size} requests{s.nlp_sample_size ? `, ${s.nlp_sample_size} chat` : ''})</span></h3>
      <div className="stat-grid">
        {perfTiles.map(({ label, val, icon: Icon }) => (
          <div className="stat" key={label}>
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

// SA09-SA13 — editable config sections. Ultra-tier billing fields left out —
// see models.AccountTier's comment (Free/Premium only on this branch).
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
    { name: 'premium_monthly_price', label: 'Premium — monthly price', type: 'number' },
    { name: 'premium_annual_price', label: 'Premium — annual price', type: 'number' },
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
      notify?.(`${section.title} saved.`)
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
            background: values.openai_zdr_status === 'confirmed' ? 'var(--safety-soft, #e8f5ef)' : 'var(--danger-100, #faf0e2)',
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
function Support({ notify }) {
  const [tix, setTix] = useState([])
  const [loading, setLoading] = useState(true)

  async function reload() {
    setLoading(true)
    try { setTix(await adminTickets()) } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [])

  async function resolve(t) {
    try {
      await adminResolveTicket(t.id)
      notify?.(`"${t.subject}" marked resolved.`)
      reload()
    } catch (err) {
      notify?.(err.message, 'danger')
    }
  }

  return (
    <section>
      <h2><LifeBuoyIcon width={20} height={20} /> Support tickets {!loading && `(${tix.filter((t) => t.status === 'open').length} open)`}</h2>
      {loading && <p className="muted">Loading…</p>}
      {!loading && tix.length === 0 && <p className="muted">No tickets.</p>}
      {tix.map((t) => (
        <div className="card" key={t.id}>
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
              <button className="small" onClick={() => resolve(t)}>
                <CheckIcon width={14} height={14} /> Mark resolved
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  )
}
