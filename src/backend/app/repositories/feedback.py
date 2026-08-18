"""CH17 — Give Feedback on Recommendation. Persisted but not yet consumed by
anything downstream (no personalization loop reads it back) — see
src/backend/README.md known gaps.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from pydantic import BaseModel

from app.repositories.store import COLLECTION_FEEDBACK, get_store


class Feedback(BaseModel):
    id: str
    child_id: str
    item_id: str
    liked: bool
    created_at: datetime


def add_feedback(child_id: str, item_id: str, liked: bool) -> Feedback:
    fb = Feedback(id=str(uuid.uuid4()), child_id=child_id, item_id=item_id, liked=liked, created_at=datetime.now(timezone.utc))
    get_store().create(COLLECTION_FEEDBACK, fb.id, fb.model_dump())
    return fb


def list_feedback_for_child(child_id: str) -> list[Feedback]:
    docs = get_store().list(COLLECTION_FEEDBACK, {"child_id": child_id})
    return sorted((Feedback(**d) for d in docs), key=lambda f: f.created_at)


def delete_feedback_for_child(child_id: str) -> None:
    """Cascade delete — see app/repositories/children.py's `cascade_delete_child`."""
    for fb in list_feedback_for_child(child_id):
        get_store().delete(COLLECTION_FEEDBACK, fb.id)
