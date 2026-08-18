// CH19 (Choose Avatar) — shown right after a first-ever login (CH01
// activation). Also reachable later for CH20 (Edit Avatar) via ChatScreen's
// settings button, reusing this same component.
import { useState } from 'react'
import { chooseAvatar } from '../api/client'
import { AVATARS } from '../avatars'
import { rememberProfile } from '../state/linkedProfiles'
import type { ChildProfilePublic } from '../types'

interface Props {
  token: string
  profile: ChildProfilePublic
  onDone: (profile: ChildProfilePublic) => void
}

export default function AvatarPicker({ token, profile, onDone }: Props) {
  const [saving, setSaving] = useState(false)

  async function pick(avatarId: string) {
    setSaving(true)
    try {
      const updated = await chooseAvatar(token, avatarId)
      rememberProfile({ id: updated.id, name: updated.name, avatarId: updated.avatar_id })
      onDone(updated)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="screen avatar-screen">
      <h2 className="login-subtitle">Pick your buddy, {profile.name}!</h2>
      <div className="avatar-grid">
        {AVATARS.map((a) => (
          <button
            key={a.id}
            className="avatar-tile"
            style={{ background: a.color }}
            onClick={() => pick(a.id)}
            disabled={saving}
          >
            <span className="avatar-tile-emoji">{a.icon}</span>
            <span className="avatar-tile-name">{a.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
