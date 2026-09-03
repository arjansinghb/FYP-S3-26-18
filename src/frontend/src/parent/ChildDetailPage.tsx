// Per-child dashboard detail — PA08/09/10/13 (profile management), PA14
// (activity), PA15 (favourites), PA16/17 (flag content + status), PA18
// (content overrides), PA21 (safety settings), PA30 (data deletion request),
// PA31 (activity trends, Premium).
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../api/http'
import * as parentApi from '../api/parentClient'
import ParentLayout from './ParentLayout'
import Toggle from './Toggle'
import { useParentSession } from '../state/useParentSession'
import { AVATARS, getAvatar } from '../avatars'
import type {
  ActivityTrends,
  AgeBand,
  ChildProfilePublic,
  ContentOverride,
  Favourite,
  Flag,
  SessionWithMessages,
} from '../types'

export default function ChildDetailPage() {
  const { childId } = useParams<{ childId: string }>()
  const { token, parent } = useParentSession()
  const navigate = useNavigate()

  const [child, setChild] = useState<ChildProfilePublic | null>(null)
  const [activity, setActivity] = useState<SessionWithMessages[]>([])
  const [favourites, setFavourites] = useState<Favourite[]>([])
  const [overrides, setOverrides] = useState<ContentOverride[]>([])
  const [flags, setFlags] = useState<Flag[]>([])
  const [expandedSession, setExpandedSession] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadAll() {
    if (!token || !childId) return
    const [c, a, f, o, allFlags] = await Promise.all([
      parentApi.getChild(token, childId),
      parentApi.getActivity(token, childId),
      parentApi.getFavourites(token, childId),
      parentApi.listContentOverrides(token, childId),
      parentApi.listFlags(token),
    ])
    setChild(c)
    setActivity([...a].reverse())
    setFavourites(favouritesSorted(f))
    setOverrides(o)
    setFlags(allFlags.filter((flag) => flag.child_id === childId))
  }

  useEffect(() => {
    loadAll().catch(() => setError('Could not load this child profile.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, childId])

  if (!child) {
    return (
      <ParentLayout>
        <p>{error ?? 'Loading…'}</p>
      </ParentLayout>
    )
  }

  const avatar = getAvatar(child.avatar_id)

  async function withBusyGuard(fn: () => Promise<void>) {
    setError(null)
    setNotice(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    }
  }

  async function handleFlag(catalogueItemId: string) {
    await withBusyGuard(async () => {
      const reason = window.prompt(`Why are you flagging "${catalogueItemId}"?`)
      if (!reason) return
      await parentApi.createFlag(token!, { child_id: childId!, catalogue_item_id: catalogueItemId, reason })
      setNotice('Flagged for moderator review.')
      await loadAll()
    })
  }

  async function handleOverride(catalogueItemId: string, decision: 'approve' | 'block') {
    await withBusyGuard(async () => {
      await parentApi.setContentOverride(token!, childId!, catalogueItemId, decision)
      setNotice(decision === 'block' ? 'Blocked — this item will no longer be recommended.' : 'Approved for this child.')
      await loadAll()
    })
  }

  async function handleDelete() {
    if (!child) return
    if (!window.confirm(`Delete ${child.name}'s profile and all their data? This can't be undone.`)) return
    await withBusyGuard(async () => {
      await parentApi.deleteChild(token!, childId!)
      navigate('/dashboard')
    })
  }

  return (
    <ParentLayout>
      <div className="child-detail-header">
        <div className="child-detail-avatar" style={{ background: avatar.color }}>
          {avatar.icon}
        </div>
        <div>
          <h1>{child.name}</h1>
          <p className="dashboard-note">Age band {child.age_band} · {child.favourites_count} favourite(s)</p>
        </div>
      </div>

      <ProfileIdBadge childId={child.id} />

      {notice && <p className="notice-text">{notice}</p>}
      {error && <p className="error-text">{error}</p>}

      <ProfileSettingsSection child={child} token={token!} onUpdated={loadAll} />

      <TrendsSection childId={childId!} token={token!} isPremium={parent?.subscription_tier === 'premium'} />

      <section className="dashboard-section">
        <h2>Activity — PA14</h2>
        {activity.length === 0 && <p className="dashboard-empty">No chat sessions yet.</p>}
        {activity.map((session) => (
          <div className="activity-session" key={session.id}>
            <button
              className="activity-session-toggle"
              onClick={() => setExpandedSession(expandedSession === session.id ? null : session.id)}
            >
              {new Date(session.started_at).toLocaleString()} — {session.status} — {session.messages.length} message(s)
            </button>
            {expandedSession === session.id && (
              <div className="activity-transcript">
                {session.messages.map((m) => (
                  <div key={m.id} className={`activity-message activity-message--${m.sender}`}>
                    <strong>{m.sender === 'child' ? child.name : 'StoryBuddy'}:</strong> {m.text}
                    {m.recommendation_refs.length > 0 && (
                      <div className="activity-refs">
                        {m.recommendation_refs.map((ref) => (
                          <span className="activity-ref-chip" key={ref}>
                            {ref}
                            <button className="chip-action" onClick={() => handleFlag(ref)} title="Flag">
                              🚩
                            </button>
                            <button className="chip-action" onClick={() => handleOverride(ref, 'block')} title="Block">
                              🚫
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="dashboard-section">
        <h2>Favourites — PA15</h2>
        {favourites.length === 0 && <p className="dashboard-empty">No favourites saved yet.</p>}
        <ul className="favourites-list">
          {favourites.map((f) => (
            <li key={f.id}>
              {/* dev-session 2026-08-21: was `f.catalogue_item_id` (a raw id
                  like "seed-dog-man") — the list only ever carried the id,
                  see types.ts's Favourite for the now-enriched shape. */}
              <span>{f.title ?? '(removed from catalogue)'}</span>
              <button className="chip-action" onClick={() => handleFlag(f.catalogue_item_id)}>
                🚩 Flag
              </button>
              <button className="chip-action" onClick={() => handleOverride(f.catalogue_item_id, 'block')}>
                🚫 Block
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="dashboard-section">
        <h2>Safety overrides — PA18</h2>
        {overrides.length === 0 && <p className="dashboard-empty">No overrides set — the age-band filter applies as normal.</p>}
        <ul className="favourites-list">
          {overrides.map((o) => (
            <li key={o.id}>
              <span>{o.catalogue_item_id}</span>
              <span className={`override-badge override-badge--${o.decision}`}>{o.decision}</span>
            </li>
          ))}
        </ul>
      </section>

      <SafetySettingsSection child={child} token={token!} onUpdated={loadAll} />

      <section className="dashboard-section">
        <h2>Flagged content status — PA17</h2>
        {flags.length === 0 && <p className="dashboard-empty">You haven't flagged anything for this child.</p>}
        <ul className="favourites-list">
          {flags.map((f) => (
            <li key={f.id}>
              <span>{f.catalogue_item_id ?? f.message_id} — "{f.reason}"</span>
              <span className={`override-badge override-badge--${f.status === 'pending' ? 'approve' : 'block'}`}>
                {f.status}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="dashboard-section dashboard-section--danger">
        <h2>Privacy & account</h2>
        <button className="danger-button" onClick={handleDelete}>
          Delete this child's profile (PA09/PA30)
        </button>
      </section>
    </ParentLayout>
  )
}

function favouritesSorted(f: Favourite[]): Favourite[] {
  return [...f].sort((a, b) => (a.saved_at < b.saved_at ? 1 : -1))
}

// CH01 (Enter Linking Code to Activate Profile) — dev-session 2026-08-20 bug
// fix. This ID was never shown anywhere in the parent-facing UI before now
// (only ever used internally in API calls/URLs), so a parent had no actual
// way to give their child the "Profile ID" the child-login screen
// (LoginScreen.tsx) asks for — every login attempt failed with "Incorrect
// PIN" no matter how carefully the PIN was typed, because the backend
// deliberately returns that same generic error for a wrong/unknown ID too
// (see app/routers/children.py's child_login — doesn't reveal whether an ID
// exists, a reasonable security choice, but a very misleading symptom when
// there was never a way to get the *right* ID in the first place). Shown
// persistently here (not just right after creation) since a child may need
// to log in again later on a different device.
function ProfileIdBadge({ childId }: { childId: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(childId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be denied (e.g. insecure context) — the ID is
      // still selectable/readable as plain text either way.
    }
  }

  return (
    <section className="dashboard-section dashboard-section--warning">
      <h2>Profile ID — give this to your child</h2>
      <p className="dashboard-note">
        On your child's device, they'll enter this Profile ID plus the PIN you set for them at{' '}
        <code>/chat</code> to log in (first time and every time after).
      </p>
      <div className="inline-form">
        <code className="verification-link-preview">{childId}</code>
        <button className="big-button" type="button" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </section>
  )
}

// PA21 — Adjust Safety Settings. Actually enforced at recommend-time on the
// backend (recommendation_service.py) — not just stored.
function SafetySettingsSection({
  child,
  token,
  onUpdated,
}: {
  child: ChildProfilePublic
  token: string
  onUpdated: () => Promise<void>
}) {
  const [newTopic, setNewTopic] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAddTopic(e: FormEvent) {
    e.preventDefault()
    const topic = newTopic.trim().toLowerCase()
    if (!topic || child.safety_settings.blocked_topics.includes(topic)) return
    setBusy(true)
    setError(null)
    try {
      await parentApi.updateSafetySettings(token, child.id, {
        blocked_topics: [...child.safety_settings.blocked_topics, topic],
      })
      setNewTopic('')
      await onUpdated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update safety settings.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoveTopic(topic: string) {
    setBusy(true)
    setError(null)
    try {
      await parentApi.updateSafetySettings(token, child.id, {
        blocked_topics: child.safety_settings.blocked_topics.filter((t) => t !== topic),
      })
      await onUpdated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update safety settings.')
    } finally {
      setBusy(false)
    }
  }

  async function handleStrictToggle(checked: boolean) {
    setBusy(true)
    setError(null)
    try {
      await parentApi.updateSafetySettings(token, child.id, { strict_age_filtering: checked })
      await onUpdated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update safety settings.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dashboard-section">
      <h2>Safety settings — PA21</h2>
      {error && <p className="error-text">{error}</p>}

      <Toggle
        label="Strict age filtering"
        hint="Turns off the age-band relaxation that a per-item 'approve' override (PA18) would otherwise allow."
        checked={child.safety_settings.strict_age_filtering}
        onChange={handleStrictToggle}
        disabled={busy}
      />

      <div className="dashboard-note" style={{ marginTop: 'var(--space-4)' }}>
        Blocked topics — recommendations tagged with any of these are never shown to {child.name}.
      </div>
      <div className="tag-input">
        {child.safety_settings.blocked_topics.map((topic) => (
          <span className="tag-chip" key={topic}>
            {topic}
            <button onClick={() => handleRemoveTopic(topic)} disabled={busy} aria-label={`Remove ${topic}`}>
              ×
            </button>
          </span>
        ))}
      </div>
      <form className="inline-form" onSubmit={handleAddTopic}>
        <label>
          Add a blocked topic
          <input
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            placeholder="e.g. scary, violence"
          />
        </label>
        <button className="big-button" type="submit" disabled={busy || !newTopic.trim()}>
          Block topic
        </button>
      </form>
    </section>
  )
}

// PA31 — View Full Activity History & Trends (Premium).
function TrendsSection({ childId, token, isPremium }: { childId: string; token: string; isPremium: boolean }) {
  const [trends, setTrends] = useState<ActivityTrends | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isPremium) return
    parentApi
      .getChildTrends(token, childId)
      .then(setTrends)
      .catch(() => setError('Could not load trends.'))
  }, [token, childId, isPremium])

  if (!isPremium) {
    return (
      <section className="dashboard-section">
        <h2>Activity trends — PA31</h2>
        <div className="premium-lock">
          <p>Weekly session counts and top-topic trends are a Premium feature.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="dashboard-section">
      <h2>Activity trends — PA31</h2>
      {error && <p className="error-text">{error}</p>}
      {!trends && !error && <p>Loading…</p>}
      {trends && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-card-value">{trends.total_sessions}</div>
              <div className="stat-card-label">Total sessions</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-value">{Object.keys(trends.sessions_by_week).length}</div>
              <div className="stat-card-label">Active weeks</div>
            </div>
          </div>
          {trends.top_topics.length > 0 && (
            <div className="tag-input" style={{ marginTop: 'var(--space-4)' }}>
              {trends.top_topics.map((topic) => (
                <span className="tag-chip" key={topic}>
                  {topic}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function ProfileSettingsSection({
  child,
  token,
  onUpdated,
}: {
  child: ChildProfilePublic
  token: string
  onUpdated: () => Promise<void>
}) {
  const [name, setName] = useState(child.name)
  const [ageBand, setAgeBand] = useState<AgeBand>(child.age_band)
  const [readingLevel, setReadingLevel] = useState(child.reading_level_guidance ?? '')
  const [newPin, setNewPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(child.name)
    setAgeBand(child.age_band)
    setReadingLevel(child.reading_level_guidance ?? '')
  }, [child])

  async function handleSaveProfile() {
    setBusy(true)
    setError(null)
    try {
      await parentApi.updateChild(token, child.id, { name, age_band: ageBand })
      if (readingLevel) await parentApi.setReadingLevel(token, child.id, readingLevel)
      await onUpdated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  async function handleAvatarChange(avatarId: string) {
    setBusy(true)
    try {
      await parentApi.updateChild(token, child.id, { avatar_id: avatarId })
      await onUpdated()
    } finally {
      setBusy(false)
    }
  }

  async function handlePinReset() {
    if (!/^\d{6}$/.test(newPin)) {
      setError('PIN must be exactly 6 digits.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await parentApi.setChildPin(token, child.id, newPin)
      setNewPin('')
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset PIN.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dashboard-section">
      <h2>Profile settings — PA08/PA10/PA13</h2>
      {error && <p className="error-text">{error}</p>}

      <div className="avatar-mini-grid">
        {AVATARS.map((a) => (
          <button
            key={a.id}
            className={`avatar-mini ${a.id === child.avatar_id ? 'avatar-mini--selected' : ''}`}
            style={{ background: a.color }}
            onClick={() => handleAvatarChange(a.id)}
            disabled={busy}
          >
            {a.icon}
          </button>
        ))}
      </div>

      <div className="inline-form">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Age band
          <select value={ageBand} onChange={(e) => setAgeBand(e.target.value as AgeBand)}>
            <option value="5-8">5-8</option>
            <option value="9-12">9-12</option>
          </select>
        </label>
        <label>
          Reading level guidance
          <input
            value={readingLevel}
            onChange={(e) => setReadingLevel(e.target.value)}
            placeholder="e.g. Grade 4"
          />
        </label>
        <button className="big-button" onClick={handleSaveProfile} disabled={busy}>
          Save
        </button>
      </div>

      <div className="inline-form">
        <label>
          Reset PIN
          <input
            inputMode="numeric"
            maxLength={6}
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="New 6-digit PIN"
          />
        </label>
        <button className="big-button" onClick={handlePinReset} disabled={busy || newPin.length !== 6}>
          Update PIN
        </button>
      </div>
    </section>
  )
}
