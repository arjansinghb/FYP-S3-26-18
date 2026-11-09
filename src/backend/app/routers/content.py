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
import time

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import ai_assist, bulk_import, content_sources, embeddings
from ..brain import topic_is_covered
from ..deps import current_account, require_role
from ..models import AuditDecision, BulkImportRequest, ContentIn, ContentOut
from ..storage import db

router = APIRouter(prefix="/api/content", tags=["content"])


def _out(item: dict) -> ContentOut:
    return ContentOut(**item)


def _reject_duplicate(body: ContentIn) -> None:
    """CM03 alt flow: a catalogue entry that already exists is not added a
    second time. 409 with the existing entry's id/title/status so the console
    can warn and link straight to it."""
    existing = bulk_import.find_duplicate(body.type, body.title, body.external_ref)
    if existing:
        raise HTTPException(409, detail={
            "message": f"“{existing['title']}” is already in the catalogue ({existing['status']}). Open the existing entry instead of adding it again.",
            "duplicate": {"id": existing["id"], "title": existing["title"], "type": existing["type"], "status": existing["status"]},
        })


def _refresh_embedding(item: dict) -> None:
    """URS Design Constraint 3's "embedding-based content matching" half —
    computed once here (approve/edit-while-approved), not at chat time, so
    app/brain.py's retrieval step is just a similarity lookup, no live API
    call per catalogue item per message."""
    if item["status"] != "approved":
        return
    text = f"{item['title']}. {item.get('description', '')}"
    db.set_embedding(item["id"], embeddings.embed_text(text))


def _refresh_synopsis(item: dict) -> None:
    """CH14's Details view — same "compute once, at the moment an item
    goes live" timing as _refresh_embedding above, not at chat time. Only
    fills a MISSING synopsis — never overwrites one that already exists
    (an edit shouldn't silently discard a perfectly good synopsis just
    because generate_synopsis had an off moment this time), and only for
    approved items (a still-pending/rejected item is never shown to a
    child, so there's nothing to generate yet)."""
    if item["status"] != "approved" or item.get("synopsis"):
        return
    synopsis = ai_assist.generate_synopsis(item)
    if synopsis:
        item["synopsis"] = synopsis


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
    _reject_duplicate(body)
    item = db.add_content(body.model_dump(), status="approved")
    # Manually-added entries are auto-approved by their own creator (see
    # this router's module docstring) — both timestamps land at once,
    # same moment, rather than reviewed_at sitting empty for something
    # that's already live.
    item["reviewed_at"] = time.time()
    item["reviewed_by"] = mod["name"]
    _refresh_embedding(item)
    _refresh_synopsis(item)
    return _out(item)


# ---------- unmet demand: what children asked Pip for that isn't in the catalogue ----------

# How many times a topic has to come up before the system searches/imports
# for it on its own, instead of waiting for a moderator to notice it below
# and click "Auto-import" themselves — the answer to "what if there are
# thousands of requested topics, one moderator can't click through every
# one" (Kiefer, 2026-09-23). This only removes the "a human has to notice
# and trigger it" step — it runs through the exact same bulk_import.run()
# pipeline (AI triage, deterministic safety gates, audit sampling) a manual
# click already would, so none of the actual approve/reject decision-making
# changes, only who kicks it off.
_AUTO_IMPORT_THRESHOLD = 3


def _search_format(open_formats: dict) -> str:
    """Which format(s) to look for a requested topic in. When a child named a
    format, the most-asked named one. When nobody did ("any"), the child could
    be happy with a book or a video, so look in both."""
    if open_formats.get("any"):
        return "any"
    explicit = {f: n for f, n in open_formats.items() if f in ("book", "video") and n}
    return max(explicit, key=explicit.get) if explicit else "any"


