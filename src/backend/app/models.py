"""Request/response shapes (Pydantic). These define the API's contract."""
from typing import Literal, Optional
from pydantic import BaseModel, Field, model_validator

AgeBand = Literal["5-8", "9-12"]
ArticulationLevel = Literal["explorer", "adventurer", "storyteller"]
ContentType = Literal["book", "video"]
# Optional, parent-supplied, never required — a child profile is valid with
# neither set. "prefer_not_to_say" is a real, first-class choice here (not
# just an absent value), since the field is being surfaced on the form at
# all and a parent should be able to say so explicitly rather than the
# option just being to leave it blank.
Gender = Literal["girl", "boy", "prefer_not_to_say"]
# A child's declared interests — plain strings, not a Literal enum, since
# the real set of catalogue genres (CM09/CM10) can grow as moderators tag
# new content, and this shouldn't need a backend deploy to keep up. The
# frontend's picker (ParentDashboard.jsx's INTEREST_OPTIONS) offers the
# genres actually present in the live catalogue, so in practice this is
# self-consistent with real content without the backend having to enforce
# it structurally.
Interests = list[str]
# PA33/34/35 gating. Gates elsewhere in the app check "== free" ("free vs.
# anything paid"), never a specific paid tier's name.
AccountTier = Literal["free", "premium"]

# ----- accounts / auth -----


class SignupRequest(BaseModel):
    email: str
    password: str = Field(min_length=6)
    name: str


class LoginRequest(BaseModel):
    email: str
    password: str


class AccountOut(BaseModel):
    id: str
    email: str
    name: str
    role: str
    verified: bool
    tier: AccountTier = "free"
    # Real, pre-existing gap found while testing gender/interests (this field
    # was never on AccountOut at all, on any code path): the frontend reads
    # `account.consent` directly (ParentDashboard.jsx) to decide whether to
    # show PA28's "Before you add a child..." re-confirmation step, but
    # every fresh login returned an account with no `consent` key — so a
    # parent who had already given consent, sometimes with existing child
    # profiles, was asked to re-enter their password and re-agree every
    # single time they opened "Add a child profile". `give_consent()` only
    # ever set `account["consent"]` to a `{timestamp, version}` dict or left
    # it `None`; this exposes that as the plain boolean the frontend was
    # always expecting.
    consent: bool = False


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = Field(default=None, min_length=6)


class AuthOut(BaseModel):
    token: str
    account: AccountOut


class SignupOut(AuthOut):
    # Only set in dev mode (see VerifyRequestOut) — real-email mode (Resend
    # configured, app/email_service.py) leaves this null so the token never
    # rides along in an API response that anyone could read; the recipient
    # has to actually open the email.
    verify_token: Optional[str] = None


# ----- UV06 email verification / PA03 password reset -----
# Two modes, decided per-request by whether app/email_service.py's Resend
# key is configured (settings.resend_configured):
#   - dev mode (no key): unchanged from before — the token comes back
#     directly in the API response instead of being emailed, `note` says so.
#   - real mode (key set): a real email is sent, `token` stays null in the
#     response, `note` says to check the inbox instead.


class VerifyRequestOut(BaseModel):
    token: Optional[str] = None
    note: str = "Dev mode: no email service configured, so the token is returned here directly instead of being emailed."


class VerifyConfirm(BaseModel):
    token: str


class PasswordResetRequest(BaseModel):
    email: str


class PasswordResetRequestOut(BaseModel):
    token: Optional[str] = None
    note: str = "Dev mode: no email service configured. If this address is registered, the reset token is returned here directly instead of being emailed."


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str = Field(min_length=6)


# ----- PA28/29/30 consent, privacy, data deletion -----


class ConsentRequest(BaseModel):
    password: str  # re-verifies the parent before recording consent


class ConsentOut(BaseModel):
    given: bool
    timestamp: Optional[float] = None


class PrivacySettings(BaseModel):
    retention_preference: Literal["standard", "minimal"] = "standard"


class DataDeletionRequestOut(BaseModel):
    id: str
    child_id: str
    status: Literal["pending", "completed", "cancelled"]
    requested_at: float
    scheduled_for: float


