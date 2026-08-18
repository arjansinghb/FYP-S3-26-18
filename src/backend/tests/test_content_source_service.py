"""YouTube channel allowlist (SA13 — Manage Billing System Configuration also
covers this settings doc; see content_source_service.py's module docstring).
Patches httpx.get directly — no real network call, no real API key needed.
"""
from __future__ import annotations

from app.services import content_source_service


class _FakeResponse:
    def __init__(self, items: list[dict]) -> None:
        self._items = items

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return {"items": self._items}


def _video_item(video_id: str, channel_id: str, title: str = "A Video") -> dict:
    return {
        "id": {"videoId": video_id},
        "snippet": {"title": title, "description": "", "channelTitle": "Ch", "channelId": channel_id, "thumbnails": {}},
    }


def test_search_videos_open_when_no_allowlist(monkeypatch) -> None:
    calls = []

    def fake_get(url, params, timeout):
        calls.append(params)
        return _FakeResponse([_video_item("vid1", "channelA")])

    monkeypatch.setattr(content_source_service.httpx, "get", fake_get)
    monkeypatch.setattr(content_source_service, "_youtube_channel_allowlist", lambda: [])

    results = content_source_service.search_videos("dinosaurs")
    assert len(calls) == 1
    assert "channelId" not in calls[0]
    assert results[0]["external_id"] == "vid1"


def test_search_videos_scoped_to_allowlist(monkeypatch) -> None:
    calls = []

    def fake_get(url, params, timeout):
        calls.append(params)
        cid = params.get("channelId")
        return _FakeResponse([_video_item(f"vid-{cid}", cid)])

    monkeypatch.setattr(content_source_service.httpx, "get", fake_get)
    monkeypatch.setattr(content_source_service, "_youtube_channel_allowlist", lambda: ["channelA", "channelB"])

    results = content_source_service.search_videos("dinosaurs", max_results=10)

    assert len(calls) == 2  # one request per allowed channel
    assert {c["channelId"] for c in calls} == {"channelA", "channelB"}
    assert {r["external_id"] for r in results} == {"vid-channelA", "vid-channelB"}


def test_search_videos_dedupes_and_caps_at_max_results(monkeypatch) -> None:
    def fake_get(url, params, timeout):
        # Same video shows up from both "allowed" channels — should be deduped.
        return _FakeResponse([_video_item("dupe", params.get("channelId"))])

    monkeypatch.setattr(content_source_service.httpx, "get", fake_get)
    monkeypatch.setattr(content_source_service, "_youtube_channel_allowlist", lambda: ["channelA", "channelB"])

    results = content_source_service.search_videos("dinosaurs", max_results=10)
    assert len(results) == 1
