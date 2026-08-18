// Persists the logged-in child's session token/profile to localStorage so a
// page reload doesn't force a fresh PIN entry every time (the 12h token TTL
// from the backend is the real expiry — see src/backend/app/core/security.py).
//
// KNOWN SIMPLIFICATION: real CH01 ("Enter Linking Code to Activate Profile")
// implies the *device* already knows which child profiles are linked to it
// (the child picks a profile icon, they don't type an ID) — that device<->
// profile linking flow isn't built yet (see src/backend/README.md and
// LoginScreen.tsx's own comment). This hook only handles the PIN-verification
// half (CH01/CH02) and persisting the resulting session.
//
// dev-session 2026-08-17: module-level external store (useSyncExternalStore),
// same fix/reasoning as useParentSession.ts's docstring — per-component
// useState went stale whenever React reused a component instance across a
// route/screen change instead of remounting it.
import { useCallback, useSyncExternalStore } from 'react'
import type { ChildLoginResult, ChildProfilePublic } from '../types'

const STORAGE_KEY = 'fyp2618.childSession'

interface StoredSession {
  token: string
  profile: ChildProfilePublic
}

function load(): StoredSession | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredSession
  } catch {
    return null
  }
}

let currentSession: StoredSession | null = load()
const listeners = new Set<() => void>()

function setCurrentSession(next: StoredSession | null): void {
  currentSession = next
  if (next) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): StoredSession | null {
  return currentSession
}

export function useChildSession() {
  const session = useSyncExternalStore(subscribe, getSnapshot)

  const login = useCallback((result: ChildLoginResult) => {
    setCurrentSession({ token: result.session_token, profile: result.profile })
  }, [])

  const updateProfile = useCallback((profile: ChildProfilePublic) => {
    setCurrentSession(currentSession ? { ...currentSession, profile } : currentSession)
  }, [])

  const logout = useCallback(() => {
    setCurrentSession(null)
  }, [])

  return {
    token: session?.token ?? null,
    profile: session?.profile ?? null,
    isLoggedIn: session !== null,
    login,
    updateProfile,
    logout,
  }
}