@router.post("/topic-requests/auto-import")
def auto_import_one_topic(mod: dict = Depends(require_role("moderator"))):
    """Called by the moderator dashboard right after it loads the list
    below (fire-and-forget, not awaited by the list render) — picks the
    single most-requested topic that's crossed _AUTO_IMPORT_THRESHOLD and
    hasn't been tried yet, and runs it through bulk_import.run(), the
    exact same pipeline (AI triage, deterministic safety gates, audit
    sampling) the "Auto-import" button already uses. A POST, not folded
    into the GET below, on purpose: this app's persistence middleware
    (main.py's persist_state) only reloads-then-saves around mutating
    verbs — a GET handler mutating topic_misses/content would compute the
    right result in this one warm instance and then never actually
    persist it, or worse, get silently overwritten by another instance's
    save moments later (see that middleware's own 2026-09-11 fix comment
    for the exact failure shape this sidesteps).

    Stamps `auto_imported` on the topic's own row the moment it's picked
    (before the import call, not after) so a moderator repeatedly loading
    the dashboard never re-runs the same search/AI-triage for a topic that
    already got its one automatic shot — an outcome that keeps retrying
    itself would be worse than one that just leaves the topic for a
    moderator's own manual "Auto-import" click. Bounded to a SINGLE topic
    per call, not the whole backlog at once, so this stays inside one
    normal request's time budget regardless of backlog size — the
    dashboard calls this often enough that a large backlog works through
    itself one topic per load, no cron needed for a prototype this size.
    Returns {"imported_topic": str | null} so the dashboard knows whether
    to refresh the list it already rendered."""
    approved = db.approved_content()
    candidates = []
    for r in db.topic_misses:
        if r.get("auto_imported") or r["count"] < _AUTO_IMPORT_THRESHOLD:
            continue
        open_formats = {f: n for f, n in r["formats"].items() if n and not topic_is_covered(r["topic"], approved, f)}
        if open_formats:
            candidates.append((r, _search_format(open_formats)))
    if not candidates:
        return {"imported_topic": None}
    row, fmt = max(candidates, key=lambda c: c[0]["count"])
    row["auto_imported"] = True
    try:
        bulk_import.run(row["topic"], fmt, limit=10, auto_approve=True)
    except Exception:
        pass
    return {"imported_topic": row["topic"]}


@router.get("/topic-requests")
def topic_requests(mod: dict = Depends(require_role("moderator")), limit: int = Query(30, ge=1, le=100)):
    """Topics children asked for that Pip couldn't serve, most-asked first — the
    moderator's guide to what to search and import next (CM03). Aggregate only:
    no child, session or message text is stored (see storage.record_topic_miss).
    A topic drops off by itself once approved content covers it, so the list
    only ever shows gaps that are still open. Purely a read — see
    auto_import_one_topic() above for the mutating half of this feature and
    why it's a separate POST rather than a side effect of this GET.

    `auto_import_threshold` and `auto_imported` are included so the
    dashboard can show WHY a row still has a manual "Auto-import" button —
    real confusion found in practice (Kiefer, 2026-09-24): every row looks
    identical whether it's below the threshold (genuinely waiting on more
    asks) or already had its one automatic shot (see
    auto_import_one_topic's own "Stamps auto_imported... before the import
    call" note) and just didn't fully resolve. Without a visible count, "it
    says it can auto-import, why do I still have to click" reads as the
    feature being broken when it's actually working as designed.

    `key` is also now included — a real gap found alongside the above
    (Kiefer, 2026-09-24, asking why there's no dismiss/delete control on
    this list at all): DELETE /topic-requests/{topic_key} below already
    existed and its own docstring already said it takes the row's `key`
    "as topic-requests lists it", but this endpoint never actually
    included that field, so no frontend could ever have called it
    correctly — dismiss was unbuildable, not just unbuilt."""
    approved = db.approved_content()
    out = []
    for r in db.topic_misses:
        # A gap is open per format: it stays until approved content of the
        # format the child asked for covers the topic ("any" = any format).
        open_formats = {
            f: n for f, n in r["formats"].items()
            if n and not topic_is_covered(r["topic"], approved, f)
        }
        if not open_formats:
            continue
        out.append({
            "topic": r["topic"], "key": r["key"], "count": r["count"], "formats": r["formats"],
            "format": _search_format(open_formats),  # "book", "video", or "any" = look in both
            "last_requested_at": r["last_at"],
            "auto_imported": bool(r.get("auto_imported")),
        })
    out.sort(key=lambda r: (-r["count"], -r["last_requested_at"]))
    out = out[:limit]
    for row in out:
        row["auto_import_threshold"] = _AUTO_IMPORT_THRESHOLD
    return out


