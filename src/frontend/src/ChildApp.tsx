// The child-facing app (login -> avatar picker, first time only -> chat).
// Mounted at /chat by App.tsx's router — kept as its own self-contained
// component/state tree, deliberately not sharing routing/state with the
// parent dashboard (agent-context/CLAUDE.md's "distinct surfaces" rule).
import { useState } from 'react'
import AvatarPicker from './components/AvatarPicker'
import ChatScreen from './components/ChatScreen'
import LoginScreen from './components/LoginScreen'
import { useChildSession } from './state/useChildSession'
import type { ChildLoginResult, ChildProfilePublic } from './types'

type Screen = 'login' | 'avatar' | 'chat'

export default function ChildApp() {
  const { token, profile, isLoggedIn, login, updateProfile, logout } = useChildSession()
  const [forceAvatarPicker, setForceAvatarPicker] = useState(false)

  function handleLogin(result: ChildLoginResult) {
    login(result)
    // CH19 — first-ever login (CH01 "activation") goes straight to avatar
    // picking, whether or not one happens to be set already.
    if (result.activated || !result.profile.avatar_id) {
      setForceAvatarPicker(true)
    }
  }

  function handleAvatarDone(updated: ChildProfilePublic) {
    updateProfile(updated)
    setForceAvatarPicker(false)
  }

  let screen: Screen = 'login'
  if (isLoggedIn && profile) {
    screen = forceAvatarPicker || !profile.avatar_id ? 'avatar' : 'chat'
  }

  return (
    <div className="app-shell">
      {screen === 'login' && <LoginScreen onLogin={handleLogin} />}
      {screen === 'avatar' && token && profile && (
        <AvatarPicker token={token} profile={profile} onDone={handleAvatarDone} />
      )}
      {screen === 'chat' && token && profile && (
        <ChatScreen
          token={token}
          profile={profile}
          onLogout={logout}
          onEditAvatar={() => setForceAvatarPicker(true)}
        />
      )}
    </div>
  )
}