# ----- PA20/22 notifications -----
# URS: "channels (in-app, email, push)". Only in_app actually delivers
# anything in this prototype (no email/push service exists) — email/push
# toggle and persist but don't deliver, same honesty-over-fake-completeness
# pattern the other branch uses for its own identical gap.


class NotificationChannels(BaseModel):
    in_app: bool = True
    email: bool = False
    push: bool = False


class NotificationPreferences(BaseModel):
    channels: NotificationChannels = NotificationChannels()


class NotificationOut(BaseModel):
    id: str
    type: str
    title: str
    body: str
    created_at: float
    read: bool


# ----- PA23-27 billing (simulated — see storage.py's subscribe/cancel_subscription) -----


class PaymentMethodIn(BaseModel):
    brand: str
    last4: str = Field(min_length=4, max_length=4)


class PaymentMethodOut(BaseModel):
    brand: str
    last4: str


class SubscribeRequest(BaseModel):
    tier: Literal["premium"] = "premium"
    billing_cycle: Literal["monthly", "annual"] = "monthly"
    payment_method: Optional[PaymentMethodIn] = None  # PA24 includes PA26 in the same flow


class SubscriptionStatusOut(BaseModel):
    tier: AccountTier
    billing_cycle: Optional[str] = None
    started_at: Optional[float] = None
    cancel_at: Optional[float] = None
    payment_method: Optional[PaymentMethodOut] = None


class BillingRecordOut(BaseModel):
    id: str
    description: str
    amount_cents: int
    ts: float


# ----- PA18 per-child content override -----


class ContentOverrideIn(BaseModel):
    action: Literal["approve", "hide"]


class ContentOverrideOut(BaseModel):
    content_id: str
    action: Literal["approve", "hide"]


# ----- PA31/32 premium insights -----


class GenreCount(BaseModel):
    genre: str
    count: int


class ChildTrendsOut(BaseModel):
    child_id: str
    total_messages: int
    total_recommendations: int
    favourites_count: int
    top_genres: list[str] = []
    # Richer breakdown behind the Insights tab's charts. Timestamps (not
    # pre-bucketed days) so the browser can bucket by the parent's own
    # timezone instead of the server's.
    genre_counts: list[GenreCount] = []
    books_recommended: int = 0
    videos_recommended: int = 0
    message_timestamps: list[float] = []
    interests: list[str] = []  # what the parent declared, to compare against what they actually read


class ChildComparisonOut(BaseModel):
    child_id: str
    name: str
    total_messages: int
    total_recommendations: int
    favourites_count: int
    top_genres: list[str] = []


# ----- child profiles -----


class ChildCreate(BaseModel):
    """No `pin` field — it's system-generated (storage._generate_unique_pin),
    not parent-typed. See that function's docstring: letting a parent freely
    choose a value that must also be globally unique caused real "PIN
    already taken" collisions as the child count grew, for zero benefit
    (nothing about this code needs to be memorable to the parent — it's
    read off the dashboard and handed to the child, not typed from memory)."""
    name: str
    # Date of birth is what the form asks for now; the age band is derived
    # from it (profile.band_from_dob). `age_band` alone is still accepted so
    # older clients and tests keep working, but one of the two is required.
    dob: Optional[str] = None  # ISO YYYY-MM-DD
    age_band: Optional[AgeBand] = None
    reading_level: Optional[str] = None
    # Both optional, requested by the assessor so the profile captures more
    # than the bare minimum needed to *gate* content (age_band) — gender and
    # interests feed the brain directly (see brain.py's respond()) instead
    # of Pip having to infer a child's tastes purely from what they happen
    # to type in their first few messages.
    gender: Optional[Gender] = None
    interests: Interests = []

    @model_validator(mode="after")
    def _needs_dob_or_band(self):
        if not self.dob and not self.age_band:
            raise ValueError("Enter your child's date of birth.")
        return self


