"""Child profiles (PA07-PA10, PA13, PA18, PA33) and the child linking/login
flow (CH01 enter linking code, CH02 simplified PIN login)."""
import time

from fastapi import APIRouter, Depends, HTTPException

from ..deps import require_role
from ..models import (
    ChildCreate, ChildLinkRequest, ChildOut, ChildPinLogin, ChildSessionOut,
    ChildSettings, ChildUpdate, ContentOverrideIn, ContentOverrideOut,
)
from ..storage import db

router = APIRouter(tags=["children"])

FREE_CHILD_LIMIT = 1
PREMIUM_CHILD_LIMIT = 4  # PA33
ULTRA_CHILD_LIMIT = float("inf")  # Ultra tier (2026-09-07) — genuinely unlimited, not just "a bigger number"

_TIER_CHILD_LIMITS = {"free": FREE_CHILD_LIMIT, "premium": PREMIUM_CHILD_LIMIT, "ultra": ULTRA_CHILD_LIMIT}


def _child_out(c: dict) -> ChildOut:
    return ChildOut(
        id=c["id"], parent_id=c["parent_id"], name=c["name"], age_band=c["age_band"],
        reading_level=c.get("reading_level"), linking_code=c["linking_code"], avatar=c["avatar"],
        settings=ChildSettings(**c.get("settings", {})), locked=c.get("locked", False),
    )


def _owned_child(child_id: str, parent: dict) -> dict:
    child = db.children.get(child_id)
    if not child or child["parent_id"] != parent["id"]:
        raise HTTPException(404, "Child profile not found")
    return child


@router.post("/api/children", response_model=ChildOut, status_code=201)
def create_child(body: ChildCreate, parent: dict = Depends(require_role("parent"))):
    """PA07. Gated behind UV06 (email verified) and PA28 (consent given) —
    "a child profile isn't allowed to exist without it" is the whole point
    of verifiable parental consent, not a checkbox nobody enforces. Also
    enforces PA33's tier cap (free: 1 child, Premium: up to 4, Ultra:
    unlimited)."""
    if not parent.get("verified"):
        raise HTTPException(403, "Please verify your email before adding a child profile.")
    if not parent.get("consent"):
        raise HTTPException(403, "Please provide parental consent before adding a child profile.")
    existing = db.children_of(parent["id"])
    tier = parent.get("tier", "free")
    limit = _TIER_CHILD_LIMITS[tier]
    if len(existing) >= limit:
        msg = ("Free accounts can have 1 child profile — upgrade to Premium for up to 4, or Ultra for unlimited."
               if tier == "free" else
               "You've reached the Premium limit of 4 child profiles — upgrade to Ultra for unlimited.")
        raise HTTPException(403, msg)
    # PIN/linking code is system-generated inside create_child now, not
    # parent-typed — see models.ChildCreate's docstring for why. No
    # pin_in_use check needed here: it's unique by construction.
    child = db.create_child(parent["id"], body.name, body.age_band, body.reading_level)
    return _child_out(child)


@router.get("/api/children", response_model=list[ChildOut])
def list_children(parent: dict = Depends(require_role("parent"))):
    return [_child_out(c) for c in db.children_of(parent["id"])]


@router.patch("/api/children/{child_id}", response_model=ChildOut)
def update_child(child_id: str, body: ChildUpdate, parent: dict = Depends(require_role("parent"))):
    """`exclude_unset` (not `getattr(...) is not None`) is what makes
    clearing `reading_level` back to empty actually work — every field on
    `ChildUpdate` is `Optional[...] = None`, so an old `is not None` check
    can't tell "the parent didn't touch this field" from "the parent
    explicitly cleared it" — both look identical (`None`) once they reach
    here. The frontend's own edit form always sends `reading_level: null`
    on purpose when the field is cleared (see EditChild in
    ParentDashboard.jsx), so silently ignoring that was a real, if small,
    bug: PA13 guidance could be set but never removed again."""
    child = _owned_child(child_id, parent)
    updates = body.model_dump(exclude_unset=True)
    for f in ("name", "age_band", "reading_level"):
        if f in updates:
            child[f] = updates[f]
    return _child_out(child)


@router.post("/api/children/{child_id}/regenerate-pin", response_model=ChildOut)
def regenerate_pin(child_id: str, parent: dict = Depends(require_role("parent"))):
    """PA10 — resets the code (e.g. the parent lost it, or shared it with
    the wrong person). System-generated replacement, not a parent-typed
    one — see storage.regenerate_pin's docstring."""
    child = _owned_child(child_id, parent)
    db.regenerate_pin(child)
    return _child_out(child)


