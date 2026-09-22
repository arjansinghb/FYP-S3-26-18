import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getToken, getMe, login, logout,
  adminSearchUsers, adminUserDetails, adminResetPassword, adminSuspend, adminUnsuspend,
} from '../api'
import { LockIcon, SettingsIcon, UsersIcon } from '../icons'
import { useToast, ToastHost } from '../components/Toast'
import PromptDialog from '../components/PromptDialog'
import { firstMissingField } from '../formValidation'
import { timeAgo } from '../timeFormat'
import './parent.css'

// trimmed-demo branch: Admin console cut down to its core — user search,
// details, password reset, suspend/unsuspend (SA03-SA07). The Overview
// stats/Reviews moderation/Settings config/Support tickets tabs from the
// full prototype-real-integrations branch are deliberately not here.

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

function Tools({ account, onLogout }) {
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

      <h2><UsersIcon width={20} height={20} /> Users</h2>
      <Users notify={notify} />

      <ToastHost toast={toast} />
    </div>
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
