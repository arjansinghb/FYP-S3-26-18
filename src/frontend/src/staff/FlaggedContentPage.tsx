// CM11 (Review Reported Content) + CM12 (Resolve Reported Content).
import { useEffect, useState } from 'react'
import { ApiError } from '../api/http'
import * as moderatorApi from '../api/moderatorClient'
import StaffLayout from './StaffLayout'
import { useStaffSession } from '../state/useStaffSession'
import type { Flag } from '../types'

export default function FlaggedContentPage() {
  const { token } = useStaffSession()
  const [flags, setFlags] = useState<Flag[]>([])
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    if (!token) return
    setFlags(await moderatorApi.getFlaggedContent(token, 'pending'))
  }

  useEffect(() => {
    refresh().catch(() => setError('Could not load flagged content.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function handleResolve(flag: Flag, resolution: 'approved' | 'removed') {
    if (!token) return
    const note = window.prompt('Resolution note (optional)') ?? undefined
    try {
      await moderatorApi.resolveFlag(token, flag.id, resolution, note)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resolve.')
    }
  }

  return (
    <StaffLayout>
      <h1>Flagged Content — CM11/CM12</h1>
      {error && <p className="error-text">{error}</p>}
      {flags.length === 0 && <p className="dashboard-empty">No pending flags — nice and quiet.</p>}
      {flags.map((flag) => (
        <div className="dashboard-section" key={flag.id}>
          <strong>{flag.catalogue_item_id ?? flag.message_id}</strong>
          <p className="dashboard-note">"{flag.reason}" — raised {new Date(flag.raised_at).toLocaleString()}</p>
          <div className="inline-form">
            <button className="big-button" onClick={() => handleResolve(flag, 'approved')}>
              ✅ Dismiss (content is fine)
            </button>
            <button className="danger-button" onClick={() => handleResolve(flag, 'removed')}>
              🗑️ Remove content
            </button>
          </div>
        </div>
      ))}
    </StaffLayout>
  )
}
