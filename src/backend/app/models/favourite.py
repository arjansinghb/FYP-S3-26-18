"""Favourites — CH15 (Save Favourite) / CH16 (View Saved Favourites) /
PA15 (View Child's Saved Favourites, parent-side)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class FavouriteCreate(BaseModel):
    catalogue_item_id: str = Field(min_length=1)


class Favourite(BaseModel):
    id: str
    child_id: str
    catalogue_item_id: str
    saved_at: datetime


class FavouriteWithItem(Favourite):
    """dev-session 2026-08-21: `GET .../favourites` used to return bare
    `Favourite` rows — just `catalogue_item_id` (e.g. "seed-dog-man"), which
    both the parent dashboard (PA15) and the child's own "My Favourites"
    view need a real title/cover for, not a raw catalogue ID. Enriched by
    looking up the catalogue item at request time (see
    app/routers/favourites.py) rather than denormalizing the title onto the
    favourite row itself — a catalogue item's title/synopsis can still
    change later (CM04) and this way the favourite always reflects the
    current one. `None` fields mean the catalogue item was removed after
    being favourited (CM05) — callers should handle that, not assume it's
    always populated."""

    title: str | None = None
    type: str | None = None
    synopsis: str | None = None
    embed_url: str | None = None
