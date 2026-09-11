"""AI *suggestions* for the two staff triage queues that get long enough
that a human reading every single item one by one stops being realistic —
parent reviews (UV04/admin) once there are 100+ of them, and catalogue
submissions (CM06) once search/import makes adding items fast. Both
functions here do the same job in spirit: a fast, structured LLM call that
proposes a decision + a one-line reason, so staff can triage by AI
suggestion instead of reading everything cold.

Explicitly NOT an auto-moderation layer — nothing here ever approves,
rejects, or publishes anything by itself. A human (admin for reviews,
moderator for catalogue) still makes the actual call every time; this only
changes what they see first. That's a different job from app/moderation.py
(which screens content the *child* is exposed to and can redirect away
from it) — these suggestions are advisory-only, staff-facing, and always
overridable.

Same fail-open posture as moderation.py: if the API key isn't configured,
the call fails, or the response doesn't parse, return a "no suggestion"
result rather than raise — an AI hiccup should never block a human from
reviewing something the normal way.
"""
from __future__ import annotations

import json

from .config import settings


def _chat_json(system_prompt: str, user_content: str) -> dict | None:
    if not settings.OPENAI_API_KEY:
        return None
    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        resp = client.chat.completions.create(
            model=settings.OPENAI_CHAT_MODEL,
            response_format={"type": "json_object"},
            temperature=0.2,  # a triage suggestion should be consistent, not creative
            timeout=15,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
        )
        return json.loads(resp.choices[0].message.content)
    except Exception:
        return None


def suggest_review(rating: int, text: str) -> dict:
    """UV04/admin — does this parent review read like a genuine, useful
    testimonial worth featuring on the public landing page? Judges
    *quality*, separate from app/moderation.py's is_unsafe (which already
    ran first and would have kept anything actually unsafe out of the
    queue entirely) — a review can be perfectly safe and still not be
    worth featuring (too short, generic, or actually a complaint rather
    than praise despite a high star rating).

    Returns {"recommend": bool | None, "reason": str}. `recommend` is
    None (not False) when the AI call itself didn't run/succeed — the
    admin UI treats that as "no AI opinion", never as a negative signal.
    """
    fallback = {"recommend": None, "reason": ""}
    if not text or not text.strip():
        return fallback
    system_prompt = (
        "You triage parent reviews of a children's book/video recommendation app "
        "for a staff member who has too many to read one by one. Judge whether THIS "
        "review is worth featuring on the public landing page: genuine, specific, and "
        "positive-or-constructive — not generic filler (\"good app\", \"nice\"), not "
        "spam/gibberish, and not primarily a complaint (even a high star rating paired "
        "with complaint text should not be recommended). A short but specific, genuine "
        "review can still be worth featuring. Respond ONLY with JSON of this exact shape: "
        '{"recommend": true or false, "reason": "one short sentence, staff-facing, '
        'explaining the call"}.'
    )
    result = _chat_json(system_prompt, f"Star rating: {rating}/5\nReview text: {text!r}")
    if not result or not isinstance(result.get("recommend"), bool):
        return fallback
    return {"recommend": result["recommend"], "reason": str(result.get("reason") or "")[:200]}


def suggest_catalogue_decision(item: dict) -> dict:
    """CM06 — a first-pass read on whether a searched/imported book or
    video looks like a fit for this catalogue, given only the metadata a
    moderator themselves would be looking at (title, synopsis, assigned
    age bands/genres). The moderator still makes the real call (CM07/
    CM08) — this only orders what they triage first and gives them a
    starting rationale, same advisory-only shape as suggest_review above.

    Returns {"suggestion": "approve" | "reject" | None, "reason": str,
    "confidence": "low" | "medium" | "high"}. `suggestion` is None when
    the AI call didn't run/succeed.
    """
    fallback = {"suggestion": None, "reason": "", "confidence": "low"}
    title = (item.get("title") or "").strip()
    if not title:
        return fallback
    system_prompt = (
        "You give a content moderator at a children's (ages 5-12) book/video "
        "recommendation app a first-pass read on a new catalogue submission, so they "
        "can triage a long queue instead of reading every item cold from scratch. Given "
        "a title, synopsis, type, and the age band(s)/genres the moderator already "
        "assigned, suggest approve or reject based on: age-appropriateness for the "
        "stated band(s), whether the synopsis actually reads like a real, specific "
        "children's book or video (not vague/spammy/low-effort), and obvious safety "
        "concerns (violence, mature themes, anything not age-appropriate). You are not "
        "the final decision-maker — a human moderator always reviews your suggestion "
        "before anything is published. Respond ONLY with JSON of this exact shape: "
        '{"suggestion": "approve" or "reject", "reason": "one short, specific sentence '
        'explaining why", "confidence": "low" or "medium" or "high"}.'
    )
    user_content = json.dumps({
        "type": item.get("type"),
        "title": title,
        "description": item.get("description", ""),
        "age_bands": item.get("age_bands", []),
        "genres": item.get("genres", []),
    })
    result = _chat_json(system_prompt, user_content)
    if not result or result.get("suggestion") not in ("approve", "reject"):
        return fallback
    confidence = result.get("confidence") if result.get("confidence") in ("low", "medium", "high") else "medium"
    return {
        "suggestion": result["suggestion"],
        "reason": str(result.get("reason") or "")[:200],
        "confidence": confidence,
    }
