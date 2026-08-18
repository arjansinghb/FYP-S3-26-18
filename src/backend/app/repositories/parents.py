"""Typed CRUD over `DocumentStore` for the `parents/{parentId}` collection.
See app/models/parent.py and agent-context/CLAUDE.md §6.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.models.parent import ConsentRecord, Parent
from app.repositories.store import COLLECTION_PARENTS, get_store


def create_parent(parent_id: str, email: str, display_name: str) -> Parent:
    parent = Parent(
        id=parent_id,
        email=email,
        display_name=display_name,
        created_at=datetime.now(timezone.utc),
    )
    get_store().create(COLLECTION_PARENTS, parent_id, parent.model_dump())
    return parent


def get_parent(parent_id: str) -> Parent | None:
    doc = get_store().get(COLLECTION_PARENTS, parent_id)
    return Parent(**doc) if doc else None


def get_parent_by_email(email: str) -> Parent | None:
    matches = get_store().list(COLLECTION_PARENTS, {"email": email})
    return Parent(**matches[0]) if matches else None


def update_parent(parent_id: str, **fields) -> None:
    get_store().update(COLLECTION_PARENTS, parent_id, fields)


def delete_parent(parent_id: str) -> None:
    get_store().delete(COLLECTION_PARENTS, parent_id)


def record_consent(parent_id: str, version: str = "v1") -> ConsentRecord:
    """PA28 — Provide Verifiable Parental Consent."""
    record = ConsentRecord(timestamp=datetime.now(timezone.utc), version=version)
    get_store().update(COLLECTION_PARENTS, parent_id, {"consent_record": record.model_dump()})
    return record


def list_all_parents() -> list[Parent]:
    """SA04 — Search User Account (the full list; router does the filtering —
    fine at this dataset size, see app/routers/admin.py)."""
    return [Parent(**d) for d in get_store().list(COLLECTION_PARENTS)]


def count_all_parents() -> int:
    return len(get_store().list(COLLECTION_PARENTS))
