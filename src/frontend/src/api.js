// Talks to the FastAPI backend. Handles the parent's auth token (kept in the
// browser's localStorage) and exposes one function per backend action.
//
// If the backend isn't running, callers that need it will get a thrown error;
// the child chat falls back to the local placeholder so the avatar still works.
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

const TOKEN_KEY = 'pip_parent_token'
export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
}

// Separate token for a logged-in child (different person, different device).
const CHILD_TOKEN_KEY = 'pip_child_token'
export function getChildToken() {
  return localStorage.getItem(CHILD_TOKEN_KEY)
}
export function setChildToken(t) {
  if (t) localStorage.setItem(CHILD_TOKEN_KEY, t)
  else localStorage.removeItem(CHILD_TOKEN_KEY)
}

// auth: false | 'parent' | 'child'  -> which token (if any) to attach
async function request(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth === 'child') {
    const t = getChildToken()
    if (t) headers['Authorization'] = `Bearer ${t}`
  } else if (auth) {
    const t = getToken()
    if (t) headers['Authorization'] = `Bearer ${t}`
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let detail
    try {
      detail = (await res.json()).detail
    } catch {
      detail = res.statusText
    }
    throw new Error(detail || `Request failed (${res.status})`)
  }
  if (res.status === 204) return null
  return res.json()
}

// ----- public landing (no login) -----
export async function getPublicSite() {
  return request('/api/public/site')
}
export async function getPublicPlans() {
  return request('/api/public/plans')
}

// ----- child chat -----
// Returns the full result { reply, recommendations }. If a child is logged in,
// the child token is attached so replies use their age band + safety settings
// and the conversation is logged for the parent.
export async function askPip(message) {
  return request('/api/chat', { method: 'POST', body: { message }, auth: 'child' })
}

// ----- child session (CH01/CH02 login, CH03 logout) -----
export async function linkChild(code, pin) {
  const data = await request('/api/children/link', { method: 'POST', body: { code, pin } })
  setChildToken(data.token)
  return data.child
}
export function childLogout() {
  setChildToken(null)
}
export async function getChildMe() {
  return request('/api/child/me', { auth: 'child' })
}
export async function setChildAvatar(avatar) {
  return request('/api/child/avatar', { method: 'PUT', body: { avatar }, auth: 'child' })
}

// ----- child favourites / feedback (CH15/CH16/CH17) -----
export async function saveFavourite(contentId) {
  return request('/api/chat/favourite', { method: 'POST', body: { content_id: contentId, liked: true }, auth: 'child' })
}
export async function myFavourites() {
  return request('/api/chat/favourites', { auth: 'child' })
}
export async function sendFeedback(contentId, liked) {
  return request('/api/chat/feedback', { method: 'POST', body: { content_id: contentId, liked }, auth: 'child' })
}

// ----- parent auth -----
export async function signup(email, password, name) {
  const data = await request('/api/auth/signup', { method: 'POST', body: { email, password, name } })
  setToken(data.token)
  return data.account
}
export async function login(email, password) {
  const data = await request('/api/auth/login', { method: 'POST', body: { email, password } })
  setToken(data.token)
  return data.account
}
export async function logout() {
  try {
    await request('/api/auth/logout', { method: 'POST', auth: true })
  } catch {
    /* ignore network errors on logout */
  }
  setToken(null)
}
export async function getMe() {
  return request('/api/auth/me', { auth: true })
}
export async function updateAccount(payload) {
  return request('/api/auth/me', { method: 'PATCH', body: payload, auth: true })
}
export async function deleteAccount() {
  return request('/api/auth/me', { method: 'DELETE', auth: true })
}

// ----- child profiles -----
export async function listChildren() {
  return request('/api/children', { auth: true })
}
export async function createChild(payload) {
  return request('/api/children', { method: 'POST', body: payload, auth: true })
}
export async function updateChild(id, payload) {
  return request(`/api/children/${id}`, { method: 'PATCH', body: payload, auth: true })
}
export async function deleteChild(id) {
  return request(`/api/children/${id}`, { method: 'DELETE', auth: true })
}
export async function updateChildSettings(id, settings) {
  return request(`/api/children/${id}/settings`, { method: 'PUT', body: settings, auth: true })
}

// ----- moderator: catalogue (CM03-CM10, CM13) -----
export async function listContent(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return request(`/api/content${qs ? `?${qs}` : ''}`, { auth: true })
}
export async function addContent(payload) {
  return request('/api/content', { method: 'POST', body: payload, auth: true })
}
export async function editContent(id, payload) {
  return request(`/api/content/${id}`, { method: 'PATCH', body: payload, auth: true })
}
export async function removeContent(id) {
  return request(`/api/content/${id}`, { method: 'DELETE', auth: true })
}
export async function approveContent(id) {
  return request(`/api/content/${id}/approve`, { method: 'POST', auth: true })
}
export async function rejectContent(id) {
  return request(`/api/content/${id}/reject`, { method: 'POST', auth: true })
}

// ----- moderator: reports (CM11/CM12) -----
export async function listReports() {
  return request('/api/reports', { auth: true })
}
export async function resolveReport(id, action) {
  return request(`/api/reports/${id}/resolve`, { method: 'POST', body: { action }, auth: true })
}

// ----- system admin (SA03-SA14) -----
export async function adminStats() {
  return request('/api/admin/stats', { auth: true })
}
export async function adminSearchUsers(q = '') {
  const qs = q ? `?q=${encodeURIComponent(q)}` : ''
  return request(`/api/admin/users${qs}`, { auth: true })
}
export async function adminUserDetails(id) {
  return request(`/api/admin/users/${id}`, { auth: true })
}
export async function adminResetPassword(id, newPassword) {
  return request(`/api/admin/users/${id}/reset-password`, { method: 'POST', body: { new_password: newPassword }, auth: true })
}
export async function adminSuspend(id) {
  return request(`/api/admin/users/${id}/suspend`, { method: 'POST', auth: true })
}
export async function adminUnsuspend(id) {
  return request(`/api/admin/users/${id}/unsuspend`, { method: 'POST', auth: true })
}
export async function adminGetConfig(section) {
  return request(`/api/admin/config/${section}`, { auth: true })
}
export async function adminSetConfig(section, values) {
  return request(`/api/admin/config/${section}`, { method: 'PUT', body: values, auth: true })
}
export async function adminTickets() {
  return request('/api/admin/tickets', { auth: true })
}
export async function adminResolveTicket(id) {
  return request(`/api/admin/tickets/${id}/resolve`, { method: 'POST', auth: true })
}

// ----- parent oversight -----
export async function childActivity(id) {
  return request(`/api/children/${id}/activity`, { auth: true })
}
export async function childFavourites(id) {
  return request(`/api/children/${id}/favourites`, { auth: true })
}
export async function reportContent(id, contentId, reason) {
  return request(`/api/children/${id}/report`, {
    method: 'POST',
    body: { content_id: contentId, reason },
    auth: true,
  })
}
