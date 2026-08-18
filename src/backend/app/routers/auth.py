"""UV05 (Sign Up) + PA01-PA03 (Log In / Log Out / Reset Password) + UV06
(Verify Account)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.core.deps import get_current_parent, get_current_parent_with_token
from app.models.parent import (
    AuthResponse,
    Parent,
    ParentCreate,
    ParentLogin,
    PasswordResetConfirm,
    PasswordResetRequest,
)
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def signup(data: ParentCreate) -> AuthResponse:
    parent, token = auth_service.signup_parent(data)
    return AuthResponse(parent=parent, token=token)


@router.post("/login", response_model=AuthResponse)
def login(data: ParentLogin) -> AuthResponse:
    parent, token = auth_service.login_parent(data.email, data.password)
    return AuthResponse(parent=parent, token=token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def logout(parent=Depends(get_current_parent)) -> None:
    auth_service.logout_parent(parent.id)


@router.post("/reset-password", status_code=status.HTTP_202_ACCEPTED)
def reset_password(data: PasswordResetRequest) -> dict:
    auth_service.request_password_reset(data.email)
    # Always a generic response, whether or not the email is registered — see
    # PRD alt-flow 1a and app/services/auth_service.py's own docstring.
    return {"message": "If that email is registered, a reset link has been sent."}


@router.post("/reset-password/confirm", status_code=status.HTTP_200_OK)
def confirm_reset_password(data: PasswordResetConfirm) -> dict:
    """PA03 — confirm step, the emailed link's landing page. Public — the
    oobCode itself is the credential, same as the link click would be."""
    auth_service.confirm_password_reset(data.oob_code, data.new_password)
    return {"message": "Password has been reset."}


class EmailVerificationConfirm(BaseModel):
    token: str | None = None  # local-dev-store path
    oob_code: str | None = None  # real Firebase path (dev-session 2026-08-17)


@router.post("/verify-email/request", status_code=status.HTTP_202_ACCEPTED)
def request_email_verification(parent_and_token: tuple[Parent, str] = Depends(get_current_parent_with_token)) -> dict:
    """UV06 — Verify Account (request step). Firebase-configured: a real
    email is sent (see app/services/auth_service.py), no token to display.
    Local-dev-store: no email transport exists, so the token is returned
    directly for the UI to display/confirm inline."""
    parent, id_token = parent_and_token
    if parent.email_verified:
        return {"message": "Already verified.", "verification_token": None}
    token = auth_service.request_email_verification(parent, id_token)
    message = "Verification link generated." if token else "Verification email sent."
    return {"message": message, "verification_token": token}


@router.post("/verify-email/confirm", response_model=Parent)
def confirm_email_verification(data: EmailVerificationConfirm) -> Parent:
    """UV06 — Verify Account (confirm step). Public — the token/oobCode
    itself is the credential, same as clicking an emailed link would be.
    Doesn't re-issue a session token: the caller's existing one (from
    login/signup) still works."""
    if data.oob_code:
        return auth_service.confirm_email_verification_oob(data.oob_code)
    if data.token:
        return auth_service.confirm_email_verification(data.token)
    raise HTTPException(status.HTTP_400_BAD_REQUEST, "Missing verification token/code")
