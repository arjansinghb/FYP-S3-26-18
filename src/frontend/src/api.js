// Talks to the FastAPI backend. Handles the parent's auth token (kept in the
// browser's localStorage) and exposes one function per backend action.
//
// If the backend isn't running, callers that need it will get a thrown error;
// the child chat falls back to the local placeholder so the avatar still works.
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

// One token slot per area (parent / moderator / admin), picked by the page
// the call is made from. They used to share a single key, so signing in as
// admin in a second tab silently swapped the parent tab's token for the
// admin's: the parent page still looked signed in, but every call after
// that (a support request, saving settings...) went out as an admin and was
// rejected with "Not allowed for this role". Each area keeps its own
// session now, and signing out of one no longer signs out the others.
function tokenKey(role) {
  const area = role || (window.location.pathname.startsWith('/admin') ? 'admin'
    : window.location.pathname.startsWith('/moderator') ? 'moderator' : 'parent')
  return `pip_${area}_token`
}
export function getToken() {
  return localStorage.getItem(tokenKey())
}
// `role` is only passed at sign-in: every role signs in on the same page
// now, so the slot comes from who actually signed in, not from the page.
export function setToken(t, role) {
  if (t) localStorage.setItem(tokenKey(role), t)
  else localStorage.removeItem(tokenKey(role))
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
// FastAPI answers a failed validation (HTTP 422) with `detail` as a LIST of objects, not a string; passing that
// straight to `new Error(...)` printed "[object Object]" on screen. Turn it into plain words instead.
function readableDetail(detail) {
  if (!Array.isArray(detail)) return detail
  return detail.map((d) => {
    const field = Array.isArray(d.loc) ? d.loc.filter((x) => x !== 'body' && x !== 'query').join(' ') : ''
    const msg = String(d.msg || '').replace(/^Value error, /, '')
    const min = /at least (\d+) character/.exec(msg)
    if (min && field) return `${field[0].toUpperCase()}${field.slice(1)} needs at least ${min[1]} characters.`
    return field && !/^[A-Z]/.test(msg) ? `${field}: ${msg}` : msg
  }).join(' ')
}

async function request(path, { method = 'GET', body, auth = false, token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth === 'child') {
    const t = getChildToken()
    if (t) headers['Authorization'] = `Bearer ${t}`
  } else if (auth) {
    const t = token || getToken()
    if (t) headers['Authorization'] = `Bearer ${t}`
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let detail
    let body = null
    try {
      body = await res.json()
      detail = body.detail
    } catch {
      detail = res.statusText
    }
    // A signed-in call that is no longer signed in (the session was cleared or expired, e.g. a
    // logout in another tab): tell the page so it can fall back to the sign-in screen instead of
    // showing a raw "Not authenticated".
    // Only the "no usable session" answers — a 401 can also mean something else (a wrong password
    // on a confirmation step), and that must not sign anyone out.
    if (auth && auth !== 'child' && ['Not authenticated', 'Invalid or expired token', 'Account not found'].includes(detail)) {
      window.dispatchEvent(new CustomEvent('pip-session-expired'))
    }
    // 503 from this API means maintenance mode is on (SA11): tell the app, so
    // it can show the maintenance screen instead of a bare error.
    if (res.status === 503 && body && typeof detail === 'string') {
      window.dispatchEvent(new CustomEvent('pip-maintenance', { detail: { message: detail, supportEmail: body.support_email || '' } }))
    }
    // A conflict can carry structure ({message, duplicate}) so the page can link to the existing entry.
    if (detail && typeof detail === 'object' && !Array.isArray(detail) && detail.message) {
      throw Object.assign(new Error(detail.message), { duplicate: detail.duplicate })
    }
    throw new Error(readableDetail(detail) || `Request failed (${res.status})`)
  }
  if (res.status === 204) return null
  return res.json()
}

// ----- maintenance mode (SA11) -----
export async function getMaintenanceStatus() {
  return request('/api/public/maintenance')
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
// UV04 — real, admin-approved parent reviews for the landing page. Empty
// until at least one exists — see public.py's own docstring for why an
// empty state here is honest, not a bug.
export async function getPublicReviews(limit = 10) {
  return request(`/api/public/reviews?limit=${limit}`)
}

// ----- UV04: a parent's own review (submit / check status) -----
export async function getMyReview() {
  return request('/api/account/reviews/me', { auth: true })
}
export async function submitReview(rating, text) {
  return request('/api/account/reviews', { method: 'POST', body: { rating, text }, auth: true })
}

// ----- system admin: review moderation queue -----
export async function adminListReviews(status) {
  return request(`/api/admin/reviews${status ? `?status=${status}` : ''}`, { auth: true })
}
export async function adminApproveReview(id) {
  return request(`/api/admin/reviews/${id}/approve`, { method: 'POST', auth: true })
}
export async function adminRejectReview(id) {
  return request(`/api/admin/reviews/${id}/reject`, { method: 'POST', auth: true })
}
export async function adminDeleteReview(id) {
  return request(`/api/admin/reviews/${id}`, { method: 'DELETE', auth: true })
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
// Checked once per fresh chat load, same as favourites/topics below — a
// topic Pip once had to say "Oops" to this child about, that real content
// now actually covers. Returns null (not an object) when there's nothing
// new to mention.
export async function resolvedTopic() {
  return request('/api/chat/resolved-topics', { auth: 'child' })
}
// Fire-and-forget, called right after the topic above is actually shown —
// stamps it server-side so it's never resurfaced again (a separate mutating
// call, not folded into the GET, so it actually persists — see that
// endpoint's own docstring).
export async function ackResolvedTopic(topic) {
  return request('/api/chat/resolved-topics/ack', { method: 'POST', body: { topic }, auth: 'child' })
}

// ----- child browse (second entry point next to "Ask Pip") -----
export async function browseCategories(type) {
  return request(`/api/browse/categories${type ? `?type=${type}` : ''}`, { auth: 'child' })
}
export async function browseItems({ genre, type, offset = 0, limit = 8 } = {}) {
  const q = new URLSearchParams({ offset, limit })
  if (genre) q.set('genre', genre)
  if (type) q.set('type', type)
  return request(`/api/browse/items?${q}`, { auth: 'child' })
}
export async function browseForYou(type) {
  return request(`/api/browse/for-you${type ? `?type=${type}` : ''}`, { auth: 'child' })
}

// ----- child articulation level (CH21/CH22) -----
export async function myLevel() {
  return request('/api/articulation/level', { auth: 'child' })
}
export async function pendingLevelUp() {
  return request('/api/articulation/level-up', { auth: 'child' })
}
export async function ackLevelUp() {
  return request('/api/articulation/level-up/ack', { method: 'POST', auth: 'child' })
}
export async function explainToPip(contentId, text, inputMode) {
  return request('/api/articulation/explanations', {
    method: 'POST', body: { content_id: contentId, text, input_mode: inputMode }, auth: 'child',
  })
}

// ----- parent: articulation (PA34-PA37) -----
export async function childArticulation(childId) {
  return request(`/api/children/${childId}/articulation`, { auth: true })
}
export async function childExplanations(childId) {
  return request(`/api/children/${childId}/explanations`, { auth: true })
}
export async function confirmExplanation(id) {
  return request(`/api/explanations/${id}/confirm`, { method: 'POST', auth: true })
}
export async function declineExplanation(id) {
  return request(`/api/explanations/${id}/decline`, { method: 'POST', auth: true })
}
export async function articulationTrends(childId) {
  return request(`/api/children/${childId}/articulation-trends`, { auth: true })
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
  setToken(data.token, data.account.role)
  return data.account
}
export async function logout() {
  // Sign out HERE first, then tell the server. The server round-trip can take seconds, and
  // until it finished the old session was still stored: a quick click to another page restored
  // it (a ghost dashboard whose token vanished a moment later — "Not authenticated"), and a page
  // load in that window meant the token was never removed at all. The slot is picked now, before
  // anything else, because callers switch page right after calling this (admin -> sign-in page).
  const slot = tokenKey()
  const token = localStorage.getItem(slot)
  localStorage.removeItem(slot)
  if (!token) return
  try {
    await request('/api/auth/logout', { method: 'POST', auth: true, token })
  } catch {
    /* ignore network errors on logout */
  }
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
export async function createSupportTicket(subject, message) {
  return request('/api/account/support', { method: 'POST', body: { subject, message }, auth: true })
}
export async function mySupportTickets() {
  return request('/api/account/support', { auth: true })
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
// `tier`: 'premium'.
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
export async function bulkImport(payload) {
  return request('/api/content/bulk-import', { method: 'POST', body: payload, auth: true })
}
export async function listAuditQueue() {
  return request('/api/content/audit-queue', { auth: true })
}
export async function submitAudit(id, payload) {
  return request(`/api/content/${id}/audit`, { method: 'POST', body: payload, auth: true })
}
export async function listTopicRequests() {
  return request('/api/content/topic-requests', { auth: true })
}
// Fire-and-forget from TopicRequests below, right after it loads the list
// above — lets a popular-enough topic import itself instead of waiting for
// a moderator to notice and click "Auto-import" one by one. Returns
// {imported_topic: string | null}.
export async function autoImportTopic() {
  return request('/api/content/topic-requests/auto-import', { method: 'POST', auth: true })
}
// Real gap, not just unbuilt: the backend endpoint already existed, but
// GET /topic-requests never included the `key` this needs, so no frontend
// could ever have called it correctly (Kiefer, 2026-09-24, asking why
// there's no dismiss control on the Requested topics list at all).
export async function dismissTopicRequest(topicKey) {
  return request(`/api/content/topic-requests/${encodeURIComponent(topicKey)}`, { method: 'DELETE', auth: true })
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
export async function sendReportNote(id, note) {
  return request(`/api/reports/${id}/note`, { method: 'POST', body: { note }, auth: true })
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

export async function reportChat(id, chatTs, reason) {
  return request(`/api/children/${id}/report`, {
    method: 'POST',
    body: { chat_ts: chatTs, reason },
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
