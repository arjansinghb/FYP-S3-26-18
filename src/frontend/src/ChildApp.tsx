// The child-facing app (login -> avatar picker, first time only -> chat).
// Mounted at /chat by App.tsx's router — kept as its own self-contained
// component/state tree, deliberately not sharing routing/state with the
// parent dashboard (agent-context/CLAUDE.md's "distinct surfaces" rule).
import { useState } from 'react'
import AvatarPicker from './components/AvatarPicker'
import ChatScreen from './components/ChatScreen'
import FavouritesShelf from './components/FavouritesShelf'
import LoginScreen from './components/LoginScreen'
import { useChildSession } from './state/useChildSession'
import type { ChildLoginResult, ChildProfilePublic } from './types'

type Screen = 'login' | 'avatar' | 'chat' | 'favourites'

export default function ChildApp() {
  const { token, profile, isLoggedIn, login, updateProfile, logout } = useChildSession()
  const [forceAvatarPicker, setForceAvatarPicker] = useState(false)
  // CH16 "My Favourites" (dev-session 2026-08-21) — a peer screen to chat,
  // not a route change (this app deliberately doesn't use react-router
  // internally, see the module docstring above).
  const [showFavourites, setShowFavourites] = useState(false)

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
    screen = forceAvatarPicker ? 'avatar' : !profile.avatar_id ? 'avatar' : showFavourites ? 'favourites' : 'chat'
  }

  return (
    <div className="app-shell">
      {screen === 'login' && <LoginScreen onLogin={handleLogin} />}
      {screen === 'avatar' && token && profile && (
        <AvatarPicker token={token} profile={profile} onDone={handleAvatarDone} />
      )}
      {screen === 'favourites' && token && profile && (
        <FavouritesShelf token={token} childId={profile.id} onBack={() => setShowFavourites(false)} />
      )}
      {screen === 'chat' && token && profile && (
        <ChatScreen
          token={token}
          profile={profile}
          onLogout={logout}
          onEditAvatar={() => setForceAvatarPicker(true)}
          onShowFavourites={() => setShowFavourites(true)}
        />
      )}
    </div>
  )
}
