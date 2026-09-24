"""Parent self-service beyond plain account CRUD (which stays in auth.py):
PA28 consent, PA29 privacy settings, PA30 data-deletion requests, PA20/22
notifications, PA23-27 billing (simulated). All require the `parent` role.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from .. import ai_assist, moderation
from ..deps import require_role
from ..models import (
    BillingRecordOut, ConsentOut, ConsentRequest, DataDeletionRequestOut,
    NotificationOut, NotificationPreferences, PaymentMethodIn,
    PaymentMethodOut, PrivacySettings, ReviewCreate, ReviewOut, SubscribeRequest,
    SubscriptionStatusOut,
)
from ..storage import db

router = APIRouter(prefix="/api/account", tags=["account"])


def _owned_child(child_id: str, parent: dict) -> dict:
    child = db.children.get(child_id)
    if not child or child["parent_id"] != parent["id"]:
        raise HTTPException(404, "Child profile not found")
    return child


# ---------- PA28: verifiable parental consent ----------
# Gate: PA07 (create_child, in routers/children.py) requires this to be given
# first — "a child profile isn't allowed to exist without it" is the whole
# point of this use case, not just a status flag nobody checks.

@router.get("/consent", response_model=ConsentOut)
def get_consent(account: dict = Depends(require_role("parent"))):
    consent = account.get("consent")
    return ConsentOut(given=bool(consent), timestamp=(consent or {}).get("timestamp"))


@router.post("/consent", response_model=ConsentOut)
def give_consent(body: ConsentRequest, account: dict = Depends(require_role("parent"))):
    if not db.check_password(account, body.password):
        raise HTTPException(401, "Wrong password")
    db.give_consent(account)
    return ConsentOut(given=True, timestamp=account["consent"]["timestamp"])


# ---------- PA29: privacy settings ----------
# URS precondition: "Parent has provided verifiable parental consent."

def _require_consent(account: dict) -> None:
    if not account.get("consent"):
        raise HTTPException(403, "Please provide parental consent first (PA28).")


@router.get("/privacy-settings", response_model=PrivacySettings)
def get_privacy_settings(account: dict = Depends(require_role("parent"))):
    _require_consent(account)
    return PrivacySettings(**account.get("privacy_settings", {}))


@router.patch("/privacy-settings", response_model=PrivacySettings)
def update_privacy_settings(body: PrivacySettings, account: dict = Depends(require_role("parent"))):
    _require_consent(account)
    db.update_privacy_settings(account, body.retention_preference)
    return PrivacySettings(**account["privacy_settings"])


# ---------- PA30: request child data deletion ----------

@router.post("/children/{child_id}/data-deletion", response_model=DataDeletionRequestOut)
def request_data_deletion(child_id: str, account: dict = Depends(require_role("parent"))):
    child = _owned_child(child_id, account)
    record = db.request_data_deletion(child)
    return DataDeletionRequestOut(**record)


@router.post("/data-deletion/{request_id}/cancel", response_model=DataDeletionRequestOut)
def cancel_data_deletion(request_id: str, account: dict = Depends(require_role("parent"))):
    """Alt Flow 3a — parent cancels before it takes effect."""
    record = db.cancel_data_deletion(request_id)
    if not record:
        raise HTTPException(404, "Deletion request not found")
    child = db.children.get(record["child_id"])
    if not child or child["parent_id"] != account["id"]:
        raise HTTPException(404, "Deletion request not found")
    return DataDeletionRequestOut(**record)


@router.get("/children/{child_id}/data-deletion", response_model=list[DataDeletionRequestOut])
def list_data_deletion_requests(child_id: str, account: dict = Depends(require_role("parent"))):
    _owned_child(child_id, account)
    return [DataDeletionRequestOut(**r) for r in db.deletion_requests if r["child_id"] == child_id]


# ---------- PA20/22: notifications ----------

@router.get("/notification-preferences", response_model=NotificationPreferences)
def get_notification_preferences(account: dict = Depends(require_role("parent"))):
    return NotificationPreferences(**account.get("notification_preferences", {}))


@router.patch("/notification-preferences", response_model=NotificationPreferences)
def update_notification_preferences(body: NotificationPreferences, account: dict = Depends(require_role("parent"))):
    account["notification_preferences"] = body.model_dump()
    return NotificationPreferences(**account["notification_preferences"])


@router.get("/notifications", response_model=list[NotificationOut])
def list_notifications(account: dict = Depends(require_role("parent"))):
    return [NotificationOut(**n) for n in db.notifications_for(account["id"])]


@router.post("/notifications/{notification_id}/read", response_model=NotificationOut)
def mark_notification_read(notification_id: str, account: dict = Depends(require_role("parent"))):
    notif = db.mark_notification_read(notification_id)
    if not notif or notif["parent_id"] != account["id"]:
        raise HTTPException(404, "Notification not found")
    return NotificationOut(**notif)


# ---------- PA23-27: billing (simulated — see storage.py's docstring on the
# subscribe/cancel methods; no real Stripe/payment account exists here, same
# as the other branch's SimulatedPaymentProvider) ----------

@router.get("/subscription", response_model=SubscriptionStatusOut)
def subscription_status(account: dict = Depends(require_role("parent"))):
    pm = account.get("payment_method")
    return SubscriptionStatusOut(
        tier=account["tier"],
        billing_cycle=account.get("subscription_billing_cycle"),
        started_at=account.get("subscription_started_at"),
        cancel_at=account.get("subscription_cancel_at"),
        payment_method=PaymentMethodOut(**pm) if pm else None,
    )


@router.post("/subscribe", response_model=SubscriptionStatusOut)
def subscribe(body: SubscribeRequest, account: dict = Depends(require_role("parent"))):
    """PA24 — includes PA26 (Update Payment Method) in the same flow per the
    URS's Sub-Flows; a payment method must exist on file by the end of this
    call, either passed in here or already set via PUT /payment-method.
    Also usable to re-subscribe after a cancellation — only rejected if
    it's the exact same tier with no pending cancellation, not any call
    while already paid. (Doubled as the upgrade path between paid tiers
    while an "ultra" tier existed; held back out of this prototype for now
    — see models.py's AccountTier comment.)"""
    if account["tier"] == body.tier and not account.get("subscription_cancel_at"):
        raise HTTPException(400, f"Already on {body.tier.capitalize()}")
    if not body.payment_method and not account.get("payment_method"):
        raise HTTPException(400, "A payment method is required to subscribe.")
    db.subscribe(account, body.tier, body.billing_cycle, body.payment_method.model_dump() if body.payment_method else None)
    db.add_notification(account["id"], "subscription_started", f"Welcome to {body.tier.capitalize()}!",
                        f"Your {body.tier.capitalize()} subscription is now active.")
    return subscription_status(account)


@router.post("/cancel-premium", response_model=SubscriptionStatusOut)
def cancel_premium(account: dict = Depends(require_role("parent"))):
    """Name kept as-is (existing route, existing frontend/tests call it) —
    cancels whichever paid tier the account is actually on; "Not currently
    on Premium" -> "Not currently subscribed" so the message stays accurate
    if a 2nd paid tier returns later (see models.py's AccountTier comment)."""
    if account["tier"] == "free":
        raise HTTPException(400, "Not currently subscribed")
    db.cancel_subscription(account)
    return subscription_status(account)


@router.post("/resume-premium", response_model=SubscriptionStatusOut)
def resume_premium(account: dict = Depends(require_role("parent"))):
    """Undo a scheduled cancellation before it takes effect."""
    if not account.get("subscription_cancel_at"):
        raise HTTPException(400, "No pending cancellation to resume")
    account["subscription_cancel_at"] = None
    return subscription_status(account)


@router.put("/payment-method", response_model=SubscriptionStatusOut)
def update_payment_method(body: PaymentMethodIn, account: dict = Depends(require_role("parent"))):
    db.set_payment_method(account, body.brand, body.last4)
    return subscription_status(account)


@router.get("/billing-history", response_model=list[BillingRecordOut])
def billing_history(account: dict = Depends(require_role("parent"))):
    return [BillingRecordOut(**b) for b in db.billing_history_for(account["id"])]


# ---------- UV04: submit a review ----------
# See models.ReviewCreate's docstring for the full picture — a real parent
# writes a real review, which only reaches the public landing page after
# an AI safety screen here AND an explicit admin approval (routers/admin.py).

def _review_out(r: dict) -> ReviewOut:
    return ReviewOut(
        id=r["id"], parent_name=r["parent_name"], rating=r["rating"], text=r["text"],
        status=r["status"], created_at=r["created_at"], rejection_reason=r.get("rejection_reason"),
        ai_recommend=r.get("ai_recommend"), ai_reason=r.get("ai_reason"),
    )


@router.get("/reviews/me", response_model=Optional[ReviewOut])
def my_review(account: dict = Depends(require_role("parent"))):
    """A parent's own review + its current status (pending/approved/
    rejected) — null if they've never submitted one."""
    review = db.review_by_parent(account["id"])
    return _review_out(review) if review else None


@router.post("/reviews", response_model=ReviewOut, status_code=201)
def submit_review(body: ReviewCreate, account: dict = Depends(require_role("parent"))):
    rating = max(1, min(5, body.rating))
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "Please write something before submitting.")
    if len(text) > 600:
        raise HTTPException(400, "Keep it under 600 characters.")
    # Same input-safety screen the child chat already uses (see
    # moderation.py) — a review that fails it never even reaches the
    # admin queue, same reasoning as redirecting an unsafe chat message
    # instead of letting a human moderator wade through it first.
    if moderation.is_unsafe(text):
        review = db.add_review(
            account["id"], account["name"], rating, text, "rejected",
            rejection_reason="This didn't pass our automatic content screen.",
        )
        return _review_out(review)
    # Advisory-only triage aid for the admin queue (app/ai_assist.py) — an
    # opinion attached at submission time, never a gate: it doesn't affect
    # whether this review lands in the queue (that's the is_unsafe check
    # above), only how the admin sees it once it's there.
    suggestion = ai_assist.suggest_review(rating, text)
    review = db.add_review(
        account["id"], account["name"], rating, text, "pending",
        ai_recommend=suggestion.get("recommend"), ai_reason=suggestion.get("reason"),
    )
    return _review_out(review)
