import { useEffect, useRef, useState } from 'react'
import { browseCategories, browseForYou, browseItems } from '../api'
import { curateTitle } from '../curate'
import { iconForGenre } from './genreIcons'
import { BookIcon, HeartIcon, PlayIcon, VideoIcon } from '../icons'

const TONES = ['purple', 'blue', 'teal', 'orange', 'pink']

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// A second, equal way into the catalogue next to "Ask Pip". Deliberately no
// search box: the chatbot already is the search, and leaving it out keeps
// the two modes genuinely different. Everything shown comes from the same
// filtered catalogue Pip itself picks from.
export default function BrowseView({ savedIds, onSave, onDetails, onWatch }) {
  const [type, setType] = useState('book')
  const [categories, setCategories] = useState([])
  const [forYou, setForYou] = useState([])
  const [genre, setGenre] = useState(null)
  const [items, setItems] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const resultsRef = useRef(null)
  const requestRef = useRef(0)

  useEffect(() => {
    const id = ++requestRef.current
    setLoading(true)
    setFailed(false)
    setGenre(null)
    setItems([])
    Promise.all([browseCategories(type), browseForYou(type)])
      .then(([cats, fy]) => { if (id === requestRef.current) { setCategories(cats); setForYou(fy) } })
      .catch(() => { if (id === requestRef.current) setFailed(true) })
      .finally(() => { if (id === requestRef.current) setLoading(false) })
  }, [type])

  async function pick(g) {
    if (genre === g) { setGenre(null); setItems([]); return }
    const id = ++requestRef.current
    setGenre(g)
    try {
      const page = await browseItems({ genre: g, type })
      if (id !== requestRef.current) return
      setItems(page.items)
      setHasMore(page.has_more)
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } catch {
      if (id === requestRef.current) setFailed(true)
    }
  }

  async function showMore() {
    try {
      const page = await browseItems({ genre, type, offset: items.length })
      setItems((prev) => [...prev, ...page.items])
      setHasMore(page.has_more)
    } catch { /* keep what is already on screen */ }
  }

  return (
    <div className="browse-view">
      <div className="browse-head">
        <h2>Browse</h2>
        <div className="type-toggle" role="group" aria-label="Books or videos">
          <button type="button" aria-pressed={type === 'book'} className={type === 'book' ? 'on' : ''} onClick={() => setType('book')}>
            <BookIcon width={16} height={16} /> Books
          </button>
          <button type="button" aria-pressed={type === 'video'} className={type === 'video' ? 'on' : ''} onClick={() => setType('video')}>
            <VideoIcon width={16} height={16} /> Videos
          </button>
        </div>
      </div>

      {failed && <p className="muted">Pip couldn't load this right now. Try again in a moment.</p>}
      {loading && !failed && <p className="muted">Looking through the shelves…</p>}

      {!loading && forYou.length > 0 && (
        <section className="browse-section">
          <h3>For you</h3>
          <div className="browse-row">
            {forYou.map((item) => (
              <BrowseCard key={item.id} item={item} saved={savedIds.has(item.id)} onSave={onSave} onDetails={onDetails} onWatch={onWatch} />
            ))}
          </div>
        </section>
      )}

      {!loading && !failed && categories.length === 0 && (
        <p className="muted">Nothing to browse here yet. Try asking Pip!</p>
      )}

      {!loading && categories.length > 0 && (
        <section className="browse-section">
          <h3>Pick a topic</h3>
          <div className="category-grid">
            {categories.map((c, i) => {
              const Icon = iconForGenre(c.genre)
              return (
                <button
                  key={c.genre}
                  type="button"
                  className={`category-tile category-tile--${TONES[i % TONES.length]} ${genre === c.genre ? 'category-tile--on' : ''}`}
                  aria-pressed={genre === c.genre}
                  onClick={() => pick(c.genre)}
                >
                  <Icon width={26} height={26} />
                  <span className="category-name">{cap(c.genre)}</span>
                  <span className="category-count">{c.count}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {genre && (
        <section className="browse-section" ref={resultsRef}>
          <h3>{cap(genre)} {type === 'book' ? 'books' : 'videos'}</h3>
          <div className="library-grid">
            {items.map((item) => (
              <BrowseCard key={item.id} item={item} saved={savedIds.has(item.id)} onSave={onSave} onDetails={onDetails} onWatch={onWatch} />
            ))}
          </div>
          {hasMore && (
            <div className="browse-more"><button type="button" className="pill" onClick={showMore}>Show more</button></div>
          )}
        </section>
      )}
    </div>
  )
}

function BrowseCard({ item, saved, onSave, onDetails, onWatch }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true)
    setError('')
    try { await onSave(item) } catch (err) { setError(err?.message || "Couldn't save that. Try again?") } finally { setSaving(false) }
  }

  return (
    <div className="library-card browse-card">
      {item.thumbnail ? (
        <img className="library-cover" src={item.thumbnail} alt="" loading="lazy" />
      ) : (
        <div className="library-cover library-cover-empty">
          {item.type === 'book' ? <BookIcon width={26} height={26} /> : <VideoIcon width={26} height={26} />}
        </div>
      )}
      <div className="library-card-body">
        <p className="library-card-title">
          {item.type === 'book' ? <BookIcon width={13} height={13} /> : <VideoIcon width={13} height={13} />}
          {curateTitle(item.title)}
        </p>
        {item.genres?.length > 0 && (
          <div className="rec-tags">{item.genres.slice(0, 2).map((g) => <span className="rec-tag" key={g}>{g}</span>)}</div>
        )}
        <div className="library-card-actions browse-actions">
          <button type="button" className="library-card-action" onClick={() => onDetails(item)}>Details</button>
          {item.type === 'video' && (
            <button type="button" className="library-card-action" onClick={() => onWatch(item)}><PlayIcon width={14} height={14} /> Watch</button>
          )}
          <button type="button" className={`library-card-action ${saved ? 'library-card-action--on' : ''}`} onClick={save} disabled={saving || saved}>
            <HeartIcon width={14} height={14} filled={saved} /> {saved ? 'Saved' : saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {error && <p className="rec-error">{error}</p>}
      </div>
    </div>
  )
}
