"""Local-dev-store-only: email/password credentials for parent accounts, used
when `settings.firebase_configured` is False (see app/services/auth_service.py).
Never touched in real-Firebase mode — Firebase Auth owns credentials there.
"""
from __future__ import annotations

from typing import Any

from app.repositories.store import COLLECTION_DEV_USERS, get_store


def create_dev_user(parent_id: str, email: str, password_hash: str) -> None:
    get_store().create(
        COLLECTION_DEV_USERS, parent_id, {"parent_id": parent_id, "email": email, "password_hash": password_hash}
    )


def get_dev_user_by_email(email: str) -> dict[str, Any] | None:
    matches = get_store().list(COLLECTION_DEV_USERS, {"email": email})
    return matches[0] if matches else None


def delete_dev_user(parent_id: str) -> None:
    get_store().delete(COLLECTION_DEV_USERS, parent_id)
