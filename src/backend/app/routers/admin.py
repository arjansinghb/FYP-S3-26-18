"""System Admin console (SA01-SA14). All endpoints require the 'admin' role.

Covers: system health/stats (SA08), user management — search/view/reset
password/suspend/unsuspend (SA03-SA07), editable config sections —
integrations/compliance/settings/website/billing (SA09-SA13), and the
escalated support-ticket queue (SA14). Login/logout (SA01/02) reuse the shared
/api/auth endpoints.
"""
import time

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import metrics
from ..config import settings
from ..deps import require_role
from ..models import ReviewOut
from ..storage import db

router = APIRouter(prefix="/api/admin", tags=["admin"])

CONFIG_SECTIONS = {"settings", "integrations", "compliance", "website", "billing"}


def _user_out(a: dict) -> dict:
    return {
        "id": a["id"], "email": a["email"], "name": a["name"], "role": a["role"],
        "verified": a["verified"], "suspended": a.get("suspended", False),
        # Admin Overview's "Recent activity" feed — see suspend_user/
        # unsuspend_user below, same "wasn't tracked at all before" gap
        # this session already closed for the Moderator console. Both
        # timestamps are kept (never cleared) so a later unsuspend doesn't
        # erase the earlier suspend's own place in the log.
        "suspended_at": a.get("suspended_at"), "suspended_by": a.get("suspended_by"),
        "unsuspended_at": a.get("unsuspended_at"), "unsuspended_by": a.get("unsuspended_by"),
    }


# ---------- SA08: system health / stats ----------

@router.get("/stats")
def stats(admin: dict = Depends(require_role("admin"))):
    content = list(db.content.values())
    return {
        "users": len(db.accounts),
        "parents": sum(1 for a in db.accounts.values() if a["role"] == "parent"),
        "moderators": sum(1 for a in db.accounts.values() if a["role"] == "moderator"),
        "admins": sum(1 for a in db.accounts.values() if a["role"] == "admin"),
        "suspended": sum(1 for a in db.accounts.values() if a.get("suspended")),
        # Admin Overview's "Account composition" card — subscription tier
        # only ever applies to parent accounts (staff don't have a tier).
        "tier_free": sum(1 for a in db.accounts.values() if a["role"] == "parent" and a.get("tier", "free") == "free"),
        "tier_premium": sum(1 for a in db.accounts.values() if a["role"] == "parent" and a.get("tier") == "premium"),
        "children": len(db.children),
        "content_total": len(content),
        "content_approved": sum(1 for c in content if c["status"] == "approved"),
        "content_pending": sum(1 for c in content if c["status"] == "pending"),
        "content_rejected": sum(1 for c in content if c["status"] == "rejected"),
        "reports_open": sum(1 for r in db.reports if r["status"] == "open"),
        "tickets_open": sum(1 for t in db.tickets if t["status"] == "open"),
        "brain": settings.BRAIN_PROVIDER,
        "uptime_seconds": int(time.time() - db.started),
        # SA08 — "API uptime, error rates, NLP/recommendation service
        # latency" per the URS's own wording, not just request counts.
        **metrics.snapshot(),
    }


# ---------- SA04/SA05: search + view users ----------

@router.get("/users")
def search_users(q: str | None = None, admin: dict = Depends(require_role("admin"))):
    users = list(db.accounts.values())
    if q:
        ql = q.lower()
        users = [u for u in users if ql in u["email"].lower() or ql in u["name"].lower()]
    return [_user_out(u) for u in users]


@router.get("/users/{user_id}")
def user_details(user_id: str, admin: dict = Depends(require_role("admin"))):
    u = db.accounts.get(user_id)
    if not u:
        raise HTTPException(404, "User not found")
    out = _user_out(u)
    out["children"] = len(db.children_of(user_id)) if u["role"] == "parent" else 0
    return out


# ---------- SA03: reset a user's password ----------

@router.post("/users/{user_id}/reset-password")
def reset_password(user_id: str, new_password: str = Body(..., embed=True, min_length=6),
                   admin: dict = Depends(require_role("admin"))):
    u = db.accounts.get(user_id)
    if not u:
        raise HTTPException(404, "User not found")
    db.update_account(u, password=new_password)
    return {"ok": True}


# ---------- SA06/SA07: suspend / unsuspend ----------

@router.post("/users/{user_id}/suspend")
def suspend_user(user_id: str, admin: dict = Depends(require_role("admin"))):
    u = db.accounts.get(user_id)
    if not u:
        raise HTTPException(404, "User not found")
    if u["role"] == "admin":
        raise HTTPException(400, "Cannot suspend an admin account")
    u["suspended"] = True
    u["suspended_at"] = time.time()
    u["suspended_by"] = admin["name"]
    # revoke their active sessions
    for tok, entry in list(db.tokens.items()):
        if entry["kind"] == "account" and entry["id"] == user_id:
            db.revoke_token(tok)
    return _user_out(u)


@router.post("/users/{user_id}/unsuspend")
def unsuspend_user(user_id: str, admin: dict = Depends(require_role("admin"))):
    u = db.accounts.get(user_id)
    if not u:
        raise HTTPException(404, "User not found")
    u["suspended"] = False
    u["unsuspended_at"] = time.time()
    u["unsuspended_by"] = admin["name"]
    return _user_out(u)


# ---------- SA09-SA13: editable config sections ----------

@router.get("/config/{section}")
def get_config(section: str, admin: dict = Depends(require_role("admin"))):
    if section not in CONFIG_SECTIONS:
        raise HTTPException(404, "Unknown config section")
    return db.system[section]


