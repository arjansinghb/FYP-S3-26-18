// Persists the logged-in staff (moderator/admin) token/profile — mirrors
// useParentSession.ts, separate storage key since staff, parent, and child
// could plausibly all be logged in on the same shared/testing browser.
// dev-session 2026-08-17: module-level external store (useSyncExternalStore)
// — same fix/reasoning as useParentSession.ts's docstring.
import { useCallback, useSyncExternalStore } from 'react'
import type { StaffLoginResult, StaffPublic } from '../types'

const STORAGE_KEY = 'fyp2618.staffSession'

interface StoredSession {
  token: string
  staff: StaffPublic
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

export function useStaffSession() {
  const session = useSyncExternalStore(subscribe, getSnapshot)

  const login = useCallback((result: StaffLoginResult) => {
    setCurrentSession({ token: result.token, staff: result.staff })
  }, [])

  const logout = useCallback(() => {
    setCurrentSession(null)
  }, [])

  return {
    token: session?.token ?? null,
    staff: session?.staff ?? null,
    isLoggedIn: session !== null,
    login,
    logout,
  }
}