class ChildUpdate(BaseModel):
    """No `pin` field here either — see ChildCreate's docstring. A parent
    resets the code via POST /children/{id}/regenerate-pin instead of typing
    a replacement value, for the same reason."""
    name: Optional[str] = None
    dob: Optional[str] = None
    age_band: Optional[AgeBand] = None
    reading_level: Optional[str] = None
    gender: Optional[Gender] = None
    interests: Optional[Interests] = None


class ChildSettings(BaseModel):
    allow_books: bool = True
    allow_videos: bool = True
    block_external_links: bool = True


class ChildOut(BaseModel):
    # `login_id` (identifies the child) and `pin` (the actual secret) both
    # go to the PARENT here, same reasoning for both: the parent is the one
    # who reads them off this dashboard and hands them to their child at
    # CH01 setup, or re-reads pin if the child forgets it — this is a
    # parent-facing read, not exposing a secret to an untrusted caller (a
    # child's own session token only ever reaches /api/child/me, a
    # different, narrower response — see routers/child.py).
    id: str
    parent_id: str
    name: str
    age_band: AgeBand
    reading_level: Optional[str]
    gender: Optional[Gender] = None
    interests: Interests = []
    dob: Optional[str] = None
    # Earned, separate from the parent-set `reading_level` above: reading
    # level drives how hard the content is, articulation level is how well
    # the child explains what they read (see routers/articulation.py).
    articulation_level: ArticulationLevel = "explorer"
    articulation_progress: int = 0  # confirmations toward the next level (0-2)
    pending_explanations: int = 0   # waiting for the parent to confirm or decline
    login_id: str
    pin: str
    avatar: str
    settings: ChildSettings
    locked: bool = False  # CH02 Alt Flow 2a — too many wrong PINs


class ChildLinkRequest(BaseModel):
    """CH01 — first-time device activation. `login_id` (alphanumeric,
    identifies the child, shown on the parent dashboard) and `pin` (numeric,
    the actual secret) are two genuinely different values as of 2026-09-09 —
    see storage.create_child's docstring for why this replaced the earlier
    design where one 6-digit value did both jobs. Both are only ever typed
    together at this one CH01 step, usually parent-assisted; CH02's return
    login (ChildPinLogin below) only ever asks for `pin`."""
    login_id: str
    pin: str


class ChildPinLogin(BaseModel):
    """CH02 — return login on a device already activated (CH01 already
    happened once). PIN only — the linking code isn't re-asked for."""
    pin: str


class ChildSessionOut(BaseModel):
    token: str
    child: ChildOut


# ----- CH04/05 chat session lifecycle (kept distinct from ChildSessionOut
# above, which is the *login* session — this is the *conversation* session) -----


class ChatSessionOut(BaseModel):
    id: str
    child_id: str
    started_at: float
    ended_at: Optional[float] = None


# ----- content catalogue -----


class ContentIn(BaseModel):
    type: ContentType
    title: str
    description: str
    age_bands: list[AgeBand]
    genres: list[str] = []
    reading_level: Optional[str] = None
    source: str = "manual"
    external_ref: Optional[str] = None
    thumbnail: Optional[str] = None  # CH14 "cover" — cover image URL


class AuditDecision(BaseModel):
    decision: Literal["confirm", "overturn"]
    note: Optional[str] = None


class BulkImportRequest(BaseModel):
    topic: str
    type: Literal["book", "video", "any"]  # "any": no format was asked for, so search both
    limit: int = 10
    auto_approve: bool = True


