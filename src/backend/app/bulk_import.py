"""Bulk import with auto-triage: the answer to "a moderator can't read 500,000
items one by one". Given a topic (usually one children asked Pip for that the
catalogue lacked — see storage.record_topic_miss), search Google Books/YouTube,
and sort the results into three piles:

    auto-approved   goes live immediately, stamped "AI auto-triage"
    auto-rejected   unsuitable for children: stored as rejected (so it is never suggested
                    again), with the reason
    needs review    lands in the ordinary Submissions queue, AI suggestion attached

(A fourth, silent case: a harmless item that just isn't about the topic is
skipped and not stored at all — it isn't unsuitable, so it must not be
recorded as rejected, and it would only clutter the queue.)

The moderator only ever reads the third pile. What makes the first two safe is
that the gates are code, not the model's say-so. An item is auto-APPROVED only
if EVERY one of these holds:

    - the TOPIC itself isn't flagged by OpenAI Moderation (checked once, up
      front — a sensitive/unsafe search topic forces every result from this
      run into the review pile, full stop, regardless of what follows)
    - it is not already in the catalogue (same link, or same type + title)
    - a real description and cover image exist
    - books: Google marks it NOT_MATURE / videos: YouTube marks it madeForKids
      AND embeddable — deterministic flags from the source, not AI opinion
    - OpenAI Moderation doesn't flag its title/description
    - the AI says approve, with HIGH confidence, on-topic, with a valid age band
    - the moderator left "let AI approve" on (they choose it per run)

Auto-REJECT needs moderation to flag it, or the AI to say "reject" with HIGH
confidence AND the explicit `unsuitable` flag — a mislabelled or off-topic item
is not an unsuitable one, and must not be recorded as rejected. Everything else — including every case where the AI call fails —
is left for a human. So an outage or an uncertain model can only make the
queue longer, never let something through.
"""
from __future__ import annotations

import random
import re
import time

from . import ai_assist, content_sources, embeddings, moderation
from .storage import db

MAX_LIMIT = 15  # per run: keeps one request inside a serverless time budget
AI_REVIEWER = "AI auto-triage"
_MIN_DESCRIPTION = 40
_MAX_STORED_DESCRIPTION = 600  # the whole store is one Firestore document — keep imported text lean

# QA: not every auto-triaged decision is read by a human, but a random slice
# of them is — the "5% sample audit" from the original design note, widened
# to 20% here so a small prototype catalogue actually produces something to
# review. A moderator confirming/overturning these (POST /{id}/audit) is how
# a wrong gate or a drifting model gets caught before it's a pattern, not a
# one-off. Tunable; not exposed as an admin setting yet — see this file's own
# docstring if that becomes worth doing.
AUDIT_SAMPLE_RATE = 0.2


def _norm(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (title or "").lower()).strip()


def _known() -> tuple[set[str], set[tuple[str, str]]]:
    refs = {str(c["external_ref"]) for c in db.content.values() if c.get("external_ref")}
    titles = {(c["type"], _norm(c["title"])) for c in db.content.values()}
    return refs, titles


def _trusted_source(c: dict, media_type: str) -> bool:
    integrations = db.system.get("integrations", {})
    if media_type == "video":
        allowlist = {ch for ch in integrations.get("youtube_channel_allowlist", []) if ch}
        return bool(allowlist) and c.get("channel_id") in allowlist
    publishers = [p.strip().lower() for p in integrations.get("trusted_book_publishers", []) if p.strip()]
    publisher = (c.get("publisher") or "").strip().lower()
    return bool(publishers) and bool(publisher) and any(p in publisher for p in publishers)


def _source_gate(c: dict, media_type: str) -> str | None:
    """None = passes; otherwise why it can't be auto-approved."""
    if len((c.get("description") or "").strip()) < _MIN_DESCRIPTION:
        return "description too thin to judge"
    if not c.get("thumbnail"):
        return "no cover image"
    if media_type == "book" and c.get("maturity") != "NOT_MATURE":
        return "not marked as suitable for all audiences by Google Books"
    if media_type == "video" and c.get("made_for_kids") is not True:
        return "not marked made-for-kids by YouTube"
    if media_type == "video" and c.get("embeddable") is False:
        return "not embeddable"
    return None