def _check_config_numbers(section: str, body: dict) -> None:
    """Rejects values that would make a setting nonsensical (a negative price,
    retention below the 7-day floor) before they are saved."""
    def number(name: str, label: str) -> float | None:
        if name not in body:
            return None
        v = body[name]
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise HTTPException(422, f"{label} must be a number.")
        return v

    if section == "compliance":
        days = number("data_retention_days", "Data retention")
        if days is not None and (days < db.RETENTION_MIN_DAYS or days != int(days)):
            raise HTTPException(422, f"Data retention must be a whole number of at least {db.RETENTION_MIN_DAYS} days.")
    if section == "billing":
        for name, label in (("premium_monthly_price", "Monthly price"), ("premium_annual_price", "Annual price")):
            price = number(name, label)
            if price is not None and price <= 0:
                raise HTTPException(422, f"{label} must be more than 0.")


@router.put("/config/{section}")
def update_config(section: str, body: dict = Body(...), admin: dict = Depends(require_role("admin"))):
    if section not in CONFIG_SECTIONS:
        raise HTTPException(404, "Unknown config section")
    _check_config_numbers(section, body)
    # only update keys that already exist in the section (keeps the shape stable)
    for k, v in body.items():
        if k in db.system[section]:
            db.system[section][k] = v
    return db.system[section]


# ---------- SA14: escalated support tickets ----------

@router.get("/tickets")
def list_tickets(admin: dict = Depends(require_role("admin"))):
    out = []
    for t in sorted(db.tickets, key=lambda t: t["ts"], reverse=True):
        t = dict(t)
        # Tickets raised before parent_name was stored: look the name up from
        # the parent's account (still there unless they deleted it).
        if not t.get("parent_name"):
            parent = db.accounts.get(t.get("parent_id") or "")
            t["parent_name"] = parent["name"] if parent else None
        out.append(t)
    return out


@router.post("/tickets/{ticket_id}/resolve")
def resolve_ticket(ticket_id: str, admin: dict = Depends(require_role("admin"))):
    ticket = next((t for t in db.tickets if t["id"] == ticket_id), None)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    ticket["status"] = "resolved"
    ticket["resolved_at"] = time.time()
    ticket["resolved_by"] = admin["name"]
    if ticket.get("parent_id"):  # tickets raised by a parent; tell them it was handled
        db.add_notification(
            ticket["parent_id"], "support_resolved", "Your support request was resolved",
            f'"{ticket["subject"]}" has been marked resolved by our team.',
        )
    return ticket


# ---------- UV04: review moderation queue ----------
# The second, human layer behind account.py's AI screen — a review only
# ever reaches the public landing page (public.py's /reviews) once an
# admin has explicitly approved it here, same "human still decides" shape
# as CM06-08's catalogue moderation, applied to user-generated review text.

def _review_out(r: dict, published_ids: set[str] | None = None) -> ReviewOut:
    return ReviewOut(
        id=r["id"], parent_name=r["parent_name"], rating=r["rating"], text=r["text"],
        status=r["status"], created_at=r["created_at"], rejection_reason=r.get("rejection_reason"),
        reviewed_at=r.get("reviewed_at"), reviewed_by=r.get("reviewed_by"),
        ai_recommend=r.get("ai_recommend"), ai_reason=r.get("ai_reason"),
        published=(r["id"] in published_ids) if published_ids is not None and r["status"] == "approved" else None,
    )


@router.get("/reviews", response_model=list[ReviewOut])
def list_reviews(status: str | None = None, admin: dict = Depends(require_role("admin"))):
    items = db.reviews.values()
    if status:
        items = [r for r in items if r["status"] == status]
    # Real gap this closes: "approved" only means it passed the human gate —
    # public_reviews() then caps the landing page at the best 10, so an
    # admin approving review #11 gets no signal it isn't actually live.
    published_ids = {r["id"] for r in db.public_reviews(10)}
    return [_review_out(r, published_ids) for r in sorted(items, key=lambda r: r["created_at"], reverse=True)]


@router.delete("/reviews/{review_id}")
def delete_review(review_id: str, admin: dict = Depends(require_role("admin"))):
    """Permanent removal — distinct from reject (which keeps the review
    visible in the Rejected tab with a reason). For junk/test content that
    shouldn't be kept around at all, e.g. placeholder submissions or
    QA fixtures left over from testing the sort/ranking logic."""
    if review_id not in db.reviews:
        raise HTTPException(404, "Review not found")
    db.reviews.pop(review_id)
    return {"ok": True}


@router.post("/reviews/{review_id}/approve", response_model=ReviewOut)
def approve_review(review_id: str, admin: dict = Depends(require_role("admin"))):
    review = db.reviews.get(review_id)
    if not review:
        raise HTTPException(404, "Review not found")
    review["status"] = "approved"
    review["rejection_reason"] = None
    review["reviewed_at"] = time.time()
    review["reviewed_by"] = admin["name"]
    return _review_out(review)


@router.post("/reviews/{review_id}/reject", response_model=ReviewOut)
def reject_review(review_id: str, admin: dict = Depends(require_role("admin"))):
    review = db.reviews.get(review_id)
    if not review:
        raise HTTPException(404, "Review not found")
    review["status"] = "rejected"
    review["rejection_reason"] = "Not a fit for the public page."
    review["reviewed_at"] = time.time()
    review["reviewed_by"] = admin["name"]
    return _review_out(review)
