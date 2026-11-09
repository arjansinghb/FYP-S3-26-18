"""CM03 — the AI pre-screen over Google Books/YouTube search results (the
supervisor's "an AI that will filter out content that would be rejected by
the moderator"). Flags, never removes; fails open when the AI is unavailable.
"""
from fastapi.testclient import TestClient

from app import ai_assist, content_sources

RESULTS = [
    {"external_id": "a", "type": "book", "title": "The Very Sleepy Bear", "description": "A gentle bedtime story."},
    {"external_id": "b", "type": "book", "title": "Advanced Corporate Tax Law", "description": "A graduate textbook."},
    {"external_id": "c", "type": "book", "title": "Blood Harvest", "description": "An adult horror novel."},
]


def test_screen_flags_only_what_the_ai_says_to_reject(monkeypatch):
    monkeypatch.setattr(ai_assist, "_chat_json", lambda system, user: {"verdicts": [
        {"index": 0, "reject": False},
        {"index": 1, "reject": True, "reason": "A graduate textbook, not for children."},
        {"index": 2, "reject": True, "reason": "Adult horror."},
        {"index": 99, "reject": True, "reason": "out of range — must be ignored"},
    ]})
    out = ai_assist.screen_import_candidates(RESULTS, "book")
    assert [r["ai_filtered"] for r in out] == [False, True, True]
    assert out[1]["ai_filter_reason"] == "A graduate textbook, not for children."
    assert len(out) == len(RESULTS)  # nothing is dropped, only flagged


def test_screen_fails_open_when_the_ai_is_unavailable(monkeypatch):
    monkeypatch.setattr(ai_assist, "_chat_json", lambda system, user: None)
    out = ai_assist.screen_import_candidates(RESULTS, "book")
    assert all(r["ai_filtered"] is False for r in out)


def test_search_endpoint_returns_the_flags(client: TestClient, moderator: dict, monkeypatch):
    monkeypatch.setattr(content_sources, "search_books", lambda q, start_index=0: [dict(r) for r in RESULTS])
    monkeypatch.setattr(ai_assist, "_chat_json", lambda system, user: {"verdicts": [
        {"index": 2, "reject": True, "reason": "Adult horror."},
    ]})
    r = client.get("/api/content/search/books", params={"q": "bears"}, headers=moderator["headers"])
    assert r.status_code == 200
    body = r.json()
    assert [x["ai_filtered"] for x in body] == [False, False, True]
    assert body[2]["ai_filter_reason"] == "Adult horror."
