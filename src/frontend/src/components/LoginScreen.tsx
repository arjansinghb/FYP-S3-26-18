// CH01 (Enter Linking Code to Activate Profile, first time on this device) /
// CH02 (Log In (PIN), every time after) — see agent-context/CLAUDE.md §2.2
// point 3 and state/linkedProfiles.ts for how the two map onto one screen.
import { useState } from 'react'
import { ApiError, childLogin } from '../api/client'
import { getAvatar } from '../avatars'
import { type LinkedProfile, loadLinkedProfiles, rememberProfile } from '../state/linkedProfiles'
import type { ChildLoginResult } from '../types'

interface Props {
  onLogin: (result: ChildLoginResult) => void
}

export default function LoginScreen({ onLogin }: Props) {
  const [known] = useState<LinkedProfile[]>(() => loadLinkedProfiles())
  const [selected, setSelected] = useState<LinkedProfile | null>(null)
  const [addingNew, setAddingNew] = useState(known.length === 0)
  const [childId, setChildId] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(id: string) {
    if (pin.length !== 6) {
      setError('PIN needs to be 6 digits.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await childLogin(id, pin)
      rememberProfile({ id: result.profile.id, name: result.profile.name, avatarId: result.profile.avatar_id })
      onLogin(result)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — try again?')
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="screen login-screen">
      <h1 className="app-title">📚 StoryBuddy</h1>

      {!addingNew && (
        <>
          <p className="login-subtitle">Who's reading today?</p>
          <div className="profile-grid">
            {known.map((p) => {
              const avatar = getAvatar(p.avatarId)
              return (
                <button
                  key={p.id}
                  className={`profile-tile ${selected?.id === p.id ? 'profile-tile--selected' : ''}`}
                  style={{ background: avatar.color }}
                  onClick={() => {
                    setSelected(p)
                    setError(null)
                  }}
                >
                  <span className="profile-tile-emoji">{avatar.icon}</span>
                  <span className="profile-tile-name">{p.name}</span>
                </button>
              )
            })}
            <button className="profile-tile profile-tile--add" onClick={() => setAddingNew(true)}>
              <span className="profile-tile-emoji">➕</span>
              <span className="profile-tile-name">New device?</span>
            </button>
          </div>

          {selected && (
            <PinPad
              busy={loading}
              error={error}
              pin={pin}
              setPin={setPin}
              onSubmit={() => submit(selected.id)}
            />
          )}
        </>
      )}

      {addingNew && (
        <>
          <p className="login-subtitle">
            First time on this device? Ask a parent for your Profile ID and PIN.
          </p>
          <input
            className="text-input"
            placeholder="Profile ID (from a parent)"
            value={childId}
            onChange={(e) => setChildId(e.target.value.trim())}
          />
          <PinPad
            busy={loading}
            error={error}
            pin={pin}
            setPin={setPin}
            onSubmit={() => childId && submit(childId)}
          />
          {known.length > 0 && (
            <button className="link-button" onClick={() => setAddingNew(false)}>
              ← Back to profiles
            </button>
          )}
        </>
      )}
    </div>
  )
}

function PinPad({
  pin,
  setPin,
  onSubmit,
  busy,
  error,
}: {
  pin: string
  setPin: (v: string) => void
  onSubmit: () => void
  busy: boolean
  error: string | null
}) {
  return (
    <div className="pin-pad">
      <input
        className="pin-input"
        inputMode="numeric"
        maxLength={6}
        placeholder="••••••"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        autoFocus
      />
      {error && <p className="error-text">{error}</p>}
      <button className="big-button" onClick={onSubmit} disabled={busy || pin.length !== 6}>
        {busy ? 'Checking…' : "Let's go!"}
      </button>
    </div>
  )
}
