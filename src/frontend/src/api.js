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
export async function getPublicCatalogueSample(limit = 6) {
  return request(`/api/public/catalogue-sample?limit=${limit}`)
}

// ----- child chat -----
// Returns the full result { reply, recommendations }. If a child is logged in,
// the child token is attached so replies use their age band + safety settings
// and the conversation is logged for the parent. `sessionId` (CH04/05) ties
// this message to a chat session so the backend can pass real conversation
// history back to the brain on the next turn (CH07) — see ChatScreen's
// session start/end calls.
export async function askPip(message, sessionId) {
  return request('/api/chat', { method: 'POST', body: { message, session_id: sessionId }, auth: 'child' })
}

// Real genre counts off the child's own visible catalogue (age band/safety
// settings already applied server-side) — used to build the starter chips
// from what's actually in the catalogue instead of six always-the-same
// guesses.
export async function getTopics() {
  return request('/api/chat/topics', { auth: 'child' })
}

// CH11 — real TTS for Pip's voice (OpenAI-backed on the server, see
// backend/app/routers/chat.py's /speech), which sounds warm/consistent on
// every device instead of whatever the browser's own Web Speech API voice
// happens to be. Doesn't go through `request()` above since the response
// is audio bytes, not JSON. Returns an object URL an <audio> element can
// play; throws on any failure (no key configured, network hiccup, etc.) so
// the caller can fall back to the browser's own voice instead of going
// silent.
export async function speakPip(text) {
  const headers = { 'Content-Type': 'application/json' }
  const t = getChildToken()
  if (t) headers['Authorization'] = `Bearer ${t}`
  const res = await fetch(`${API_BASE}/api/chat/speech`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`Speech request failed (${res.status})`)
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

// ----- child session (CH01/CH02 login, CH03 logout) -----
// CH01: this device hasn't been activated for a child yet -> full code+PIN.
// CH02: it has -> the device remembers which child (id only, nothing
// secret) and the login screen only asks for the PIN.
const DEVICE_CHILD_KEY = 'pip_activated_child_id'
export function getActivatedChildId() {
  return localStorage.getItem(DEVICE_CHILD_KEY)
}
export function forgetDevice() {
  localStorage.removeItem(DEVICE_CHILD_KEY)
}

export async function linkChild(loginId, pin) {
  const data = await request('/api/children/link', { method: 'POST', body: { login_id: loginId, pin } })
  setChildToken(data.token)
  localStorage.setItem(DEVICE_CHILD_KEY, data.child.id)
  return data.child
}
export async function pinLogin(childId, pin) {
  const data = await request(`/api/children/${childId}/login`, { method: 'POST', body: { pin } })
  setChildToken(data.token)
  localStorage.setItem(DEVICE_CHILD_KEY, data.child.id)
  return data.child
}
export function childLogout() {
  // CH03: ends the session but the device stays "activated" (CH02's own
  // precondition) — logging out returns to the PIN-only screen, not all
  // the way back to code entry. Use forgetDevice() separately for that.
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
export async function removeFavourite(contentId) {
  return request(`/api/chat/favourite/${contentId}`, { method: 'DELETE', auth: 'child' })
}
export async function sendFeedback(contentId, liked) {
  return request('/api/chat/feedback', { method: 'POST', body: { content_id: contentId, liked }, auth: 'child' })
}

// ----- parent auth -----
export async function signup(email, password, name) {
  const data = await request('/api/auth/signup', { method: 'POST', body: { email, password, name } })
  setToken(data.token)
  // verify_token is dev-mode only (see VerifyRequestOut on the backend — no
  // email service is configured, so the token comes back here instead of
  // being emailed). Callers that don't need it can just ignore it.
  return { ...data.account, verify_token: data.verify_token }
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

// ----- UV06 email verification / PA03 password reset -----
export async function requestVerification() {
  return request('/api/auth/verify/request', { method: 'POST', auth: true })
}
export async function confirmVerification(token) {
  return request('/api/auth/verify/confirm', { method: 'POST', body: { token } })
}
export async function requestPasswordReset(email) {
  return request('/api/auth/reset-password/request', { method: 'POST', body: { email } })
}
export async function confirmPasswordReset(token, newPassword) {
  return request('/api/auth/reset-password/confirm', { method: 'POST', body: { token, new_password: newPassword } })
}

// ----- PA28 consent / PA29 privacy / PA30 data deletion -----
export async function getConsent() {
  return request('/api/account/consent', { auth: true })
}
export async function giveConsent(password) {
  return request('/api/account/consent', { method: 'POST', body: { password }, auth: true })
}
export async function getPrivacySettings() {
  return request('/api/account/privacy-settings', { auth: true })
}
export async function updatePrivacySettings(retentionPreference) {
  return request('/api/account/privacy-settings', { method: 'PATCH', body: { retention_preference: retentionPreference }, auth: true })
}
export async function requestChildDataDeletion(childId) {
  return request(`/api/account/children/${childId}/data-deletion`, { method: 'POST', auth: true })
}
export async function listChildDataDeletions(childId) {
  return request(`/api/account/children/${childId}/data-deletion`, { auth: true })
}
export async function cancelChildDataDeletion(requestId) {
  return request(`/api/account/data-deletion/${requestId}/cancel`, { method: 'POST', auth: true })
}

// ----- PA20/22 notifications -----
export async function getNotificationPreferences() {
  return request('/api/account/notification-preferences', { auth: true })
}
export async function updateNotificationPreferences(channels) {
  return request('/api/account/notification-preferences', { method: 'PATCH', body: { channels }, auth: true })
}
export async function listNotifications() {
  return request('/api/account/notifications', { auth: true })
}
export async function markNotificationRead(id) {
  return request(`/api/account/notifications/${id}/read`, { method: 'POST', auth: true })
}

// ----- PA23-27 billing (simulated) -----
export async function getSubscriptionStatus() {
  return request('/api/account/subscription', { auth: true })
}
// `tier`: 'premium' | 'ultra' (Ultra tier, 2026-09-07) — also the upgrade
// path between the two paid tiers, not just Free -> paid.
export async function subscribe(tier, billingCycle, paymentMethod) {
  return request('/api/account/subscribe', { method: 'POST', body: { tier, billing_cycle: billingCycle, payment_method: paymentMethod }, auth: true })
}
export async function cancelPremium() {
  return request('/api/account/cancel-premium', { method: 'POST', auth: true })
}
export async function resumePremium() {
  return request('/api/account/resume-premium', { method: 'POST', auth: true })
}
export async function updatePaymentMethod(brand, last4) {
  return request('/api/account/payment-method', { method: 'PUT', body: { brand, last4 }, auth: true })
}
export async function getBillingHistory() {
  return request('/api/account/billing-history', { auth: true })
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
export async function unlockChild(id) {
  return request(`/api/children/${id}/unlock`, { method: 'POST', auth: true })
}
export async function regenerateChildPin(id) {
  return request(`/api/children/${id}/regenerate-pin`, { method: 'POST', auth: true })
}
export async function regenerateChildLoginId(id) {
  return request(`/api/children/${id}/regenerate-login-id`, { method: 'POST', auth: true })
}

// ----- PA18 per-child content overrides -----
export async function setContentOverride(childId, contentId, action) {
  return request(`/api/children/${childId}/content-overrides/${contentId}`, { method: 'PUT', body: { action }, auth: true })
}
export async function listContentOverrides(childId) {
  return request(`/api/children/${childId}/content-overrides`, { auth: true })
}
export async function clearContentOverride(childId, contentId) {
  return request(`/api/children/${childId}/content-overrides/${contentId}`, { method: 'DELETE', auth: true })
}

// ----- PA31/32 premium insights -----
export async function childTrends(id) {
  return request(`/api/children/${id}/trends`, { auth: true })
}
export async function compareChildren() {
  return request('/api/children/compare', { auth: true })
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

// ----- PA17: reported-content status -----
export async function childReports(id) {
  return request(`/api/children/${id}/reports`, { auth: true })
}
export async function myReports() {
  return request('/api/children/reports', { auth: true })
}

// ----- CH04/05: chat session lifecycle -----
export async function startChatSession() {
  return request('/api/chat/sessions', { method: 'POST', auth: 'child' })
}
export async function endChatSession(id) {
  return request(`/api/chat/sessions/${id}/end`, { method: 'POST', auth: 'child' })
}

// ----- CM03/CM06: search + import from Google Books/YouTube -----
export async function searchBooks(q) {
  return request(`/api/content/search/books?q=${encodeURIComponent(q)}`, { auth: true })
}
export async function searchVideos(q) {
  return request(`/api/content/search/videos?q=${encodeURIComponent(q)}`, { auth: true })
}
export async function importContent(payload) {
  return request('/api/content/import', { method: 'POST', body: payload, auth: true })
}
