"""Request/response shapes (Pydantic). These define the API's contract."""
from typing import Literal, Optional
from pydantic import BaseModel, Field

AgeBand = Literal["5-8", "9-12"]
ContentType = Literal["book", "video"]

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
    tier: Literal["free", "premium"] = "free"  # PA33/34/35 gating


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = Field(default=None, min_length=6)


class AuthOut(BaseModel):
    token: str
    account: AccountOut


class SignupOut(AuthOut):
    # Dev mode only (see VerifyRequestOut) — lets the signup response itself
    # carry the verification token instead of nothing happening because no
    # email service is configured.
    verify_token: Optional[str] = None


# ----- UV06 email verification / PA03 password reset -----
# Dev-mode: no email service is configured, so both flows return the token
# directly in the API response instead of emailing it — same honest pattern
# the other branch uses for its own no-email-service gaps. A teammate with
# SMTP/Firebase credentials can swap the "return token" step for an actual
# send later without touching the confirm side.


class VerifyRequestOut(BaseModel):
    token: str
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
    billing_cycle: Literal["monthly", "annual"] = "monthly"
    payment_method: Optional[PaymentMethodIn] = None  # PA24 includes PA26 in the same flow


class SubscriptionStatusOut(BaseModel):
    tier: Literal["free", "premium"]
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


class ChildTrendsOut(BaseModel):
    child_id: str
    total_messages: int
    total_recommendations: int
    favourites_count: int
    top_genres: list[str] = []


class ChildComparisonOut(BaseModel):
    child_id: str
    name: str
    total_messages: int
    total_recommendations: int
    favourites_count: int
    top_genres: list[str] = []


# ----- child profiles -----


PIN_PATTERN = r"^\d{6}$"  # URS PA10: "exactly six digits" — also doubles as the CH01 linking code


class ChildCreate(BaseModel):
    name: str
    age_band: AgeBand
    reading_level: Optional[str] = None
    pin: str = Field(pattern=PIN_PATTERN)


class ChildUpdate(BaseModel):
    name: Optional[str] = None
    age_band: Optional[AgeBand] = None
    reading_level: Optional[str] = None
    pin: Optional[str] = Field(default=None, pattern=PIN_PATTERN)


class ChildSettings(BaseModel):
    allow_books: bool = True
    allow_videos: bool = True
    block_external_links: bool = True


class ChildOut(BaseModel):
    id: str
    parent_id: str
    name: str
    age_band: AgeBand
    reading_level: Optional[str]
    linking_code: str
    avatar: str
    settings: ChildSettings
    locked: bool = False  # CH02 Alt Flow 2a — too many wrong PINs


class ChildLinkRequest(BaseModel):
    """CH01 — first-time device activation. Per the URS, the "linking code"
    IS the 6-digit PIN (PA10 sets one value that does both jobs) — `code`
    and `pin` are compared against the same stored value, not two different
    ones. Kept as two fields on the wire since CH01/CH02 are worded as two
    separate steps, but they always match."""
    code: str
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


class ContentOut(ContentIn):
    id: str
    status: Literal["approved", "pending", "rejected"]


# ----- chat / recommendations -----


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None  # CH04 — ties this message to a chat session


class Recommendation(BaseModel):
    id: str
    type: ContentType
    title: str
    explanation: str
    description: str = ""
    external_ref: Optional[str] = None  # YouTube id for videos, once curated
    thumbnail: Optional[str] = None  # CH14 "cover"


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


class ReportOut(BaseModel):
    id: str
    content_id: str
    content_title: str
    reason: str
    status: str
    ts: float


class ResolveReport(BaseModel):
    action: Literal["dismiss", "remove"] = "dismiss"
