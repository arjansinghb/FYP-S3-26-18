"""Auto-importing a requested topic on its own once it's popular enough
(POST /api/content/topic-requests/auto-import) — the answer to "a
moderator can't click Auto-import one by one through a huge backlog of
requested topics" (Kiefer, 2026-09-23).

These tests mock bulk_import.run() itself — its own internal AI-triage/
safety-gate decision-making is already covered by test_bulk_import.py.
What's under test here is different: WHICH topic gets picked, WHEN
(the request threshold), that it only ever runs once per topic (so a
moderator's dashboard polling this doesn't re-run the same search/AI
call forever), and that it's a POST (a mutating endpoint the app's
persist-after-mutating-verbs middleware actually saves), not folded into
the read-only GET /topic-requests list.
"""
import pytest
from fastapi.testclient import TestClient

from app import bulk_import


@pytest.fixture()
def clean_topics():
    from app.storage import db

    before = list(db.topic_misses)
    db.topic_misses.clear()
    yield db
    db.topic_misses[:] = before


def test_below_threshold_does_nothing(client: TestClient, moderator: dict, clean_topics, monkeypatch):
    calls = []
    monkeypatch.setattr(bulk_import, "run", lambda *a, **k: calls.append(a) or {})
    clean_topics.record_topic_miss("mermaids", "book")
    clean_topics.record_topic_miss("mermaids", "book")  # count 2, threshold is 3
    r = client.post("/api/content/topic-requests/auto-import", headers=moderator["headers"])
    assert r.status_code == 200
    assert r.json() == {"imported_topic": None}
    assert calls == []


def test_at_threshold_triggers_the_real_pipeline_and_stamps_the_row(client: TestClient, moderator: dict, clean_topics, monkeypatch):
    calls = []
    monkeypatch.setattr(bulk_import, "run", lambda topic, fmt, **k: calls.append((topic, fmt)) or {"approved": 1})
    for _ in range(3):
        clean_topics.record_topic_miss("mermaids", "book")

    r = client.post("/api/content/topic-requests/auto-import", headers=moderator["headers"])
    assert r.json() == {"imported_topic": "mermaids"}
    assert calls == [("mermaids", "book")]
    row = next(x for x in clean_topics.topic_misses if x["key"] == "mermaid")
    assert row["auto_imported"] is True


def test_only_runs_once_per_topic(client: TestClient, moderator: dict, clean_topics, monkeypatch):
    calls = []
    monkeypatch.setattr(bulk_import, "run", lambda *a, **k: calls.append(a) or {})
    for _ in range(3):
        clean_topics.record_topic_miss("mermaids", "book")

    client.post("/api/content/topic-requests/auto-import", headers=moderator["headers"])
    r2 = client.post("/api/content/topic-requests/auto-import", headers=moderator["headers"])
    assert r2.json() == {"imported_topic": None}
    assert len(calls) == 1  # the 2nd call found nothing new to do


def test_picks_the_single_highest_count_eligible_topic(client: TestClient, moderator: dict, clean_topics, monkeypatch):
    """Both cross the threshold — only the more-requested one runs this call;
    the other gets its turn on a later call, once this one is stamped."""
    calls = []
    monkeypatch.setattr(bulk_import, "run", lambda topic, fmt, **k: calls.append(topic) or {})
    for _ in range(3):
        clean_topics.record_topic_miss("mermaids", "book")
    for _ in range(5):
        clean_topics.record_topic_miss("unicorns", "book")

    r = client.post("/api/content/topic-requests/auto-import", headers=moderator["headers"])
    assert r.json() == {"imported_topic": "unicorns"}
    assert calls == ["unicorns"]


def test_a_topic_already_covered_by_approved_content_is_not_selected(client: TestClient, moderator: dict, clean_topics, monkeypatch):
    """"dinosaur" is a real genre in the seeded catalogue — even past
    threshold, it's not an open gap, so it must never be picked; "mermaids"
    (genuinely uncovered) should win instead."""
    calls = []
    monkeypatch.setattr(bulk_import, "run", lambda topic, fmt, **k: calls.append(topic) or {})
    for _ in range(3):
        clean_topics.record_topic_miss("mermaids", "book")
    for _ in range(5):
        clean_topics.record_topic_miss("dinosaur", "book")

    r = client.post("/api/content/topic-requests/auto-import", headers=moderator["headers"])
    assert r.json() == {"imported_topic": "mermaids"}
    assert calls == ["mermaids"]


def test_a_failing_import_still_counts_as_attempted(client: TestClient, moderator: dict, clean_topics, monkeypatch):
    """A search/AI-call failure (network hiccup, AI outage) must not turn
    into an endless retry loop on every future dashboard load — it's left
    for the moderator's own manual "Auto-import" instead."""
    def boom(*a, **k):
        raise RuntimeError("network hiccup")

    monkeypatch.setattr(bulk_import, "run", boom)
    for _ in range(3):
        clean_topics.record_topic_miss("mermaids", "book")

    r = client.post("/api/content/topic-requests/auto-import", headers=moderator["headers"])
    assert r.status_code == 200
    assert r.json() == {"imported_topic": "mermaids"}
    row = next(x for x in clean_topics.topic_misses if x["key"] == "mermaid")
    assert row["auto_imported"] is True

    r2 = client.post("/api/content/topic-requests/auto-import", headers=moderator["headers"])
    assert r2.json() == {"imported_topic": None}


def test_only_moderators_can_trigger_auto_import(client: TestClient, active_parent: dict):
    assert client.post("/api/content/topic-requests/auto-import", headers=active_parent["headers"]).status_code == 403
    assert client.post("/api/content/topic-requests/auto-import").status_code in (401, 403)
