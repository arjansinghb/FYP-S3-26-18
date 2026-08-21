"""Child self-service (uses a child session token, from /api/children/link).

Covers CH19 (choose avatar) and CH20 (edit avatar), plus a "me" lookup so the
app can restore a child's session on reload. Log out (CH03) is handled on the
client by dropping the token.
"""
from fastapi import APIRouter, Depends

from ..deps import current_child
from ..models import AvatarUpdate, ChildOut, ChildSettings
from ..storage import db

router = APIRouter(prefix="/api/child", tags=["child"])


def _child_out(c: dict) -> ChildOut:
    return ChildOut(
        id=c["id"], parent_id=c["parent_id"], name=c["name"], age_band=c["age_band"],
        reading_level=c.get("reading_level"), linking_code=c["linking_code"], avatar=c["avatar"],
        settings=ChildSettings(**c.get("settings", {})),
    )


@router.get("/me", response_model=ChildOut)
def me(child: dict = Depends(current_child)):
    return _child_out(child)


@router.put("/avatar", response_model=ChildOut)
def set_avatar(body: AvatarUpdate, child: dict = Depends(current_child)):
    """CH19/CH20 — the child picks/edits their avatar."""
    child["avatar"] = body.avatar
    return _child_out(child)
