"""Typed CRUD for `flags/{flagId}` — PA16/PA17 (parent side), CM11/CM12
(moderator side, see app/repositories/moderation.py)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.models.flag import Flag, FlagCreate
from app.repositories.store import COLLECTION_FLAGS, get_store


def create_flag(parent_id: str, data: FlagCreate) -> Flag:
    flag = Flag(
        id=str(uuid.uuid4()),
        parent_id=parent_id,
        child_id=data.child_id,
        catalogue_item_id=data.catalogue_item_id,
        message_id=data.message_id,
        reason=data.reason,
        raised_at=datetime.now(timezone.utc),
    )
    get_store().create(COLLECTION_FLAGS, flag.id, flag.model_dump())
    return flag


def get_flag(flag_id: str) -> Flag | None:
    doc = get_store().get(COLLECTION_FLAGS, flag_id)
    return Flag(**doc) if doc else None


def list_flags_for_parent(parent_id: str) -> list[Flag]:
    docs = get_store().list(COLLECTION_FLAGS, {"parent_id": parent_id})
    return sorted((Flag(**d) for d in docs), key=lambda f: f.raised_at, reverse=True)


def list_flags_by_status(status: str | None = None) -> list[Flag]:
    """CM11 — Review Reported Content (moderator queue)."""
    where = {"status": status} if status else None
    docs = get_store().list(COLLECTION_FLAGS, where)
    return sorted((Flag(**d) for d in docs), key=lambda f: f.raised_at)


def resolve_flag(flag_id: str, status: str, resolution_note: str | None = None) -> None:
    """CM12 — Resolve Reported Content."""
    get_store().update(
        COLLECTION_FLAGS,
        flag_id,
        {"status": status, "resolved_at": datetime.now(timezone.utc), "resolution_note": resolution_note},
    )


def delete_flags_for_child(child_id: str) -> None:
    for flag in [Flag(**d) for d in get_store().list(COLLECTION_FLAGS, {"child_id": child_id})]:
        get_store().delete(COLLECTION_FLAGS, flag.id)
