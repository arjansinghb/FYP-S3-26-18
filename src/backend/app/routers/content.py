"""Content catalogue + basic moderation.

Browse (CM13, also used by the recommendation engine) is open to any logged-in
account. Add/edit/remove/approve/reject (CM03-CM09) require the moderator role.

LATER: the catalogue is populated from Google Books + YouTube (curated
allowlist); this manual CRUD stays as the moderator's control surface.
"""
from fastapi import APIRouter, Depends, HTTPException, Query

from ..deps import current_account, require_role
from ..models import ContentIn, ContentOut
from ..storage import db

router = APIRouter(prefix="/api/content", tags=["content"])


def _out(item: dict) -> ContentOut:
    return ContentOut(**item)


@router.get("", response_model=list[ContentOut])
def browse(
    account: dict = Depends(current_account),
    type: str | None = Query(None),
    age_band: str | None = Query(None),
    genre: str | None = Query(None),
    status: str | None = Query(None),
    q: str | None = Query(None),
):
    items = list(db.content.values())
    if status:
        items = [i for i in items if i["status"] == status]
    if type:
        items = [i for i in items if i["type"] == type]
    if age_band:
        items = [i for i in items if age_band in i["age_bands"]]
    if genre:
        items = [i for i in items if genre in i.get("genres", [])]
    if q:
        ql = q.lower()
        items = [i for i in items if ql in i["title"].lower() or ql in i["description"].lower()]
    return [_out(i) for i in items]


@router.post("", response_model=ContentOut, status_code=201)
def add_entry(body: ContentIn, mod: dict = Depends(require_role("moderator"))):
    item = db.add_content(body.model_dump(), status="approved")
    return _out(item)


@router.patch("/{content_id}", response_model=ContentOut)
def edit_entry(content_id: str, body: ContentIn, mod: dict = Depends(require_role("moderator"))):
    item = db.content.get(content_id)
    if not item:
        raise HTTPException(404, "Content not found")
    item.update(body.model_dump())
    return _out(item)


@router.delete("/{content_id}", status_code=204)
def remove_entry(content_id: str, mod: dict = Depends(require_role("moderator"))):
    if content_id not in db.content:
        raise HTTPException(404, "Content not found")
    db.content.pop(content_id, None)


@router.post("/{content_id}/approve", response_model=ContentOut)
def approve(content_id: str, mod: dict = Depends(require_role("moderator"))):
    item = db.content.get(content_id)
    if not item:
        raise HTTPException(404, "Content not found")
    item["status"] = "approved"
    return _out(item)


@router.post("/{content_id}/reject", response_model=ContentOut)
def reject(content_id: str, mod: dict = Depends(require_role("moderator"))):
    item = db.content.get(content_id)
    if not item:
        raise HTTPException(404, "Content not found")
    item["status"] = "rejected"
    return _out(item)
