"""Typed CRUD for `childProfiles/{childId}/contentOverrides/{itemId}`
(flattened — see app/repositories/base.py docstring). PA18."""
from __future__ import annotations

from datetime import datetime, timezone

from app.models.content_override import ContentOverride, ContentOverrideCreate
from app.repositories.store import COLLECTION_CONTENT_OVERRIDES, get_store


def _doc_id(child_id: str, catalogue_item_id: str) -> str:
    # One override per (child, item) — upserting via a deterministic ID keeps
    # "set it again" idempotent instead of accumulating duplicates.
    return f"{child_id}::{catalogue_item_id}"


def set_override(child_id: str, data: ContentOverrideCreate) -> ContentOverride:
    override = ContentOverride(
        id=_doc_id(child_id, data.catalogue_item_id),
        child_id=child_id,
        catalogue_item_id=data.catalogue_item_id,
        decision=data.decision,
        created_at=datetime.now(timezone.utc),
    )
    store = get_store()
    doc_id = override.id
    if store.get(COLLECTION_CONTENT_OVERRIDES, doc_id) is not None:
        store.update(COLLECTION_CONTENT_OVERRIDES, doc_id, override.model_dump())
    else:
        store.create(COLLECTION_CONTENT_OVERRIDES, doc_id, override.model_dump())
    return override


def list_overrides_for_child(child_id: str) -> list[ContentOverride]:
    docs = get_store().list(COLLECTION_CONTENT_OVERRIDES, {"child_id": child_id})
    return [ContentOverride(**d) for d in docs]


def delete_overrides_for_child(child_id: str) -> None:
    for o in list_overrides_for_child(child_id):
        get_store().delete(COLLECTION_CONTENT_OVERRIDES, o.id)
