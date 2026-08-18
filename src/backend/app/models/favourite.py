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
