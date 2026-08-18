"""PA04-PA06 (View/Update/Delete Account) + PA28 (Provide Verifiable Parental
Consent) — the consent gate lives here rather than under /children because it's
account-level and must exist *before* the first child profile can be created
(PA07's precondition) — see agent-context/CLAUDE.md §2.2 point 1.

Also PA23-PA27 (Premium billing — simulated by default, real gateway
swap-in-ready, see app/services/payment/): PA23 (View Subscription Status) is
just `Parent.subscription_tier` off the existing GET below, no dedicated
endpoint needed.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import get_current_parent
from app.models.admin import SystemSettings
from app.models.billing import (
    BillingRecord,
    PaymentMethod,
    PaymentMethodUpdate,
    SubscribeRequest,
)
from app.models.parent import ConsentRecord, ConsentRequest, DataPrivacySettings, Parent, ParentUpdate
from app.repositories import billing as billing_repo
from app.repositories import parents
from app.repositories.store import COLLECTION_SYSTEM_SETTINGS, get_store
from app.services import auth_service
from app.services.payment.provider import get_payment_provider

router = APIRouter(prefix="/account", tags=["account"])

_MONTHLY_PERIOD = timedelta(days=30)
_ANNUAL_PERIOD = timedelta(days=365)


def _get_system_settings() -> SystemSettings:
    """SA13 — admin-configured Premium pricing lives on the same singleton
    settings doc as SA10/SA11 (see app/routers/admin.py)."""
    doc = get_store().get(COLLECTION_SYSTEM_SETTINGS, "default")
    return SystemSettings(**doc) if doc else SystemSettings()


@router.get("", response_model=Parent)
def get_account(parent: Parent = Depends(get_current_parent)) -> Parent:
    return parent


@router.patch("", response_model=Parent)
def update_account(data: ParentUpdate, parent: Parent = Depends(get_current_parent)) -> Parent:
    if data.email and data.email != parent.email and parents.get_parent_by_email(data.email) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already in use")
    fields = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if fields:
        parents.update_parent(parent.id, **fields)
    return parents.get_parent(parent.id)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_account(parent: Parent = Depends(get_current_parent)) -> None:
    # NOTE: does not yet cascade-delete child profiles/sessions — see
    # src/backend/README.md known gaps.
    auth_service.delete_parent_account(parent)


@router.post("/consent", response_model=ConsentRecord, status_code=status.HTTP_201_CREATED)
def provide_consent(data: ConsentRequest, parent: Parent = Depends(get_current_parent)) -> ConsentRecord:
    """PA28 — one-time gate; re-calling this just re-records consent
    (harmless). Re-verifies the parent's password first (see
    ConsentRequest's docstring) — reuses the same check PA01 login already
    does, so a mismatch raises the same 401 a bad login would."""
    auth_service.login_parent(parent.email, data.password)
    return parents.record_consent(parent.id)


@router.patch("/privacy-settings", response_model=DataPrivacySettings)
def update_privacy_settings(
    data: DataPrivacySettings, parent: Parent = Depends(get_current_parent)
) -> DataPrivacySettings:
    """PA29 — Manage Data Privacy Settings. Was modelled (Parent.data_privacy_settings,
    defaulted on every account) but had no way to actually change it until now —
    PATCH /account above only ever touched display_name/email."""
    parents.update_parent(parent.id, data_privacy_settings=data.model_dump())
    return data


@router.put("/payment-method", response_model=PaymentMethod)
def update_payment_method(data: PaymentMethodUpdate, parent: Parent = Depends(get_current_parent)) -> PaymentMethod:
    """PA26 — Update Payment Method. Goes through the PaymentProvider
    abstraction (app/services/payment/) rather than deriving last4 inline —
    simulated today, but the round-trip is real, so swapping in a production
    provider later touches provider.py only. The full card number is never
    persisted on our side either way."""
    provider = get_payment_provider()
    result = provider.save_payment_method(parent.id, data.card_number, data.exp_month, data.exp_year)
    method = PaymentMethod(
        brand=result.brand,
        last4=result.last4,
        exp_month=result.exp_month,
        exp_year=result.exp_year,
        provider_reference=result.provider_reference,
    )
    parents.update_parent(parent.id, payment_method=method.model_dump())
    return method


@router.post("/subscribe", response_model=Parent)
def subscribe_to_premium(
    data: SubscribeRequest = SubscribeRequest(), parent: Parent = Depends(get_current_parent)
) -> Parent:
    """PA24 — Subscribe to Premium. Requires a payment method on file first,
    same order-of-operations a real checkout would enforce. Charges through
    the PaymentProvider abstraction (simulated by default — see
    app/services/payment/) rather than just flipping the tier and hoping.
    Price is admin-configured (SA13), not a hardcoded constant."""
    if parent.subscription_tier == "premium":
        raise HTTPException(status.HTTP_409_CONFLICT, "Already on Premium")
    if parent.payment_method is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Add a payment method first (PA26)")

    pricing = _get_system_settings()
    amount_cents = (
        pricing.premium_annual_price_cents if data.billing_cycle == "annual" else pricing.premium_monthly_price_cents
    )

    provider = get_payment_provider()
    charge = provider.charge_subscription(parent.id, parent.payment_method.provider_reference or "", amount_cents)
    if charge.status != "succeeded":
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "Payment failed — try a different payment method.")

    now = datetime.now(timezone.utc)
    parents.update_parent(
        parent.id,
        subscription_tier="premium",
        subscription_billing_cycle=data.billing_cycle,
        subscription_started_at=now,
        subscription_cancel_at=None,
    )
    billing_repo.create_billing_record(
        parent.id,
        "subscribed",
        amount_cents,
        f"Premium subscription ({data.billing_cycle})",
        charge.provider_reference,
    )
    return parents.get_parent(parent.id)


@router.post("/cancel-premium", response_model=Parent)
def cancel_premium(parent: Parent = Depends(get_current_parent)) -> Parent:
    """PA25 — Cancel Premium: effective at the end of the current billing
    period (URS normal flow step 2 — "System confirms the effective
    downgrade date"), not instant. Sets `subscription_cancel_at`;
    `core/deps.py`'s `_apply_pending_cancellation` lazily downgrades once
    that date passes (see its own docstring for why no cron job).

    Existing child profiles/favourites over the free-tier cap aren't deleted
    even after the downgrade lands (PA33/PA34's limits only block *new*
    profiles/favourites going forward) — same grandfathering most real
    subscription products do."""
    if parent.subscription_tier != "premium":
        raise HTTPException(status.HTTP_409_CONFLICT, "Not currently on Premium")
    if parent.subscription_cancel_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cancellation already scheduled")

    period = _ANNUAL_PERIOD if parent.subscription_billing_cycle == "annual" else _MONTHLY_PERIOD
    cancel_at = datetime.now(timezone.utc) + period

    get_payment_provider().cancel_subscription(parent.id)
    parents.update_parent(parent.id, subscription_cancel_at=cancel_at)
    billing_repo.create_billing_record(
        parent.id, "cancelled", 0, f"Premium cancelled — access continues until {cancel_at.date().isoformat()}"
    )
    return parents.get_parent(parent.id)


@router.post("/resume-premium", response_model=Parent)
def resume_premium(parent: Parent = Depends(get_current_parent)) -> Parent:
    """PA25's alt-flow 2a — "Parent opts to stay on Premium: no change is
    made" — undoes a scheduled cancellation before it takes effect. Not its
    own PRD use case; a natural extension now that cancellation is a
    scheduled state rather than instant (see cancel_premium above)."""
    if parent.subscription_cancel_at is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "No cancellation is scheduled")
    parents.update_parent(parent.id, subscription_cancel_at=None)
    return parents.get_parent(parent.id)


@router.get("/billing-history", response_model=list[BillingRecord])
def get_billing_history(parent: Parent = Depends(get_current_parent)) -> list[BillingRecord]:
    """PA27 — View Billing History."""
    return billing_repo.list_billing_records(parent.id)
