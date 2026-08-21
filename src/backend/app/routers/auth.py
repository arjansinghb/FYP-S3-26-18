"""Accounts & auth — covers PA01/PA02 (login/logout), UV05 (sign up), and the
moderator/admin logins (CM01/SA01) through one shared mechanism.

LATER: Firebase Authentication replaces this; email verification and password
reset become Firebase flows.
"""
from fastapi import APIRouter, Depends, HTTPException

from ..deps import current_account
from ..models import AccountOut, AccountUpdate, AuthOut, LoginRequest, SignupRequest
from ..storage import db

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _account_out(acc: dict) -> AccountOut:
    return AccountOut(id=acc["id"], email=acc["email"], name=acc["name"],
                      role=acc["role"], verified=acc["verified"])


@router.post("/signup", response_model=AuthOut)
def signup(body: SignupRequest):
    try:
        acc = db.create_account(body.email, body.password, body.name, role="parent")
    except ValueError as e:
        raise HTTPException(409, str(e))
    token = db.issue_token("account", acc["id"])
    return AuthOut(token=token, account=_account_out(acc))


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