class ContentOut(ContentIn):
    id: str
    status: Literal["approved", "pending", "rejected"]
    # CM06 triage aid (app/ai_assist.py's suggest_catalogue_decision) —
    # server-computed at import time, never client-supplied (not on
    # ContentIn), and always advisory: the moderator's own approve/reject
    # is what actually decides an item's status, this just orders/explains
    # what they see first in a long submissions queue.
    ai_suggestion: Optional[Literal["approve", "reject"]] = None
    ai_reason: Optional[str] = None
    ai_confidence: Optional[Literal["low", "medium", "high"]] = None
    # Never tracked at all until now (real gap, flagged directly: no way
    # to tell a moderator WHEN something was submitted/imported or
    # approved/rejected, let alone by whom) — feeds Moderator Overview's
    # "Recent activity" feed. `created_at` is set once, at add/import time
    # (see storage.add_content); `reviewed_at`/`reviewed_by` are set once,
    # the first time the item is approved or rejected (see routers/
    # content.py's approve()/reject()/add_entry()) — a manually-added entry
    # is auto-approved by its own creator, so it gets both stamps at once.
    created_at: Optional[float] = None
    reviewed_at: Optional[float] = None
    # CH14 — a real, child-facing synopsis (app/ai_assist.py's
    # generate_synopsis), server-computed once when an item goes live, never
    # client-supplied. `description` above stays the raw scraped listing
    # text (never shown to a child, see ChildChat.jsx's own comment on why)
    # — this is the actual curated summary Pip's Details view reads from.
    synopsis: Optional[str] = None
    reviewed_by: Optional[str] = None
    # True when bulk import's auto-triage (app/bulk_import.py) approved or
    # rejected this without a human — lets the console mark and later sample it.
    auto_triaged: Optional[bool] = None
    # QA audit (app/bulk_import.py's AUDIT_SAMPLE_RATE, routers/content.py's
    # /audit-queue and /{id}/audit): "pending" = sampled, waiting for a
    # moderator's confirm/overturn; "not_sampled" = auto-triaged but not
    # picked; "confirmed"/"overturned" = a moderator's verdict on this AI
    # decision. None for anything not auto-triaged at all.
    audit_status: Optional[Literal["pending", "not_sampled", "confirmed", "overturned"]] = None
    audited_at: Optional[float] = None
    audited_by: Optional[str] = None
    audit_note: Optional[str] = None


# ----- chat / recommendations -----


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None  # CH04 — ties this message to a chat session


class AckResolvedTopicRequest(BaseModel):
    """POST /api/chat/resolved-topics/ack — the topic string GET
    /resolved-topics just returned, so it's stamped as already-mentioned
    and never resurfaced to this child again."""
    topic: str


class SpeechRequest(BaseModel):
    """/api/chat/speech — text Pip just said, to be voiced back as real
    audio via OpenAI TTS. Length-capped (see the router) since this is
    always Pip's own reply text, never arbitrary child input."""
    text: str


class Recommendation(BaseModel):
    id: str
    type: ContentType
    title: str
    explanation: str
    description: str = ""
    # CH14's Details view — a real, genuine synopsis (app/ai_assist.py's
    # generate_synopsis), distinct from `explanation` (why THIS pick fits
    # what the child asked for) and from `description` (raw scraped
    # listing text, never shown to a child — see ChildChat.jsx). None for
    # an item that predates this feature or whose generation failed; the
    # frontend falls back to `explanation` in that case.
    synopsis: Optional[str] = None
    external_ref: Optional[str] = None  # YouTube id for videos, once curated
    thumbnail: Optional[str] = None  # CH14 "cover"
    genres: list[str] = []  # CM10 tags, already on every catalogue item — was
    # computed at moderation time and then never sent to the child client, so
    # a card had no structured signal beyond one sentence of prose.


class ChatResponse(BaseModel):
    reply: str
    recommendations: list[Recommendation] = []


class AvatarUpdate(BaseModel):
    avatar: str


class FeedbackRequest(BaseModel):
    content_id: str
    liked: bool


class ReportRequest(BaseModel):
    content_id: str
    reason: str


# ---------- UV04: parent-submitted reviews, shown on the public landing
# page. Genuinely new — the landing page's earlier "Why families trust
# Pip" section deliberately used verifiable product claims instead of
# invented user quotes (see Home.jsx's TRUST_POINTS comment); this is the
# real version of that idea, sitting alongside it: an actual parent writes
# an actual review, which only ever becomes public after (1) an automated
# safety screen and (2) explicit admin approval — same two-layer pattern
# already used for the child chat's own input safety and the content
# catalogue's moderation queue, applied here to user-generated text
# instead of a child's message or a catalogue submission.
class ReviewCreate(BaseModel):
    rating: int  # 1-5
    text: str


