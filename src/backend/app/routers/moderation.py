"""CM01-CM13 — Content Moderator. Staff login is shared with System Admin
(app/routers/admin.py) via `get_current_staff`; routes here don't additionally
check role, since both roles moderate in this build (no separate
moderator-vs-admin permission split was specified anywhere) — flag to the
team if that split should be enforced.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import get_current_staff
from app.core.security import verify_secret
from app.models.catalogue import (
    AgeBandTagUpdate,
    CatalogueItem,
    CatalogueItemUpdate,
    ContentSearchResult,
    ImportContentRequest,
    MetadataUpdate,
    RejectRequest,
)
from app.models.flag import Flag
from app.models.staff import StaffAccount, StaffLogin, StaffLoginResult, StaffPublic
from app.repositories import catalogue as catalogue_repo
from app.repositories import flags as flags_repo
from app.repositories import notifications as notifications_repo
from app.repositories import parents as parents_repo
from app.repositories import staff as staff_repo
from app.services import content_source_service, openai_service

router = APIRouter(tags=["moderation"])


@router.post("/moderation/login", response_model=StaffLoginResult)
def staff_login(data: StaffLogin) -> StaffLoginResult:
    """CM01/SA01 — Log In."""
    from app.core.security import create_staff_token

    account = staff_repo.get_staff_by_email(data.email)
    if account is None or not verify_secret(data.password, account.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    token = create_staff_token(account.id, account.role)
    return StaffLoginResult(staff=StaffPublic(id=account.id, email=account.email, role=account.role), token=token)


@router.post("/moderation/logout", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def staff_logout(staff: StaffAccount = Depends(get_current_staff)) -> None:
    """CM02/SA02 — Log Out. Stateless JWT — client-side discard only."""
    return None


# ---------------------------------------------------------------------------
# Catalogue CRUD — CM03/CM04/CM05/CM13
# ---------------------------------------------------------------------------


def _embedding_text(item: CatalogueItem) -> str:
    return f"{item.title} {item.synopsis} {item.genre or ''} {' '.join(item.topics)}"


def _maybe_promote_to_live(item_id: str) -> None:
    """After CM09 (age-band tag) or CM10 (metadata), promote pendingTagging ->
    live once *both* steps have happened — mirrors agent-context/CLAUDE.md
    §5.1's "embeddings computed once at CM09/CM10 tagging time" note."""
    item = catalogue_repo.get_item(item_id)
    if item is None or item.status != "pendingTagging":
        return
    has_age_bands = len(item.age_bands) > 0
    has_metadata = bool(item.genre) or len(item.topics) > 0 or bool(item.reading_level)
    if has_age_bands and has_metadata:
        embedding = openai_service.embed_text(_embedding_text(item))
        catalogue_repo.update_item(item_id, embedding=embedding, status="live")


@router.get("/catalogue", response_model=list[CatalogueItem])
def browse_catalogue(
    status_filter: str | None = None, q: str | None = None, staff: StaffAccount = Depends(get_current_staff)
) -> list[CatalogueItem]:
    """CM13 — Browse Content Database. `status_filter` and `q` (title
    substring, case-insensitive) are both optional."""
    items = catalogue_repo.list_all_items()
    if status_filter:
        items = [i for i in items if i.status == status_filter]
    if q:
        needle = q.lower()
        items = [i for i in items if needle in i.title.lower()]
    return items


@router.post("/catalogue/import", response_model=CatalogueItem, status_code=status.HTTP_201_CREATED)
def import_content(data: ImportContentRequest, staff: StaffAccount = Depends(get_current_staff)) -> CatalogueItem:
    """CM03 — Add Catalogue Entry, sourced from a Google Books/YouTube search
    result (see content_source_service.py). Starts `pendingReview` like
    everything else — importing is not the same as approving. The generated
    ID is derived from source+external_id so re-importing the same search
    result is idempotent (returns the existing item) rather than duplicating."""
    item_id = f"{data.type}-{data.external_id}"
    existing = catalogue_repo.get_item(item_id)
    if existing is not None:
        return existing
    item = CatalogueItem(
        id=item_id,
        title=data.title,
        type=data.type,
        synopsis=data.synopsis,
        source_url=data.source_url,
        status="pendingReview",
        moderator_id=staff.id,
        created_at=datetime.now(timezone.utc),
    )
    catalogue_repo.create_item(item)
    return item


