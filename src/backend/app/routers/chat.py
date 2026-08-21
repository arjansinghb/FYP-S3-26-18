"""The child-facing chat loop — the heart of the product.

Covers CH06 (natural-language query), CH07 (clarifying follow-ups), CH08/CH09
(book/video recommendations), CH10 (explanation), CH15/CH16 (save/view
favourites), CH17 (feedback). Requires a child session token (from /link).

Also supports an anonymous "demo" mode: if there is no child token, it still
answers using the whole approved catalogue, so the avatar prototype works
without logging in.
"""
import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..brain import get_brain
from ..models import ChatRequest, ChatResponse, FeedbackRequest, Recommendation
from ..storage import db

router = APIRouter(prefix="/api/chat", tags=["chat"])
optional_bearer = HTTPBearer(auto_error=False)


def _optional_child(creds: HTTPAuthorizationCredentials | None):
    if not creds:
        return None
    entry = db.resolve_token(creds.credentials)
    if entry and entry["kind"] == "child":
        return db.children.get(entry["id"])
    return None


@router.post("", response_model=ChatResponse)
def chat(body: ChatRequest, creds: HTTPAuthorizationCredentials | None = Depends(optional_bearer)):
    child = _optional_child(creds)
    age_band = child["age_band"] if child else None

    # Respect the child's safety settings (PA21): filter the catalogue to the
    # content types the parent allows for this child.
    catalogue = db.approved_content()
    if child:
        s = child.get("settings", {})
        if not s.get("allow_books", True):
            catalogue = [c for c in catalogue if c["type"] != "book"]
        if not s.get("allow_videos", True):
            catalogue = [c for c in catalogue if c["type"] != "video"]

    result = get_brain().respond(body.message, age_band, catalogue)

    # log to the child's activity so parents can review it later (PA14)
    if child:
        db.activity[child["id"]].append({
            "ts": time.time(),
            "message": body.message,
            "reply": result.reply,
            "rec_ids": [r["id"] for r in result.recommendations],
        })

    recs = [Recommendation(**r) for r in result.recommendations]
    return ChatResponse(reply=result.reply, recommendations=recs)


@router.post("/favourite", status_code=201)
def save_favourite(body: FeedbackRequest, creds: HTTPAuthorizationCredentials = Depends(HTTPBearer())):
    child = _optional_child(creds)
    if not child:
        raise HTTPException(401, "Child session required")
    if body.content_id not in db.content:
        raise HTTPException(404, "Content not found")
    favs = db.favourites[child["id"]]
    if not any(f["content_id"] == body.content_id for f in favs):
        favs.append({"content_id": body.content_id, "ts": time.time()})
    return {"ok": True}


@router.get("/favourites")
def list_favourites(creds: HTTPAuthorizationCredentials = Depends(HTTPBearer())):
    child = _optional_child(creds)
    if not child:
        raise HTTPException(401, "Child session required")
    out = []
    for f in db.favourites[child["id"]]:
        item = db.content.get(f["content_id"])
        if item:
            out.append({"id": item["id"], "title": item["title"], "type": item["type"]})
    return out


@router.post("/feedback")
def feedback(body: FeedbackRequest, creds: HTTPAuthorizationCredentials = Depends(HTTPBearer())):
    child = _optional_child(creds)
    if not child:
        raise HTTPException(401, "Child session required")
    # For the prototype we just acknowledge it; later this tunes recommendations.
    return {"ok": True, "liked": body.liked}
