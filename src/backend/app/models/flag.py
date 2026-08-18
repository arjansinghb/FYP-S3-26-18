"""PA16 (Report/Flag Content from History) / PA17 (View Flagged Content Status)
— parent-raised. Resolved by a moderator via CM11/CM12 (see app/models/moderation.py)."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

FlagStatus = Literal["pending", "approved", "removed"]


class FlagCreate(BaseModel):
    child_id: str
    catalogue_item_id: str | None = None
    message_id: str | None = None
    reason: str = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def _one_target(self) -> "FlagCreate":
        if not self.catalogue_item_id and not self.message_id:
            raise ValueError("Provide either catalogue_item_id or message_id")
        return self


class Flag(BaseModel):
    id: str
    parent_id: str
    child_id: str
    catalogue_item_id: str | None = None
    message_id: str | None = None
    reason: str
    status: FlagStatus = "pending"
    raised_at: datetime
    resolved_at: datetime | None = None
    resolution_note: str | None = None
