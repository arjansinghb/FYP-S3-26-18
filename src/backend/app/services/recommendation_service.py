"""Content-based retrieval — agent-context/CLAUDE.md §5.1's "Retrieval" step.
Cosine similarity over precomputed `catalogueItems` embeddings, pre-filtered by
the child's `ageBand` and (per CLAUDE.md §3 point 1) restricted to
`status == "live"` items only. The LLM is never asked to pick a book itself —
see app/services/openai_service.py's module docstring.

Also applies PA18 (Hide Specific Content) parent overrides: "block" removes an
item from consideration outright (even if it would otherwise match); "approve"
lets an item through despite not matching the child's normal age band — both
still respect the format filter and status=="live" gate, since an override is
a *relaxation* of the age-band rule specifically, not a bypass of moderation.

Also applies PA21 (Adjust Safety Settings, app/models/child.py's
`SafetySettings`): `blocked_topics` excludes any candidate whose `topics`
intersect it, on top of (not instead of) the moderation/age-band/override
layers above; `strict_age_filtering` disables the PA18 "approve" override's
cross-age-band relaxation specifically — it never touches the base age-band
filter, which was already exact-match to begin with.
"""
from __future__ import annotations

import math

from app.core.config import get_settings
from app.models.chat import RecommendationOut, Slots
from app.repositories import catalogue as catalogue_repo
from app.repositories import content_overrides as content_overrides_repo
from app.services import openai_service


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _slots_to_query_text(slots: Slots) -> str:
    parts = [p for p in (slots.topic, slots.mood, slots.format, slots.difficulty) if p]
    return " ".join(parts) or "something fun to read or watch"


def _embed_url(item_id: str, item_type: str) -> str | None:
    """CH12 — Watch Embedded Video. Catalogue item IDs are minted as
    `f"{type}-{external_id}"` at import time (see
    app/routers/moderation.py's import_content) — for a video, `external_id`
    is the raw YouTube video ID, so it round-trips into a standard YouTube
    iframe-embed URL with no extra stored field needed. `CatalogueItemPublic`
    (app/models/catalogue.py) predates this and is otherwise unused — this is
    the actual child-facing path (RecommendationOut, returned from chat)."""
    if item_type != "video":
        return None
    prefix = "video-"
    if not item_id.startswith(prefix):
        return None
    return f"https://www.youtube.com/embed/{item_id[len(prefix):]}"


def recommend(
    slots: Slots,
    age_band: str,
    exclude_item_ids: list[str],
    child_id: str | None = None,
    blocked_topics: list[str] | None = None,
    strict_age_filtering: bool = False,
) -> list[RecommendationOut]:
    """CH08/CH09 (Receive Book/Video Recommendation) + CH10 (explanation),
    returned together as the "small set" from agent-context/CLAUDE.md §2.1."""
    settings = get_settings()

    candidates = catalogue_repo.list_live_items(age_band=age_band)

    blocked_ids: set[str] = set()
    if child_id:
        overrides = content_overrides_repo.list_overrides_for_child(child_id)
        blocked_ids = {o.catalogue_item_id for o in overrides if o.decision == "block"}
        approved_ids = {o.catalogue_item_id for o in overrides if o.decision == "approve"}
        if not strict_age_filtering:  # PA21 — strict mode disables this cross-age-band relaxation
            known_ids = {c.id for c in candidates}
            for item_id in approved_ids - known_ids:
                item = catalogue_repo.get_item(item_id)
                if item is not None and item.status == "live":
                    candidates.append(item)

    candidates = [c for c in candidates if c.id not in blocked_ids]
    if blocked_topics:  # PA21
        blocked_topic_set = set(blocked_topics)
        candidates = [c for c in candidates if not blocked_topic_set.intersection(c.topics)]
    if slots.format in ("book", "video"):
        candidates = [c for c in candidates if c.type == slots.format]
    candidates = [c for c in candidates if c.id not in exclude_item_ids]
    if not candidates:
        return []

    query_embedding = openai_service.embed_text(_slots_to_query_text(slots))
    scored = [(item, _cosine(query_embedding, item.embedding or [])) for item in candidates]
    scored.sort(key=lambda pair: pair[1], reverse=True)
    top_items = [item for item, _ in scored[: settings.recommendation_batch_size]]

    results = []
    for item in top_items:
        reason = openai_service.explain_recommendation(item.title, item.synopsis, slots, age_band)
        results.append(
            RecommendationOut(
                item_id=item.id,
                title=item.title,
                type=item.type,
                reason=reason,
                embed_url=_embed_url(item.id, item.type),
            )
        )
    return results
