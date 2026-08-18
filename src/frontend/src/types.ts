// Mirrors src/backend/app/models/*.py response shapes (subset actually used
// by this UI). Keep in sync manually for now — no shared codegen yet.

export type AgeBand = '5-8' | '9-12'

export interface SafetySettings {
  blocked_topics: string[]
  strict_age_filtering: boolean
}

export interface ChildProfilePublic {
  id: string
  parent_id: string
  name: string
  age_band: AgeBand
  avatar_id: string | null
  reading_level_guidance: string | null
  created_at: string
  favourites_count: number
  safety_settings: SafetySettings
}

export interface ChildLoginResult {
  profile: ChildProfilePublic
  session_token: string
  /** true the very first time this profile ever logs in (CH01, "Enter Linking
   * Code to Activate Profile") — false every time after (CH02, "Log In (PIN)").
   * See agent-context/CLAUDE.md §2.2 point 3. */
  activated: boolean
}

export type ContentType = 'book' | 'video'

export interface RecommendationOut {
  item_id: string
  title: string
  type: ContentType
  reason: string
  /** CH12 — Watch Embedded Video. Set only for type === 'video'. */
  embed_url: string | null
}

export type SessionStatus = 'active' | 'ended'

export interface ChatSession {
  id: string
  child_id: string
  started_at: string
  ended_at: string | null
  status: SessionStatus
  clarifying_rounds: number
  shown_item_ids: string[]
}

export interface BotReply {
  message: string
  clarifying_question: string | null
  recommendations: RecommendationOut[]
  session_status: SessionStatus
}

export type Sender = 'child' | 'bot'

export interface ChatMessage {
  id: string
  session_id: string
  sender: Sender
  text: string
  timestamp: string
  recommendation_refs: string[]
}

export interface Favourite {
  id: string
  child_id: string
  catalogue_item_id: string
  saved_at: string
}

export interface ApiErrorBody {
  detail: string
}

export interface SessionWithMessages extends ChatSession {
  messages: ChatMessage[]
}

// --- Parent-facing types (PA/UV use cases) ---

export type SubscriptionTier = 'free' | 'premium'

export interface ConsentRecord {
  timestamp: string
  version: string
}

export interface DataPrivacySettings {
  retention_preference: string
}

// PA22 — Set Notification Preferences. `email`/`push` are schema-ready, not
// functional yet — see src/backend/app/models/notification.py.
export interface NotificationChannels {
  in_app: boolean
  email: boolean
  push: boolean
}

export interface NotificationPreferences {
  flag_resolved: boolean
  child_activated: boolean
  channels: NotificationChannels
}

// PA26 — Update Payment Method (simulated; never a real card number).
export interface PaymentMethod {
  brand: string
  last4: string
  exp_month: number
  exp_year: number
  /** Opaque reference from the payment provider (simulated by default — see
   * src/backend/app/services/payment/). Not shown in the UI, kept only for
   * type parity with the API response. */
  provider_reference: string | null
}

export type BillingCycle = 'monthly' | 'annual'

export interface Parent {
  id: string
  email: string
  display_name: string
  created_at: string
  subscription_tier: SubscriptionTier
  consent_record: ConsentRecord | null
  data_privacy_settings: DataPrivacySettings
  email_verified: boolean
  notification_preferences: NotificationPreferences
  payment_method: PaymentMethod | null
  subscription_billing_cycle: BillingCycle | null
  subscription_started_at: string | null
  /** PA25 — set once Cancel Premium has been requested; Premium stays active
   * until this date, then lazily downgrades (see core/deps.py). */
  subscription_cancel_at: string | null
}

export interface AuthResponse {
  parent: Parent
  token: string
}

// PA20 — Receive Notifications.
export type NotificationType = 'flag_resolved' | 'child_activated'

export interface AppNotification {
  id: string
  parent_id: string
  type: NotificationType
  title: string
  body: string
  child_id: string | null
  created_at: string
  read_at: string | null
  channels_attempted: ('in_app' | 'email' | 'push')[]
}

// PA24-27 — Premium billing (simulated).
export type BillingEventType = 'subscribed' | 'cancelled'

export interface BillingRecord {
  id: string
  parent_id: string
  event: BillingEventType
  amount_cents: number
  description: string
  created_at: string
  provider_reference: string | null
}

// PA31 — View Full Activity History & Trends.
export interface ActivityTrends {
  child_id: string
  total_sessions: number
  sessions_by_week: Record<string, number>
  top_topics: string[]
}

// PA32 — View Multi-Child Comparative Insights.
export interface ChildInsight {
  child_id: string
  child_name: string
  total_sessions: number
  total_favourites: number
}

export type FlagStatus = 'pending' | 'approved' | 'removed'

export interface Flag {
  id: string
  parent_id: string
  child_id: string
  catalogue_item_id: string | null
  message_id: string | null
  reason: string
  status: FlagStatus
  raised_at: string
  resolved_at: string | null
  resolution_note: string | null
}

export type OverrideDecision = 'approve' | 'block'

export interface ContentOverride {
  id: string
  child_id: string
  catalogue_item_id: string
  decision: OverrideDecision
  created_at: string
}

// --- Staff (Content Moderator / System Admin) types ---

export type StaffRole = 'moderator' | 'admin'
export type CatalogueStatus = 'pendingReview' | 'pendingTagging' | 'live' | 'rejected' | 'removed'

export interface StaffPublic {
  id: string
  email: string
  role: StaffRole
}

export interface StaffLoginResult {
  staff: StaffPublic
  token: string
}

export interface CatalogueItemFull {
  id: string
  title: string
  type: ContentType
  synopsis: string
  age_bands: AgeBand[]
  genre: string | null
  topics: string[]
  reading_level: string | null
  source_url: string | null
  embedding: number[] | null
  status: CatalogueStatus
  moderator_id: string | null
  created_at: string
}

export interface ContentSearchResult {
  external_id: string
  title: string
  synopsis: string
  thumbnail: string | null
  source_url: string | null
  extra: string | null
}

// --- System Admin types ---

export type AccountStatus = 'active' | 'suspended'

export interface AdminUserSummary {
  id: string
  email: string
  display_name: string
  account_type: 'parent'
  subscription_tier: SubscriptionTier
  status: AccountStatus
  created_at: string
}

export interface SystemHealth {
  status: string
  firebase_configured: boolean
  openai_configured: boolean
  catalogue_item_count: number
  parent_count: number
  child_profile_count: number
  // Real measured numbers (app/core/metrics.py), not hardcoded — see SA08.
  uptime_seconds: number
  window_seconds: number
  request_count_window: number
  error_count_window: number
  error_rate_window: number
  avg_latency_ms: number | null
  nlp_avg_latency_ms: number | null
  nlp_sample_count_window: number
}

export interface IntegrationStatus {
  firebase: boolean
  openai: boolean
  google_books: boolean
  youtube_data: boolean
}

// SA10 (Compliance & Data-Retention) + SA11 (System Settings) + SA13
// (Manage Billing System Configuration) — one settings doc, see
// src/backend/app/models/admin.py.
export interface SystemSettings {
  data_retention_days: number
  default_age_band_threshold: number
  premium_monthly_price_cents: number
  premium_annual_price_cents: number
  /** SA13 tying into content_source_service.py's YouTube search — empty
   * means "not curated yet", falls back to open safeSearch=strict search. */
  youtube_channel_allowlist: string[]
  updated_at: string | null
}
