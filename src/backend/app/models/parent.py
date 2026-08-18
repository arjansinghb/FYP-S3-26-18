"""Parent account models. Matches agent-context/CLAUDE.md §6 `parents/{parentId}`."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from app.models.billing import BillingCycle, PaymentMethod
from app.models.notification import NotificationPreferences

SubscriptionTier = Literal["free", "premium"]
AccountStatus = Literal["active", "suspended"]


class ConsentRecord(BaseModel):
    """PA28 — Provide Verifiable Parental Consent (PDPA)."""

    timestamp: datetime
    version: str = "v1"


class ConsentRequest(BaseModel):
    """PA28 — dev-session 2026-08-17: the URS's use-case description gives an
    explicit example of what "verifiable" should mean here — "re-authentication
    or payment-method verification". Going with re-authentication (re-enter
    password) since billing stays simulated/untouched per Kiefer's instruction
    — see agent-context/CLAUDE.md §15.9. Replaces the previous plain
    click-through."""

    password: str


class DataPrivacySettings(BaseModel):
    retention_preference: str = "standard"


class ParentCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    display_name: str = Field(min_length=1, max_length=100)


class ParentLogin(BaseModel):
    email: EmailStr
    password: str


class ParentUpdate(BaseModel):
    display_name: str | None = None
    email: EmailStr | None = None


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    """PA03 — confirm step, Firebase-only (see auth_service.confirm_password_reset).
    oob_code is the code Firebase embedded in the emailed reset link."""

    oob_code: str
    new_password: str


class Parent(BaseModel):
    id: str  # Firebase Auth uid (or local dev-store id)
    email: EmailStr
    display_name: str
    created_at: datetime
    subscription_tier: SubscriptionTier = "free"
    status: AccountStatus = "active"  # SA06/SA07 — Suspend/Unsuspend User Account
    consent_record: ConsentRecord | None = None
    data_privacy_settings: DataPrivacySettings = Field(default_factory=DataPrivacySettings)
    email_verified: bool = False  # UV06 — Verify Account
    notification_preferences: NotificationPreferences = Field(default_factory=NotificationPreferences)  # PA22
    payment_method: PaymentMethod | None = None  # PA26 (simulated — see app/models/billing.py)

    # PA24/PA25 — billing cycle + pending-cancellation state. No recurring-
    # billing job runner exists in this build, so "effective at period end"
    # (URS's PA25 normal flow) is approximated as a fixed cancel_at date set
    # at cancel time (30 days out for monthly, 365 for annual) rather than
    # computed off a real renewal schedule — see core/deps.py's
    # `_apply_pending_cancellation`, which lazily downgrades once that date
    # has passed (checked on every authenticated request, no cron needed).
    subscription_billing_cycle: BillingCycle | None = None
    subscription_started_at: datetime | None = None
    subscription_cancel_at: datetime | None = None  # set => "Premium until this date, then Free"

    @property
    def has_consented(self) -> bool:
        return self.consent_record is not None


class AuthResponse(BaseModel):
    parent: Parent
    token: str
