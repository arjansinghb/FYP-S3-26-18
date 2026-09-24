"""The child-facing chat loop — the heart of the product.

Covers CH04/05 (session start/end), CH06 (natural-language query), CH07
(clarifying follow-ups), CH08/CH09 (book/video recommendations), CH10
(explanation), CH15/CH16 (save/view favourites, capped per PA34), CH17
(feedback). Requires a child session token (from /link).

Also supports an anonymous "demo" mode: if there is no child token, it still
answers using the whole approved catalogue, so the avatar prototype works
without logging in.
"""
import io
import random
import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .. import guardrails
from ..brain import BrainResult, covering_item, get_brain, topic_is_covered, _named_genre_items
from ..config import settings
from ..models import (
    AckResolvedTopicRequest, ChatRequest, ChatResponse, ChatSessionOut, FeedbackRequest, Recommendation, SpeechRequest,
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
        # refresh_child (not a plain dict lookup) — same cross-instance
        # staleness fix as deps.py's current_child/current_account (see
        # storage.py's refresh_account docstring for the real bug this
        # closes), applied here too since this router has its own
        # child-auth helper instead of going through deps.py.
        return db.refresh_child(entry["id"])
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


def _shown_ids(child_id: str, session_id: str | None) -> set[str]:
    """CH18 — every item already recommended *in this session*, derived from
    the activity log's own `rec_ids` (no new field needed — the data was
    already being logged, just never read back). Excluding these from the
    next retrieval is what makes "show me another" actually show another,
    instead of the same 1-2 items the deterministic embedding match would
    otherwise hand back for a near-identical follow-up message."""
    if not child_id or not session_id:
        return set()
    ids: set[str] = set()
    for entry in db.activity.get(child_id, []):
        if entry.get("session_id") == session_id:
            ids.update(entry.get("rec_ids") or [])
    return ids


def _disliked_ids(child_id: str) -> set[str]:
    """CH17 — "Not for me" now actually means something: once a child
    dislikes an item, it's excluded from every future recommendation for
    them, not just this session. (Liked items aren't specially re-ranked in
    this pass — see PA31/oversight's genre trends for where "liked" data
    already surfaces instead; hard-excluding dislikes is the one behaviour
    change that's both safe and directly verifiable.)"""
    return {f["content_id"] for f in db.feedback.get(child_id, []) if f.get("liked") is False}


# How many genuine misses in a row (asked for something real, nothing in the
# catalogue fit — CH... "Oops" replies) it takes before Pip stops negotiating
# specific topics and just gives a real recommendation instead. Mirrors the
# existing clarifying-question cap (2 rounds, then recommend with
# best-effort) — same "know when to stop" idea, applied to repeated misses
# instead of repeated questions. Without this, a child who happens to ask
# for several things the catalogue genuinely doesn't have in a row gets
# nothing but a string of "no"s, which reads as Pip giving up on them
# (flagged directly, 2026-09-24) rather than the friendly companion the
# whole product is supposed to be.
MISS_STREAK_BREAK = 2


def _recent_miss_streak(child_id: str, session_id: str | None) -> int:
    """How many of the most recent turns in THIS session (not the child's
    whole history) were genuine misses in a row, counting back from the
    latest turn until the first one that wasn't — a turn with real
    recommendations resets the streak to 0, same as one where Pip was just
    chatting/clarifying (missed_topic only means "asked for something real
    and nothing fit", not "didn't recommend anything")."""
    if not child_id or not session_id:
        return 0
    streak = 0
    for entry in reversed(db.activity.get(child_id, [])):
        if entry.get("session_id") != session_id:
            continue
        if entry.get("missed_topic") and not entry.get("rec_ids"):
            streak += 1
        else:
            break
    return streak


def _fallback_recommendation(catalogue: list[dict], child: dict | None) -> dict | None:
    """A genuine, concrete pick when the streak above is broken — not
    another "here's a topic you could try instead", an actual book/video.
    Prefers a genre this child has already liked or saved (same signal
    /topics above already uses for chip ranking) so "something I think
    you'll like" is a real guess, not a random shot when better information
    exists; falls back to anything in the (already age/settings/exclusion-
    filtered) pool otherwise. None only when that pool is genuinely empty —
    the caller keeps the normal "Oops" reply in that case."""
    if not catalogue:
        return None
    preferred: set[str] = set()
    if child:
        liked_ids = {f["content_id"] for f in db.feedback.get(child["id"], []) if f.get("liked") is True}
        saved_ids = {f["content_id"] for f in db.favourites.get(child["id"], [])}
        for content_id in liked_ids | saved_ids:
            item = db.content.get(content_id)
            if item:
                preferred.update(item.get("genres", []))
    pool = [c for c in catalogue if preferred & set(c.get("genres", []))] or catalogue
    item = random.choice(pool)
    return {
        "id": item["id"], "type": item["type"], "title": item["title"],
        "explanation": item.get("description") or "I think you'll really like it!",
        "description": item.get("description", ""),
        "synopsis": item.get("synopsis"),
        "external_ref": item.get("external_ref"), "thumbnail": item.get("thumbnail"),
        "genres": item.get("genres", []),
    }


@router.get("/topics")
def topics(creds: HTTPAuthorizationCredentials | None = Depends(optional_bearer)):
    """Real starter-chip entry points, derived from the same visible
    catalogue a recommendation would actually draw from (age band, PA21/
    PA18 settings and overrides all already applied) — so a chip never
    promises a topic that would come back empty. Still just topic *labels*
    that map to a chat message, the same device the hardcoded starter
    chips already used — not a browsable result list (see §2.1: this
    product never shows the catalogue itself to a child, only genre words
    counted off it)."""
    child = _optional_child(creds)
    catalogue = _visible_catalogue(child)
    counts: dict[str, int] = {}
    for item in catalogue:
        for genre in item.get("genres", []):
            counts[genre] = counts.get(genre, 0) + 1

    # Personalise: genres from items this child has actually liked or
    # saved get real priority, so a returning child's chips reflect what
    # they've told Pip they enjoy — not just what's most common across the
    # whole catalogue. A fresh child with no signal yet just gets the
    # catalogue-popularity ranking; nothing here fabricates a preference
    # that doesn't exist. Closes the exact gap PA31/oversight's genre
    # trends already surface to a *parent* — the child never saw their own
    # preferences reflected back at them before this.
    preferred: set[str] = set()
    if child:
        liked_ids = {f["content_id"] for f in db.feedback.get(child["id"], []) if f.get("liked") is True}
        saved_ids = {f["content_id"] for f in db.favourites.get(child["id"], [])}
        for content_id in liked_ids | saved_ids:
            item = db.content.get(content_id)
            if item:
                preferred.update(item.get("genres", []))

    ranked = sorted(counts.items(), key=lambda kv: (kv[0] not in preferred, -kv[1], kv[0]))
    return [{"genre": genre, "count": count, "preferred": genre in preferred} for genre, count in ranked[:8]]


@router.post("", response_model=ChatResponse)
def chat(body: ChatRequest, creds: HTTPAuthorizationCredentials | None = Depends(optional_bearer)):
    child = _optional_child(creds)
    catalogue = _visible_catalogue(child)
    visible = catalogue  # before per-session exclusions below — what a miss is judged against

    # CH07 — real conversation memory: prior turns in THIS session (not the
    # child's whole history) are passed to the brain so it can build on an
    # earlier clarifying question instead of answering every message cold.
    history = []
    if child and body.session_id:
        session = db.chat_sessions.get(body.session_id)
        if session and session["child_id"] == child["id"]:
            history = db.session_history(child["id"], body.session_id)

    # CH17/CH18 — exclude what this child has already been shown this
    # session, and what they've told Pip they don't like, before retrieval
    # ever sees the pool. Doing it here (not inside the brain) means both
    # PlaceholderBrain and OpenAIBrain get the fix for free, and it composes
    # with the PA21/PA18/age-band narrowing above the same way.
    already_shown_note = None
    if child:
        exclude = _shown_ids(child["id"], body.session_id) | _disliked_ids(child["id"])
        if exclude:
            # Before narrowing the pool, check whether the exclusion is about
            # to remove the ONLY reason a genre the child's current message
            # literally names would otherwise have matched — if so, the
            # model needs to be told that explicitly (see brain.py's
            # `already_shown_note` docstring for the exact turn-to-turn
            # inconsistency this closes: without this, an emptied-out
            # candidate list looks identical whether the topic never
            # existed or was already fully shown, and the model was left to
            # guess between them from prose history alone).
            if _named_genre_items(body.message, catalogue) and not _named_genre_items(
                body.message, [c for c in catalogue if c["id"] not in exclude],
            ):
                already_shown_note = (
                    "Every catalogue item matching a genre the child's current message names has already "
                    "been shown to them earlier in this session (that's why the list below may not include "
                    "one). If nothing below fits, say so honestly as 'you've already seen everything I have "
                    "on that' — never say it doesn't exist."
                )
            catalogue = [c for c in catalogue if c["id"] not in exclude]

    # Age eligibility (and PA18 overrides) is already fully resolved by
    # _visible_catalogue above — the brain never re-filters by age_band
    # (see brain.py's own comments on this). What's passed here now is
    # purely for the LLM's *language* — age-appropriate sentence length/
    # vocabulary, and (PA13) the parent's reading-level guidance, if set.
    # Both used to be silently thrown away: age_band was hardcoded to None
    # (so Pip's phrasing never actually adapted per child), and
    # reading_level was never read anywhere in this path at all despite a
    # parent being able to set it.
    # Code-level guardrails (app/guardrails.py) wrap the brain: a blocked
    # message gets a fixed reply and never reaches the model at all; whatever
    # the brain does say is checked again before the child sees it.
    guardrail: str | None = None
    missed_topic = None
    verdict = guardrails.check_input(
        body.message, child_id=child["id"] if child else None, history=history, pool=catalogue,
    )
    if verdict:
        guardrail = verdict.reason
        result = BrainResult(reply=verdict.reply, recommendations=[])
    else:
        result = get_brain().respond(
            body.message, child["age_band"] if child else None, catalogue,
            history=history, reading_level=child.get("reading_level") if child else None,
            already_shown_note=already_shown_note,
        )
        result.reply, guardrail = guardrails.check_output(result.reply)
        if guardrail:
            result.recommendations = []
        elif result.missed_topic and not result.recommendations and not topic_is_covered(
            result.missed_topic, visible, result.missed_format or "any",
        ):
            # Demand signal for moderators (GET /api/content/topic-requests):
            # a real topic the catalogue can't serve. Judged against the whole
            # visible pool, so "you've already seen everything on it" isn't a miss.
            db.record_topic_miss(result.missed_topic, result.missed_format or "any")
            missed_topic = result.missed_topic
            # 2+ misses in a row already, and this one makes it another —
            # stop negotiating topics and give a real pick instead (see
            # MISS_STREAK_BREAK's own comment for why).
            if child and _recent_miss_streak(child["id"], body.session_id) >= MISS_STREAK_BREAK:
                fallback = _fallback_recommendation(catalogue, child)
                if fallback:
                    kind = "book" if fallback["type"] == "book" else "video"
                    result = BrainResult(
                        reply=(
                            f"I haven't found exactly what you're looking for yet, but I think "
                            f"you'll really like this {kind} — '{fallback['title']}'! {fallback['explanation']}"
                        ),
                        recommendations=[fallback],
                    )

    # log to the child's activity so parents can review it later (PA14)
    if child:
        entry = {
            "ts": time.time(),
            "session_id": body.session_id,
            "message": body.message,
            "reply": result.reply,
            "rec_ids": [r["id"] for r in result.recommendations],
        }
        if guardrail:
            entry["guardrail"] = guardrail  # why this turn was intercepted — audit trail
        if missed_topic:
            entry["missed_topic"] = missed_topic  # feeds _recent_miss_streak above
        db.activity[child["id"]].append(entry)

    recs = [Recommendation(**r) for r in result.recommendations]
    return ChatResponse(reply=result.reply, recommendations=recs)


# CH11 — real TTS for Pip's voice, replacing the browser's own Web Speech
# API (whose voice quality/availability is entirely device/OS-dependent —
# some devices only have a flat, robotic voice with no warmer option at
# all). Same optional-bearer pattern as POST /api/chat above, so the
# anonymous "demo" mode keeps working too — this endpoint never touches a
# child's own data, it just voices text Pip already decided to say.
_MAX_SPEECH_CHARS = 600  # generous for one Pip reply; guards against abuse/cost


@router.post("/speech")
def speech(body: SpeechRequest, creds: HTTPAuthorizationCredentials | None = Depends(optional_bearer)):
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "No text to speak")
    text = text[:_MAX_SPEECH_CHARS]

    if not settings.openai_configured:
        # No key configured (local-dev/placeholder mode) — let the frontend
        # fall back to the browser's own Web Speech API instead of erroring.
        raise HTTPException(503, "Real voice isn't configured — falling back to browser voice")

    from openai import OpenAI

    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    try:
        resp = client.audio.speech.create(
            model=settings.OPENAI_TTS_MODEL,
            voice=settings.OPENAI_TTS_VOICE,
            input=text,
            response_format="mp3",
        )
    except Exception:
        raise HTTPException(502, "Voice generation failed — try again")

    return StreamingResponse(io.BytesIO(resp.content), media_type="audio/mpeg")


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
        is_free_tier = not parent or parent.get("tier", "free") == "free"  # PA34 — anything paid gets unlimited
        if is_free_tier and len(favs) >= FREE_FAVOURITES_LIMIT:
            raise HTTPException(
                403,
                f"You've saved {FREE_FAVOURITES_LIMIT} favourites — ask a grown-up about "
                "Premium to save unlimited favourites!",
            )
        favs.append({"content_id": body.content_id, "ts": time.time()})
    return {"ok": True}


