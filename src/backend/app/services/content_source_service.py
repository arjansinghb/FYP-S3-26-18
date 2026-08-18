"""Google Books API + YouTube Data API v3 clients — search-only, used by the
moderator console (CM03/CM06) to find import candidates. Ingestion-time only,
never called at chat time — see agent-context/CLAUDE.md §2.1/§5's "curated
catalogue, never a live open query" rule. A moderator still has to explicitly
approve each item (CM07) before it's ever recommendable (CLAUDE.md §3 point 1).

**YouTube channel allowlist** (dev-session 2026-08-11 — closes a previously
flagged gap): CLAUDE.md §5 describes the YouTube source as "restricted to a
curated allowlist of vetted channel/source IDs". `search_videos` now honours
`SystemSettings.youtube_channel_allowlist` (SA13, see app/models/admin.py) —
when an admin has curated one, search is scoped to just those channels (one
YouTube API call per channel, merged); when the list is still empty (the
out-of-the-box state — curating a real list of vetted kids' channels is an
editorial decision for the team, not something this pass can invent), it
falls back to the previous open `safeSearch=strict` search. CM06/CM07's human
review is still a real gate either way; the allowlist narrows what a
moderator sees to search *from* in the first place.
"""
from __future__ import annotations

import httpx

from app.core.config import get_settings
from app.models.admin import SystemSettings
from app.repositories.store import COLLECTION_SYSTEM_SETTINGS, get_store

GOOGLE_BOOKS_BASE = "https://www.googleapis.com/books/v1/volumes"
YOUTUBE_SEARCH_BASE = "https://www.googleapis.com/youtube/v3/search"


def _youtube_channel_allowlist() -> list[str]:
    doc = get_store().get(COLLECTION_SYSTEM_SETTINGS, "default")
    settings = SystemSettings(**doc) if doc else SystemSettings()
    return settings.youtube_channel_allowlist


def search_books(query: str, max_results: int = 10) -> list[dict]:
    settings = get_settings()
    resp = httpx.get(
        GOOGLE_BOOKS_BASE,
        params={"q": query, "maxResults": max_results, "key": settings.google_books_api_key},
        timeout=10.0,
    )
    resp.raise_for_status()
    data = resp.json()

    results = []
    for item in data.get("items", []):
        info = item.get("volumeInfo", {})
        results.append(
            {
                "external_id": item.get("id", ""),
                "title": info.get("title", "Untitled"),
                "synopsis": info.get("description", "") or "",
                "authors": info.get("authors", []),
                "thumbnail": info.get("imageLinks", {}).get("thumbnail"),
                "source_url": info.get("infoLink") or info.get("previewLink"),
                "categories": info.get("categories", []),
            }
        )
    return results


def _youtube_search_request(query: str, max_results: int, channel_id: str | None = None) -> list[dict]:
    settings = get_settings()
    params = {
        "part": "snippet",
        "q": query,
        "type": "video",
        "maxResults": max_results,
        "safeSearch": "strict",
        "key": settings.youtube_data_api_key,
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
        results.append(
            {
                "external_id": video_id,
                "title": snippet.get("title", "Untitled"),
                "synopsis": snippet.get("description", "") or "",
                "channel": snippet.get("channelTitle"),
                "channel_id": snippet.get("channelId"),
                "thumbnail": (snippet.get("thumbnails", {}).get("medium") or {}).get("url"),
                "source_url": f"https://www.youtube.com/watch?v={video_id}" if video_id else None,
            }
        )
    return results


def search_videos(query: str, max_results: int = 10) -> list[dict]:
    """CM03/CM06 import-candidate search. Scoped to
    `SystemSettings.youtube_channel_allowlist` when an admin has curated one
    — see module docstring — otherwise an open safeSearch=strict search."""
    allowlist = _youtube_channel_allowlist()
    if not allowlist:
        return _youtube_search_request(query, max_results)

    # One request per allowed channel, merged — the YouTube Data API's
    # `channelId` param only accepts a single channel, not a list. Small
    # curated lists (the whole point of "curated") keep this to a handful of
    # calls; each still asks for up to `max_results` so a channel with
    # several matches isn't starved by ones with none.
    merged: list[dict] = []
    seen_ids: set[str] = set()
    for channel_id in allowlist:
        for result in _youtube_search_request(query, max_results, channel_id=channel_id):
            if result["external_id"] and result["external_id"] not in seen_ids:
                seen_ids.add(result["external_id"])
                merged.append(result)
    return merged[:max_results]
