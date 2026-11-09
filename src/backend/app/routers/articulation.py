"""Articulation levels (CH21/CH22, PA34-PA37).

A child picks a saved book or video, taps "Tell Pip about this" and explains
it in their own words (typed, or spoken and transcribed on the device). Pip
answers warmly and never judges. The explanation is logged for the parent,
who confirms or declines it. Three confirmations promote the child one level:
Explorer, Adventurer, Storyteller.

This is deliberately NOT a comprehension test and NOT the same thing as the
parent-set reading level (PA13), which keeps driving content difficulty on its
own. Declines are never shown to the child in any form.
"""
import time
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException

from .. import moderation, pii, profile
from ..brain import get_brain
from ..deps import current_child, require_role
from ..models import (
    ArticulationTrendsOut, DecideOut, ExplainOut, ExplainRequest, ExplanationOut, GenreCount, LevelOut,
    LevelStep, LevelUpOut,
)
from ..storage import db
from .children import _owned_child

router = APIRouter(prefix="/api", tags=["articulation"])

MAX_EXPLANATION_CHARS = 800

_GENTLE_REDIRECT = "Let's keep our chats friendly. Tell me about your favourite part of the story instead!"


def _level_out(child: dict) -> LevelOut:
    level = child.get("articulation_level", "explorer")
    nxt = profile.next_level(level)
    info = profile.LEVEL_INFO[level]
    return LevelOut(
        level=level,
        label=info["label"],
        descriptor=info["descriptor"],
        progress=child.get("articulation_progress", 0) if nxt else 0,
        needed=profile.CONFIRMATIONS_PER_LEVEL,
        next_level=nxt,
        next_label=profile.level_label(nxt) if nxt else None,
        pending=db.pending_explanation_count(child["id"]),
    )


def _explanation_out(e: dict) -> ExplanationOut:
    item = db.content.get(e["content_id"]) or {}
    info = profile.LEVEL_INFO.get(e["level_at"], profile.LEVEL_INFO["explorer"])
    return ExplanationOut(
        id=e["id"], content_id=e["content_id"], title=item.get("title", "A book or video"),
        type=item.get("type", "book"), thumbnail=item.get("thumbnail"), genres=item.get("genres", []),
        text=e["text"], input_mode=e["input_mode"], level_at=e["level_at"],
        level_label=info["label"], level_descriptor=info["descriptor"],
        status=e["status"], created_at=e["created_at"], decided_at=e.get("decided_at"),
    )


# ---------- child side ----------

@router.get("/articulation/level", response_model=LevelOut)
def my_level(child: dict = Depends(current_child)):
    """CH22 — the child's own level and progress, compact on the home screen
    and in detail in the Library. Counts only: nothing here can reveal a
    declined explanation."""
    out = _level_out(child)
    out.pending = 0  # the child never sees what is waiting on the parent
    return out


@router.get("/articulation/level-up", response_model=LevelUpOut)
def pending_level_up(child: dict = Depends(current_child)):
    """The payoff moment. The parent confirms asynchronously, so Pip tells the
    child next time they open the app, not when the parent taps the button."""
    lu = child.get("level_up_pending")
    if not lu:
        return LevelUpOut()
    return LevelUpOut(level_up={
        "from": lu["from"], "to": lu["to"],
        "from_label": profile.level_label(lu["from"]), "to_label": profile.level_label(lu["to"]),
    })


@router.post("/articulation/level-up/ack", status_code=204)
def ack_level_up(child: dict = Depends(current_child)):
    child["level_up_pending"] = None


