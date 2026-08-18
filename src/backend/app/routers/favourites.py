"""CH15 (Save Favourite) / CH16 (View Saved Favourites) / PA15 (View Child's
Saved Favourites, parent-side — GET below is reachable by either auth, see
core/deps.py's `get_child_dual_auth`).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import get_child_dual_auth, get_current_child
from app.models.child import ChildProfile
from app.models.favourite import Favourite, FavouriteCreate
from app.repositories import children as children_repo
from app.repositories import favourites as favourites_repo
from app.repositories import parents as parents_repo

router = APIRouter(prefix="/children/{child_id}/favourites", tags=["favourites"])

FREE_TIER_FAVOURITES_CAP = 5


@router.post("", response_model=Favourite, status_code=status.HTTP_201_CREATED)
def save_favourite(
    child_id: str, data: FavouriteCreate, child: ChildProfile = Depends(get_current_child)
) -> Favourite:
    """CH15 — Save Favourite. Free tier capped at 5 (PRD's CH15 alt-flow);
    Premium removes the cap (PA34)."""
    if child.id != child_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your profile")

    parent = parents_repo.get_parent(child.parent_id)
    tier = parent.subscription_tier if parent else "free"
    if tier == "free" and child.favourites_count >= FREE_TIER_FAVOURITES_CAP:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You've saved 5 favourites — ask a parent about Premium for unlimited favourites!",
        )

    fav = favourites_repo.add_favourite(child_id, data.catalogue_item_id)
    children_repo.adjust_favourites_count(child_id, +1)
    return fav


@router.get("", response_model=list[Favourite])
def list_favourites(child_id: str, child: ChildProfile = Depends(get_child_dual_auth)) -> list[Favourite]:
    """CH16 (child) / PA15 (parent) — View Saved Favourites."""
    return favourites_repo.list_favourites(child_id)


@router.delete("/{favourite_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def remove_favourite(
    child_id: str, favourite_id: str, child: ChildProfile = Depends(get_current_child)
) -> None:
    if child.id != child_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your profile")
    fav = favourites_repo.get_favourite(favourite_id)
    if fav is None or fav.child_id != child_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Favourite not found")
    favourites_repo.remove_favourite(favourite_id)
    children_repo.adjust_favourites_count(child_id, -1)
