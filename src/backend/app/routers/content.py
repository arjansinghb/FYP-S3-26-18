"""Content catalogue + basic moderation.

Browse (CM13, also used by the recommendation engine) is open to any logged-in
account. Add/edit/remove/approve/reject (CM03-CM09) require the moderator role.

The catalogue can be populated two ways: manual CRUD below (moderator typed it
in themselves, trusted at entry time -> auto-"approved"), or search + import
from Google Books/YouTube (app/content_sources.py) -> lands as "pending" so it
still goes through an explicit approve/reject (CM07/CM08), same as any other
new submission. Search results are never recommendable on their own — only
`/approve`'d content ever reaches app/brain.py.
"""
from fastapi import APIRouter, Depends, HTTPException, Query

from .. import ai_assist, content_sources, embeddings
from ..deps import current_account, require_role
from ..models import ContentIn, ContentOut
from ..storage import db

router = APIRouter(prefix="/api/content", tags=["content"])


def _out(item: dict) -> ContentOut:
    return ContentOut(**item)


def _refresh_embedding(item: dict) -> None:
    """URS Design Constraint 3's "embedding-based content matching" half —
    computed once here (approve/edit-while-approved), not at chat time, so
    app/brain.py's retrieval step is just a similarity lookup, no live API
    call per catalogue item per message."""
    if item["status"] != "approved":
        return
    text = f"{item['title']}. {item.get('description', '')}"
    db.set_embedding(item["id"], embeddings.embed_text(text))


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
    _refresh_embedding(item)
    return _out(item)


# ---------- CM03/CM06: search + import from Google Books / YouTube ----------

@router.get("/search/books")
def search_books(
    q: str = Query(..., min_length=1),
    start_index: int = Query(0, ge=0),
    mod: dict = Depends(require_role("moderator")),
):
    """Live Google Books search — import candidates only, nothing here is
    recommendable until a moderator explicitly imports (-> pending) and
    approves (CM07) it. Empty list (not an error) if no API key is configured.
    `start_index` pages through results (see content_sources.search_books)."""
    return content_sources.search_books(q, start_index=start_index)


@router.get("/search/videos")
def search_videos(q: str = Query(..., min_length=1), mod: dict = Depends(require_role("moderator"))):
    """Live YouTube Data API search — same import-candidate-only rule as
    search/books above."""
    return content_sources.search_videos(q)


@router.post("/import", response_model=ContentOut, status_code=201)
def import_entry(body: ContentIn, mod: dict = Depends(require_role("moderator"))):
    """Takes a search/books or search/videos result the moderator picked
    (title/description/external_ref carried over) plus the age_bands/genres
    they assign — that assignment is a real editorial judgement call a human
    makes here, not something inferred from the API response. Lands as
    "pending", same as any other new submission (CM06), until explicitly
    approved via POST /{id}/approve (CM07/CM08 still applies).

    Also gets a first-pass AI read (app/ai_assist.py's
    suggest_catalogue_decision) attached at import time — advisory only,
    shown to the moderator in the Submissions queue, never auto-applied to
    `status` here."""
    data = body.model_dump()
    suggestion = ai_assist.suggest_catalogue_decision(data)
    data["ai_suggestion"] = suggestion.get("suggestion")
    data["ai_reason"] = suggestion.get("reason")
    data["ai_confidence"] = suggestion.get("confidence")
    item = db.add_content(data, status="pending")
    return _out(item)


@router.patch("/{content_id}", response_model=ContentOut)
def edit_entry(content_id: str, body: ContentIn, mod: dict = Depends(require_role("moderator"))):
    item = db.content.get(content_id)
    if not item:
        raise HTTPException(404, "Content not found")
    item.update(body.model_dump())
    _refresh_embedding(item)  # title/description may have changed
    return _out(item)


@router.delete("/{content_id}", status_code=204)
def remove_entry(content_id: str, mod: dict = Depends(require_role("moderator"))):
    if content_id not in db.content:
        raise HTTPException(404, "Content not found")
    db.remove_content(content_id)


@router.post("/{content_id}/approve", response_model=ContentOut)
def approve(content_id: str, mod: dict = Depends(require_role("moderator"))):
    item = db.content.get(content_id)
    if not item:
        raise HTTPException(404, "Content not found")
    item["status"] = "approved"
    _refresh_embedding(item)
    return _out(item)


@router.post("/{content_id}/reject", response_model=ContentOut)
def reject(content_id: str, mod: dict = Depends(require_role("moderator"))):
    item = db.content.get(content_id)
    if not item:
        raise HTTPException(404, "Content not found")
    item["status"] = "rejected"
    return _out(item)
