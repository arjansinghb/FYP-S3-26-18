"""PA18 — Hide Specific Content (approve/block override). A parent-set
per-child exception on top of the normal age-band filter — see
app/services/recommendation_service.py for how "block" and "approve" are
applied at retrieval time."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

Decision = Literal["approve", "block"]


class ContentOverrideCreate(BaseModel):
    catalogue_item_id: str
    decision: Decision


class ContentOverride(BaseModel):
    id: str
    child_id: str
    catalogue_item_id: str
    decision: Decision
    created_at: datetime
