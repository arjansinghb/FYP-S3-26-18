import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getToken, getMe, login, logout,
  listContent, addContent, editContent, removeContent, approveContent, rejectContent,
  listReports, resolveReport,
} from '../api'
import './parent.css'

const AGE_BANDS = ['5-8', '9-12']

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

  return (
    <div className="parent auth">
      <Link className="home-link" to="/">← Home</Link>
      <h1>Moderator Sign In</h1>
      <form onSubmit={submit} className="card">
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Sign In'}</button>
      </form>
      <p className="muted">Demo login: <b>moderator@pip.local</b> / <b>moderator123</b></p>
    </div>
  )
}

function Tools({ account, onLogout }) {
  const [tab, setTab] = useState('submissions')
  return (
    <div className="parent">
      <header className="parent-header">
        <div>
          <Link className="home-link" to="/">← Home</Link>
          <h1>Moderator Console</h1>
          <p className="muted">Signed in as {account.name}</p>
        </div>
        <button className="ghost" onClick={onLogout}>Log out</button>
      </header>

      <div className="tabs">
        <button className={tab === 'submissions' ? 'tab active' : 'tab'} onClick={() => setTab('submissions')}>Submissions</button>
        <button className={tab === 'catalogue' ? 'tab active' : 'tab'} onClick={() => setTab('catalogue')}>Catalogue</button>
        <button className={tab === 'reports' ? 'tab active' : 'tab'} onClick={() => setTab('reports')}>Reports</button>
      </div>

      {tab === 'submissions' && <Submissions />}
      {tab === 'catalogue' && <Catalogue />}
      {tab === 'reports' && <Reports />}
    </div>
  )
}

// CM06/CM07/CM08 — review new submissions, approve or reject
function Submissions() {
  const [items, setItems] = useState([])
  async function reload() { setItems(await listContent({ status: 'pending' })) }
  useEffect(() => { reload() }, [])
  async function act(id, fn) { await fn(id); reload() }

  return (
    <section>
      <h2>New submissions ({items.length})</h2>
      {items.length === 0 && <p className="muted">Nothing waiting for review. 🎉</p>}
      {items.map((i) => (
        <div className="card" key={i.id}>
          <div className="child-top">
            <div><h3>{i.type === 'book' ? '📚' : '🎬'} {i.title}</h3><p className="muted">{i.description}</p></div>
            <span className="badge badge-pending">pending</span>
          </div>
          <p className="muted">Age: {i.age_bands.join(', ')} · Genres: {i.genres.join(', ') || '—'}</p>
          <div className="row">
            <button onClick={() => act(i.id, approveContent)}>Approve</button>
            <button className="danger" onClick={() => act(i.id, rejectContent)}>Reject</button>
          </div>
        </div>
      ))}
    </section>
  )
}

// CM13 browse + CM03 add + CM04 edit + CM05 remove (CM09/CM10 tags via the form)
function Catalogue() {
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)
  async function reload() { setItems(await listContent({})) }
  useEffect(() => { reload() }, [])

  return (
    <section>
      <AddEntry onAdded={reload} />
      <h2>Catalogue ({items.length})</h2>
      {items.map((i) => (
        editing === i.id ? (
          <EntryForm
            key={i.id}
            initial={i}
            onSave={async (payload) => { await editContent(i.id, payload); setEditing(null); reload() }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div className="card" key={i.id}>
            <div className="child-top">
              <div><h3>{i.type === 'book' ? '📚' : '🎬'} {i.title}</h3><p className="muted">{i.description}</p></div>
              <span className={`badge badge-${i.status}`}>{i.status}</span>
            </div>
            <p className="muted">Age: {i.age_bands.join(', ')} · Genres: {i.genres.join(', ') || '—'} · Level: {i.reading_level || '—'}</p>
            <div className="row">
              <button className="ghost small" onClick={() => setEditing(i.id)}>Edit</button>
              <button className="danger small" onClick={async () => { if (confirm('Remove this entry?')) { await removeContent(i.id); reload() } }}>Remove</button>
            </div>
          </div>
        )
      ))}
    </section>
  )
}

function AddEntry({ onAdded }) {
  const [open, setOpen] = useState(false)
  if (!open) return <button className="add-btn" onClick={() => setOpen(true)}>➕ Add catalogue entry</button>
  return <EntryForm isNew onSave={async (payload) => { await addContent(payload); setOpen(false); onAdded() }} onCancel={() => setOpen(false)} />
}

function EntryForm({ initial = {}, onSave, onCancel, isNew }) {
  const [type, setType] = useState(initial.type || 'book')
  const [title, setTitle] = useState(initial.title || '')
  const [description, setDescription] = useState(initial.description || '')
  const [bands, setBands] = useState(initial.age_bands || ['5-8'])
  const [genres, setGenres] = useState((initial.genres || []).join(', '))
  const [level, setLevel] = useState(initial.reading_level || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function toggleBand(b) {
    setBands(bands.includes(b) ? bands.filter((x) => x !== b) : [...bands, b])
  }

  async function submit(e) {
    e.preventDefault()
    if (bands.length === 0) { setError('Pick at least one age band'); return }
    setError(''); setBusy(true)
    const payload = {
      type, title, description,
      age_bands: bands,
      genres: genres.split(',').map((g) => g.trim()).filter(Boolean),
      reading_level: level || null,
    }
    try { await onSave(payload) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>{isNew ? 'New entry' : 'Edit entry'}</h3>
      <label>Type
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="book">Book</option>
          <option value="video">Video</option>
        </select>
      </label>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
      <label>Description<input value={description} onChange={(e) => setDescription(e.target.value)} required /></label>
      <div>
        <span className="muted">Age bands (CM09)</span>
        <div className="row">
          {AGE_BANDS.map((b) => (
            <label key={b} className="toggle">
              <input type="checkbox" checked={bands.includes(b)} onChange={() => toggleBand(b)} />{b}
            </label>
          ))}
        </div>
      </div>
      <label>Genres, comma-separated (CM10)<input value={genres} onChange={(e) => setGenres(e.target.value)} placeholder="funny, space" /></label>
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
function Reports() {
  const [items, setItems] = useState([])
  async function reload() { setItems(await listReports()) }
  useEffect(() => { reload() }, [])
  async function act(id, action) { await resolveReport(id, action); reload() }

  return (
    <section>
      <h2>Reported content ({items.length})</h2>
      {items.length === 0 && <p className="muted">No reports right now. 🎉</p>}
      {items.map((r) => (
        <div className="card" key={r.id}>
          <div className="child-top">
            <div><h3>{r.content_title}</h3><p className="muted">Reason: {r.reason}</p></div>
            <span className={`badge badge-${r.status === 'open' ? 'pending' : 'approved'}`}>{r.status}</span>
          </div>
          {r.status === 'open' && (
            <div className="row">
              <button className="ghost small" onClick={() => act(r.id, 'dismiss')}>Dismiss</button>
              <button className="danger small" onClick={() => act(r.id, 'remove')}>Remove content</button>
            </div>
          )}
        </div>
      ))}
    </section>
  )
}
