"""Parent-only oversight endpoints not covered elsewhere: PA16/PA17 (flag
content + status), PA18 (content overrides), PA19 (external link for a saved
book), PA31/PA32 (Premium activity trends + multi-child comparative
insights). PA12-15 live in chat.py/favourites.py (shared read endpoints via
`get_child_dual_auth`); PA13 lives in children.py.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import get_current_parent, require_owner
from app.models.analytics import ActivityTrends, ChildInsight
from app.models.content_override import ContentOverride, ContentOverrideCreate
from app.models.flag import Flag, FlagCreate
from app.models.parent import Parent
from app.repositories import catalogue as catalogue_repo
from app.repositories import children as children_repo
from app.repositories import content_overrides as content_overrides_repo
from app.repositories import flags as flags_repo
from app.services import activity_analytics

router = APIRouter(tags=["parent-dashboard"])


@router.post("/flags", response_model=Flag, status_code=status.HTTP_201_CREATED)
def create_flag(data: FlagCreate, parent: Parent = Depends(get_current_parent)) -> Flag:
    """PA16 — Report/Flag Content from History."""
    child = children_repo.get_child(data.child_id)
    if child is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Child profile not found")
    require_owner(parent, child)
    return flags_repo.create_flag(parent.id, data)


@router.get("/flags", response_model=list[Flag])
def list_my_flags(parent: Parent = Depends(get_current_parent)) -> list[Flag]:
    """PA17 — View Flagged Content Status."""
    return flags_repo.list_flags_for_parent(parent.id)


@router.get("/flags/{flag_id}", response_model=Flag)
def get_flag_status(flag_id: str, parent: Parent = Depends(get_current_parent)) -> Flag:
    """PA17 — View Flagged Content Status (single item)."""
    flag = flags_repo.get_flag(flag_id)
    if flag is None or flag.parent_id != parent.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Flag not found")
    return flag


@router.post("/children/{child_id}/content-overrides", response_model=ContentOverride, status_code=status.HTTP_201_CREATED)
def set_content_override(
    child_id: str, data: ContentOverrideCreate, parent: Parent = Depends(get_current_parent)
) -> ContentOverride:
    """PA18 — Hide Specific Content (approve/block override). Applied at
    recommendation time — see app/services/recommendation_service.py."""
    child = children_repo.get_child(child_id)
    if child is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Child profile not found")
    require_owner(parent, child)
    if catalogue_repo.get_item(data.catalogue_item_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Catalogue item not found")
    return content_overrides_repo.set_override(child_id, data)


@router.get("/children/{child_id}/content-overrides", response_model=list[ContentOverride])
def list_content_overrides(child_id: str, parent: Parent = Depends(get_current_parent)) -> list[ContentOverride]:
    child = children_repo.get_child(child_id)
    if child is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Child profile not found")
    require_owner(parent, child)
    return content_overrides_repo.list_overrides_for_child(child_id)


@router.get("/children/{child_id}/trends", response_model=ActivityTrends)
def get_child_trends(child_id: str, parent: Parent = Depends(get_current_parent)) -> ActivityTrends:
    """PA31 — View Full Activity History & Trends (Premium). The free tier's
    PA14 (chat.py's GET .../activity) already has the raw transcript; this
    adds the computed weekly-count/top-topics layer on the same data."""
    if parent.subscription_tier != "premium":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Trend insights are a Premium feature")
    child = children_repo.get_child(child_id)
    if child is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Child profile not found")
    require_owner(parent, child)
    return activity_analytics.build_trends(child_id)


@router.get("/children-insights", response_model=list[ChildInsight])
def get_comparative_insights(parent: Parent = Depends(get_current_parent)) -> list[ChildInsight]:
    """PA32 — View Multi-Child Comparative Insights (Premium). Route is
    `/children-insights`, not `/children/insights` — the latter would collide
    with children.py's `GET /children/{child_id}` (a literal 'insights' would
    be parsed as a child_id there); see that router's own "me"-before-
    "{child_id}" comment for the same class of bug."""
    if parent.subscription_tier != "premium":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Comparative insights are a Premium feature")
    return [activity_analytics.build_insight(child) for child in children_repo.list_children_for_parent(parent.id)]


@router.get("/catalogue/{item_id}/external-link")
def get_external_link(item_id: str, parent: Parent = Depends(get_current_parent)) -> dict:
    """PA19 — View External Access Options for Saved Book. Parent-only —
    `sourceUrl` is never sent to the child client (see CatalogueItemPublic)."""
    item = catalogue_repo.get_item(item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Catalogue item not found")
    if not item.source_url:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No external link available for this item")
    return {"item_id": item.id, "title": item.title, "url": item.source_url}
