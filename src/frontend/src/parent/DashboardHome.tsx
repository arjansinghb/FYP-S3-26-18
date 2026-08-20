// PA07 (Create Child Profile) + children list (the dashboard's landing view)
// + PA32 (Multi-Child Comparative Insights, Premium).
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/http'
import * as parentApi from '../api/parentClient'
import ParentLayout from './ParentLayout'
import { useParentSession } from '../state/useParentSession'
import { getAvatar } from '../avatars'
import type { ChildInsight, ChildProfilePublic } from '../types'

export default function DashboardHome() {
  const { token, parent } = useParentSession()
  const navigate = useNavigate()
  const [children, setChildren] = useState<ChildProfilePublic[] | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    parentApi.listChildren(token).then(setChildren).catch(() => setChildren([]))
  }, [token])

  const limit = parent?.subscription_tier === 'premium' ? 4 : 1
  const atLimit = (children?.length ?? 0) >= limit

  return (
    <ParentLayout>
      <div className="dashboard-header">
        <h1>My Children</h1>
        {!atLimit && (
          <button className="big-button" onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Cancel' : '+ Add Child Profile'}
          </button>
        )}
      </div>

      {atLimit && (
        <p className="dashboard-note">
          {parent?.subscription_tier === 'free'
            ? "Free tier is limited to 1 child profile — Premium supports up to 4."
            : 'Premium child-profile limit (4) reached.'}
        </p>
      )}

      {showForm && (
        <CreateChildForm
          token={token!}
          onCreated={(created) => {
            setShowForm(false)
            // dev-session 2026-08-20 bug fix: land straight on the new
            // child's detail page (which now shows the Profile ID, see
            // ChildDetailPage.tsx) instead of just the list — a parent who
            // just created a profile has nowhere else to find the ID their
            // child needs to actually log in (CH01). Reported: "can't find
            // a way to log in to the child profile... says incorrect PIN"
            // — the PIN was never wrong, there was just no ID to give the
            // child in the first place.
            navigate(`/dashboard/children/${created.id}`)
          }}
          onError={setError}
        />
      )}
      {error && <p className="error-text">{error}</p>}

      {children === null && <p>Loading…</p>}
      {children !== null && children.length === 0 && !showForm && (
        <p className="dashboard-empty">No child profiles yet — add one to get started.</p>
      )}

      <div className="child-card-grid">
        {children?.map((child) => {
          const avatar = getAvatar(child.avatar_id)
          return (
            <Link to={`/dashboard/children/${child.id}`} className="child-card" key={child.id}>
              <div className="child-card-avatar" style={{ background: avatar.color }}>
                {avatar.icon}
              </div>
              <div className="child-card-name">{child.name}</div>
              <div className="child-card-meta">
                Age band {child.age_band} · {child.favourites_count} favourite(s)
              </div>
              <div className="child-card-cta">
                View details <span aria-hidden="true">→</span>
              </div>
            </Link>
          )
        })}
      </div>

      {children !== null && children.length > 1 && (
        <ComparativeInsights token={token!} isPremium={parent?.subscription_tier === 'premium'} />
      )}
    </ParentLayout>
  )
}

// PA32 — View Multi-Child Comparative Insights (Premium). Only worth showing
// once there's more than one child to compare.
function ComparativeInsights({ token, isPremium }: { token: string; isPremium: boolean }) {
  const [insights, setInsights] = useState<ChildInsight[] | null>(null)

  useEffect(() => {
    if (!isPremium) return
    parentApi.getComparativeInsights(token).then(setInsights).catch(() => setInsights([]))
  }, [token, isPremium])

  if (!isPremium) {
    return (
      <section className="dashboard-section">
        <h2>Compare children — PA32</h2>
        <div className="premium-lock">
          <p>Side-by-side activity comparison across child profiles is a Premium feature.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="dashboard-section">
      <h2>Compare children — PA32</h2>
      {insights === null && <p>Loading…</p>}
      {insights !== null && insights.length > 0 && (
        <table className="staff-table">
          <thead>
            <tr>
              <th>Child</th>
              <th>Total sessions</th>
              <th>Total favourites</th>
            </tr>
          </thead>
          <tbody>
            {insights.map((row) => (
              <tr key={row.child_id}>
                <td>{row.child_name}</td>
                <td>{row.total_sessions}</td>
                <td>{row.total_favourites}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function CreateChildForm({
  token,
  onCreated,
  onError,
}: {
  token: string
  onCreated: (created: ChildProfilePublic) => void
  onError: (msg: string | null) => void
}) {
  const [name, setName] = useState('')
  const [dob, setDob] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onError(null)
    if (!/^\d{6}$/.test(pin)) {
      onError('PIN must be exactly 6 digits.')
      return
    }
    setBusy(true)
    try {
      const created = await parentApi.createChild(token, { name, dob, pin })
      onCreated(created)
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Something went wrong — try again?')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="inline-form" onSubmit={handleSubmit}>
      <label>
        Child's name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Date of birth
        <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} required />
      </label>
      <label>
        6-digit PIN (they'll use this to log in)
        <input
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          required
        />
      </label>
      <button className="big-button" type="submit" disabled={busy}>
        {busy ? 'Creating…' : 'Create profile'}
      </button>
    </form>
  )
}
