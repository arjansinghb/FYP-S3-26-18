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
    # 2026-09-09 fix — reload from Firestore on every authenticated request,
    # not just when the token itself is missing (see storage.py's
    # refresh_account docstring for the real bug this closes: a verified/
    # consent/tier change made on one warm Vercel instance was invisible to
    # every OTHER already-warm instance still serving the same cached
    # token, e.g. PA07's "please verify your email" firing on an account
    # that genuinely was already verified). No-op, and effectively free, in
    # local dev / when Firebase isn't configured.
    acc = db.refresh_account(acc_id)
    if not acc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found")
    # PA25 — lazily downgrade a scheduled-cancellation account once its date
    # has passed; runs on every authenticated request so no cron is needed.
    db.apply_pending_cancellation(acc)
    # PA30 — same lazy pattern for scheduled child-data deletions.
    db.apply_due_deletions()
    # PA29 — and chat history past its retention period.
    db.apply_retention()
    return acc


def require_role(*roles: str):
    def checker(account: dict = Depends(current_account)) -> dict:
        if account["role"] not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed for this role")
        return account
    return checker


def current_child(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    child_id = _resolve(creds, "child")
    # Same cross-instance reload as current_account above — see
    # storage.py's refresh_child docstring.
    child = db.refresh_child(child_id)
    if not child:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Child session not found")
    db.apply_retention()
    return child
