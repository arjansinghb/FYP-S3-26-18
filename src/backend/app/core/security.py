"""Password/PIN hashing + session-token helpers.

The child PIN login (CH01/CH02) never goes through Firebase Auth at all — see
agent-context/CLAUDE.md §2.2 — so it always needs its own signed session token,
regardless of Firebase configuration. The parent-dev token is only used in
local-dev-store mode, standing in for a real Firebase ID token.
"""
from __future__ import annotations

import time
from typing import Any

import jwt
from passlib.context import CryptContext

from app.core.config import get_settings

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

CHILD_TOKEN_TTL_SECONDS = 12 * 60 * 60  # 12h — a school-day-long session, not a persistent login
PARENT_DEV_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60  # 7d, local-dev-store only
STAFF_TOKEN_TTL_SECONDS = 12 * 60 * 60  # 12h — a work-shift-long session
EMAIL_VERIFICATION_TOKEN_TTL_SECONDS = 24 * 60 * 60  # 24h — UV06


def hash_secret(raw: str) -> str:
    """Used for both child PINs (PA10) and, local-dev-store only, parent passwords."""
    return _pwd_context.hash(raw)


def verify_secret(raw: str, hashed: str) -> bool:
    return _pwd_context.verify(raw, hashed)


def create_child_session_token(child_id: str, parent_id: str) -> str:
    settings = get_settings()
    payload = {
        "child_id": child_id,
        "parent_id": parent_id,
        "type": "child",
        "exp": int(time.time()) + CHILD_TOKEN_TTL_SECONDS,
    }
    return jwt.encode(payload, settings.session_secret, algorithm="HS256")


def decode_child_session_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    payload = jwt.decode(token, settings.session_secret, algorithms=["HS256"])
    if payload.get("type") != "child":
        raise jwt.InvalidTokenError("not a child session token")
    return payload


def create_parent_dev_token(parent_id: str) -> str:
    settings = get_settings()
    payload = {
        "parent_id": parent_id,
        "type": "parent_dev",
        "exp": int(time.time()) + PARENT_DEV_TOKEN_TTL_SECONDS,
    }
    return jwt.encode(payload, settings.session_secret, algorithm="HS256")


def decode_parent_dev_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    payload = jwt.decode(token, settings.session_secret, algorithms=["HS256"])
    if payload.get("type") != "parent_dev":
        raise jwt.InvalidTokenError("not a parent dev session token")
    return payload


def create_email_verification_token(parent_id: str) -> str:
    """UV06 — Verify Account. One unified implementation regardless of
    settings.firebase_configured (unlike PA01/PA03's Firebase-vs-local-store
    branch): a real deployment would still need to email this link itself
    (Firebase's own `email_verified` flag lives on the Auth user record, not
    reachable from the REST-only Identity Toolkit calls this backend already
    makes — see app/core/firebase.py), so there's no real advantage to
    branching here, only extra code paths to keep in sync."""
    settings = get_settings()
    payload = {
        "parent_id": parent_id,
        "type": "email_verification",
        "exp": int(time.time()) + EMAIL_VERIFICATION_TOKEN_TTL_SECONDS,
    }
    return jwt.encode(payload, settings.session_secret, algorithm="HS256")


def decode_email_verification_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    payload = jwt.decode(token, settings.session_secret, algorithms=["HS256"])
    if payload.get("type") != "email_verification":
        raise jwt.InvalidTokenError("not an email verification token")
    return payload


def create_staff_token(staff_id: str, role: str) -> str:
    """CM01/SA01 — staff login (moderator or admin). See app/models/staff.py
    for why staff have their own credential store rather than Firebase Auth."""
    settings = get_settings()
    payload = {
        "staff_id": staff_id,
        "role": role,
        "type": "staff",
        "exp": int(time.time()) + STAFF_TOKEN_TTL_SECONDS,
    }
    return jwt.encode(payload, settings.session_secret, algorithm="HS256")


def decode_staff_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    payload = jwt.decode(token, settings.session_secret, algorithms=["HS256"])
    if payload.get("type") != "staff":
        raise jwt.InvalidTokenError("not a staff session token")
    return payload
