"""Accounts & auth — covers PA01/PA02 (login/logout), UV05 (sign up), UV06
(email verification), PA03 (password reset), and the moderator/admin logins
(CM01/SA01) through one shared mechanism.

LATER: Firebase Authentication replaces this; UV06/PA03 become real emailed
Firebase flows instead of the dev-mode token-in-response approach below.
"""
from fastapi import APIRouter, Depends, HTTPException

from ..deps import current_account
from ..models import (
    AccountOut, AccountUpdate, AuthOut, LoginRequest, PasswordResetConfirm,
    PasswordResetRequest, PasswordResetRequestOut, SignupOut, SignupRequest,
    VerifyConfirm, VerifyRequestOut,
)
from ..storage import db

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _account_out(acc: dict) -> AccountOut:
    return AccountOut(id=acc["id"], email=acc["email"], name=acc["name"],
                      role=acc["role"], verified=acc["verified"], tier=acc.get("tier", "free"))


@router.post("/signup", response_model=SignupOut)
def signup(body: SignupRequest):
    """UV05. Per the URS, signup creates the account "pending email
    verification" (UV06) — a verification token is minted right away so the
    client can immediately offer to confirm it (dev mode: no email service is
    configured, see VerifyRequestOut's own note, so the token comes back in
    the signup response instead of being emailed)."""
    try:
        acc = db.create_account(body.email, body.password, body.name, role="parent")
    except ValueError as e:
        raise HTTPException(409, str(e))
    token = db.issue_token("account", acc["id"])
    verify_token = db.request_email_verification(acc)
    return SignupOut(token=token, account=_account_out(acc), verify_token=verify_token)


@router.post("/login", response_model=AuthOut)
def login(body: LoginRequest):
    acc = db.find_account_by_email(body.email)
    if not acc or not db.check_password(acc, body.password):
        raise HTTPException(401, "Wrong email or password")
    if acc.get("suspended"):
        raise HTTPException(403, "This account has been suspended. Please contact support.")
    token = db.issue_token("account", acc["id"])
    return AuthOut(token=token, account=_account_out(acc))


@router.post("/logout")
def logout(account: dict = Depends(current_account)):
    # token is revoked client-side by dropping it; also clear server-side copies
    for tok, entry in list(db.tokens.items()):
        if entry == {"kind": "account", "id": account["id"]}:
            db.revoke_token(tok)
    return {"ok": True}


@router.get("/me", response_model=AccountOut)
def me(account: dict = Depends(current_account)):
    return _account_out(account)


@router.patch("/me", response_model=AccountOut)
def update_me(body: AccountUpdate, account: dict = Depends(current_account)):
    try:
        db.update_account(account, name=body.name, email=body.email, password=body.password)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return _account_out(account)


@router.delete("/me", status_code=204)
def delete_me(account: dict = Depends(current_account)):
    db.delete_account(account["id"])


# ---------- UV06: email verification ----------

@router.post("/verify/request", response_model=VerifyRequestOut)
def request_verification(account: dict = Depends(current_account)):
    """2b in CH... (UV06 Alt Flow 2b) — visitor requests a resend."""
    if account["verified"]:
        raise HTTPException(400, "Account is already verified")
    token = db.request_email_verification(account)
    return VerifyRequestOut(token=token)


@router.post("/verify/confirm", response_model=AccountOut)
def confirm_verification(body: VerifyConfirm):
    account = db.confirm_email_verification(body.token)
    if not account:
        raise HTTPException(400, "That verification link is invalid or has expired.")
    return _account_out(account)


# ---------- PA03: password reset ----------

@router.post("/reset-password/request", response_model=PasswordResetRequestOut)
def request_password_reset(body: PasswordResetRequest):
    """Doesn't reveal whether the email is registered (same non-enumeration
    principle as child_login's shared error message) — always 200, but the
    token is only actually minted (and returned, dev-mode) if it matches a
    real account."""
    token = db.request_password_reset(body.email)
    return PasswordResetRequestOut(token=token)


@router.post("/reset-password/confirm", response_model=AccountOut)
def confirm_password_reset(body: PasswordResetConfirm):
    account = db.confirm_password_reset(body.token, body.new_password)
    if not account:
        raise HTTPException(400, "That reset link is invalid or has expired.")
    return _account_out(account)