@router.delete("/favourite/{content_id}")
def remove_favourite(content_id: str, creds: HTTPAuthorizationCredentials = Depends(require_bearer)):
    """CH16's real missing half — the free-tier 5-item cap (PA34) is
    permanent for a Free child without this: once they hit 5, "Save" just
    403s forever with no way to make room. Removing a favourite doesn't
    need `content_id` to still exist in the catalogue (a moderator could
    have retired it since); only the child's own favourites list is
    touched, and dropping an unknown id is a no-op, not a 404 — the child's
    intent ("this shouldn't be in my library") is satisfied either way."""
    child = _require_child(creds)
    favs = db.favourites[child["id"]]
    db.favourites[child["id"]] = [f for f in favs if f["content_id"] != content_id]
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
        # Status-gated, not just existence-gated — a moderator can reject
        # (CM08) an item that was already `approved` and already
        # favourited (reject has no status guard, see content.py), and
        # without this check it kept showing here even after losing its
        # approved status: the one place left where a child could still
        # reach something a moderator had since pulled back.
        if item and item["status"] == "approved":
            out.append({
                "id": item["id"], "title": item["title"], "type": item["type"],
                "description": item.get("description", ""), "thumbnail": item.get("thumbnail"),
                "genres": item.get("genres", []),
            })
    return out


