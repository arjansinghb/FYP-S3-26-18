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

One exception: generate_synopsis() below produces real child-facing text
(CH14's Details view), not a staff suggestion — it runs its own output
through app/moderation.py's is_unsafe before ever returning it, same
belt-and-suspenders check guardrails.py applies to everything else Pip
says to a child.

Same fail-open posture as moderation.py: if the API key isn't configured,
the call fails, or the response doesn't parse, return a "no suggestion"
result rather than raise — an AI hiccup should never block a human from
reviewing something the normal way.
"""
from __future__ import annotations

import json

from . import moderation
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


_MAX_SYNOPSIS_CHARS = 700


def generate_synopsis(item: dict) -> str | None:
    """CH14's "details" view — a real, genuine synopsis, not the raw
    scraped catalogue `description` (actual box-set/marketing listing
    text, verified to include asterisk-bullet lists and mid-word
    truncation — never shown to a child; see ChildChat.jsx's own comment
    on why) and not just the one-line recommendation `explanation` either
    (that's about why THIS pick fits what the child asked for, not what
    the book/video is actually about). Called once, at the moment an item
    goes live (routers/content.py's add_entry()/approve(), bulk_import's
    own auto-approve branch) and cached on the item — never generated
    live inside a child-facing request. Returns None on any failure (no
    key, bad/oversized response, empty title); callers keep the item's
    existing `synopsis` (or leave it unset) rather than overwrite a good
    one with nothing, same fail-open posture as the rest of this file."""
    title = (item.get("title") or "").strip()
    if not title:
        return None
    system_prompt = (
        "Write a short, genuine synopsis of a children's book or video for a kids' companion app's "
        "\"details\" view (read by, or read aloud to, a child aged 5-12). 2-4 short sentences: what "
        "it's actually about, warm and inviting, spoiler-light (no ending reveals), age-appropriate "
        "language. No marketing language (\"bestseller\", \"don't miss\", star ratings, calls to "
        "action) and no raw catalogue metadata (index numbers, IDs, URLs, playlist links). If the "
        "given description is too thin, promotional, or unclear to summarise honestly, write a short "
        "general synopsis from the title and genres instead, without inventing specific plot details "
        'you can\'t be sure of. Respond ONLY with JSON: {"synopsis": "string"}.'
    )
    user_content = json.dumps({
        "type": item.get("type"), "title": title, "description": (item.get("description") or "")[:600],
        "genres": item.get("genres", []), "age_bands": item.get("age_bands", []),
    })
    result = _chat_json(system_prompt, user_content)
    text = str((result or {}).get("synopsis") or "").strip()
    if not text or len(text) > _MAX_SYNOPSIS_CHARS or moderation.is_unsafe(text):
        return None
    return text


def screen_import_candidates(results: list[dict], media_type: str) -> list[dict]:
    """CM03 — the search-stage half of the moderator AI: a pre-screen that
    filters out results the moderator would almost certainly reject anyway
    (supervisor's prototype requirement: "an AI that will filter out
    content that would be rejected by the moderator"), so their time goes
    to plausible candidates instead of wading through adult/technical/spam
    results a broad Google Books/YouTube query always mixes in.

    One batched call for the whole result page (not one call per result).
    Each result comes back annotated with `ai_filtered` (bool) and
    `ai_filter_reason`, never removed — the moderator UI hides filtered
    ones by default but can still reveal and import any of them, so a wrong
    AI call costs one click to override rather than losing a good item.
    Same fail-open posture as everything else in this file: if the AI call
    doesn't run or doesn't parse, nothing is marked filtered.
    """
    annotated = [{**r, "ai_filtered": False, "ai_filter_reason": ""} for r in results]
    if not annotated:
        return annotated
    system_prompt = (
        "You pre-screen search results for a content moderator at a children's (ages 5-12) "
        "book/video recommendation app, so the moderator only spends time on results they "
        "would plausibly approve. For each result decide whether the moderator would REJECT "
        "it: reject anything that isn't suitable children's content — violence or gore, "
        "sexual or mature themes, drugs or alcohol, hate or harassment, horror aimed at older "
        "audiences, adult/academic/technical/professional material not made for children "
        "(e.g. a university textbook, an adult thriller, a gaming stream, news, commentary or "
        "reaction content), or spam/clickbait with an empty or nonsensical description. When "
        "in doubt about an ordinary, harmless children's book or video, do NOT reject it — you "
        "are only removing what clearly wouldn't be approved, and a human moderator still "
        "reviews everything that's left. Respond ONLY with JSON of this exact shape: "
        '{"verdicts": [{"index": 0, "reject": true or false, "reason": "one short sentence, '
        'only needed when reject is true"}]} with one entry per result.'
    )
    brief = [
        {
            "index": i,
            "title": r.get("title"),
            "description": (r.get("description") or "")[:240],
            "by": r.get("authors") or r.get("channel"),
            "categories": r.get("categories") or [],
        }
        for i, r in enumerate(annotated)
    ]
    result = _chat_json(system_prompt, json.dumps({"type": media_type, "results": brief}))
    for verdict in (result or {}).get("verdicts") or []:
        index = verdict.get("index")
        if (
            isinstance(index, int) and not isinstance(index, bool)
            and 0 <= index < len(annotated) and verdict.get("reject") is True
        ):
            annotated[index]["ai_filtered"] = True
            annotated[index]["ai_filter_reason"] = str(verdict.get("reason") or "")[:200]
    return annotated


TRIAGE_AGE_BANDS = ("5-8", "9-12")


def triage_candidates(candidates: list[dict], media_type: str, topic: str, genre_vocab: list[str]) -> list[dict | None]:
    """Bulk import — the triage half of the moderator AI: one batched call that
    judges every candidate for a requested topic and proposes the metadata a
    moderator would otherwise type in (age bands, genres).

    Per candidate: `{decision: approve|reject|off_topic|review, confidence: low|medium|high,
    on_topic: bool, reason, age_bands: [...], genres: [...]}`, or None for a
    candidate the AI didn't return a usable verdict for. The whole list is
    None-filled when the call can't run — and bulk_import treats "no verdict"
    as "needs a human", never as approval, so an AI outage can't wave anything
    through. What the verdict is ALLOWED to do (auto-approve / auto-reject) is
    decided by bulk_import's gates, not here.
    """
    verdicts: list[dict | None] = [None] * len(candidates)
    if not candidates:
        return verdicts
    system_prompt = (
        "You triage import candidates for a children's (ages 5-12) book/video recommendation "
        "app. A child asked for the topic given below and the catalogue has nothing on it, so a "
        "moderator is importing candidates. For each candidate decide: "
        '"approve" — a real, specific, wholesome children\'s book/video that is genuinely ABOUT '
        'the topic and clearly age-appropriate; "reject" — UNSUITABLE FOR CHILDREN, and only that '
        "(violence or gore, sexual or mature themes, drugs or alcohol, hate, horror for older "
        "audiences, adult/academic/technical/professional material, news, commentary, gaming "
        'streams, spam or clickbait); "off_topic" — perfectly fine for children but not really '
        'about the topic (never use "reject" for this); "review" — anything uncertain, '
        "borderline, thin on detail, or only loosely related. Be strict about approving: when in "
        "any doubt choose review, never approve. `confidence` is how sure you are of the "
        "decision. `on_topic` is whether it is genuinely about the topic. `unsuitable` is true ONLY if "
        "the item itself is inappropriate for children — never for being off topic, mislabelled, "
        "low quality or badly described. `age_bands` is the "
        "subset of [\"5-8\", \"9-12\"] it suits. `genres` is 1-3 lowercase one- or two-word tags, "
        "preferring these existing ones when they fit: "
        f"{json.dumps(genre_vocab[:30])}. Respond ONLY with JSON of this exact shape: "
        '{"verdicts": [{"index": 0, "decision": "approve" | "reject" | "off_topic" | "review", '
        '"confidence": "low" | "medium" | "high", "on_topic": true | false, '
        '"unsuitable": true | false, "reason": "one short sentence", "age_bands": ["5-8"], "genres": ["animals"]}]} '
        "with one entry per candidate."
    )
    brief = [
        {
            "index": i, "title": c.get("title"),
            "description": (c.get("description") or "")[:300],
            "by": c.get("authors") or c.get("channel"),
            "categories": c.get("categories") or [],
        }
        for i, c in enumerate(candidates)
    ]
    result = _chat_json(system_prompt, json.dumps({"type": media_type, "topic": topic, "candidates": brief}))
    for raw in (result or {}).get("verdicts") or []:
        index = raw.get("index")
        if not isinstance(index, int) or isinstance(index, bool) or not (0 <= index < len(candidates)):
            continue
        if raw.get("decision") not in ("approve", "reject", "off_topic", "review"):
            continue
        genres = [
            g.strip().lower() for g in (raw.get("genres") or [])
            if isinstance(g, str) and 2 <= len(g.strip()) <= 30
        ][:3]
        verdicts[index] = {
            "decision": raw["decision"],
            "confidence": raw.get("confidence") if raw.get("confidence") in ("low", "medium", "high") else "low",
            "on_topic": raw.get("on_topic") is True,
            "unsuitable": raw.get("unsuitable") is True,
            "reason": str(raw.get("reason") or "")[:200],
            "age_bands": [b for b in (raw.get("age_bands") or []) if b in TRIAGE_AGE_BANDS],
            "genres": genres,
        }
    return verdicts
