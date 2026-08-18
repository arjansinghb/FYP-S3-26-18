// Tracks which child profiles have ever logged in on *this browser/device* —
// lets LoginScreen show a profile-icon picker (matching CH02's real UX: tap
// your icon, enter your PIN) instead of asking for a raw profile ID every
// time. The very first login for a profile on a new device still needs the
// ID typed in once (stands in for CH01's "linking", see LoginScreen.tsx) —
// after that it's remembered here.
//
// This is genuinely local-device state, not account data — clearing browser
// storage just means re-entering the ID once more, nothing is lost server-side.
const STORAGE_KEY = 'fyp2618.linkedProfiles'

export interface LinkedProfile {
  id: string
  name: string
  avatarId: string | null
}

export function loadLinkedProfiles(): LinkedProfile[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as LinkedProfile[]
  } catch {
    return []
  }
}

export function rememberProfile(profile: LinkedProfile): void {
  const existing = loadLinkedProfiles().filter((p) => p.id !== profile.id)
  existing.push(profile)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing))
}

export function forgetProfile(id: string): void {
  const remaining = loadLinkedProfiles().filter((p) => p.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining))
}
