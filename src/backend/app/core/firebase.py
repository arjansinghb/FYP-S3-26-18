"""Firebase Admin SDK helpers — auth verification + Identity Toolkit REST calls
for password-based login/reset. The Admin SDK can create/manage users but can't
verify a password (there's no server-side "sign in" call in it) — the Identity
Toolkit REST API is Google's own documented way to do that server-side:
https://firebase.google.com/docs/reference/rest/auth#section-sign-in-email-password

Only ever touched when `settings.firebase_configured`; local-dev-store mode
(see app/repositories/local_store.py) never imports `firebase_admin` at all.
"""
from __future__ import annotations

import httpx

from app.core.config import get_settings

_IDENTITY_TOOLKIT_BASE = "https://identitytoolkit.googleapis.com/v1/accounts"


def _ensure_app() -> None:
    import firebase_admin
    from firebase_admin import credentials

    settings = get_settings()
    if not firebase_admin._apps:
        cred = credentials.Certificate(str(settings.firebase_admin_credentials_full_path))
        firebase_admin.initialize_app(cred, {"projectId": settings.firebase_project_id})


def create_firebase_user(email: str, password: str, display_name: str) -> str:
    """UV05/PA07-adjacent — creates the Firebase Auth user. Returns the new uid."""
    from firebase_admin import auth

    _ensure_app()
    user = auth.create_user(email=email, password=password, display_name=display_name)
    return user.uid


def sign_in_with_password(email: str, password: str) -> str:
    """PA01 — verifies a password server-side via Identity Toolkit and returns
    a Firebase ID token. Raises httpx.HTTPStatusError on bad credentials."""
    settings = get_settings()
    resp = httpx.post(
        f"{_IDENTITY_TOOLKIT_BASE}:signInWithPassword",
        params={"key": settings.firebase_api_key},
        json={"email": email, "password": password, "returnSecureToken": True},
        timeout=10.0,
    )
    resp.raise_for_status()
    return resp.json()["idToken"]


def verify_id_token(token: str) -> str:
    """Returns the uid encoded in a valid Firebase ID token."""
    from firebase_admin import auth

    _ensure_app()
    decoded = auth.verify_id_token(token)
    return decoded["uid"]


def send_password_reset_email(email: str, continue_url: str | None = None) -> None:
    """PA03 — dev-session 2026-08-17: replaces the old
    `generate_password_reset_link` (Admin SDK), which only *generated* a link
    and left the caller to somehow deliver it — nothing did, so resets
    dead-ended. `accounts:sendOobCode` is Identity Toolkit's REST equivalent
    that actually triggers Firebase's own hosted mail delivery for the
    template, no SMTP account needed:
    https://firebase.google.com/docs/reference/rest/auth#section-send-password-reset-email
    `continue_url` (when given) makes the emailed link deep-link back into
    this app instead of Firebase's generic default action page — the domain
    it points at must be in the Firebase project's Auth > Settings >
    Authorized domains list (localhost is authorized by default)."""
    settings = get_settings()
    body: dict = {"requestType": "PASSWORD_RESET", "email": email}
    if continue_url:
        body["continueUrl"] = continue_url
    resp = httpx.post(
        f"{_IDENTITY_TOOLKIT_BASE}:sendOobCode",
        params={"key": settings.firebase_api_key},
        json=body,
        timeout=10.0,
    )
    resp.raise_for_status()


def confirm_password_reset(oob_code: str, new_password: str) -> None:
    """PA03 — completes the reset once the parent submits a new password from
    the emailed link's landing page. Consumes the oobCode via Identity
    Toolkit's dedicated resetPassword call — a used/expired/invalid code
    raises httpx.HTTPStatusError."""
    settings = get_settings()
    resp = httpx.post(
        f"{_IDENTITY_TOOLKIT_BASE}:resetPassword",
        params={"key": settings.firebase_api_key},
        json={"oobCode": oob_code, "newPassword": new_password},
        timeout=10.0,
    )
    resp.raise_for_status()


def send_email_verification_email(id_token: str, continue_url: str | None = None) -> None:
    """UV06 — same sendOobCode mechanism as the password-reset email above,
    VERIFY_EMAIL request type. Needs the user's own current Firebase ID
    token (not just their email) — Identity Toolkit's API contract, since
    this proves the request came from an authenticated session for that
    account."""
    settings = get_settings()
    body: dict = {"requestType": "VERIFY_EMAIL", "idToken": id_token}
    if continue_url:
        body["continueUrl"] = continue_url
    resp = httpx.post(
        f"{_IDENTITY_TOOLKIT_BASE}:sendOobCode",
        params={"key": settings.firebase_api_key},
        json=body,
        timeout=10.0,
    )
    resp.raise_for_status()


def confirm_email_verification_oob(oob_code: str) -> str:
    """UV06 — completes verification once the parent clicks the emailed
    link; consumes the oobCode via Identity Toolkit's generic accounts:update
    call (this is the same call Firebase's own hosted action page makes
    under the hood). Returns the now-verified account's email so the caller
    can look up which parent record to mark verified — this backend's own
    `email_verified` flag lives on our `parents` collection, separate from
    Firebase Auth's own copy (see app/core/security.py's
    create_email_verification_token docstring for why)."""
    settings = get_settings()
    resp = httpx.post(
        f"{_IDENTITY_TOOLKIT_BASE}:update",
        params={"key": settings.firebase_api_key},
        json={"oobCode": oob_code},
        timeout=10.0,
    )
    resp.raise_for_status()
    return resp.json()["email"]


def revoke_refresh_tokens(uid: str) -> None:
    """PA02 — invalidate existing sessions on logout-everywhere / account changes."""
    from firebase_admin import auth

    _ensure_app()
    auth.revoke_refresh_tokens(uid)


def delete_firebase_user(uid: str) -> None:
    """PA06 — Delete Account."""
    from firebase_admin import auth

    _ensure_app()
    auth.delete_user(uid)
