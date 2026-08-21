"""System Admin console (SA01-SA14). All endpoints require the 'admin' role.

Covers: system health/stats (SA08), user management — search/view/reset
password/suspend/unsuspend (SA03-SA07), editable config sections —
integrations/compliance/settings/website/billing (SA09-SA13), and the
escalated support-ticket queue (SA14). Login/logout (SA01/02) reuse the shared
/api/auth endpoints.
"""
import time

from fastapi import APIRouter, Body, Depends, HTTPException

from ..config import settings
from ..deps import require_role
from ..storage import db

router = APIRouter(prefix="/api/admin", tags=["admin"])

CONFIG_SECTIONS = {"settings", "integrations", "compliance", "website", "billing"}


def _user_out(a: dict) -> dict:
    return {
        "id": a["id"], "email": a["email"], "name": a["name"], "role": a["role"],
        "verified": a["verified"], "suspended": a.get("suspended", False),
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
        "children": len(db.children),
        "content_total": len(content),
        "content_approved": sum(1 for c in content if c["status"] == "approved"),
        "content_pending": sum(1 for c in content if c["status"] == "pending"),
        "content_rejected": sum(1 for c in content if c["status"] == "rejected"),
        "reports_open": sum(1 for r in db.reports if r["status"] == "open"),
        "tickets_open": sum(1 for t in db.tickets if t["status"] == "open"),
        "brain": settings.BRAIN_PROVIDER,
        "uptime_seconds": int(time.time() - db.started),
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
    return _user_out(u)


# ---------- SA09-SA13: editable config sections ----------

@router.get("/config/{section}")
def get_config(section: str, admin: dict = Depends(require_role("admin"))):
    if section not in CONFIG_SECTIONS:
        raise HTTPException(404, "Unknown config section")
    return db.system[section]


@router.put("/config/{section}")
def update_config(section: str, body: dict = Body(...), admin: dict = Depends(require_role("admin"))):
    if section not in CONFIG_SECTIONS:
        raise HTTPException(404, "Unknown config section")
    # only update keys that already exist in the section (keeps the shape stable)
    for k, v in body.items():
        if k in db.system[section]:
            db.system[section][k] = v
    return db.system[section]


# ---------- SA14: escalated support tickets ----------

@router.get("/tickets")
def list_tickets(admin: dict = Depends(require_role("admin"))):
    return sorted(db.tickets, key=lambda t: t["ts"], reverse=True)


@router.post("/tickets/{ticket_id}/resolve")
def resolve_ticket(ticket_id: str, admin: dict = Depends(require_role("admin"))):
    ticket = next((t for t in db.tickets if t["id"] == ticket_id), None)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    ticket["status"] = "resolved"
    return ticket
