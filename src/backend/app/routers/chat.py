"""The child-facing chat loop — the heart of the product.

Covers CH04/05 (session start/end), CH06 (natural-language query), CH07
(clarifying follow-ups), CH08/CH09 (book/video recommendations), CH10
(explanation), CH15/CH16 (save/view favourites, capped per PA34), CH17
(feedback). Requires a child session token (from /link).

Also supports an anonymous "demo" mode: if there is no child token, it still
answers using the whole approved catalogue, so the avatar prototype works
without logging in.
"""
import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..brain import get_brain
from ..models import (
    ChatRequest, ChatResponse, ChatSessionOut, FeedbackRequest, Recommendation,
)
from ..storage import db

router = APIRouter(prefix="/api/chat", tags=["chat"])
optional_bearer = HTTPBearer(auto_error=False)
require_bearer = HTTPBearer()

FREE_FAVOURITES_LIMIT = 5  # PA34


def _optional_child(creds: HTTPAuthorizationCredentials | None):
    if not creds:
        return None
    entry = db.resolve_token(creds.credentials)
    if entry and entry["kind"] == "child":
        return db.children.get(entry["id"])
    return None


def _require_child(creds: HTTPAuthorizationCredentials):
    child = _optional_child(creds)
    if not child:
        raise HTTPException(401, "Child session required")
    return child


def _visible_catalogue(child: dict | None) -> list[dict]:
    """Approved catalogue, narrowed by (in order): PA21 type settings, PA18
    per-child overrides, then age band — with an "approve" override
    deliberately bypassing the age-band check (per PA18's own description:
    "overriding the default age-band filtering"). Age filtering happens here
    rather than inside the brain, so overrides can affect it; the brain is
    handed an already-final pool and never re-filters by age band itself."""
    catalogue = db.approved_content()
    if not child:
        return catalogue

    settings = child.get("settings", {})
    if not settings.get("allow_books", True):
        catalogue = [c for c in catalogue if c["type"] != "book"]
    if not settings.get("allow_videos", True):
        catalogue = [c for c in catalogue if c["type"] != "video"]

    overrides = db.overrides_for(child["id"])
    age_band = child["age_band"]

    def _keep(item: dict) -> bool:
        action = overrides.get(item["id"])
        if action == "hide":
            return False
        if action == "approve":
            return True
        return age_band in item.get("age_bands", [])

    return [c for c in catalogue if _keep(c)]


@router.post("", response_model=ChatResponse)
def chat(body: ChatRequest, creds: HTTPAuthorizationCredentials | None = Depends(optional_bearer)):
    child = _optional_child(creds)
    catalogue = _visible_catalogue(child)

    # CH07 — real conversation memory: prior turns in THIS session (not the
    # child's whole history) are passed to the brain so it can build on an
    # earlier clarifying question instead of answering every message cold.
    history = []
    if child and body.session_id:
        session = db.chat_sessions.get(body.session_id)
        if session and session["child_id"] == child["id"]:
            history = db.session_history(child["id"], body.session_id)

    # Age filtering already happened in _visible_catalogue above (so PA18
    # overrides can affect it) — pass age_band=None so the brain trusts the
    # pool it's given instead of re-filtering it.
    result = get_brain().respond(body.message, None, catalogue, history=history)

    # log to the child's activity so parents can review it later (PA14)
    if child:
        db.activity[child["id"]].append({
            "ts": time.time(),
            "session_id": body.session_id,
            "message": body.message,
            "reply": result.reply,
            "rec_ids": [r["id"] for r in result.recommendations],
        })

    recs = [Recommendation(**r) for r in result.recommendations]
    return ChatResponse(reply=result.reply, recommendations=recs)


# ---------- CH04/05: chat session lifecycle ----------

@router.post("/sessions", response_model=ChatSessionOut, status_code=201)
def start_session(creds: HTTPAuthorizationCredentials = Depends(require_bearer)):
    child = _require_child(creds)
    session = db.start_chat_session(child["id"])
    return ChatSessionOut(**session)


@router.post("/sessions/{session_id}/end", response_model=ChatSessionOut)
def end_session(session_id: str, creds: HTTPAuthorizationCredentials = Depends(require_bearer)):
    """CH05 — ends the active chat session; the messages sent under it are
    already in db.activity, so nothing further needs to be saved here."""
    child = _require_child(creds)
    session = db.chat_sessions.get(session_id)
    if not session or session["child_id"] != child["id"]:
        raise HTTPException(404, "Session not found")
    db.end_chat_session(session_id)
    return ChatSessionOut(**session)


@router.post("/favourite", status_code=201)
def save_favourite(body: FeedbackRequest, creds: HTTPAuthorizationCredentials = Depends(require_bearer)):
    child = _require_child(creds)
    if body.content_id not in db.content:
        raise HTTPException(404, "Content not found")
    favs = db.favourites[child["id"]]
    if not any(f["content_id"] == body.content_id for f in favs):
        parent = db.accounts.get(child["parent_id"])
        is_premium = bool(parent and parent.get("tier") == "premium")  # PA34
        if not is_premium and len(favs) >= FREE_FAVOURITES_LIMIT:
            raise HTTPException(
                403,
                f"You've saved {FREE_FAVOURITES_LIMIT} favourites — ask a grown-up about "
                "Premium to save unlimited favourites!",
            )
        favs.append({"content_id": body.content_id, "ts": time.time()})
    return {"ok": True}


@router.get("/favourites")
def list_favourites(creds: HTTPAuthorizationCredentials = Depends(require_bearer)):
    """Child-facing — deliberately does NOT include `external_ref` (PA19 is
    parent-facing only; see oversight.py's child_favourites for the parent
    version that does include it)."""
    child = _require_child(creds)
    out = []
    for f in db.favourites[child["id"]]:
        item = db.content.get(f["content_id"])
        if item:
            out.append({
                "id": item["id"], "title": item["title"], "type": item["type"],
                "description": item.get("description", ""), "thumbnail": item.get("thumbnail"),
            })
    return out


@router.post("/feedback")
def feedback(body: FeedbackRequest, creds: HTTPAuthorizationCredentials = Depends(require_bearer)):
    child = _require_child(creds)
    # For the prototype we just acknowledge it; later this tunes recommendations.
    return {"ok": True, "liked": body.liked}
