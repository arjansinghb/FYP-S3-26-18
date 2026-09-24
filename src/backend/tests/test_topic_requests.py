"""Unmet demand: when Pip has to say "Oops, nothing about X", the topic is
tallied so moderators can see what to import next (GET /api/content/topic-requests).
Aggregate only — no child id, session or message text is ever stored.
"""
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import brain as brain_module
from app.brain import BrainResult, OpenAIBrain, PlaceholderBrain, clean_missed_topic, topic_is_covered

CATALOGUE = [
    {"id": "b1", "type": "book", "title": "The Dragon Who Sneezed", "description": "A giggly dragon.", "genres": ["funny"]},
    {"id": "b2", "type": "book", "title": "Luna's Moon Trip", "description": "A rocket to the moon.", "genres": ["space"]},
]


# ---- cleaning what the model says the topic was ----

@pytest.mark.parametrize("raw, expected", [
    ("pirates", "pirates"),
    ("  Pirate Ships ", "pirate ships"),
    ("a book about dinosaurs", "dinosaurs"),
    ("the ocean", "ocean"),
    ("robots", "robots"),
    ("spider-man", "spider-man"),
])
def test_clean_missed_topic_keeps_plain_topics(raw, expected):
    assert clean_missed_topic(raw) == expected


@pytest.mark.parametrize("raw", [
    None, 5, "", "   ", "book", "email me at a@b.com", "https://x.example", "call 91234567",
    "one two three four", "x", "how do I get to the moon and back again",
])
def test_clean_missed_topic_drops_anything_that_is_not_a_topic(raw):
    assert clean_missed_topic(raw) is None


def test_topic_is_covered_looks_at_title_description_and_genres():
    assert topic_is_covered("dragons", CATALOGUE)      # title/description, plural-tolerant
    assert topic_is_covered("space", CATALOGUE)        # genre
    assert topic_is_covered("moon rocket", CATALOGUE)  # every word present in one item
    assert not topic_is_covered("pirates", CATALOGUE)
    assert not topic_is_covered("dragon pirates", CATALOGUE)


# ---- what each brain reports ----

def test_mock_brain_reports_the_missed_topic_and_format():
    result = PlaceholderBrain().respond("Do you have a book about dinosaurs?", "5-8", CATALOGUE)
    assert result.missed_topic == "dinosaur" and result.missed_format == "book"


def test_mock_brain_reports_nothing_when_it_recommends():
    result = PlaceholderBrain().respond("a funny book please", "5-8", CATALOGUE)
    assert result.recommendations and result.missed_topic is None


def _openai_brain(payload: dict) -> OpenAIBrain:
    completions = SimpleNamespace(create=lambda **kw: SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(payload)))]))
    brain = OpenAIBrain.__new__(OpenAIBrain)
    brain._client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    brain._model = "fake"
    return brain


def test_openai_brain_reads_the_missing_field(monkeypatch):
    monkeypatch.setattr(brain_module.embeddings, "embed_text", lambda text: None)
    brain = _openai_brain({"reply": "Oops, no pirates!", "picks": [], "missing": {"topic": "Pirates", "format": "video"}})
    result = brain.respond("a video about pirates", "5-8", CATALOGUE)
    assert (result.missed_topic, result.missed_format) == ("pirates", "video")


def test_openai_brain_ignores_missing_when_it_recommended_something(monkeypatch):
    monkeypatch.setattr(brain_module.embeddings, "embed_text", lambda text: None)
    brain = _openai_brain({"reply": "Try this!", "picks": [{"index": 0, "why": "fun"}],
                           "missing": {"topic": "pirates", "format": "book"}})
    assert brain.respond("pirates", "5-8", CATALOGUE).missed_topic is None


def test_openai_brain_survives_a_malformed_missing_field(monkeypatch):
    monkeypatch.setattr(brain_module.embeddings, "embed_text", lambda text: None)
    for bad in ("pirates", ["pirates"], {"topic": "https://evil.example"}, {"format": "book"}):
        brain = _openai_brain({"reply": "Oops!", "picks": [], "missing": bad})
        assert brain.respond("pirates", "5-8", CATALOGUE).missed_topic is None


# ---- end to end: tally -> endpoint -> drops off once covered ----

def _fake_brain(topic, fmt="book"):
    class Fake:
        def respond(self, *args, **kwargs):
            return BrainResult(reply="Oops, there isn't any of that yet!", recommendations=[],
                               missed_topic=topic, missed_format=fmt)
    return Fake()


def test_misses_are_tallied_grouped_and_listed_for_moderators(client: TestClient, child_session: dict, moderator: dict, monkeypatch):
    from app.routers import chat as chat_router
    from app.storage import db

    db.topic_misses.clear()
    for topic, fmt in [("pirates", "book"), ("pirate", "video"), ("pirates", "book"), ("volcanoes", "video")]:
        monkeypatch.setattr(chat_router, "get_brain", lambda t=topic, f=fmt: _fake_brain(t, f))
        assert client.post("/api/chat", headers=child_session["headers"], json={"message": "a fresh request"}).status_code == 200

    r = client.get("/api/content/topic-requests", headers=moderator["headers"])
    assert r.status_code == 200
    rows = r.json()
    assert [(x["topic"], x["count"]) for x in rows] == [("pirates", 3), ("volcanoes", 1)]  # pirate/pirates merged, most-asked first
    assert rows[0]["formats"] == {"book": 2, "video": 1, "any": 0} and rows[0]["format"] == "book"
    assert rows[1]["format"] == "video"

    # aggregate only: nothing that identifies the child or what they typed
    stored = json.dumps(db.topic_misses)
    assert child_session["child"]["id"] not in stored and "a fresh request" not in stored


