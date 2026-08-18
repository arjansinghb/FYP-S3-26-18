"""Typed CRUD for `staffAccounts/{staffId}`. See app/models/staff.py."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.models.staff import StaffAccount
from app.repositories.store import COLLECTION_STAFF_ACCOUNTS, get_store


def create_staff(email: str, role: str, password_hash: str) -> StaffAccount:
    staff = StaffAccount(
        id=str(uuid.uuid4()), email=email, role=role, password_hash=password_hash, created_at=datetime.now(timezone.utc)
    )
    get_store().create(COLLECTION_STAFF_ACCOUNTS, staff.id, staff.model_dump())
    return staff


def get_staff(staff_id: str) -> StaffAccount | None:
    doc = get_store().get(COLLECTION_STAFF_ACCOUNTS, staff_id)
    return StaffAccount(**doc) if doc else None


def get_staff_by_email(email: str) -> StaffAccount | None:
    matches = get_store().list(COLLECTION_STAFF_ACCOUNTS, {"email": email})
    return StaffAccount(**matches[0]) if matches else None
