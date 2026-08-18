// CM13 (Browse Content Database) + CM04 (Edit) + CM05 (Remove).
import { useEffect, useState } from 'react'
import { ApiError } from '../api/http'
import * as moderatorApi from '../api/moderatorClient'
import StaffLayout from './StaffLayout'
import { useStaffSession } from '../state/useStaffSession'
import type { CatalogueItemFull, CatalogueStatus } from '../types'

const STATUS_OPTIONS = ['', 'pendingReview', 'pendingTagging', 'live', 'rejected', 'removed']

const STATUS_BADGE_VARIANT: Record<CatalogueStatus, string> = {
  pendingReview: 'status-badge--warning',
  pendingTagging: 'status-badge--info',
  live: 'status-badge--success',
  rejected: 'status-badge--danger',
  removed: 'status-badge--neutral',
}

export default function CataloguePage() {
  const { token } = useStaffSession()
  const [items, setItems] = useState<CatalogueItemFull[]>([])
  const [statusFilter, setStatusFilter] = useState('')
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    if (!token) return
    setItems(await moderatorApi.browseCatalogue(token, { statusFilter: statusFilter || undefined, q: q || undefined }))
  }

  useEffect(() => {
    refresh().catch(() => setError('Could not load the catalogue.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function handleRemove(id: string) {
    if (!token || !window.confirm('Remove this item from the catalogue?')) return
    try {
      await moderatorApi.removeCatalogueEntry(token, id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove.')
    }
  }

  return (
    <StaffLayout>
      <h1>Catalogue — CM13</h1>
      <div className="inline-form">
        <label>
          Status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s || 'All'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title contains
          <input value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button className="big-button" onClick={refresh}>
          Filter
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      <table className="staff-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Type</th>
            <th>Status</th>
            <th>Age bands</th>
            <th>Genre</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.title}</td>
              <td>{item.type}</td>
              <td>
                <span className={`status-badge ${STATUS_BADGE_VARIANT[item.status]}`}>{item.status}</span>
              </td>
              <td>{item.age_bands.join(', ')}</td>
              <td>{item.genre ?? '—'}</td>
              <td>
                {item.status !== 'removed' && (
                  <button className="table-btn table-btn--danger" onClick={() => handleRemove(item.id)}>
                    🗑️ Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && <p className="dashboard-empty">No items match this filter.</p>}
    </StaffLayout>
  )
}
