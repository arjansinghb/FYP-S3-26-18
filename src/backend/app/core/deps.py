"""FastAPI dependency functions for auth — parent (Firebase ID token, or a
local-dev-store stand-in token) and child (PIN session token, CH01/CH02).
"""
from __future__ import annotations

from datetime import datetime, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_settings
from app.core.security import decode_child_session_token, decode_parent_dev_token, decode_staff_token
from app.models.child import ChildProfile
from app.models.parent import Parent
from app.models.staff import StaffAccount
from app.repositories import parents as parents_repo
from app.repositories.children import get_child
from app.repositories.parents import get_parent
from app.repositories.staff import get_staff

_bearer = HTTPBearer(auto_error=False)


def _apply_pending_cancellation(parent: Parent) -> Parent:
    """PA25 — Cancel Premium is "effective at period end", not instant (see
    Parent.subscription_cancel_at's docstring for why this is a lazy check
    here rather than a cron job). Runs on every authenticated parent
    request, so `subscription_tier` is never stale by more than one request."""
    if parent.subscription_cancel_at is None:
        return parent
    if datetime.now(timezone.utc) < parent.subscription_cancel_at:
        return parent
    parents_repo.update_parent(
        parent.id,
        subscription_tier="free",
        subscription_billing_cycle=None,
        subscription_started_at=None,
        subscription_cancel_at=None,
    )
    return get_parent(parent.id)


def get_current_parent(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> Parent:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")

    settings = get_settings()
    if settings.firebase_configured:
        from app.core.firebase import verify_id_token

        try:
            parent_id = verify_id_token(credentials.credentials)
        except Exception as exc:  # firebase_admin raises several distinct error types here
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token") from exc
    else:
        try:
            payload = decode_parent_dev_token(credentials.credentials)
        except jwt.PyJWTError as exc:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token") from exc
        parent_id = payload["parent_id"]

    parent = get_parent(parent_id)
    if parent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Parent not found")
    return _apply_pending_cancellation(parent)


def get_current_parent_with_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> tuple[Parent, str]:
    """Same resolution as get_current_parent, but also returns the raw
    bearer token — needed by UV06's verification-request step, which must
    forward the caller's own Firebase ID token to Identity Toolkit's
    sendOobCode call (see app/core/firebase.py's send_email_verification_email)."""
    parent = get_current_parent(credentials)
    token = credentials.credentials if credentials is not None else ""
    return parent, token


def get_current_child(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> ChildProfile:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    try:
        payload = decode_child_session_token(credentials.credentials)
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired session") from exc

    child = get_child(payload["child_id"])
    if child is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Child profile not found")
    return child


def require_owner(parent: Parent, child: ChildProfile) -> None:
    """Raise 403 unless `parent` owns `child` — the HTTP-API equivalent of the
    Firestore security-rule shape described in agent-context/CLAUDE.md §2.2's
    closing paragraph (a parent token may only touch its own children)."""
    if child.parent_id != parent.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your child profile")


def get_child_dual_auth(
    child_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> ChildProfile:
    """For read endpoints legitimately reachable by *either* the child
    themselves (e.g. CH16, View Saved Favourites) or their parent (e.g. PA15,
    the same data from the dashboard) — tries a child session token first,
    falls back to a parent token + ownership check. Avoids registering two
    routes on the same path for what's really one read operation."""
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    token = credentials.credentials

    try:
        payload = decode_child_session_token(token)
        child = get_child(payload["child_id"])
        if child is None or child.id != child_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Child profile not found")
        return child
    except jwt.PyJWTError:
        pass  # not a child token — try parent auth below

    settings = get_settings()
    if settings.firebase_configured:
        from app.core.firebase import verify_id_token

        try:
            parent_id = verify_id_token(token)
        except Exception as exc:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token") from exc
    else:
        try:
            payload = decode_parent_dev_token(token)
        except jwt.PyJWTError as exc:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token") from exc
        parent_id = payload["parent_id"]

    child = get_child(child_id)
    if child is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Child profile not found")
    if child.parent_id != parent_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your child profile")
    return child


def get_current_staff(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> StaffAccount:
    """CM (Content Moderator) and SA (System Admin) routes — both roles use
    this; routes that are admin-only additionally call `require_admin`."""
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    try:
        payload = decode_staff_token(credentials.credentials)
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired session") from exc

    staff = get_staff(payload["staff_id"])
    if staff is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Staff account not found")
    return staff


def require_admin(staff: StaffAccount) -> None:
    if staff.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin role required")