def test_a_topic_the_child_could_already_be_shown_is_not_a_miss(client: TestClient, child_session: dict, monkeypatch):
    from app.routers import chat as chat_router
    from app.storage import db

    db.topic_misses.clear()
    covered = db.approved_content()[0]["genres"][0]  # a genre real approved content already has
    monkeypatch.setattr(chat_router, "get_brain", lambda: _fake_brain(covered, "any"))
    client.post("/api/chat", headers=child_session["headers"], json={"message": "something else"})
    assert db.topic_misses == []


def test_a_gap_is_judged_per_format(client: TestClient, child_session: dict, moderator: dict, monkeypatch):
    """Asked for a VIDEO on a topic that only has books: that's still a gap."""
    from app.routers import chat as chat_router
    from app.storage import db

    db.topic_misses.clear()
    db.content["only-book"] = {"id": "only-book", "type": "book", "title": "Volcano Tales", "description": "Lava!",
                               "age_bands": ["5-8", "9-12"], "genres": ["volcanoes"], "status": "approved"}
    try:
        monkeypatch.setattr(chat_router, "get_brain", lambda: _fake_brain("volcanoes", "video"))
        client.post("/api/chat", headers=child_session["headers"], json={"message": "a video about volcanoes"})
        rows = client.get("/api/content/topic-requests", headers=moderator["headers"]).json()
        assert [(x["topic"], x["format"]) for x in rows] == [("volcanoes", "video")]

        db.topic_misses.clear()
        monkeypatch.setattr(chat_router, "get_brain", lambda: _fake_brain("volcanoes", "book"))
        client.post("/api/chat", headers=child_session["headers"], json={"message": "a book about volcanoes"})
        assert db.topic_misses == []  # the book exists, so a book request isn't a miss
    finally:
        db.content.pop("only-book", None)


def test_a_gap_disappears_once_approved_content_covers_it(client: TestClient, moderator: dict):
    from app.storage import db

    db.topic_misses.clear()
    db.record_topic_miss("narwhals", "book")
    assert [x["topic"] for x in client.get("/api/content/topic-requests", headers=moderator["headers"]).json()] == ["narwhals"]

    r = client.post("/api/content", headers=moderator["headers"], json={
        "type": "book", "title": "Narwhals of the Deep", "description": "Unicorns of the sea.",
        "age_bands": ["5-8"], "genres": ["ocean"]})
    assert r.status_code == 201  # moderator-added entries land approved
    assert client.get("/api/content/topic-requests", headers=moderator["headers"]).json() == []


def test_topic_requests_include_auto_import_progress(client: TestClient, moderator: dict):
    """The dashboard needs to tell a below-threshold row (still waiting on
    more asks) apart from one that already had its one automatic shot —
    real confusion found in practice (Kiefer, 2026-09-24): every row looked
    identical, so the manual "Auto-import" button being present on every
    single one read as the automation being broken, when it was actually
    working as designed."""
    from app.storage import db
    from app.routers.content import _AUTO_IMPORT_THRESHOLD

    db.topic_misses.clear()
    db.record_topic_miss("wombats", "book")  # a topic no other test in this file ever turns into real content
    row = next(r for r in db.topic_misses if r["topic"] == "wombats")
    row["auto_imported"] = True

    rows = client.get("/api/content/topic-requests", headers=moderator["headers"]).json()
    assert rows[0]["auto_import_threshold"] == _AUTO_IMPORT_THRESHOLD
    assert rows[0]["auto_imported"] is True


def test_topic_requests_auto_imported_defaults_false(client: TestClient, moderator: dict):
    from app.storage import db

    db.topic_misses.clear()
    db.record_topic_miss("wallabies", "book")

    rows = client.get("/api/content/topic-requests", headers=moderator["headers"]).json()
    assert rows[0]["auto_imported"] is False


def test_only_moderators_can_see_topic_requests(client: TestClient, child_session: dict, active_parent: dict):
    assert client.get("/api/content/topic-requests", headers=active_parent["headers"]).status_code == 403
    assert client.get("/api/content/topic-requests", headers=child_session["headers"]).status_code in (401, 403)
    assert client.get("/api/content/topic-requests").status_code in (401, 403)


def test_a_moderator_can_dismiss_a_topic_request(client: TestClient, moderator: dict):
    from app.storage import db

    db.topic_misses.clear()
    db.record_topic_miss("narwhals", "book")
    db.record_topic_miss("volcanoes", "video")

    r = client.delete("/api/content/topic-requests/narwhal", headers=moderator["headers"])
    assert r.status_code == 204
    remaining = [x["topic"] for x in client.get("/api/content/topic-requests", headers=moderator["headers"]).json()]
    assert remaining == ["volcanoes"]  # only the dismissed one is gone


def test_dismissing_an_already_gone_topic_is_still_a_204(client: TestClient, moderator: dict):
    from app.storage import db

    db.topic_misses.clear()
    assert client.delete("/api/content/topic-requests/nonexistent", headers=moderator["headers"]).status_code == 204


def test_only_moderators_can_dismiss_topic_requests(client: TestClient, active_parent: dict):
    assert client.delete("/api/content/topic-requests/x", headers=active_parent["headers"]).status_code == 403
    assert client.delete("/api/content/topic-requests/x").status_code in (401, 403)
