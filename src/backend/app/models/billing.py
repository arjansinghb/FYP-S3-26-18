"""Premium subscription billing — PA23 (View Subscription Status, served
directly off `Parent.subscription_tier`, see app/routers/account.py's existing
GET /account), PA24 (Subscribe to Premium), PA25 (Cancel Premium), PA26
(Update Payment Method), PA27 (View Billing History).

Simulated by default (decision log, dev-sessions 2026-08-10/11): no real
payment processor account exists for this project, so nothing here is ever
actually charged. But — per supervisor guidance (2026-08-11) — the flow runs
through a real provider *abstraction* (app/services/payment/), not ad-hoc
mock logic in the router: `PaymentMethod`/`BillingRecord` below carry a
`provider_reference` exactly like they would against a real gateway, so
swapping `SimulatedPaymentProvider` for a real `StripePaymentProvider` later
(production only) is a one-line change in `payment/provider.py`, not a
redesign. The full card number is still never persisted anywhere, regardless
of provider.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

BillingEventType = Literal["subscribed", "cancelled"]
BillingCycle = Literal["monthly", "annual"]  # PA24 — Subscribe to Premium

# Shipped defaults for a fresh SystemSettings doc (SA13) — see
# app/models/admin.py's SystemSettings.premium_monthly_price_cents /
# premium_annual_price_cents, which is what PA24 actually reads at
# subscribe-time. Kept here too since a few tests/fixtures reference the
# monthly default directly.
PREMIUM_MONTHLY_PRICE_CENTS = 999
PREMIUM_ANNUAL_PRICE_CENTS = 9990


class SubscribeRequest(BaseModel):
    """PA24 — Subscribe to Premium. Defaults to monthly for backward
    compatibility with clients that don't send a body at all."""

    billing_cycle: BillingCycle = "monthly"


class PaymentMethodUpdate(BaseModel):
    """PA26. The raw card number only ever lives for the duration of this one
    request — `PaymentMethod` below (what actually gets stored) keeps just the
    brand + last 4 digits, same shape a real processor would hand back."""

    card_number: str = Field(min_length=12, max_length=19)
    exp_month: int = Field(ge=1, le=12)
    exp_year: int = Field(ge=2024, le=2100)

    @field_validator("card_number")
    @classmethod
    def _digits_only(cls, v: str) -> str:
        digits = v.replace(" ", "")
        if not digits.isdigit():
            raise ValueError("Card number must be digits only")
        return digits


class PaymentMethod(BaseModel):
    brand: str = "card"
    last4: str
    exp_month: int
    exp_year: int
    provider_reference: str | None = None  # e.g. Stripe's `pm_...` id — opaque to us either way


class BillingRecord(BaseModel):
    id: str
    parent_id: str
    event: BillingEventType
    amount_cents: int
    description: str
    created_at: datetime
    provider_reference: str | None = None  # e.g. Stripe's charge/invoice id
