// Persists the logged-in parent's token/profile to localStorage — mirrors
// useChildSession.ts's approach, kept as a separate hook/storage key since a
// parent and a child could plausibly be logged in on the same device/browser
// at once (shared family computer) and shouldn't clobber each other.
//
// dev-session 2026-08-17 fix: this used to give every component calling
// useParentSession() its own independent `useState(() => load())` — fine
// when React actually remounts a component on a route change, but React
// Router doesn't guarantee that: swapping from `<Route path="/consent"
// element={<RequireParentAuth><ConsentPage/></RequireParentAuth>}>` to
// `<Route path="/dashboard" element={<RequireParentAuth requireConsent>...`
// can *reuse* the existing RequireParentAuth instance (same component type,
// same position in the tree) rather than unmount+remount it — so its
// internal session copy, set once at first mount, never saw
// ConsentPage's `updateParent()` call at all, even though ConsentPage's own
// copy (and localStorage) updated correctly. That's structurally
// unfixable with per-component useState. A module-level external store
// (subscribed to via useSyncExternalStore) gives every consumer — no
// matter how React decides to mount/reuse them — the exact same live
// value, updated the instant any one of them calls login/updateParent/
// logout.
import { useCallback, useSyncExternalStore } from 'react'
import type { AuthResponse, Parent } from '../types'

const STORAGE_KEY = 'fyp2618.parentSession'

interface StoredSession {
  token: string
  parent: Parent
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

export function useParentSession() {
  const session = useSyncExternalStore(subscribe, getSnapshot)

  const login = useCallback((result: AuthResponse) => {
    setCurrentSession({ token: result.token, parent: result.parent })
  }, [])

  const updateParent = useCallback((parent: Parent) => {
    setCurrentSession(currentSession ? { ...currentSession, parent } : currentSession)
  }, [])

  const logout = useCallback(() => {
    setCurrentSession(null)
  }, [])

  return {
    token: session?.token ?? null,
    parent: session?.parent ?? null,
    isLoggedIn: session !== null,
    login,
    updateParent,
    logout,
  }
}