@router.delete("/api/children/{child_id}", status_code=204)
def delete_child(child_id: str, parent: dict = Depends(require_role("parent"))):
    child = _owned_child(child_id, parent)
    db.children.pop(child["id"], None)
    db.favourites.pop(child["id"], None)
    db.activity.pop(child["id"], None)
    db.content_overrides.pop(child["id"], None)


@router.put("/api/children/{child_id}/settings", response_model=ChildOut)
def set_safety_settings(child_id: str, body: ChildSettings, parent: dict = Depends(require_role("parent"))):
    """PA21 — Adjust Safety Settings for a child. These are respected by the
    chat/recommendation engine (e.g. books-only, videos-only)."""
    child = _owned_child(child_id, parent)
    child["settings"] = body.model_dump()
    return _child_out(child)


# ---------- PA18: hide / re-approve specific content for one child ----------

@router.put("/api/children/{child_id}/content-overrides/{content_id}", response_model=ContentOverrideOut)
def set_content_override(child_id: str, content_id: str, body: ContentOverrideIn, parent: dict = Depends(require_role("parent"))):
    _owned_child(child_id, parent)
    if content_id not in db.content:
        raise HTTPException(404, "Content not found")
    db.set_content_override(child_id, content_id, body.action)
    return ContentOverrideOut(content_id=content_id, action=body.action)


@router.get("/api/children/{child_id}/content-overrides", response_model=list[ContentOverrideOut])
def list_content_overrides(child_id: str, parent: dict = Depends(require_role("parent"))):
    _owned_child(child_id, parent)
    return [ContentOverrideOut(content_id=cid, action=action) for cid, action in db.overrides_for(child_id).items()]


@router.delete("/api/children/{child_id}/content-overrides/{content_id}", status_code=204)
def clear_content_override(child_id: str, content_id: str, parent: dict = Depends(require_role("parent"))):
    _owned_child(child_id, parent)
    db.clear_content_override(child_id, content_id)


def _activate_and_issue(child: dict) -> ChildSessionOut:
    if not child.get("first_login_at"):
        child["first_login_at"] = time.time()
        db.add_notification(
            child["parent_id"], "child_activated", f"{child['name']} is all set up!",
            f"{child['name']} just logged in for the first time and is ready to chat with Pip.",
        )
    token = db.issue_token("child", child["id"])
    return ChildSessionOut(token=token, child=_child_out(child))


@router.post("/api/children/link", response_model=ChildSessionOut)
def link_child(body: ChildLinkRequest):
    """CH01 — first-time device activation: enter the linking code + PIN
    (the same 6-digit value, per PA10 — see ChildLinkRequest's docstring)."""
    child = db.find_child_by_code(body.code)
    if not child:
        raise HTTPException(401, "That code or PIN doesn't match. Ask a grown-up to help!")
    if child.get("locked"):
        raise HTTPException(403, "Too many wrong tries — ask a grown-up to unlock this profile.")
    if not db.check_child_pin(child, body.pin):
        detail = ("Too many wrong tries — ask a grown-up to unlock this profile."
                   if child.get("locked") else "That code or PIN doesn't match. Ask a grown-up to help!")
        raise HTTPException(401 if not child.get("locked") else 403, detail)
    return _activate_and_issue(child)


@router.post("/api/children/{child_id}/login", response_model=ChildSessionOut)
def pin_login(child_id: str, body: ChildPinLogin):
    """CH02 — return login on a device that's already been through CH01
    once (the frontend remembers `child_id` locally and skips straight to a
    PIN-only screen — no linking code re-entry)."""
    child = db.children.get(child_id)
    if not child:
        raise HTTPException(401, "Profile not found on this device. Ask a grown-up to help!")
    if child.get("locked"):
        raise HTTPException(403, "Too many wrong tries — ask a grown-up to unlock this profile.")
    if not db.check_child_pin(child, body.pin):
        detail = ("Too many wrong tries — ask a grown-up to unlock this profile."
                   if child.get("locked") else "That's not quite right. Try again!")
        raise HTTPException(401 if not child.get("locked") else 403, detail)
    return _activate_and_issue(child)


@router.post("/api/children/{child_id}/unlock", response_model=ChildOut)
def unlock_child(child_id: str, parent: dict = Depends(require_role("parent"))):
    """Parent intervention referenced in CH02 Alt Flow 2a."""
    child = _owned_child(child_id, parent)
    db.unlock_child(child)
    return _child_out(child)