@router.get("/resolved-topics")
def resolved_topics(creds: HTTPAuthorizationCredentials = Depends(require_bearer)):
    """Continuity across sessions for a gap Pip once had to say "Oops" to
    THIS specific child about — not the aggregate moderator queue (GET
    /api/content/topic-requests), which deliberately never stores which
    child asked anything (see storage.record_topic_miss's own docstring).
    This instead reads back the child's own activity log, which already
    retains their raw messages for PA14 — no new privacy surface, just a
    new read of data that already exists. Finds the most recent topic Pip
    once missed for them that real approved content now actually covers,
    and hands back a real item to mention — the same "pick up where you
    left off" continuity ChildChat.jsx's welcome-back block already gives
    streaks/favourites, extended to a gap that's since been filled.

    A pure read, no side effect — see POST /resolved-topics/ack below for
    the "don't mention this one again" half, and why that's a separate
    mutating call rather than a side effect of this GET (same reasoning as
    content.py's auto_import_one_topic: this app's persistence middleware
    only reloads-then-saves around mutating verbs, so a GET handler that
    tried to stamp `notified_resolved_topics` here would compute the right
    answer and then silently never persist it — reproduced live, a 2nd
    call kept returning the same "already seen" topic). Returns null (not
    an empty object) when there's nothing new — the common case."""
    child = _require_child(creds)
    already = set(child.get("notified_resolved_topics") or [])
    approved = db.approved_content()
    seen: set[str] = set()
    for entry in reversed(db.activity.get(child["id"], [])):
        topic = entry.get("missed_topic")
        if not topic or topic in seen or topic in already:
            continue
        seen.add(topic)
        item = covering_item(topic, approved, "any")
        if not item:
            continue
        return {
            "topic": topic,
            "item": {"id": item["id"], "type": item["type"], "title": item["title"],
                      "thumbnail": item.get("thumbnail")},
        }
    return None


@router.post("/resolved-topics/ack")
def ack_resolved_topic(body: AckResolvedTopicRequest, creds: HTTPAuthorizationCredentials = Depends(require_bearer)):
    """The mutating half of the feature above — called by the frontend
    right after it actually shows a resolved topic to the child (fire-
    and-forget, not awaited by the render), so it's never mentioned again."""
    child = _require_child(creds)
    already = child.get("notified_resolved_topics") or []
    if body.topic not in already:
        child["notified_resolved_topics"] = [*already, body.topic]
    return {"ok": True}


@router.post("/feedback")
def feedback(body: FeedbackRequest, creds: HTTPAuthorizationCredentials = Depends(require_bearer)):
    """CH17 — used to be acknowledged and discarded. Now actually persisted
    (`db.feedback`) and read back by `_disliked_ids` above, so a "Not for
    me" tap has a real, verifiable effect on what this child sees next —
    not just an animation on the button."""
    child = _require_child(creds)
    if body.content_id not in db.content:
        raise HTTPException(404, "Content not found")
    db.feedback.setdefault(child["id"], []).append({
        "content_id": body.content_id, "liked": body.liked, "ts": time.time(),
    })
    return {"ok": True, "liked": body.liked}
