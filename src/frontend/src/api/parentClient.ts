// Parent-facing API calls — see src/backend/app/routers/{auth,account,children,
// parent_dashboard}.py for the source of truth on request/response shapes.
import { request } from './http'
import type {
  ActivityTrends,
  AppNotification,
  AuthResponse,
  BillingRecord,
  ChildInsight,
  ChildProfilePublic,
  ConsentRecord,
  ContentOverride,
  DataPrivacySettings,
  Favourite,
  Flag,
  NotificationPreferences,
  Parent,
  PaymentMethod,
  SafetySettings,
  SessionWithMessages,
} from '../types'

// UV05 — Sign Up (Create Parent Account).
export function signup(email: string, password: string, displayName: string): Promise<AuthResponse> {
  return request('/auth/signup', {
    method: 'POST',
    body: { email, password, display_name: displayName },
  })
}

// PA01 — Log In.
export function login(email: string, password: string): Promise<AuthResponse> {
  return request('/auth/login', { method: 'POST', body: { email, password } })
}

// PA02 — Log Out.
export function logout(token: string): Promise<void> {
  return request('/auth/logout', { method: 'POST', token })
}

// PA03 — Reset Password (request step). dev-session 2026-08-17: this now
// triggers a real email (Firebase Identity Toolkit sendOobCode, see backend
// docstring) — the response never carries anything to display.
export function resetPassword(email: string): Promise<{ message: string }> {
  return request('/auth/reset-password', { method: 'POST', body: { email } })
}

// PA03 — Reset Password (confirm step). Public — the oobCode from the
// emailed link's URL is the credential.
export function confirmPasswordReset(oobCode: string, newPassword: string): Promise<{ message: string }> {
  return request('/auth/reset-password/confirm', {
    method: 'POST',
    body: { oob_code: oobCode, new_password: newPassword },
  })
}

// PA04 — View Account Details.
export function getAccount(token: string): Promise<Parent> {
  return request('/account', { token })
}

// PA05 — Update Account Details.
export function updateAccount(token: string, fields: { display_name?: string; email?: string }): Promise<Parent> {
  return request('/account', { method: 'PATCH', token, body: fields })
}

// PA06 — Delete Account.
export function deleteAccount(token: string): Promise<void> {
  return request('/account', { method: 'DELETE', token })
}

// PA28 — Provide Verifiable Parental Consent. dev-session 2026-08-17: the
// URS's own example ("re-authentication or payment-method verification") is
// now enforced — password is re-checked server-side before consent records.
export function provideConsent(token: string, password: string): Promise<ConsentRecord> {
  return request('/account/consent', { method: 'POST', token, body: { password } })
}

// UV06 — Verify Account (request step). Firebase-configured: a real email is
// sent (verification_token comes back null). Local-dev-store: no email
// transport exists, so the token is returned directly for inline display.
export function requestEmailVerification(token: string): Promise<{ message: string; verification_token: string | null }> {
  return request('/auth/verify-email/request', { method: 'POST', token })
}

// UV06 — Verify Account (confirm step, local-dev-store path). Public — the
// token is the credential.
export function confirmEmailVerification(verificationToken: string): Promise<Parent> {
  return request('/auth/verify-email/confirm', { method: 'POST', body: { token: verificationToken } })
}

// UV06 — Verify Account (confirm step, real-Firebase path). Public — the
// oobCode from the emailed link's URL is the credential.
export function confirmEmailVerificationOob(oobCode: string): Promise<Parent> {
  return request('/auth/verify-email/confirm', { method: 'POST', body: { oob_code: oobCode } })
}

// PA20 — Receive Notifications.
export function listNotifications(token: string): Promise<AppNotification[]> {
  return request('/notifications', { token })
}

export function markNotificationRead(token: string, notificationId: string): Promise<void> {
  return request(`/notifications/${notificationId}/read`, { method: 'POST', token })
}

// PA22 — Set Notification Preferences.
export function getNotificationPreferences(token: string): Promise<NotificationPreferences> {
  return request('/account/notification-preferences', { token })
}

export function updateNotificationPreferences(
  token: string,
  prefs: NotificationPreferences
): Promise<NotificationPreferences> {
  return request('/account/notification-preferences', { method: 'PATCH', token, body: prefs })
}

// PA20/PA22 real push delivery — dev-session 2026-08-17. See
// src/state/pushNotifications.ts (browser-side flow) and backend's
// app/services/push_service.py (VAPID/Web Push, not FCM).
export function getPushPublicKey(): Promise<{ public_key: string; configured: boolean }> {
  return request('/notifications/push/public-key')
}

export function subscribeToPush(
  token: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
): Promise<{ message: string }> {
  return request('/notifications/push/subscribe', { method: 'POST', token, body: subscription })
}

export function unsubscribeFromPush(token: string, endpoint: string): Promise<void> {
  return request('/notifications/push/unsubscribe', { method: 'POST', token, body: { endpoint } })
}

// PA29 — Manage Data Privacy Settings.
export function updatePrivacySettings(token: string, settings: DataPrivacySettings): Promise<DataPrivacySettings> {
  return request('/account/privacy-settings', { method: 'PATCH', token, body: settings })
}

