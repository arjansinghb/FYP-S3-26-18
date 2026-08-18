"""Parent auth — branches on `settings.firebase_configured` between real
Firebase Auth (Identity Toolkit REST + Admin SDK, see app/core/firebase.py) and
a local-dev-store email/password path (see app/repositories/dev_users.py), so
the core loop is buildable/testable without a live Firebase project — see
agent-context/CLAUDE.md §12.
"""
from __future__ import annotations

import uuid

import jwt
from fastapi import HTTPException, status

from app.core.config import get_settings
from app.core.security import (
    create_email_verification_token,
    create_parent_dev_token,
    decode_email_verification_token,
    hash_secret,
    verify_secret,
)
from app.models.parent import Parent, ParentCreate
from app.repositories import dev_users, parents


def signup_parent(data: ParentCreate) -> tuple[Parent, str]:
    """UV05 — Sign Up (Create Parent Account)."""
    if parents.get_parent_by_email(data.email) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    settings = get_settings()
    if settings.firebase_configured:
        from app.core.firebase import create_firebase_user, sign_in_with_password

        parent_id = create_firebase_user(data.email, data.password, data.display_name)
        parent = parents.create_parent(parent_id, data.email, data.display_name)
        token = sign_in_with_password(data.email, data.password)
    else:
        parent_id = str(uuid.uuid4())
        parent = parents.create_parent(parent_id, data.email, data.display_name)
        dev_users.create_dev_user(parent_id, data.email, hash_secret(data.password))
        token = create_parent_dev_token(parent_id)
    return parent, token


def login_parent(email: str, password: str) -> tuple[Parent, str]:
    """PA01 — Log In."""
    settings = get_settings()
    if settings.firebase_configured:
        from app.core.firebase import sign_in_with_password

        try:
            token = sign_in_with_password(email, password)
        except Exception as exc:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password") from exc
        parent = parents.get_parent_by_email(email)
        if parent is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Parent record missing — contact support")
    else:
        record = dev_users.get_dev_user_by_email(email)
        if record is None or not verify_secret(password, record["password_hash"]):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
        parent = parents.get_parent(record["parent_id"])
        if parent is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Parent record missing — contact support")
        token = create_parent_dev_token(parent.id)

    if parent.status == "suspended":
        # SA06 — Suspend User Account: blocks login, per its normal flow step 3.
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been suspended. Contact support.")
    return parent, token


def logout_parent(parent_id: str) -> None:
    """PA02 — Log Out."""
    settings = get_settings()
    if settings.firebase_configured:
        from app.core.firebase import revoke_refresh_tokens

        revoke_refresh_tokens(parent_id)
    # local-dev-store tokens are stateless JWTs — "logout" there is a client-side discard only.


def request_password_reset(email: str) -> str | None:
    """PA03 — Reset Password. dev-session 2026-08-17: firebase_configured now
    sends a *real* email via Identity Toolkit's sendOobCode (see
    app/core/firebase.py's send_password_reset_email) instead of generating a
    link nothing ever delivered — returns None since there's nothing left for
    the caller to display, the email itself carries the link. Local-dev-store
    keeps the old dev-token shortcut (no real inbox exists to email in that
    mode anyway). Returns None either way if the email isn't registered; the
    router still replies with a generic success message regardless (PRD
    alt-flow 1a: don't reveal account existence)."""
    settings = get_settings()
    if settings.firebase_configured:
        from app.core.firebase import send_password_reset_email

        try:
            send_password_reset_email(email, continue_url=f"{settings.cors_origin}/reset-password")
        except Exception:
            pass  # still don't reveal whether the email is registered
        return None
    record = dev_users.get_dev_user_by_email(email)
    if record is None:
        return None
    return create_parent_dev_token(record["parent_id"])  # dev-mode stand-in "reset token"


def confirm_password_reset(oob_code: str, new_password: str) -> None:
    """PA03 — confirm step, Firebase-only. Local-dev-store has no oobCode
    concept — its "reset" is the dev-token shortcut above, which already acts
    as a session, so there's nothing to confirm separately in that mode."""
    settings = get_settings()
    if not settings.firebase_configured:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Password reset confirmation isn't available in local-dev mode — the reset request itself already returns a usable session.",
        )
    from app.core.firebase import confirm_password_reset as firebase_confirm_password_reset

    try:
        firebase_confirm_password_reset(oob_code, new_password)
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired reset link") from exc


def request_email_verification(parent: Parent, id_token: str) -> str | None:
    """UV06 — Verify Account (request step). dev-session 2026-08-17:
    firebase_configured now sends a *real* email via sendOobCode (see
    app/core/firebase.py's send_email_verification_email), forwarding the
    caller's own Firebase ID token as Identity Toolkit requires — returns
    None since the email carries the link. Local-dev-store keeps returning
    the token directly for the UI to display/confirm inline, unchanged."""
    settings = get_settings()
    if settings.firebase_configured:
        from app.core.firebase import send_email_verification_email

        send_email_verification_email(id_token, continue_url=f"{settings.cors_origin}/verify-email")
        return None
    return create_email_verification_token(parent.id)


def confirm_email_verification(token: str) -> Parent:
    """UV06 — Verify Account (confirm step, local-dev-store's JWT path)."""
    try:
        payload = decode_email_verification_token(token)
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired verification link") from exc

    parent = parents.get_parent(payload["parent_id"])
    if parent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Parent not found")
    parents.update_parent(parent.id, email_verified=True)
    return parents.get_parent(parent.id)


def confirm_email_verification_oob(oob_code: str) -> Parent:
    """UV06 — Verify Account (confirm step, Firebase's real-email path).
    Consumes the oobCode against Identity Toolkit, then marks our own
    `parents` record verified — see app/core/firebase.py's
    confirm_email_verification_oob docstring for why that's a separate flag
    from Firebase Auth's own copy."""
    from app.core.firebase import confirm_email_verification_oob as firebase_confirm_verification

    try:
        email = firebase_confirm_verification(oob_code)
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired verification link") from exc

    parent = parents.get_parent_by_email(email)
    if parent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Parent not found")
    parents.update_parent(parent.id, email_verified=True)
    return parents.get_parent(parent.id)


def delete_parent_account(parent: Parent) -> None:
    """PA06 — Delete Account. Cascades to every child profile under this
    parent (and everything scoped under each of those — see
    children_repo.cascade_delete_child) before removing the parent record."""
    from app.repositories import billing as billing_repo
    from app.repositories import children as children_repo
    from app.repositories import notifications as notifications_repo

    for child in children_repo.list_children_for_parent(parent.id):
        children_repo.cascade_delete_child(child.id)
    notifications_repo.delete_notifications_for_parent(parent.id)
    billing_repo.delete_billing_records_for_parent(parent.id)

    settings = get_settings()
    if settings.firebase_configured:
        from app.core.firebase import delete_firebase_user

        delete_firebase_user(parent.id)
    else:
        dev_users.delete_dev_user(parent.id)
    parents.delete_parent(parent.id)
