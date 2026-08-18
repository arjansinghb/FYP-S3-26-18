// Content Moderator (CM01-13) API calls — see src/backend/app/routers/moderation.py.
import { request } from './http'
import type { CatalogueItemFull, ContentSearchResult, ContentType, Flag, StaffLoginResult } from '../types'

// CM01 — Log In.
export function login(email: string, password: string): Promise<StaffLoginResult> {
  return request('/moderation/login', { method: 'POST', body: { email, password } })
}

// CM02 — Log Out.
export function logout(token: string): Promise<void> {
  return request('/moderation/logout', { method: 'POST', token })
}

// CM06 — Review New Content Submission (the queue).
export function getQueue(token: string): Promise<CatalogueItemFull[]> {
  return request('/moderation/queue', { token })
}

// CM13 — Browse Content Database.
export function browseCatalogue(
  token: string,
  opts: { statusFilter?: string; q?: string } = {}
): Promise<CatalogueItemFull[]> {
  const params = new URLSearchParams()
  if (opts.statusFilter) params.set('status_filter', opts.statusFilter)
  if (opts.q) params.set('q', opts.q)
  const qs = params.toString()
  return request(`/catalogue${qs ? `?${qs}` : ''}`, { token })
}

// CM03 — Add Catalogue Entry (from a search result).
export function importContent(
  token: string,
  data: { external_id: string; type: ContentType; title: string; synopsis: string; source_url?: string | null }
): Promise<CatalogueItemFull> {
  return request('/catalogue/import', { method: 'POST', token, body: data })
}

// CM04 — Edit Catalogue Entry.
export function editCatalogueEntry(
  token: string,
  itemId: string,
  fields: Partial<Pick<CatalogueItemFull, 'title' | 'synopsis' | 'genre' | 'topics' | 'reading_level' | 'source_url'>>
): Promise<CatalogueItemFull> {
  return request(`/catalogue/${itemId}`, { method: 'PATCH', token, body: fields })
}

// CM05 — Remove Catalogue Entry.
export function removeCatalogueEntry(token: string, itemId: string): Promise<void> {
  return request(`/catalogue/${itemId}`, { method: 'DELETE', token })
}

// CM07 — Approve Content.
export function approveContent(token: string, itemId: string): Promise<CatalogueItemFull> {
  return request(`/catalogue/${itemId}/approve`, { method: 'POST', token })
}

// CM08 — Reject Content.
export function rejectContent(token: string, itemId: string, reason: string): Promise<CatalogueItemFull> {
  return request(`/catalogue/${itemId}/reject`, { method: 'POST', token, body: { reason } })
}

// CM09 — Apply Age-Band Tag.
export function applyAgeBandTag(token: string, itemId: string, ageBands: string[]): Promise<CatalogueItemFull> {
  return request(`/catalogue/${itemId}/age-bands`, { method: 'POST', token, body: { age_bands: ageBands } })
}

// CM10 — Apply Reading-Level/Genre Metadata.
export function applyMetadata(
  token: string,
  itemId: string,
  data: { genre?: string; topics?: string[]; reading_level?: string }
): Promise<CatalogueItemFull> {
  return request(`/catalogue/${itemId}/metadata`, { method: 'POST', token, body: data })
}

// CM11 — Review Reported Content.
export function getFlaggedContent(token: string, statusFilter = 'pending'): Promise<Flag[]> {
  return request(`/moderation/flags?status_filter=${statusFilter}`, { token })
}

// CM12 — Resolve Reported Content.
export function resolveFlag(
  token: string,
  flagId: string,
  resolution: 'approved' | 'removed',
  note?: string
): Promise<Flag> {
  const params = new URLSearchParams({ resolution })
  if (note) params.set('note', note)
  return request(`/moderation/flags/${flagId}/resolve?${params.toString()}`, { method: 'POST', token })
}

// Search sources for CM03 — Google Books / YouTube Data API.
export function searchBooks(token: string, q: string): Promise<ContentSearchResult[]> {
  return request(`/moderation/search/books?q=${encodeURIComponent(q)}`, { token })
}

export function searchVideos(token: string, q: string): Promise<ContentSearchResult[]> {
  return request(`/moderation/search/videos?q=${encodeURIComponent(q)}`, { token })
}
