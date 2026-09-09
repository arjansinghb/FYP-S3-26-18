import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getToken, getMe, login, logout,
  listContent, addContent, editContent, removeContent, approveContent, rejectContent,
  listReports, resolveReport, searchBooks, searchVideos, importContent,
} from '../api'
import {
  BookIcon, CheckIcon, CloseIcon, EditIcon, FlagIcon, GridIcon, InboxIcon,
  PlusIcon, SearchIcon, TrashIcon, VideoIcon,
} from '../icons'
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

const TABS = [
  { key: 'submissions', label: 'Submissions', icon: InboxIcon },
  { key: 'catalogue', label: 'Catalogue', icon: GridIcon },
  { key: 'reports', label: 'Reports', icon: FlagIcon },
]

function Tools({ account, onLogout }) {
  const [tab, setTab] = useState('submissions')
  return (
    <div className="parent">
      <Link className="home-link" to="/">← Home</Link>
      <header className="parent-header">
        <div className="parent-header-who">
          <div className="parent-header-role"><GridIcon width={20} height={20} /></div>
          <div>
            <h1>Moderator Console</h1>
            <p className="muted">Signed in as {account.name}</p>
          </div>
        </div>
        <button className="ghost" onClick={onLogout}>Log out</button>
      </header>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'tab active' : 'tab'} onClick={() => setTab(t.key)}>
            <t.icon width={16} height={16} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'submissions' && <Submissions />}
      {tab === 'catalogue' && <Catalogue />}
      {tab === 'reports' && <Reports />}
    </div>
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
function SearchImport({ onImported }) {
  const [type, setType] = useState('book')
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(null) // the search result being turned into a real entry

  async function search(e) {
    e.preventDefault()
    if (!q.trim()) return
    setBusy(true); setError('')
    try {
      setResults(type === 'book' ? await searchBooks(q) : await searchVideos(q))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Picking a result opens the same EntryForm used everywhere else,
  // pre-filled from the real search data — the moderator still has to
  // pick age bands/genres themselves (CM09/CM10), never auto-assigned.
  if (importing) {
    return (
      <EntryForm
        isNew
        initial={{
          type,
          title: importing.title,
          description: importing.description,
          thumbnail: importing.thumbnail,
          external_ref: importing.external_ref,
          age_bands: [],
          genres: [],
          source: type === 'book' ? 'google_books' : 'youtube',
        }}
        onSave={async (payload) => {
          await importContent(payload)
          setImporting(null); setResults(null); setQ('')
          onImported()
        }}
        onCancel={() => setImporting(null)}
      />
    )
  }

  return (
    <section>
      <h2><SearchIcon width={20} height={20} /> Search &amp; import (CM03)</h2>
      <form className="row" onSubmit={search}>
        <select value={type} onChange={(e) => { setType(e.target.value); setResults(null) }}>
          <option value="book">Books</option>
          <option value="video">Videos</option>
        </select>
        <input
          type="search"
          placeholder={`Search Google Books/YouTube for ${type}s…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: '1 1 220px' }}
        />
        <button type="submit" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
      </form>
      {error && <p className="error">{error}</p>}
      {results && results.length === 0 && !error && (
        <p className="muted">No results — try a different search, or check the {type === 'book' ? 'Google Books' : 'YouTube Data'} API key is configured.</p>
      )}
      {results && results.length > 0 && (
        <div className="search-results">
          {results.map((r) => (
            <div className="search-result" key={r.external_id}>
              {r.thumbnail ? (
                <img className="search-result-cover" src={r.thumbnail} alt="" />
              ) : (
                <div className="search-result-cover search-result-cover-empty"><TypeIcon type={type} /></div>
              )}
              <div className="search-result-body">
                <h4>{r.title}</h4>
                <p className="muted">{truncate(r.description, 150)}</p>
                {type === 'video' && r.channel && <p className="muted">Channel: {r.channel}</p>}
                <button className="small" onClick={() => setImporting(r)}><PlusIcon width={14} height={14} /> Import for review</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
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
      <SearchImport onImported={reload} />
      <h2><InboxIcon width={20} height={20} /> New submissions ({items.length})</h2>
      {items.length === 0 && (
        <p className="empty-state"><CheckIcon width={18} height={18} /> Nothing waiting for review — you're all caught up.</p>
      )}
      {items.map((i) => (
        <div className="card" key={i.id}>
          <div className="child-top">
            <div className="item-with-thumb">
              {i.thumbnail && <img className={`item-thumb item-thumb--${i.type}`} src={i.thumbnail} alt="" />}
              <div>
                <h3 className="item-title"><TypeIcon type={i.type} /> {i.title}</h3>
                <p className="muted">{i.description}</p>
              </div>
            </div>
            <span className="badge badge-pending">pending</span>
          </div>
          <p className="muted">Age: {i.age_bands.join(', ')} · Genres: {i.genres.join(', ') || '—'}</p>
          <div className="row">
            <button className="success" onClick={() => act(i.id, approveContent)}><CheckIcon width={16} height={16} /> Approve</button>
            <button className="danger" onClick={() => act(i.id, rejectContent)}><CloseIcon width={16} height={16} /> Reject</button>
          </div>
        </div>
      ))}
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
function truncate(text, max = 140) {
  if (!text || text.length <= max) return text
  return text.slice(0, max).trimEnd() + '…'
}

function Catalogue() {
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  async function reload(overrides = {}) {
    const params = {}
    const query = overrides.q ?? q
    const type = overrides.typeFilter ?? typeFilter
    const status = overrides.statusFilter ?? statusFilter
    if (query.trim()) params.q = query.trim()
    if (type) params.type = type
    if (status) params.status = status
    setItems(await listContent(params))
  }
  useEffect(() => { reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced — a real API call per keystroke would be chatty; 300ms feels
  // instant to type against without firing on every letter.
  useEffect(() => {
    const id = setTimeout(() => reload(), 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, typeFilter, statusFilter])

  return (
    <section>
      <AddEntry onAdded={reload} />
      <h2><GridIcon width={20} height={20} /> Catalogue ({items.length})</h2>

      <div className="row" style={{ marginBottom: 12 }}>
        <input
          type="search"
          placeholder="Search title or description…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: '1 1 220px' }}
        />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          <option value="book">Books</option>
          <option value="video">Videos</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {items.length === 0 && <p className="muted">No catalogue items match that search.</p>}

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
              <div className="item-with-thumb">
                {i.thumbnail && <img className={`item-thumb item-thumb--${i.type}`} src={i.thumbnail} alt="" />}
                <div>
                  <h3 className="item-title"><TypeIcon type={i.type} /> {i.title}</h3>
                  <p className="muted">{truncate(i.description)}</p>
                </div>
              </div>
              <span className={`badge badge-${i.status}`}>{i.status}</span>
            </div>
            <p className="muted">Age: {i.age_bands.join(', ')} · Genres: {i.genres.join(', ') || '—'} · Level: {i.reading_level || '—'}</p>
            <div className="row">
              <button className="ghost small" onClick={() => setEditing(i.id)}><EditIcon width={15} height={15} /> Edit</button>
              <button className="danger small" onClick={async () => { if (confirm('Remove this entry?')) { await removeContent(i.id); reload() } }}>
                <TrashIcon width={15} height={15} /> Remove
              </button>
            </div>
          </div>
        )
      ))}
    </section>
  )
}

function AddEntry({ onAdded }) {
  const [open, setOpen] = useState(false)
  if (!open) return <button className="add-btn" onClick={() => setOpen(true)}><PlusIcon width={16} height={16} /> Add catalogue entry</button>
  return <EntryForm isNew onSave={async (payload) => { await addContent(payload); setOpen(false); onAdded() }} onCancel={() => setOpen(false)} />
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
      <label>Cover image URL<input value={thumbnail} onChange={(e) => setThumbnail(e.target.value)} placeholder="https://…" /></label>
      <label>{type === 'video' ? 'YouTube video ID (CH12 — what actually plays)' : 'External link (e.g. a library/store page, PA19)'}
        <input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} placeholder={type === 'video' ? 'dQw4w9WgXcQ' : 'https://…'} />
      </label>
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
      <h2><FlagIcon width={20} height={20} /> Reported content ({items.length})</h2>
      {items.length === 0 && (
        <p className="empty-state"><CheckIcon width={18} height={18} /> No reports right now.</p>
      )}
      {items.map((r) => (
        <div className="card" key={r.id}>
          <div className="child-top">
            <div><h3 className="item-title">{r.content_title}</h3><p className="muted">Reason: {r.reason}</p></div>
            <span className={`badge badge-${r.status === 'open' ? 'pending' : 'approved'}`}>{r.status}</span>
          </div>
          {r.status === 'open' && (
            <div className="row">
              <button className="ghost small" onClick={() => act(r.id, 'dismiss')}>Dismiss</button>
              <button className="danger small" onClick={() => act(r.id, 'remove')}><TrashIcon width={15} height={15} /> Remove content</button>
            </div>
          )}
        </div>
      ))}
    </section>
  )
}
