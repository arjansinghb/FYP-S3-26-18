"""Maintenance mode (SA11): an admin switch that pauses Pip for parents and
children while keeping it open for staff.

While it is on, every API call from a parent, a child or an anonymous
visitor is answered with 503 and a friendly message. Admins and moderators
keep working, so an admin can always sign in and turn it off again. A few
paths stay open on purpose: health checks, the public landing data, the
status endpoint the frontend polls, and login itself (staff use the same
login as everyone; a parent who logs in during maintenance is turned away
inside the login handler once their role is known).
"""
import time

from .storage import db

STAFF_ROLES = ("admin", "moderator")

# Paths that never get paused.
_OPEN_PREFIXES = ("/api/health", "/api/public/", "/api/auth/login", "/api/auth/logout")

# Another warm instance may have changed the flag; re-read the shared state
# at most this often instead of on every request.
_RECHECK_SECONDS = 5.0
_last_check = 0.0


def active() -> bool:
    global _last_check
    now = time.monotonic()
    if now - _last_check > _RECHECK_SECONDS:
        _last_check = now
        db.refresh_public()
    return bool(db.system["settings"].get("maintenance_mode"))


def support_email() -> str:
    return db.system["settings"].get("support_email") or ""


def message() -> str:
    return "Pip is being updated right now. Please try again in a little while."


def payload() -> dict:
    return {"detail": message(), "maintenance": True, "support_email": support_email()}


def is_open_path(path: str) -> bool:
    return not path.startswith("/api") or path.startswith(_OPEN_PREFIXES)


def is_staff_token(token: str | None) -> bool:
    if not token:
        return False
    entry = db.resolve_token(token)
    if not entry or entry["kind"] != "account":
        return False
    account = db.accounts.get(entry["id"])
    return bool(account and account.get("role") in STAFF_ROLES)
