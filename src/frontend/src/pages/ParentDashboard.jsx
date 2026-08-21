import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getToken, getMe, login, signup, logout,
  updateAccount, deleteAccount,
  listChildren, createChild, updateChild, deleteChild, updateChildSettings,
  childActivity, childFavourites, reportContent,
} from '../api'
import './parent.css'

export default function ParentDashboard() {
  const [account, setAccount] = useState(null)
  const [checking, setChecking] = useState(true)

  // Restore an existing session on load.
  useEffect(() => {
    if (!getToken()) { setChecking(false); return }
    getMe().then(setAccount).catch(() => {}).finally(() => setChecking(false))
  }, [])

  function handleDeleted() {
    logout()
    setAccount(null)
  }

  if (checking) return <div className="parent"><p className="muted">Loading…</p></div>
  if (!account) return <AuthPanel onAuthed={setAccount} />
  return (
    <Dashboard
      account={account}
      onAccountUpdated={setAccount}
      onDeleted={handleDeleted}
      onLogout={() => { logout(); setAccount(null) }}
    />
  )
}

// ---------- login / sign up ----------

function AuthPanel({ onAuthed }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      const acc = mode === 'login'
        ? await login(email, password)
        : await signup(email, password, name)
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
      <h1>Parent {mode === 'login' ? 'Sign In' : 'Sign Up'}</h1>
      <form onSubmit={submit} className="card">
        {mode === 'signup' && (
          <label>Your name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        )}
        <label>Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
        </button>
      </form>
      <p className="muted">
        {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
        <button className="linkbtn" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError('') }}>
          {mode === 'login' ? 'Sign up' : 'Sign in'}
        </button>
      </p>
    </div>
  )
}

// ---------- dashboard ----------

function Dashboard({ account, onAccountUpdated, onDeleted, onLogout }) {
  const [children, setChildren] = useState([])
  const [error, setError] = useState('')

  async function reload() {
    try { setChildren(await listChildren()) } catch (err) { setError(err.message) }
  }
  useEffect(() => { reload() }, [])

  return (
    <div className="parent">
      <header className="parent-header">
        <div>
          <Link className="home-link" to="/">← Home</Link>
          <h1>Parent Dashboard</h1>
          <p className="muted">Signed in as {account.name} ({account.email})</p>
        </div>
        <button className="ghost" onClick={onLogout}>Log out</button>
      </header>

      {error && <p className="error">{error}</p>}

      <AccountPanel account={account} onUpdated={onAccountUpdated} onDeleted={onDeleted} />

      <AddChild onAdded={reload} />

      <h2>Your children ({children.length})</h2>
      {children.length === 0 && <p className="muted">No child profiles yet. Add one above.</p>}
      <div className="child-grid">
        {children.map((c) => (
          <ChildCard key={c.id} child={c} onChanged={reload} />
        ))}
      </div>
    </div>
  )
}

// ---------- account: view / edit / delete (PA04/PA05/PA06) ----------

