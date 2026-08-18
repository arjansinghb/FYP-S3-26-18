"""Typed CRUD over `DocumentStore` for `catalogueItems/{itemId}`.
See app/models/catalogue.py.
"""
from __future__ import annotations

from app.models.catalogue import CatalogueItem
from app.repositories.store import COLLECTION_CATALOGUE_ITEMS, get_store


def create_item(item: CatalogueItem) -> None:
    get_store().create(COLLECTION_CATALOGUE_ITEMS, item.id, item.model_dump())


def get_item(item_id: str) -> CatalogueItem | None:
    doc = get_store().get(COLLECTION_CATALOGUE_ITEMS, item_id)
    return CatalogueItem(**doc) if doc else None


def list_live_items(age_band: str | None = None) -> list[CatalogueItem]:
    """Only `status == "live"` items are ever eligible — see app/models/catalogue.py."""
    docs = get_store().list(COLLECTION_CATALOGUE_ITEMS, {"status": "live"})
    items = [CatalogueItem(**d) for d in docs]
    if age_band:
        items = [i for i in items if age_band in i.age_bands]
    return items


def update_item(item_id: str, **fields) -> None:
    get_store().update(COLLECTION_CATALOGUE_ITEMS, item_id, fields)


def list_all_items() -> list[CatalogueItem]:
    """CM13 — Browse Content Database (unfiltered by status, staff-only)."""
    return [CatalogueItem(**d) for d in get_store().list(COLLECTION_CATALOGUE_ITEMS)]