class ReviewOut(BaseModel):
    id: str
    parent_name: str
    rating: int
    text: str
    status: Literal["pending", "rejected", "approved"]
    created_at: float
    reviewed_at: Optional[float] = None  # set once, on approve/reject — Admin Overview's "Recent activity"
    reviewed_by: Optional[str] = None
    rejection_reason: Optional[str] = None
    # UV04/admin triage aid (app/ai_assist.py's suggest_review) — computed
    # once at submission time, advisory-only: an admin still approves or
    # rejects every review themselves, this just helps them find the ones
    # worth reading first once there are far more than fit on one screen.
    ai_recommend: Optional[bool] = None
    ai_reason: Optional[str] = None
    # Admin Reviews tab — an "approved" review isn't automatically visible:
    # public.py's /reviews caps at the best 10 (storage.public_reviews).
    # True/False only for approved reviews (computed against that same
    # top-10 cut in admin.py's list_reviews); null for pending/rejected,
    # where "published" doesn't apply yet.
    published: Optional[bool] = None


class PublicReviewOut(BaseModel):
    """What an unregistered visitor actually sees — no parent id, no
    status/rejection detail, just the finished, approved review."""
    parent_name: str
    rating: int
    text: str


class ReportOut(BaseModel):
    id: str
    content_id: str
    content_title: str
    content_type: Optional[Literal["book", "video"]] = None  # None if the content was since removed
    thumbnail: Optional[str] = None  # cover image, for the moderator's report cards
    reason: str
    status: str
    ts: float
    resolved_at: Optional[float] = None  # set once, in resolve_report() — same "Recent activity" feed as ContentOut
    outcome: Optional[Literal["removed", "no_change"]] = None  # what the moderator decided; None while the report is open
    note: Optional[str] = None  # optional message from the moderator to the parent who reported


class ResolveReport(BaseModel):
    action: Literal["dismiss", "remove"] = "dismiss"


class ReportNote(BaseModel):
    """A message from a moderator to the parent who made a report. Separate from
    resolving it: sending one never changes the report's status, and the child
    never sees it."""
    note: str = Field(min_length=1, max_length=300)

    @model_validator(mode="after")
    def _not_blank(self):
        self.note = self.note.strip()
        if not self.note:
            raise ValueError("Write a note first.")
        return self


# ----- articulation levels (CH21/CH22, PA34-PA37) -----

class ExplainRequest(BaseModel):
    content_id: str
    text: str
    input_mode: Literal["voice", "text"] = "text"


class ExplainOut(BaseModel):
    pip_reply: str
    # False when the message was turned away by the safety screen: Pip still
    # answers kindly, but nothing is logged and the item stays free to try.
    saved: bool = True


class LevelOut(BaseModel):
    level: ArticulationLevel
    label: str
    descriptor: str
    progress: int
    needed: int
    next_level: Optional[ArticulationLevel] = None
    next_label: Optional[str] = None
    pending: int = 0  # explanations waiting on the parent (parent view only)


class LevelUpOut(BaseModel):
    level_up: Optional[dict] = None  # {"from", "to", "from_label", "to_label"} until acknowledged


class ExplanationOut(BaseModel):
    id: str
    content_id: str
    title: str
    type: ContentType
    thumbnail: Optional[str] = None
    genres: list[str] = []
    text: str
    input_mode: Literal["voice", "text"]
    level_at: ArticulationLevel
    level_label: str
    level_descriptor: str
    status: Literal["pending", "confirmed", "declined"]
    created_at: float
    decided_at: Optional[float] = None


class DecideOut(BaseModel):
    explanation: ExplanationOut
    level: LevelOut
    leveled_up: bool = False


class LevelStep(BaseModel):
    level: ArticulationLevel
    label: str
    at: float


class ArticulationTrendsOut(BaseModel):
    level_history: list[LevelStep] = []
    total: int = 0
    confirmed: int = 0
    declined: int = 0
    pending: int = 0
    top_genres: list[GenreCount] = []
    explained_per_week: list[int] = []  # oldest first, last 8 weeks


# ----- browse (CH20-style catalogue tiles) -----

class BrowseCategory(BaseModel):
    genre: str
    count: int


class BrowseItemsOut(BaseModel):
    items: list[Recommendation]
    total: int
    has_more: bool