@router.post("/articulation/explanations", response_model=ExplainOut, status_code=201)
def explain(body: ExplainRequest, child: dict = Depends(current_child)):
    """CH21 — "Tell Pip about this"."""
    saved_ids = {f["content_id"] for f in db.favourites.get(child["id"], [])}
    item = db.content.get(body.content_id)
    if body.content_id not in saved_ids or not item or item.get("status") != "approved":
        raise HTTPException(404, "Pick something from your Library to tell Pip about.")
    if db.explanation_blocks_item(child["id"], body.content_id):
        raise HTTPException(409, "You already told Pip about this one. Pick another from your Library, or come back to it when you reach the next level!")

    text = pii.scrub(body.text.strip())
    if not text:
        raise HTTPException(400, "Tell Pip a little about it first.")
    if len(text) > MAX_EXPLANATION_CHARS:
        raise HTTPException(400, "That's a lot! Tell Pip the main parts.")
    if moderation.is_unsafe(text):
        return ExplainOut(pip_reply=_GENTLE_REDIRECT, saved=False)

    level = child.get("articulation_level", "explorer")
    try:
        reply = get_brain().explain_reply(child["name"], child.get("age_band"), item, text, level)
    except Exception:
        reply = f"Thank you for telling me about {item['title']}! I loved hearing it in your own words."
    db.add_explanation(child, body.content_id, text, body.input_mode, reply)
    db.add_notification(
        child["parent_id"], "explanation", "New explanation to review",
        f"{child['name']} told Pip about \"{item['title']}\". Open their Explanations tab to review it.",
    )
    return ExplainOut(pip_reply=reply)


# ---------- parent side ----------

def _is_premium(parent: dict) -> bool:
    return parent.get("tier", "free") != "free"


@router.get("/children/{child_id}/articulation", response_model=LevelOut)
def child_level(child_id: str, parent: dict = Depends(require_role("parent"))):
    """PA36 (all tiers) — current level plus how many explanations are
    waiting on a confirmation."""
    return _level_out(_owned_child(child_id, parent))


@router.get("/children/{child_id}/explanations", response_model=list[ExplanationOut])
def list_explanations(child_id: str, parent: dict = Depends(require_role("parent"))):
    """PA34 — what the child actually said, next to the descriptor of the
    level they are currently at. Free accounts see what is waiting for
    review; Premium also keeps the full dated history (PA37)."""
    child = _owned_child(child_id, parent)
    rows = db.explanations_for(child["id"])
    if not _is_premium(parent):
        rows = [e for e in rows if e["status"] == "pending"]
    return [_explanation_out(e) for e in rows]


def _decide(explanation_id: str, confirm: bool, parent: dict) -> DecideOut:
    exp = db.explanations.get(explanation_id)
    if not exp:
        raise HTTPException(404, "Explanation not found")
    child = _owned_child(exp["child_id"], parent)
    result = db.decide_explanation(explanation_id, confirm)
    if result is None:
        raise HTTPException(409, "This explanation has already been reviewed.")
    exp, leveled_up = result
    return DecideOut(explanation=_explanation_out(exp), level=_level_out(child), leveled_up=leveled_up)


@router.post("/explanations/{explanation_id}/confirm", response_model=DecideOut)
def confirm_explanation(explanation_id: str, parent: dict = Depends(require_role("parent"))):
    """PA35 — "this shows understanding at their current level"."""
    return _decide(explanation_id, True, parent)


@router.post("/explanations/{explanation_id}/decline", response_model=DecideOut)
def decline_explanation(explanation_id: str, parent: dict = Depends(require_role("parent"))):
    """PA35 — doesn't use the item up (the child can try again later) and is
    never surfaced to the child."""
    return _decide(explanation_id, False, parent)


@router.get("/children/{child_id}/articulation-trends", response_model=ArticulationTrendsOut)
def articulation_trends(child_id: str, parent: dict = Depends(require_role("parent"))):
    """PA37 (Premium) — dated level progression and what they explain about."""
    if not _is_premium(parent):
        raise HTTPException(403, "Articulation history is a Premium feature.")
    child = _owned_child(child_id, parent)
    rows = db.explanations_for(child["id"])
    genres: Counter = Counter()
    for e in rows:
        item = db.content.get(e["content_id"]) or {}
        genres.update(item.get("genres", []))
    now = time.time()
    weeks = [0] * 8
    for e in rows:
        age_weeks = int((now - e["created_at"]) // (7 * 86400))
        if 0 <= age_weeks < 8:
            weeks[7 - age_weeks] += 1
    return ArticulationTrendsOut(
        level_history=[
            LevelStep(level=s["level"], label=profile.level_label(s["level"]), at=s["at"])
            for s in child.get("level_history", [])
        ],
        total=len(rows),
        confirmed=sum(1 for e in rows if e["status"] == "confirmed"),
        declined=sum(1 for e in rows if e["status"] == "declined"),
        pending=sum(1 for e in rows if e["status"] == "pending"),
        top_genres=[GenreCount(genre=g, count=n) for g, n in genres.most_common(5)],
        explained_per_week=weeks,
    )
