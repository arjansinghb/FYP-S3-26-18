"""Typed CRUD over `DocumentStore` for `favourites/{favouriteId}`.
CH15 (Save Favourite) / CH16 (View Saved Favourites) / PA15 (parent-side view).
See app/models/favourite.py.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.models.favourite import Favourite
from app.repositories.store import COLLECTION_FAVOURITES, get_store


def add_favourite(child_id: str, catalogue_item_id: str) -> Favourite:
    fav = Favourite(
        id=str(uuid.uuid4()), child_id=child_id, catalogue_item_id=catalogue_item_id, saved_at=datetime.now(timezone.utc)
    )
    get_store().create(COLLECTION_FAVOURITES, fav.id, fav.model_dump())
    return fav


def list_favourites(child_id: str) -> list[Favourite]:
    docs = get_store().list(COLLECTION_FAVOURITES, {"child_id": child_id})
    return sorted((Favourite(**d) for d in docs), key=lambda f: f.saved_at)


def get_favourite(favourite_id: str) -> Favourite | None:
    doc = get_store().get(COLLECTION_FAVOURITES, favourite_id)
    return Favourite(**doc) if doc else None


def remove_favourite(favourite_id: str) -> None:
    get_store().delete(COLLECTION_FAVOURITES, favourite_id)


def delete_favourites_for_child(child_id: str) -> None:
    """Cascade delete — see app/repositories/children.py's `cascade_delete_child`."""
    for fav in list_favourites(child_id):
        get_store().delete(COLLECTION_FAVOURITES, fav.id)
