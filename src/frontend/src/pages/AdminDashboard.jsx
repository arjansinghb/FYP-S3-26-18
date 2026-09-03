import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getToken, getMe, login, logout,
  adminStats, adminSearchUsers, adminUserDetails, adminResetPassword, adminSuspend, adminUnsuspend,
  adminGetConfig, adminSetConfig, adminTickets, adminResolveTicket,
} from '../api'
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

function Tools({ account, onLogout }) {
  const [tab, setTab] = useState('overview')
  return (
    <div className="parent">
      <header className="parent-header">
        <div>
          <Link className="home-link" to="/">← Home</Link>
          <h1>Admin Console</h1>
          <p className="muted">Signed in as {account.name}</p>
        </div>
        <button className="ghost" onClick={onLogout}>Log out</button>
      </header>

      <div className="tabs">
        {['overview', 'users', 'settings', 'support'].map((t) => (
          <button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview />}
      {tab === 'users' && <Users />}
      {tab === 'settings' && <Settings />}
      {tab === 'support' && <Support />}
    </div>
  )
}

// SA08 — system health
function Overview() {
  const [s, setS] = useState(null)
  useEffect(() => { adminStats().then(setS) }, [])
  if (!s) return <p className="muted">Loading…</p>
  const tiles = [
    ['Users', s.users], ['Parents', s.parents], ['Children', s.children],
    ['Catalogue', s.content_total], ['Approved', s.content_approved], ['Pending', s.content_pending],
    ['Open reports', s.reports_open], ['Open tickets', s.tickets_open], ['Suspended', s.suspended],
  ]
  return (
    <section>
      <h2>System health</h2>
      <div className="stat-grid">
        {tiles.map(([label, val]) => (
          <div className="stat" key={label}>
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
function Users() {
  const [q, setQ] = useState('')
  const [users, setUsers] = useState([])
  const [details, setDetails] = useState({}) // id -> detail object

  async function search() { setUsers(await adminSearchUsers(q)) }
  useEffect(() => { search() }, [])

  async function showDetails(u) {
    if (details[u.id]) { const d = { ...details }; delete d[u.id]; setDetails(d); return }
    setDetails({ ...details, [u.id]: await adminUserDetails(u.id) })
  }
  async function reset(u) {
    const pw = prompt(`New password for ${u.email} (min 6 characters):`)
    if (!pw) return
    try { await adminResetPassword(u.id, pw); alert('Password has been reset.') } catch (e) { alert(e.message) }
  }
  async function toggleSuspend(u) {
    try {
      if (u.suspended) { await adminUnsuspend(u.id) }
      else { if (!confirm(`Suspend ${u.email}? They won't be able to log in.`)) return; await adminSuspend(u.id) }
      search()
    } catch (e) { alert(e.message) }
  }

  return (
    <section>
      <div className="row" style={{ marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email"
          onKeyDown={(e) => e.key === 'Enter' && search()} style={{ flex: 1 }} />
        <button onClick={search}>Search</button>
      </div>
      {users.map((u) => (
        <div className="card" key={u.id}>
          <div className="child-top">
            <div><h3>{u.name}</h3><p className="muted">{u.email} · role: {u.role}</p></div>
            <div className="row">
              {u.suspended && <span className="badge badge-rejected">suspended</span>}
              {u.verified && <span className="badge badge-approved">verified</span>}
            </div>
          </div>
          <div className="row">
            <button className="ghost small" onClick={() => showDetails(u)}>{details[u.id] ? 'Hide' : 'Details'}</button>
            <button className="ghost small" onClick={() => reset(u)}>Reset password</button>
            {u.role !== 'admin' && (
              <button className={u.suspended ? 'small' : 'danger small'} onClick={() => toggleSuspend(u)}>
                {u.suspended ? 'Unsuspend' : 'Suspend'}
              </button>
            )}
          </div>
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
    { name: 'monthly_price', label: 'Monthly price', type: 'number' },
    { name: 'billing_enabled', label: 'Billing enabled', type: 'bool' },
  ] },
]

function Settings() {
  return (
    <section>
      {CONFIG_SECTIONS.map((s) => <ConfigCard key={s.key} section={s} />)}
    </section>
  )
}

function ConfigCard({ section }) {
  const [values, setValues] = useState(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { adminGetConfig(section.key).then(setValues) }, [section.key])

  if (!values) return null
  function set(name, val) { setValues({ ...values, [name]: val }); setSaved(false) }
  async function save() { setValues(await adminSetConfig(section.key, values)); setSaved(true) }

  return (
    <div className="card">
      <h3>{section.title}</h3>
      {section.key === 'compliance' && (
        <div
          className="card"
          style={{
            margin: '0 0 8px', padding: 12,
            background: values.openai_zdr_status === 'confirmed' ? '#dcf6e8' : '#fdeef4',
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
        {saved && <span className="muted">Saved ✓</span>}
      </div>
    </div>
  )
}

// SA14 — escalated support tickets
function Support() {
  const [tix, setTix] = useState([])
  async function reload() { setTix(await adminTickets()) }
  useEffect(() => { reload() }, [])
  async function resolve(id) { await adminResolveTicket(id); reload() }

  return (
    <section>
      <h2>Support tickets ({tix.filter((t) => t.status === 'open').length} open)</h2>
      {tix.length === 0 && <p className="muted">No tickets.</p>}
      {tix.map((t) => (
        <div className="card" key={t.id}>
          <div className="child-top">
            <div><h3>{t.subject}</h3><p className="muted">From: {t.from_email}</p></div>
            <span className={`badge badge-${t.status === 'open' ? 'pending' : 'approved'}`}>{t.status}</span>
          </div>
          <p className="muted">{t.message}</p>
          {t.status === 'open' && (
            <div className="row"><button className="small" onClick={() => resolve(t.id)}>Mark resolved</button></div>
          )}
        </div>
      ))}
    </section>
  )
}