function AccountPanel({ account, onUpdated, onDeleted }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(account.name)
  const [email, setEmail] = useState(account.email)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e) {
    e.preventDefault()
    setError(''); setBusy(true)
    const payload = { name, email }
    if (password) payload.password = password
    try {
      const updated = await updateAccount(payload)
      onUpdated(updated)
      setPassword('')
      setEditing(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm('Delete your account? This permanently removes your profile and ALL your child profiles and their data. This cannot be undone.')) return
    await deleteAccount()
    onDeleted()
  }

  return (
    <section className="card">
      <div className="child-top">
        <h3>My account</h3>
        {!editing && <button className="ghost small" onClick={() => setEditing(true)}>Edit</button>}
      </div>

      {!editing ? (
        <>
          <p className="muted">Name: <b>{account.name}</b></p>
          <p className="muted">Email: <b>{account.email}</b></p>
          <div className="row">
            <button className="danger small" onClick={remove}>Delete account</button>
          </div>
        </>
      ) : (
        <form onSubmit={save}>
          <label>Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>New password (leave blank to keep current)
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
            <button type="button" className="ghost" onClick={() => { setEditing(false); setName(account.name); setEmail(account.email); setPassword(''); setError('') }}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  )
}

function AddChild({ onAdded }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [ageBand, setAgeBand] = useState('5-8')
  const [readingLevel, setReadingLevel] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      await createChild({ name, age_band: ageBand, reading_level: readingLevel || null, pin })
      setName(''); setReadingLevel(''); setPin(''); setAgeBand('5-8'); setOpen(false)
      onAdded()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return <button className="add-btn" onClick={() => setOpen(true)}>➕ Add a child profile</button>

  return (
    <form onSubmit={submit} className="card">
      <h3>New child profile</h3>
      <label>Child's name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>Age band
        <select value={ageBand} onChange={(e) => setAgeBand(e.target.value)}>
          <option value="5-8">5–8</option>
          <option value="9-12">9–12</option>
        </select>
      </label>
      <label>Reading level (optional)
        <input value={readingLevel} onChange={(e) => setReadingLevel(e.target.value)} placeholder="e.g. early, middle" />
      </label>
      <label>PIN (4–6 digits, the child uses this to log in)
        <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} required minLength={4} maxLength={6} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create profile'}</button>
        <button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  )
}

function ChildCard({ child, onChanged }) {
  const [view, setView] = useState(null) // 'activity' | 'favourites' | 'edit' | 'safety' | null
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)

  async function toggle(which) {
    if (view === which) { setView(null); return }
    setView(which)
    if (which === 'activity' || which === 'favourites') {
      setLoading(true)
      try {
        setData(which === 'activity' ? await childActivity(child.id) : await childFavourites(child.id))
      } catch {
        setData([])
      } finally {
        setLoading(false)
      }
    }
  }

  async function remove() {
    if (!confirm(`Delete ${child.name}'s profile? This cannot be undone.`)) return
    await deleteChild(child.id)
    onChanged()
  }

  async function report(item) {
    const reason = prompt(`Why are you reporting "${item.title}"?`)
    if (!reason) return
    await reportContent(child.id, item.id, reason)
    alert('Thanks — this has been reported to the moderators.')
  }

  return (
    <div className="child-card">
      <div className="child-top">
        <div>
          <h3>{child.name}</h3>
          <p className="muted">Age {child.age_band}{child.reading_level ? ` · ${child.reading_level}` : ''}</p>
        </div>
        <button className="ghost small" onClick={remove}>Delete</button>
      </div>

      <div className="linking">
        <span className="muted">Linking code (give to your child):</span>
        <code className="code">{child.linking_code}</code>
      </div>

      <div className="row">
        <button className="small" onClick={() => toggle('activity')}>Activity</button>
        <button className="small" onClick={() => toggle('favourites')}>Favourites</button>
        <button className="small ghost" onClick={() => toggle('edit')}>Edit</button>
        <button className="small ghost" onClick={() => toggle('safety')}>Safety</button>
      </div>

      {view === 'edit' && <EditChild child={child} onDone={() => { setView(null); onChanged() }} />}
      {view === 'safety' && <SafetySettings child={child} onDone={() => { setView(null); onChanged() }} />}

      {(view === 'activity' || view === 'favourites') && (
        <div className="panel">
          {loading && <p className="muted">Loading…</p>}
          {!loading && data.length === 0 && <p className="muted">Nothing here yet.</p>}

          {!loading && view === 'activity' && data.map((a, i) => (
            <div key={i} className="activity-item">
              <p className="said-child">🧒 {a.message}</p>
              <p className="said-pip">🤖 {a.reply}</p>
              <p className="ts">{new Date(a.ts * 1000).toLocaleString()}</p>
            </div>
          ))}

          {!loading && view === 'favourites' && data.map((f) => (
            <div key={f.id} className="fav-item">
              <span>{f.type === 'book' ? '📚' : '🎬'} {f.title}</span>
              <button className="ghost small" onClick={() => report(f)}>Report</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// PA08 — Edit Child Profile
function EditChild({ child, onDone }) {
  const [name, setName] = useState(child.name)
  const [ageBand, setAgeBand] = useState(child.age_band)
  const [readingLevel, setReadingLevel] = useState(child.reading_level || '')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(e) {
    e.preventDefault()
    setError(''); setBusy(true)
    const payload = { name, age_band: ageBand, reading_level: readingLevel || null }
    if (pin) payload.pin = pin
    try {
      await updateChild(child.id, payload)
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="panel" onSubmit={save}>
      <label>Name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>Age band
        <select value={ageBand} onChange={(e) => setAgeBand(e.target.value)}>
          <option value="5-8">5–8</option>
          <option value="9-12">9–12</option>
        </select>
      </label>
      <label>Reading level
        <input value={readingLevel} onChange={(e) => setReadingLevel(e.target.value)} placeholder="e.g. early, middle" />
      </label>
      <label>New PIN (leave blank to keep current)
        <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} minLength={4} maxLength={6} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  )
}

// PA21 — Adjust Safety Settings
function SafetySettings({ child, onDone }) {
  const s = child.settings || {}
  const [allowBooks, setAllowBooks] = useState(s.allow_books ?? true)
  const [allowVideos, setAllowVideos] = useState(s.allow_videos ?? true)
  const [blockExternal, setBlockExternal] = useState(s.block_external_links ?? true)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await updateChildSettings(child.id, {
        allow_books: allowBooks,
        allow_videos: allowVideos,
        block_external_links: blockExternal,
      })
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <label className="toggle">
        <input type="checkbox" checked={allowBooks} onChange={(e) => setAllowBooks(e.target.checked)} />
        Allow book recommendations
      </label>
      <label className="toggle">
        <input type="checkbox" checked={allowVideos} onChange={(e) => setAllowVideos(e.target.checked)} />
        Allow video recommendations
      </label>
      <label className="toggle">
        <input type="checkbox" checked={blockExternal} onChange={(e) => setBlockExternal(e.target.checked)} />
        Block links that leave the app (recommended)
      </label>
      <div className="row">
        <button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
      </div>
    </div>
  )
}
