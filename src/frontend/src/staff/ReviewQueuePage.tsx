// CM06 (Review New Content Submission) -> CM07/CM08 (Approve/Reject) -> if
// approved, CM09 (Age-Band Tag) + CM10 (Metadata) — shown as two sections
// since they're sequential stages of the same pipeline.
import { useEffect, useState } from 'react'
import { ApiError } from '../api/http'
import * as moderatorApi from '../api/moderatorClient'
import StaffLayout from './StaffLayout'
import { useStaffSession } from '../state/useStaffSession'
import type { AgeBand, CatalogueItemFull } from '../types'

export default function ReviewQueuePage() {
  const { token } = useStaffSession()
  const [items, setItems] = useState<CatalogueItemFull[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    if (!token) return
    const [queue, all] = await Promise.all([
      moderatorApi.getQueue(token),
      moderatorApi.browseCatalogue(token, { statusFilter: 'pendingTagging' }),
    ])
    setItems([...queue, ...all])
  }

  useEffect(() => {
    refresh().catch(() => setError('Could not load the review queue.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const pendingReview = items?.filter((i) => i.status === 'pendingReview') ?? []
  const pendingTagging = items?.filter((i) => i.status === 'pendingTagging') ?? []

  async function guarded(fn: () => Promise<void>) {
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    }
  }

  return (
    <StaffLayout>
      <h1>Review Queue</h1>
      {error && <p className="error-text">{error}</p>}

      <section className="dashboard-section">
        <h2>CM06 — New submissions ({pendingReview.length})</h2>
        {pendingReview.length === 0 && <p className="dashboard-empty">Nothing waiting for review.</p>}
        {pendingReview.map((item) => (
          <ReviewCard
            key={item.id}
            item={item}
            onApprove={() => guarded(async () => void (await moderatorApi.approveContent(token!, item.id)))}
            onReject={(reason) => guarded(async () => void (await moderatorApi.rejectContent(token!, item.id, reason)))}
          />
        ))}
      </section>

      <section className="dashboard-section">
        <h2>CM09/CM10 — Pending tagging ({pendingTagging.length})</h2>
        {pendingTagging.length === 0 && <p className="dashboard-empty">Nothing waiting for tagging.</p>}
        {pendingTagging.map((item) => (
          <TaggingCard key={item.id} item={item} token={token!} onDone={() => guarded(async () => {})} />
        ))}
      </section>
    </StaffLayout>
  )
}

function ReviewCard({
  item,
  onApprove,
  onReject,
}: {
  item: CatalogueItemFull
  onApprove: () => void
  onReject: (reason: string) => void
}) {
  return (
    <div className="dashboard-section dashboard-section--flat">
      <strong>{item.title}</strong> <span className="dashboard-note">({item.type})</span>
      <p className="dashboard-note">{item.synopsis.slice(0, 240)}{item.synopsis.length > 240 ? '…' : ''}</p>
      <div className="inline-form">
        <button className="big-button" onClick={onApprove}>
          ✅ Approve
        </button>
        <button
          className="danger-button"
          onClick={() => {
            const reason = window.prompt('Reason for rejecting?')
            if (reason) onReject(reason)
          }}
        >
          ❌ Reject
        </button>
      </div>
    </div>
  )
}

function TaggingCard({ item, token, onDone }: { item: CatalogueItemFull; token: string; onDone: () => void }) {
  const [ageBands, setAgeBands] = useState<AgeBand[]>(item.age_bands)
  const [genre, setGenre] = useState(item.genre ?? '')
  const [topics, setTopics] = useState(item.topics.join(', '))
  const [readingLevel, setReadingLevel] = useState(item.reading_level ?? '')
  const [busy, setBusy] = useState(false)

  function toggleAgeBand(band: AgeBand) {
    setAgeBands((prev) => (prev.includes(band) ? prev.filter((b) => b !== band) : [...prev, band]))
  }

  async function handleSave() {
    setBusy(true)
    try {
      if (ageBands.length > 0) await moderatorApi.applyAgeBandTag(token, item.id, ageBands)
      if (genre || topics || readingLevel) {
        await moderatorApi.applyMetadata(token, item.id, {
          genre: genre || undefined,
          topics: topics ? topics.split(',').map((t) => t.trim()).filter(Boolean) : [],
          reading_level: readingLevel || undefined,
        })
      }
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dashboard-section dashboard-section--flat">
      <strong>{item.title}</strong> <span className="dashboard-note">({item.type})</span>
      <div className="inline-form">
        <label>
          Age bands
          <span>
            <label style={{ display: 'inline-flex', gap: 4, fontWeight: 400 }}>
              <input type="checkbox" checked={ageBands.includes('5-8')} onChange={() => toggleAgeBand('5-8')} /> 5-8
            </label>{' '}
            <label style={{ display: 'inline-flex', gap: 4, fontWeight: 400 }}>
              <input type="checkbox" checked={ageBands.includes('9-12')} onChange={() => toggleAgeBand('9-12')} /> 9-12
            </label>
          </span>
        </label>
        <label>
          Genre
          <input value={genre} onChange={(e) => setGenre(e.target.value)} />
        </label>
        <label>
          Topics (comma-separated)
          <input value={topics} onChange={(e) => setTopics(e.target.value)} />
        </label>
        <label>
          Reading level
          <input value={readingLevel} onChange={(e) => setReadingLevel(e.target.value)} />
        </label>
        <button className="big-button" onClick={handleSave} disabled={busy}>
          Save tags {ageBands.length > 0 && (genre || topics) ? '(will go live)' : ''}
        </button>
      </div>
    </div>
  )
}