def run_both(topic: str, limit: int = 10, auto_approve: bool = True) -> dict:
    """A topic nobody asked a format for: search books and videos, splitting the
    limit between them, and return one combined report."""
    limit = max(1, min(int(limit), MAX_LIMIT))
    per_format = max(1, limit // 2)
    parts = [run(topic, "book", per_format, auto_approve), run(topic, "video", per_format, auto_approve)]
    out = {
        "topic": topic.strip(), "type": "any", "auto_approve": auto_approve,
        "topic_flagged": any(p["topic_flagged"] for p in parts),
        "items": [item for p in parts for item in p["items"]],
    }
    for key in ("found", "skipped_duplicates", "skipped_off_topic", "approved", "rejected", "pending"):
        out[key] = sum(p[key] for p in parts)
    return out


def run(topic: str, media_type: str, limit: int = 10, auto_approve: bool = True) -> dict:
    if media_type == "any":
        return run_both(topic, limit, auto_approve)
    limit = max(1, min(int(limit), MAX_LIMIT))
    topic = topic.strip()

    # A topic that's itself flagged by OpenAI Moderation (the same check
    # already used to screen a child's own chat messages, see
    # app/moderation.py) must never go straight to a live catalogue entry
    # on AI confidence alone — real gap found in practice (Kiefer,
    # 2026-09-24, asking what stops a negative/sensitive keyword from
    # auto-importing once it crosses the popularity threshold): nothing
    # did. This doesn't block the search or the topic from being covered
    # at all — a moderator can still deliberately import something on a
    # sensitive topic (grief, bullying, illness are all legitimate,
    # valuable subjects for a children's book) — it just means a human
    # decides that, not a confidence score, so every result lands in the
    # ordinary review queue no matter how the caller set `auto_approve` or
    # how confident the AI triage is. This is on TOP of, not instead of,
    # the existing per-item gates below (moderation on each found item's
    # own title/description, Google/YouTube maturity flags, AI on-topic +
    # age-band judgment) — those still run and can still auto-reject
    # something unsuitable; this only ever removes the auto-APPROVE path.
    topic_flagged = moderation.is_unsafe(topic)
    if topic_flagged:
        auto_approve = False

    found = content_sources.search_for_import(topic, media_type, limit)

    known_refs, known_titles = _known()
    fresh, skipped = [], 0
    for c in found:
        ref = str(c.get("external_ref") or "")
        key = (media_type, _norm(c.get("title", "")))
        if (ref and ref in known_refs) or key in known_titles:
            skipped += 1
            continue
        known_refs.add(ref)
        known_titles.add(key)
        fresh.append(c)
    fresh = fresh[:limit]

    flags = moderation.flagged_many([f"{c.get('title', '')}. {c.get('description', '')}" for c in fresh])
    genre_vocab = sorted({g for c in db.approved_content() for g in c.get("genres", [])})
    verdicts = ai_assist.triage_candidates(fresh, media_type, topic, genre_vocab)

    now = time.time()
    outcomes, to_embed, off_topic = [], [], 0
    for c, flagged, v in zip(fresh, flags, verdicts):
        if not flagged and v and v["decision"] == "off_topic":
            off_topic += 1
            continue
        gate = _source_gate(c, media_type)
        trusted = _trusted_source(c, media_type)
        ok_confidence = ("medium", "high") if trusted else ("high",)
        record = {
            "type": media_type, "title": c.get("title", "Untitled"),
            "description": (c.get("description") or "")[:_MAX_STORED_DESCRIPTION],
            "age_bands": (v or {}).get("age_bands", []), "genres": (v or {}).get("genres", []),
            "source": "google_books" if media_type == "book" else "youtube",
            "external_ref": c.get("external_ref"), "thumbnail": c.get("thumbnail"),
            "ai_suggestion": None, "ai_reason": None, "ai_confidence": None,
        }
        if v:
            record["ai_suggestion"] = "approve" if v["decision"] == "approve" else "reject" if v["decision"] == "reject" else None
            record["ai_reason"], record["ai_confidence"] = v["reason"], v["confidence"]

        if flagged:
            status, reason = "rejected", "Flagged by content moderation."
        elif v and v["decision"] == "reject" and v["confidence"] == "high" and v["unsuitable"]:
            status, reason = "rejected", v["reason"] or "Not suitable for children."
        elif (
            auto_approve and v and v["decision"] == "approve" and v["confidence"] in ok_confidence
            and v["on_topic"] and v["age_bands"] and gate is None
        ):
            status, reason = "approved", v["reason"] or "Confident match."
            if trusted:
                reason += " (trusted source — easier bar applied)"
            topic_tag = topic.lower()
            if topic_tag not in record["genres"]:
                record["genres"] = [*record["genres"], topic_tag][:4]
        else:
            status = "pending"
            reason = gate or (v["reason"] if v else "AI unavailable — needs a human look.")
            if v and v["decision"] == "approve" and not gate and not auto_approve:
                reason = "Looks good — left for you (auto-approve was off)."

        item = db.add_content(record, status=status)
        sampled = False
        if status != "pending":
            item["reviewed_at"], item["reviewed_by"], item["auto_triaged"] = now, AI_REVIEWER, True
            sampled = random.random() < AUDIT_SAMPLE_RATE
            item["audit_status"] = "pending" if sampled else "not_sampled"
        if status == "approved":
            to_embed.append(item)
            # CH14's Details view — same "compute once, when it goes live"
            # timing as content.py's own _refresh_synopsis, just inlined
            # here since this path never touches that router at all.
            synopsis = ai_assist.generate_synopsis(item)
            if synopsis:
                item["synopsis"] = synopsis
        outcomes.append({
            "id": item["id"], "title": item["title"], "outcome": status, "reason": reason,
            "trusted_source": trusted, "sampled_for_audit": sampled,
        })

    # One batched call for every newly-live item; a failure leaves them
    # embedding-less, which retrieval tolerates (they rank last until re-saved).
    for item, vec in zip(to_embed, embeddings.embed_texts([f"{i['title']}. {i.get('description', '')}" for i in to_embed])):
        db.set_embedding(item["id"], vec)

    counts = {k: sum(1 for o in outcomes if o["outcome"] == k) for k in ("approved", "rejected", "pending")}
    return {
        "topic": topic, "type": media_type, "found": len(found), "skipped_duplicates": skipped,
        "skipped_off_topic": off_topic,
        "auto_approve": auto_approve, "topic_flagged": topic_flagged, **counts, "items": outcomes,
    }
