"""PA07-PA09 (Create/Edit/Delete Child Profile) + CH01/CH02 (child PIN login).

Free-tier cap of 1 child profile / Premium up to 4 (PA33 in the PRD's Premium
use-case set) is enforced in `create_child_profile` below — see
agent-context/CLAUDE.md §8.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import get_current_parent, get_current_child, require_owner
from app.core.security import create_child_session_token, hash_secret, verify_secret
from app.models.child import (
    AvatarUpdate,
    ChildLoginResult,
    ChildPinLogin,
    ChildProfileCreate,
    ChildProfilePublic,
    ChildProfileUpdate,
    PinUpdate,
    ReadingLevelUpdate,
    SafetySettingsUpdate,
    derive_age_band,
)
from app.models.parent import Parent
from app.repositories import children as children_repo
from app.repositories import notifications as notifications_repo
from app.repositories import parents as parents_repo

router = APIRouter(tags=["children"])

FREE_TIER_CHILD_LIMIT = 1
PREMIUM_TIER_CHILD_LIMIT = 4


@router.post("/children", response_model=ChildProfilePublic, status_code=status.HTTP_201_CREATED)
def create_child_profile(
    data: ChildProfileCreate, parent: Parent = Depends(get_current_parent)
) -> ChildProfilePublic:
    """PA07 — Create Child Profile (bundles PA10 Set Child Profile PIN, see
    app/models/child.py). Precondition: parent has provided consent (PA28)."""
    if not parent.has_consented:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Verifiable parental consent (PA28) is required before creating a child profile.",
        )

    existing = children_repo.list_children_for_parent(parent.id)
    limit = PREMIUM_TIER_CHILD_LIMIT if parent.subscription_tier == "premium" else FREE_TIER_CHILD_LIMIT
    if len(existing) >= limit:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Free tier is limited to 1 child profile — upgrade to Premium for up to 4."
            if parent.subscription_tier == "free"
            else "Premium child-profile limit (4) reached.",
        )

    age_band = data.age_band_override or derive_age_band(data.dob)
    profile = children_repo.create_child(
        parent_id=parent.id,
        name=data.name,
        dob=data.dob,
        age_band=age_band,
        pin_hash=hash_secret(data.pin),
        avatar_id=data.avatar_id,
    )
    return profile.public()


@router.get("/children", response_model=list[ChildProfilePublic])
def list_child_profiles(parent: Parent = Depends(get_current_parent)) -> list[ChildProfilePublic]:
    return [c.public() for c in children_repo.list_children_for_parent(parent.id)]


@router.get("/children/me", response_model=ChildProfilePublic)
def get_my_profile(child=Depends(get_current_child)) -> ChildProfilePublic:
    """Convenience for the chat UI once logged in via a child session token.
    Registered BEFORE /children/{child_id} below — "me" would otherwise match
    that dynamic segment and get routed to the parent-auth'd handler instead
    (real bug hit during testing: FastAPI/Starlette matches routes in
    registration order, so a literal path must come before a competing
    dynamic one)."""
    return child.public()


@router.patch("/children/me/avatar", response_model=ChildProfilePublic)
def choose_avatar(data: AvatarUpdate, child=Depends(get_current_child)) -> ChildProfilePublic:
    """CH19 (Choose Avatar, first time) / CH20 (Edit Avatar, any time after) —
    child-facing, unlike PA08 which is the parent's edit path. Also registered
    before /children/{child_id}/... routes for the same reason as above."""
    children_repo.update_child(child.id, avatar_id=data.avatar_id)
    return children_repo.get_child(child.id).public()


@router.get("/children/{child_id}", response_model=ChildProfilePublic)
def get_child_profile(child_id: str, parent: Parent = Depends(get_current_parent)) -> ChildProfilePublic:
    child = children_repo.get_child(child_id)
    if child is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Child profile not found")
    require_owner(parent, child)
    return child.public()


@router.patch("/children/{child_id}", response_model=ChildProfilePublic)
def update_child_profile(
    child_id: str, data: ChildProfileUpdate, parent: Parent = Depends(get_current_parent)
) -> ChildProfilePublic:
    """PA08 — Edit Child Profile."""
    child = children_repo.get_child(child_id)
    if child is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Child profile not found")
    require_owner(parent, child)
    fields = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if fields:
        children_repo.update_child(child_id, **fields)
    return children_repo.get_child(child_id).public()


@router.patch("/children/{child_id}/pin", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def set_child_pin(child_id: str, data: PinUpdate, parent: Parent = Depends(get_current_parent)) -> None:
    """PA10 — Set Child Profile PIN, as a standalone later change (e.g. reset)."""
    child = children_repo.get_child(child_id)
    if child is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Child profile not found")
    require_owner(parent, child)
    children_repo.update_child(child_id, pin_hash=hash_secret(data.pin))


@router.post("/children/{child_id}/reading-level", response_model=ChildProfilePublic)
def set_reading_level(
    child_id: str, data: ReadingLevelUpdate, parent: Parent = Depends(get_current_parent)
) -> ChildProfilePublic:
    """PA13 — Set Reading-Level Guidance."""
    child = children_repo.get_child(child_id)
    if child is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Child profile not found")
    require_owner(parent, child)
    children_repo.update_child(child_id, reading_level_guidance=data.reading_level_guidance)
    return children_repo.get_child(child_id).public()


@router.patch("/children/{child_id}/safety-settings", response_model=ChildProfilePublic)
def update_safety_settings(
    child_id: str, data: SafetySettingsUpdate, parent: Parent = Depends(get_current_parent)
) -> ChildProfilePublic:
    """PA21 — Adjust Safety Settings. Actually enforced at recommendation
    time, not just stored — see app/services/recommendation_service.py."""
    child = children_repo.get_child(child_id)
    if child is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Child profile not found")
    require_owner(parent, child)
    updated = child.safety_settings.model_copy(update=data.model_dump(exclude_unset=True, exclude_none=True))
    children_repo.update_child(child_id, safety_settings=updated.model_dump())
    return children_repo.get_child(child_id).public()


@router.delete("/children/{child_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_child_profile(child_id: str, parent: Parent = Depends(get_current_parent)) -> None:
    """PA09 — Delete Child Profile. Cascades to sessions/messages/favourites/
    feedback/flags/content-overrides — see children_repo.cascade_delete_child."""
    child = children_repo.get_child(child_id)
    if child is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Child profile not found")
    require_owner(parent, child)
    children_repo.cascade_delete_child(child_id)


@router.post("/children/{child_id}/data-deletion-request", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def request_child_data_deletion(child_id: str, parent: Parent = Depends(get_current_parent)) -> None:
    """PA30 — Request Child Data Deletion. Simplified from the PRD's
    "confirm scope and deletion timeline, then schedule" flow to an immediate
    delete — there's no deferred-deletion job queue in this build (flagged,
    not silently skipped: see src/backend/README.md)."""
    child = children_repo.get_child(child_id)
    if child is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Child profile not found")
    require_owner(parent, child)
    children_repo.cascade_delete_child(child_id)


@router.post("/children/{child_id}/login", response_model=ChildLoginResult)
def child_login(child_id: str, data: ChildPinLogin) -> ChildLoginResult:
    """CH01 (first-ever login for this profile) / CH02 (every login after) —
    same endpoint, see app/models/child.py module docstring for why."""
    child = children_repo.get_child(child_id)
    if child is None or not verify_secret(data.pin, child.pin_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect PIN")

    activated = child.first_login_at is None
    if activated:
        children_repo.mark_first_login(child_id)
        parent = parents_repo.get_parent(child.parent_id)
        if parent is not None:
            notifications_repo.notify_if_enabled(
                parent,
                "child_activated",
                f"{child.name} activated their profile",
                f"{child.name} just logged in for the first time on a new device.",
                child_id=child.id,
            )

    # dev-session 2026-08-21 — engagement streak, see
    # app/repositories/children.py's record_daily_activity docstring.
    child = children_repo.record_daily_activity(child_id) or child

    token = create_child_session_token(child_id=child.id, parent_id=child.parent_id)
    return ChildLoginResult(profile=child.public(), session_token=token, activated=activated)
