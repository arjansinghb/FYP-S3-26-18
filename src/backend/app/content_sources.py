"""Google Books API + YouTube Data API v3 clients — search only, used by the
moderator console (CM03/CM06) to find real import candidates.

Ingestion-time only, never called at chat time: app/brain.py only ever picks
from what's already in `db.content` with status "approved" — a search here
never becomes recommendable on its own, a moderator still has to explicitly
import (adds it as "pending") and then approve (CM07) it first. Same
"curated catalogue, never a live open query at chat time" rule the rest of
this project follows.

No API keys -> both functions return an empty list rather than raising, so a
backend with no content-source keys configured still boots fine; the search/
import endpoints in routers/content.py just come back empty until keys are
added.
"""
from __future__ import annotations

import html

import httpx

from .config import settings
from .storage import db

GOOGLE_BOOKS_BASE = "https://www.googleapis.com/books/v1/volumes"
YOUTUBE_SEARCH_BASE = "https://www.googleapis.com/youtube/v3/search"


def search_books(query: str, max_results: int = 20, start_index: int = 0) -> list[dict]:
    """`start_index` pages through results — Google's public API silently
    caps a single page well under `max_results` for larger values, so a
    caller wanting more than ~20 candidates needs to call this again with
    `start_index=20`, `40`, etc. rather than just raising `max_results`."""
    if not settings.GOOGLE_BOOKS_API_KEY:
        return []
    resp = httpx.get(
        GOOGLE_BOOKS_BASE,
        params={
            "q": query, "maxResults": max_results, "startIndex": start_index,
            "key": settings.GOOGLE_BOOKS_API_KEY,
        },
        timeout=10.0,
    )
    resp.raise_for_status()
    data = resp.json()

    results = []
    for item in data.get("items", []):
        info = item.get("volumeInfo", {})
        results.append({
            "external_id": item.get("id", ""),
            "type": "book",
            # html.unescape guards against the same HTML-entity leak the
            # YouTube branch below has (see that one's own comment) —
            # Google Books hasn't been observed doing this in practice, but
            # unescape is a no-op on already-plain text, so it costs nothing
            # to apply consistently rather than wait for a real report.
            "title": html.unescape(info.get("title", "Untitled")),
            "description": html.unescape(info.get("description", "") or ""),
            "authors": info.get("authors", []),
            "thumbnail": info.get("imageLinks", {}).get("thumbnail"),
            "external_ref": info.get("infoLink") or info.get("previewLink"),
            "categories": info.get("categories", []),
            "maturity": info.get("maturityRating"),  # "NOT_MATURE" | "MATURE"
            "publisher": info.get("publisher", ""),
        })
    return results


def _youtube_channel_allowlist() -> list[str]:
    return db.system.get("integrations", {}).get("youtube_channel_allowlist", [])


def _youtube_search_request(query: str, max_results: int, channel_id: str | None = None) -> list[dict]:
    params = {
        "part": "snippet", "q": query, "type": "video", "maxResults": max_results,
        "safeSearch": "strict", "key": settings.YOUTUBE_DATA_API_KEY,
    }
    if channel_id:
        params["channelId"] = channel_id
    resp = httpx.get(YOUTUBE_SEARCH_BASE, params=params, timeout=10.0)
    resp.raise_for_status()
    data = resp.json()

    results = []
    for item in data.get("items", []):
        snippet = item.get("snippet", {})
        video_id = item.get("id", {}).get("videoId", "")
        results.append({
            "external_id": video_id,
            "type": "video",
            # YouTube Data API's own documented quirk: `snippet.title`/
            # `snippet.description` come back HTML-entity-escaped ("&amp;"
            # for a literal "&", etc.) — real, reported bug (Kiefer,
            # 2026-09-24): titles like "Law & Order" were showing up in the
            # moderator console literally as "Law &amp; Order" because
            # nothing ever decoded them. Decode once here, at ingestion,
            # so every downstream reader (catalogue, AI triage, the child-
            # facing title) gets clean plain text instead of each needing
            # to know about this API's encoding behaviour itself.
            "title": html.unescape(snippet.get("title", "Untitled")),
            "description": html.unescape(snippet.get("description", "") or ""),
            "channel": snippet.get("channelTitle"),
            "channel_id": snippet.get("channelId"),
            "thumbnail": (snippet.get("thumbnails", {}).get("medium") or {}).get("url"),
            # Bare video id, not the full watch URL — models.py's own
            # Recommendation.external_ref docstring: "YouTube id for videos".
            # ChildChat.jsx's video overlay builds the embed URL itself
            # (`youtube.com/embed/{external_ref}`), so a full URL here would
            # silently break the "Watch" button.
            "external_ref": video_id or None,
        })
    return results


def search_videos(query: str, max_results: int = 10) -> list[dict]:
    """CM03/CM06 import-candidate search, `safeSearch=strict`. URS Design
    Constraint 5: YouTube content must come from a curated allowlist, not
    open search — honoured via
    `system.integrations.youtube_channel_allowlist` (admin-editable, SA09):
    when the admin has curated a list of channel ids, search is scoped to
    just those channels (one API call per channel, merged/deduped). The
    out-of-the-box empty list still falls back to an open `safeSearch=strict`
    search — curating the real list is an editorial decision for the content
    team, not something this pass can invent — but every result, allowlisted
    or not, still goes through a moderator's explicit import + approve
    (CM06/07) before it's ever recommendable, so nothing here is a live gap
    in what a child can actually receive."""
    if not settings.YOUTUBE_DATA_API_KEY:
        return []

    allowlist = _youtube_channel_allowlist()
    if not allowlist:
        return _youtube_search_request(query, max_results)

    merged: list[dict] = []
    seen_ids: set[str] = set()
    for channel_id in allowlist:
        for result in _youtube_search_request(query, max_results, channel_id=channel_id):
            if result["external_id"] and result["external_id"] not in seen_ids:
                seen_ids.add(result["external_id"])
                merged.append(result)
    return merged[:max_results]


def _youtube_kid_flags(video_ids: list[str]) -> dict[str, dict]:
    """videos.list `status` for a batch of ids -> {id: {made_for_kids, embeddable}}.
    Empty on any failure (callers then treat every video as unverified)."""
    if not video_ids or not settings.YOUTUBE_DATA_API_KEY:
        return {}
    try:
        resp = httpx.get(
            "https://www.googleapis.com/youtube/v3/videos",
            params={"part": "status", "id": ",".join(video_ids), "key": settings.YOUTUBE_DATA_API_KEY},
            timeout=10.0,
        )
        resp.raise_for_status()
        return {
            v["id"]: {
                "made_for_kids": (v.get("status") or {}).get("madeForKids"),
                "embeddable": (v.get("status") or {}).get("embeddable"),
            }
            for v in resp.json().get("items", [])
        }
    except Exception:
        return {}


def search_for_import(topic: str, media_type: str, limit: int) -> list[dict]:
    """Bulk-import search: like search_books/search_videos but narrowed to what
    could plausibly be auto-triaged — English print books, and for videos the
    `madeForKids` / `embeddable` flags attached so the triage gate can require
    them. Over-fetches (the caller drops duplicates and stops at `limit`)."""
    fetch = min(limit * 3, 40)
    if media_type == "book":
        return search_books(f"{topic} subject:juvenile", max_results=fetch)
    results = search_videos(f"{topic} for kids", max_results=min(fetch, 25))
    flags = _youtube_kid_flags([r["external_id"] for r in results])
    return [{**r, **flags.get(r["external_id"], {"made_for_kids": None, "embeddable": None})} for r in results]