@router.delete("/topic-requests/{topic_key}", status_code=204)
def dismiss_topic_request(topic_key: str, mod: dict = Depends(require_role("moderator"))):
    """Remove one tallied topic (e.g. the moderator decided not to pursue it,
    or it was a one-off/test message) — `topic_key` is the row's own `key`
    (singularised), as topic-requests lists it, not the display `topic`
    text. Idempotent: dismissing an already-gone key is still a 204, not 404."""
    db.topic_misses[:] = [r for r in db.topic_misses if r["key"] != topic_key]


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
    `start_index` pages through results (see content_sources.search_books).
    Every result carries `ai_filtered`/`ai_filter_reason` (ai_assist.
    screen_import_candidates) — the ones the AI expects the moderator to
    reject anyway, flagged (not removed) so the UI can hide them by default."""
    return ai_assist.screen_import_candidates(content_sources.search_books(q, start_index=start_index), "book")


@router.get("/search/videos")
def search_videos(q: str = Query(..., min_length=1), mod: dict = Depends(require_role("moderator"))):
    """Live YouTube Data API search — same import-candidate-only rule as
    search/books above, including the AI pre-screen flags."""
    return ai_assist.screen_import_candidates(content_sources.search_videos(q), "video")


# ---------- QA audit: a human spot-check on what the AI decided alone ----------

@router.get("/audit-queue")
def audit_queue(mod: dict = Depends(require_role("moderator")), limit: int = Query(20, ge=1, le=100)):
    """Items bulk import's auto-triage (app/bulk_import.py) approved or
    rejected WITHOUT a human, sampled at AUDIT_SAMPLE_RATE for a moderator to
    double-check after the fact — not a second gate before publish (that
    already happened), but the way a wrong gate or a drifting model gets
    caught as a pattern instead of staying invisible forever. `accuracy` is
    None until at least one item has actually been audited."""
    sampled = [c for c in db.content.values() if c.get("audit_status") == "pending"]
    sampled.sort(key=lambda c: c.get("reviewed_at") or 0)
    confirmed = sum(1 for c in db.content.values() if c.get("audit_status") == "confirmed")
    overturned = sum(1 for c in db.content.values() if c.get("audit_status") == "overturned")
    audited = confirmed + overturned
    return {
        "items": [_out(c) for c in sampled[:limit]],
        "pending_count": len(sampled),
        "confirmed": confirmed, "overturned": overturned,
        "accuracy": round(confirmed / audited, 3) if audited else None,
    }


@router.post("/{content_id}/audit", response_model=ContentOut)
def audit_decision(content_id: str, body: AuditDecision, mod: dict = Depends(require_role("moderator"))):
    """A moderator's verdict on one sampled AI decision. "confirm" leaves the
    item exactly as the AI left it. "overturn" means the AI got it wrong —
    the item's real status flips (approved -> rejected pulls it from the
    catalogue immediately; rejected -> approved publishes it, computing the
    embedding it never got). Either way this is a one-time verdict: an item
    not currently `audit_status == "pending"` (never sampled, or already
    audited) is rejected rather than silently re-recorded."""
    item = db.content.get(content_id)
    if not item:
        raise HTTPException(404, "Content not found")
    if item.get("audit_status") != "pending":
        raise HTTPException(409, "This item isn't waiting for an audit decision")

    if body.decision == "overturn":
        item["status"] = "rejected" if item["status"] == "approved" else "approved"
        item["audit_status"] = "overturned"
        _refresh_embedding(item)  # a no-op unless it just flipped TO approved
        _refresh_synopsis(item)   # same — a no-op unless it just flipped TO approved
    else:
        item["audit_status"] = "confirmed"

    item["audited_at"] = time.time()
    item["audited_by"] = mod["name"]
    if body.note:
        item["audit_note"] = str(body.note)[:300]
    return _out(item)


@router.post("/bulk-import")
def bulk_import_topic(body: BulkImportRequest, mod: dict = Depends(require_role("moderator"))):
    """Search a topic, then triage every new result (app/bulk_import.py): the
    confident ones are approved or rejected by code-gated AI, the rest land in
    the normal Submissions queue. Returns a per-item report so nothing the AI
    did is invisible. Empty result (not an error) if no API key is configured."""
    topic = body.topic.strip()
    if not topic or len(topic) > 80:
        raise HTTPException(422, "Give a topic of 1-80 characters")
    return bulk_import.run(topic, body.type, body.limit, body.auto_approve)


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
    _reject_duplicate(body)
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
    item["reviewed_at"] = time.time()
    item["reviewed_by"] = mod["name"]
    _refresh_embedding(item)
    _refresh_synopsis(item)
    return _out(item)


@router.post("/{content_id}/reject", response_model=ContentOut)
def reject(content_id: str, mod: dict = Depends(require_role("moderator"))):
    item = db.content.get(content_id)
    if not item:
        raise HTTPException(404, "Content not found")
    item["status"] = "rejected"
    item["reviewed_at"] = time.time()
    item["reviewed_by"] = mod["name"]
    return _out(item)
