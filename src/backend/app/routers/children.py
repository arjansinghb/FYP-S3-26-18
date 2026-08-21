"""Child profiles (PA07-PA10, PA13) and the child linking/login flow
(CH01 enter linking code, CH02 simplified PIN login)."""
from fastapi import APIRouter, Depends, HTTPException

from ..deps import current_account, require_role
from ..models import (
    ChildCreate, ChildLinkRequest, ChildOut, ChildSessionOut, ChildSettings, ChildUpdate,
)
from ..storage import db

router = APIRouter(tags=["children"])


def _child_out(c: dict) -> ChildOut:
    return ChildOut(
        id=c["id"], parent_id=c["parent_id"], name=c["name"], age_band=c["age_band"],
        reading_level=c.get("reading_level"), linking_code=c["linking_code"], avatar=c["avatar"],
        settings=ChildSettings(**c.get("settings", {})),
    )


def _owned_child(child_id: str, parent: dict) -> dict:
    child = db.children.get(child_id)
    if not child or child["parent_id"] != parent["id"]:
        raise HTTPException(404, "Child profile not found")
    return child


@router.post("/api/children", response_model=ChildOut, status_code=201)
def create_child(body: ChildCreate, parent: dict = Depends(require_role("parent"))):
    child = db.create_child(parent["id"], body.name, body.age_band, body.pin, body.reading_level)
    return _child_out(child)


@router.get("/api/children", response_model=list[ChildOut])
def list_children(parent: dict = Depends(require_role("parent"))):
    return [_child_out(c) for c in db.children_of(parent["id"])]


@router.patch("/api/children/{child_id}", response_model=ChildOut)
def update_child(child_id: str, body: ChildUpdate, parent: dict = Depends(require_role("parent"))):
    child = _owned_child(child_id, parent)
    for f in ("name", "age_band", "reading_level", "pin"):
        val = getattr(body, f)
        if val is not None:
            child[f] = val
    return _child_out(child)


@router.delete("/api/children/{child_id}", status_code=204)
def delete_child(child_id: str, parent: dict = Depends(require_role("parent"))):
    child = _owned_child(child_id, parent)
    db.children.pop(child["id"], None)
    db.favourites.pop(child["id"], None)
    db.activity.pop(child["id"], None)


@router.put("/api/children/{child_id}/settings", response_model=ChildOut)
def set_safety_settings(child_id: str, body: ChildSettings, parent: dict = Depends(require_role("parent"))):
    """PA21 — Adjust Safety Settings for a child. These are respected by the
    chat/recommendation engine (e.g. books-only, videos-only)."""
    child = _owned_child(child_id, parent)
    child["settings"] = body.model_dump()
    return _child_out(child)


@router.post("/api/children/link", response_model=ChildSessionOut)
def link_child(body: ChildLinkRequest):
    """Used on the CHILD's device: enter linking code + PIN to start a session."""
    child = db.find_child_by_code(body.code)
    if not child or child["pin"] != body.pin:
        raise HTTPException(401, "That code or PIN doesn't match. Ask a grown-up to help!")
    token = db.issue_token("child", child["id"])
    return ChildSessionOut(token=token, child=_child_out(child))
