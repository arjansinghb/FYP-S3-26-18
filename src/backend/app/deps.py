"""Shared authentication dependencies used by the routers."""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .storage import db

bearer = HTTPBearer(auto_error=True)


def _resolve(creds: HTTPAuthorizationCredentials, expected_kind: str):
    entry = db.resolve_token(creds.credentials)
    if not entry or entry["kind"] != expected_kind:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    return entry["id"]


def current_account(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    acc_id = _resolve(creds, "account")
    acc = db.accounts.get(acc_id)
    if not acc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found")
    return acc


def require_role(*roles: str):
    def checker(account: dict = Depends(current_account)) -> dict:
        if account["role"] not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed for this role")
        return account
    return checker


def current_child(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    child_id = _resolve(creds, "child")
    child = db.children.get(child_id)
    if not child:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Child session not found")
    return child