// PA26 — Update Payment Method (simulated — see backend docstring; full card
// number is sent once over the wire and never stored, only brand/last4 come back).
export function updatePaymentMethod(
  token: string,
  data: { card_number: string; exp_month: number; exp_year: number }
): Promise<PaymentMethod> {
  return request('/account/payment-method', { method: 'PUT', token, body: data })
}

// PA24 — Subscribe to Premium (simulated).
export function subscribeToPremium(token: string, billingCycle: 'monthly' | 'annual' = 'monthly'): Promise<Parent> {
  return request('/account/subscribe', { method: 'POST', token, body: { billing_cycle: billingCycle } })
}

// PA25 — Cancel Premium (effective at period end — see Parent.subscription_cancel_at).
export function cancelPremium(token: string): Promise<Parent> {
  return request('/account/cancel-premium', { method: 'POST', token })
}

// PA25's alt-flow 2a — undo a scheduled cancellation before it takes effect.
export function resumePremium(token: string): Promise<Parent> {
  return request('/account/resume-premium', { method: 'POST', token })
}

// PA27 — View Billing History.
export function getBillingHistory(token: string): Promise<BillingRecord[]> {
  return request('/account/billing-history', { token })
}

// PA07 — Create Child Profile (bundles PA10 PIN — see backend model docstring).
export function createChild(
  token: string,
  data: { name: string; dob: string; pin: string; avatar_id?: string }
): Promise<ChildProfilePublic> {
  return request('/children', { method: 'POST', token, body: data })
}

// Parent's own children list.
export function listChildren(token: string): Promise<ChildProfilePublic[]> {
  return request('/children', { token })
}

export function getChild(token: string, childId: string): Promise<ChildProfilePublic> {
  return request(`/children/${childId}`, { token })
}

// PA08 — Edit Child Profile (also covers age-band changes).
export function updateChild(
  token: string,
  childId: string,
  fields: { name?: string; age_band?: string; avatar_id?: string; reading_level_guidance?: string }
): Promise<ChildProfilePublic> {
  return request(`/children/${childId}`, { method: 'PATCH', token, body: fields })
}

// PA10 — Set Child Profile PIN (standalone change, e.g. reset).
export function setChildPin(token: string, childId: string, pin: string): Promise<void> {
  return request(`/children/${childId}/pin`, { method: 'PATCH', token, body: { pin } })
}

// PA13 — Set Reading-Level Guidance.
export function setReadingLevel(token: string, childId: string, guidance: string): Promise<ChildProfilePublic> {
  return request(`/children/${childId}/reading-level`, {
    method: 'POST',
    token,
    body: { reading_level_guidance: guidance },
  })
}

// PA09 — Delete Child Profile.
export function deleteChild(token: string, childId: string): Promise<void> {
  return request(`/children/${childId}`, { method: 'DELETE', token })
}

// PA30 — Request Child Data Deletion (see backend docstring re: simplified to immediate).
export function requestChildDataDeletion(token: string, childId: string): Promise<void> {
  return request(`/children/${childId}/data-deletion-request`, { method: 'POST', token })
}

// PA14 — View Child's Activity (full chronological chat/recommendation log).
export function getActivity(token: string, childId: string): Promise<SessionWithMessages[]> {
  return request(`/children/${childId}/activity`, { token })
}

// PA15 — View Child's Saved Favourites (same endpoint as CH16, dual-auth on the backend).
export function getFavourites(token: string, childId: string): Promise<Favourite[]> {
  return request(`/children/${childId}/favourites`, { token })
}

// PA16 — Report/Flag Content from History.
export function createFlag(
  token: string,
  data: { child_id: string; catalogue_item_id?: string; message_id?: string; reason: string }
): Promise<Flag> {
  return request('/flags', { method: 'POST', token, body: data })
}

// PA17 — View Flagged Content Status.
export function listFlags(token: string): Promise<Flag[]> {
  return request('/flags', { token })
}

// PA18 — Hide Specific Content (approve/block override).
export function setContentOverride(
  token: string,
  childId: string,
  catalogueItemId: string,
  decision: 'approve' | 'block'
): Promise<ContentOverride> {
  return request(`/children/${childId}/content-overrides`, {
    method: 'POST',
    token,
    body: { catalogue_item_id: catalogueItemId, decision },
  })
}

export function listContentOverrides(token: string, childId: string): Promise<ContentOverride[]> {
  return request(`/children/${childId}/content-overrides`, { token })
}

// PA19 — View External Access Options for Saved Book.
export function getExternalLink(token: string, itemId: string): Promise<{ title: string; url: string }> {
  return request(`/catalogue/${itemId}/external-link`, { token })
}

// PA21 — Adjust Safety Settings. Actually enforced at recommend-time on the
// backend (see recommendation_service.py), not just stored.
export function updateSafetySettings(
  token: string,
  childId: string,
  data: Partial<SafetySettings>
): Promise<ChildProfilePublic> {
  return request(`/children/${childId}/safety-settings`, { method: 'PATCH', token, body: data })
}

// PA31 — View Full Activity History & Trends (Premium).
export function getChildTrends(token: string, childId: string): Promise<ActivityTrends> {
  return request(`/children/${childId}/trends`, { token })
}

// PA32 — View Multi-Child Comparative Insights (Premium). Route is
// `/children-insights`, not `/children/insights` — see backend router
// docstring for why (would collide with GET /children/{child_id}).
export function getComparativeInsights(token: string): Promise<ChildInsight[]> {
  return request('/children-insights', { token })
}
