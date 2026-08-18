// CM03 — Add Catalogue Entry, sourced from Google Books / YouTube Data API
// search (see src/backend/app/services/content_source_service.py).
import { useState } from 'react'
import { ApiError } from '../api/http'
import * as moderatorApi from '../api/moderatorClient'
import StaffLayout from './StaffLayout'
import { useStaffSession } from '../state/useStaffSession'
import type { ContentSearchResult, ContentType } from '../types'

export default function SearchImportPage() {
  const { token } = useStaffSession()
  const [type, setType] = useState<ContentType>('book')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ContentSearchResult[]>([])
  const [imported, setImported] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSearch() {
    if (!token || !query.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = type === 'book' ? await moderatorApi.searchBooks(token, query) : await moderatorApi.searchVideos(token, query)
      setResults(res)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Search failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleImport(r: ContentSearchResult) {
    if (!token) return
    try {
      await moderatorApi.importContent(token, {
        external_id: r.external_id,
        type,
        title: r.title,
        synopsis: r.synopsis,
        source_url: r.source_url,
      })
      setImported((prev) => new Set(prev).add(r.external_id))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed.')
    }
  }

  return (
    <StaffLayout>
      <h1>Find Content — CM03</h1>
      <p className="dashboard-note">
        Google Books / YouTube search results are candidates only — importing puts them in the pendingReview queue,
        it does not approve them.
      </p>

      <div className="inline-form">
        <label>
          Source
          <select value={type} onChange={(e) => setType(e.target.value as ContentType)}>
            <option value="book">Google Books</option>
            <option value="video">YouTube</option>
          </select>
        </label>
        <label>
          Search
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
        </label>
        <button className="big-button" onClick={handleSearch} disabled={busy}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="child-card-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {results.map((r) => (
          <div className="dashboard-section" key={r.external_id} style={{ textAlign: 'left' }}>
            {r.thumbnail && <img src={r.thumbnail} alt="" style={{ maxWidth: '100%', borderRadius: 8 }} />}
            <strong>{r.title}</strong>
            <p className="dashboard-note">{r.extra}</p>
            <p className="dashboard-note">{r.synopsis.slice(0, 140)}{r.synopsis.length > 140 ? '…' : ''}</p>
            <button className="big-button" onClick={() => handleImport(r)} disabled={imported.has(r.external_id)}>
              {imported.has(r.external_id) ? '✅ Imported' : '+ Import'}
            </button>
          </div>
        ))}
      </div>
    </StaffLayout>
  )
}
