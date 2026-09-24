"""Google Books / YouTube search clients (app/content_sources.py) decode
HTML entities in titles and descriptions before returning them — a real,
reported bug (Kiefer, 2026-09-24): YouTube's Data API returns `snippet.title`
HTML-escaped (e.g. "Law &amp; Order" for a literal "Law & Order"), and
nothing ever decoded it, so it showed up in the moderator console literally
as "&amp;". Confirmed live: 6 real catalogue items already had raw entities
in their stored titles.
"""
import httpx

from app import content_sources
from app.config import settings


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def test_search_videos_decodes_html_entities(monkeypatch):
    monkeypatch.setattr(settings, "YOUTUBE_DATA_API_KEY", "fake-key")
    monkeypatch.setattr(content_sources, "_youtube_channel_allowlist", lambda: [])
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _FakeResponse({
        "items": [{
            "id": {"videoId": "abc123"},
            "snippet": {
                "title": "When Kids Kill: Dangerous Kids Vol. 2 | Law &amp; Order",
                "description": "It&#39;s a &quot;crime&quot; story",
                "channelTitle": "Some Channel", "channelId": "chan1",
                "thumbnails": {"medium": {"url": "https://img.example/1.jpg"}},
            },
        }],
    }))

    results = content_sources.search_videos("killing people")

    assert results[0]["title"] == "When Kids Kill: Dangerous Kids Vol. 2 | Law & Order"
    assert results[0]["description"] == 'It\'s a "crime" story'


def test_search_books_decodes_html_entities(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_BOOKS_API_KEY", "fake-key")
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _FakeResponse({
        "items": [{
            "id": "g1",
            "volumeInfo": {
                "title": "Kids&#39; Guide to Gun Safety &amp; Fun",
                "description": "Learn &amp; grow",
            },
        }],
    }))

    results = content_sources.search_books("gun safety")

    assert results[0]["title"] == "Kids' Guide to Gun Safety & Fun"
    assert results[0]["description"] == "Learn & grow"


def test_search_videos_with_plain_text_is_unaffected(monkeypatch):
    monkeypatch.setattr(settings, "YOUTUBE_DATA_API_KEY", "fake-key")
    monkeypatch.setattr(content_sources, "_youtube_channel_allowlist", lambda: [])
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _FakeResponse({
        "items": [{
            "id": {"videoId": "abc123"},
            "snippet": {
                "title": "Ordinary Title", "description": "Ordinary description",
                "channelTitle": "Some Channel", "channelId": "chan1", "thumbnails": {},
            },
        }],
    }))

    results = content_sources.search_videos("something")

    assert results[0]["title"] == "Ordinary Title"
    assert results[0]["description"] == "Ordinary description"