@router.patch("/catalogue/{item_id}", response_model=CatalogueItem)
def edit_catalogue_entry(
    item_id: str, data: CatalogueItemUpdate, staff: StaffAccount = Depends(get_current_staff)
) -> CatalogueItem:
    """CM04 — Edit Catalogue Entry."""
    item = catalogue_repo.get_item(item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Catalogue item not found")
    fields = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if fields:
        catalogue_repo.update_item(item_id, **fields)
        if item.status == "live":
            # Re-embed if a live item's searchable text changed.
            refreshed = catalogue_repo.get_item(item_id)
            if refreshed:
                catalogue_repo.update_item(item_id, embedding=openai_service.embed_text(_embedding_text(refreshed)))
    return catalogue_repo.get_item(item_id)


@router.delete("/catalogue/{item_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def remove_catalogue_entry(item_id: str, staff: StaffAccount = Depends(get_current_staff)) -> None:
    """CM05 — Remove Catalogue Entry. Soft-delete (status="removed") rather
    than a hard delete, to keep an audit trail and so PA16/CM11 flags
    referencing this item still resolve to something."""
    item = catalogue_repo.get_item(item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Catalogue item not found")
    catalogue_repo.update_item(item_id, status="removed")


# ---------------------------------------------------------------------------
# Review pipeline — CM06/CM07/CM08/CM09/CM10
# ---------------------------------------------------------------------------


@router.get("/moderation/queue", response_model=list[CatalogueItem])
def review_queue(staff: StaffAccount = Depends(get_current_staff)) -> list[CatalogueItem]:
    """CM06 — Review New Content Submission (the queue itself)."""
    return [i for i in catalogue_repo.list_all_items() if i.status == "pendingReview"]


@router.post("/catalogue/{item_id}/approve", response_model=CatalogueItem)
def approve_content(item_id: str, staff: StaffAccount = Depends(get_current_staff)) -> CatalogueItem:
    """CM07 — Approve Content."""
    item = catalogue_repo.get_item(item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Catalogue item not found")
    if item.status != "pendingReview":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Item is '{item.status}', not pendingReview")
    catalogue_repo.update_item(item_id, status="pendingTagging", moderator_id=staff.id)
    return catalogue_repo.get_item(item_id)


@router.post("/catalogue/{item_id}/reject", response_model=CatalogueItem)
def reject_content(item_id: str, data: RejectRequest, staff: StaffAccount = Depends(get_current_staff)) -> CatalogueItem:
    """CM08 — Reject Content."""
    item = catalogue_repo.get_item(item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Catalogue item not found")
    if item.status != "pendingReview":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Item is '{item.status}', not pendingReview")
    catalogue_repo.update_item(item_id, status="rejected", moderator_id=staff.id)
    return catalogue_repo.get_item(item_id)


@router.post("/catalogue/{item_id}/age-bands", response_model=CatalogueItem)
def apply_age_band_tag(
    item_id: str, data: AgeBandTagUpdate, staff: StaffAccount = Depends(get_current_staff)
) -> CatalogueItem:
    """CM09 — Apply Age-Band Tag. Promotes to `live` once CM10's metadata is
    also present — see `_maybe_promote_to_live`."""
    item = catalogue_repo.get_item(item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Catalogue item not found")
    catalogue_repo.update_item(item_id, age_bands=data.age_bands)
    _maybe_promote_to_live(item_id)
    return catalogue_repo.get_item(item_id)


@router.post("/catalogue/{item_id}/metadata", response_model=CatalogueItem)
def apply_metadata(item_id: str, data: MetadataUpdate, staff: StaffAccount = Depends(get_current_staff)) -> CatalogueItem:
    """CM10 — Apply Reading-Level/Genre Metadata. Promotes to `live` once
    CM09's age-band tag is also present — see `_maybe_promote_to_live`."""
    item = catalogue_repo.get_item(item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Catalogue item not found")
    fields = data.model_dump(exclude_unset=True)
    catalogue_repo.update_item(item_id, **fields)
    _maybe_promote_to_live(item_id)
    return catalogue_repo.get_item(item_id)


# ---------------------------------------------------------------------------
# Flagged content — CM11/CM12
# ---------------------------------------------------------------------------


@router.get("/moderation/flags", response_model=list[Flag])
def review_flagged_content(
    status_filter: str = "pending", staff: StaffAccount = Depends(get_current_staff)
) -> list[Flag]:
    """CM11 — Review Reported Content."""
    return flags_repo.list_flags_by_status(status_filter)


@router.post("/moderation/flags/{flag_id}/resolve", response_model=Flag)
def resolve_flagged_content(
    flag_id: str,
    resolution: str,
    note: str | None = None,
    staff: StaffAccount = Depends(get_current_staff),
) -> Flag:
    """CM12 — Resolve Reported Content. `resolution` is "approved" (dismiss —
    item stays as-is) or "removed" (also soft-deletes the flagged catalogue
    item, if the flag targets one)."""
    flag = flags_repo.get_flag(flag_id)
    if flag is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Flag not found")
    if resolution not in ("approved", "removed"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "resolution must be 'approved' or 'removed'")
    flags_repo.resolve_flag(flag_id, resolution, note)
    if resolution == "removed" and flag.catalogue_item_id:
        catalogue_repo.update_item(flag.catalogue_item_id, status="removed")

    parent = parents_repo.get_parent(flag.parent_id)  # PA20 — notify the parent who raised it
    if parent is not None:
        notifications_repo.notify_if_enabled(
            parent,
            "flag_resolved",
            "Your report was resolved",
            f"A moderator marked your flagged content report as '{resolution}'."
            + (f" Note: {note}" if note else ""),
            child_id=flag.child_id,
        )
    return flags_repo.get_flag(flag_id)


# ---------------------------------------------------------------------------
# Google Books / YouTube search — feeds CM03
# ---------------------------------------------------------------------------


@router.get("/moderation/search/books", response_model=list[ContentSearchResult])
def search_books(q: str, staff: StaffAccount = Depends(get_current_staff)) -> list[ContentSearchResult]:
    raw = content_source_service.search_books(q)
    return [
        ContentSearchResult(
            external_id=r["external_id"],
            title=r["title"],
            synopsis=r["synopsis"],
            thumbnail=r["thumbnail"],
            source_url=r["source_url"],
            extra=", ".join(r["authors"]) if r["authors"] else None,
        )
        for r in raw
    ]


@router.get("/moderation/search/videos", response_model=list[ContentSearchResult])
def search_videos(q: str, staff: StaffAccount = Depends(get_current_staff)) -> list[ContentSearchResult]:
    raw = content_source_service.search_videos(q)
    return [
        ContentSearchResult(
            external_id=r["external_id"],
            title=r["title"],
            synopsis=r["synopsis"],
            thumbnail=r["thumbnail"],
            source_url=r["source_url"],
            extra=r["channel"],
        )
        for r in raw
    ]
