"""Typed CRUD over `DocumentStore` for the
`parents/{parentId}/childProfiles/{childId}` collection (flattened — see
app/repositories/base.py docstring). See app/models/child.py.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from app.models.child import AgeBand, ChildProfile
from app.repositories.store import COLLECTION_CHILD_PROFILES, get_store


def _to_doc(profile: ChildProfile) -> dict:
    doc = profile.model_dump()
    doc["dob"] = profile.dob.isoformat()  # keep as ISO string — Firestore's Python client doesn't accept bare `date`
    return doc


def _from_doc(doc: dict) -> ChildProfile:
    data = dict(doc)
    if isinstance(data.get("dob"), str):
        data["dob"] = date.fromisoformat(data["dob"])
    return ChildProfile(**data)


def create_child(
    parent_id: str,
    name: str,
    dob: date,
    age_band: AgeBand,
    pin_hash: str,
    avatar_id: str | None = None,
) -> ChildProfile:
    """PA07 (Create Child Profile) + PA10 (Set Child Profile PIN), bundled — see
    app/models/child.py module docstring for why."""
    child_id = str(uuid.uuid4())
    profile = ChildProfile(
        id=child_id,
        parent_id=parent_id,
        name=name,
        dob=dob,
        age_band=age_band,
        pin_hash=pin_hash,
        avatar_id=avatar_id,
        created_at=datetime.now(timezone.utc),
    )
    get_store().create(COLLECTION_CHILD_PROFILES, child_id, _to_doc(profile))
    return profile


def get_child(child_id: str) -> ChildProfile | None:
    doc = get_store().get(COLLECTION_CHILD_PROFILES, child_id)
    return _from_doc(doc) if doc else None


def list_children_for_parent(parent_id: str) -> list[ChildProfile]:
    docs = get_store().list(COLLECTION_CHILD_PROFILES, {"parent_id": parent_id})
    return [_from_doc(d) for d in docs]


def count_all_children() -> int:
    """SA08 — View System Health/Monitoring."""
    return len(get_store().list(COLLECTION_CHILD_PROFILES))


def update_child(child_id: str, **fields) -> None:
    """PA08 — Edit Child Profile (also covers age-band changes, see
    app/models/child.py module docstring)."""
    get_store().update(COLLECTION_CHILD_PROFILES, child_id, fields)


def delete_child(child_id: str) -> None:
    """PA09 — Delete Child Profile."""
    get_store().delete(COLLECTION_CHILD_PROFILES, child_id)


def mark_first_login(child_id: str) -> None:
    """CH01 — Enter Linking Code to Activate Profile: recorded the first time a
    child profile's PIN is successfully entered."""
    get_store().update(COLLECTION_CHILD_PROFILES, child_id, {"first_login_at": datetime.now(timezone.utc)})


def adjust_favourites_count(child_id: str, delta: int) -> None:
    child = get_child(child_id)
    if child is not None:
        new_count = max(0, child.favourites_count + delta)
        get_store().update(COLLECTION_CHILD_PROFILES, child_id, {"favourites_count": new_count})


def cascade_delete_child(child_id: str) -> None:
    """PA09 (Delete Child Profile) / PA30 (Request Child Data Deletion) — removes
    the child profile *and* everything scoped under it (sessions, messages,
    favourites, feedback, flags, content overrides). Imported lazily to avoid a
    module-load-order cycle (these repos don't import children.py themselves,
    but keeping the imports local here makes that non-dependency explicit)."""
    from app.repositories import content_overrides as content_overrides_repo
    from app.repositories import chat as chat_repo
    from app.repositories import favourites as favourites_repo
    from app.repositories import feedback as feedback_repo
    from app.repositories import flags as flags_repo

    chat_repo.delete_sessions_for_child(child_id)
    favourites_repo.delete_favourites_for_child(child_id)
    feedback_repo.delete_feedback_for_child(child_id)
    flags_repo.delete_flags_for_child(child_id)
    content_overrides_repo.delete_overrides_for_child(child_id)
    delete_child(child_id)
