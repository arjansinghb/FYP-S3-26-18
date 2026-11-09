"""CH14's Details view getting a real synopsis, not just the one-line
recommendation `explanation` or the raw scraped catalogue `description`
(app/ai_assist.py's generate_synopsis) — "keliatan simple banget gada kek
sesuatu yang dibaca" (Kiefer, 2026-09-24): the Details overlay used to show
only the one-sentence reason a pick fit the request, nothing like an actual
summary of what the book/video is about.
"""
import pytest
from fastapi.testclient import TestClient

from app import ai_assist, bulk_import, moderation


# ---- generate_synopsis, directly ----

def test_generate_synopsis_returns_the_models_text(monkeypatch):
    monkeypatch.setattr(ai_assist, "_chat_json", lambda system, user: {"synopsis": "A brave little rock finds its voice."})
    assert ai_assist.generate_synopsis({"title": "Ricky the Rock"}) == "A brave little rock finds its voice."


def test_generate_synopsis_is_none_for_an_item_with_no_title():
    assert ai_assist.generate_synopsis({"title": ""}) is None
    assert ai_assist.generate_synopsis({}) is None


def test_generate_synopsis_is_none_when_the_model_is_unavailable(monkeypatch):
    monkeypatch.setattr(ai_assist, "_chat_json", lambda system, user: None)
    assert ai_assist.generate_synopsis({"title": "A Book"}) is None


def test_generate_synopsis_is_none_for_an_empty_or_oversized_response(monkeypatch):
    monkeypatch.setattr(ai_assist, "_chat_json", lambda system, user: {"synopsis": ""})
    assert ai_assist.generate_synopsis({"title": "A Book"}) is None
    monkeypatch.setattr(ai_assist, "_chat_json", lambda system, user: {"synopsis": "x" * 800})
    assert ai_assist.generate_synopsis({"title": "A Book"}) is None


def test_generate_synopsis_is_none_when_moderation_flags_the_result(monkeypatch):
    monkeypatch.setattr(ai_assist, "_chat_json", lambda system, user: {"synopsis": "Something bad."})
    monkeypatch.setattr(moderation, "is_unsafe", lambda text: True)
    assert ai_assist.generate_synopsis({"title": "A Book"}) is None


# ---- wired into content.py (add_entry / approve) ----

def test_adding_an_entry_generates_a_synopsis(client: TestClient, moderator: dict, monkeypatch):
    monkeypatch.setattr(ai_assist, "_chat_json", lambda system, user: {"synopsis": "A cosy tale."})
    r = client.post("/api/content", headers=moderator["headers"], json={
        "type": "book", "title": "Synopsis Test Book", "description": "raw scraped text",
        "age_bands": ["5-8"], "genres": ["cosy"],
    })
    assert r.status_code == 201
    assert r.json()["synopsis"] == "A cosy tale."


def test_approving_a_pending_item_generates_a_synopsis(client: TestClient, moderator: dict, monkeypatch):
    from app.storage import db

    item = db.add_content(
        {"type": "book", "title": "Pending Synopsis Book", "description": "raw", "age_bands": ["5-8"], "genres": []},
        status="pending",
    )
    monkeypatch.setattr(ai_assist, "_chat_json", lambda system, user: {"synopsis": "What it's really about."})
    r = client.post(f"/api/content/{item['id']}/approve", headers=moderator["headers"])
    assert r.status_code == 200
    assert r.json()["synopsis"] == "What it's really about."


def test_approving_never_overwrites_an_existing_synopsis(client: TestClient, moderator: dict, monkeypatch):
    from app.storage import db

    item = db.add_content(
        {"type": "book", "title": "Already Has One", "description": "raw", "age_bands": ["5-8"], "genres": [],
         "synopsis": "The original good synopsis."},
        status="pending",
    )

    def boom(system, user):
        raise AssertionError("must not call the model when a synopsis already exists")

    monkeypatch.setattr(ai_assist, "_chat_json", boom)
    r = client.post(f"/api/content/{item['id']}/approve", headers=moderator["headers"])
    assert r.json()["synopsis"] == "The original good synopsis."


def test_a_failed_generation_leaves_synopsis_unset_not_an_error(client: TestClient, moderator: dict, monkeypatch):
    monkeypatch.setattr(ai_assist, "_chat_json", lambda system, user: None)
    r = client.post("/api/content", headers=moderator["headers"], json={
        "type": "book", "title": "No Synopsis Book", "description": "raw", "age_bands": ["5-8"], "genres": [],
    })
    assert r.status_code == 201
    assert r.json()["synopsis"] is None


def test_overturning_a_rejection_to_approved_also_generates_a_synopsis(client: TestClient, moderator: dict, monkeypatch):
    """The one path that went live WITHOUT ever touching add_entry(),
    approve(), or bulk_import.run() — a moderator overturning the AI's own
    "reject" verdict during a post-hoc audit (POST /{id}/audit). Real gap
    found while confirming synopsis coverage was actually complete
    (Kiefer, 2026-09-24): this item would otherwise go live with no
    synopsis at all, forever, since nothing else would ever generate one
    for it after this point."""
    from app.storage import db

    item = db.add_content(
        {"type": "book", "title": "Overturned Rejection", "description": "raw", "age_bands": ["5-8"], "genres": []},
        status="rejected",
    )
    item["audit_status"] = "pending"
    monkeypatch.setattr(ai_assist, "_chat_json", lambda system, user: {"synopsis": "It was fine all along."})

    r = client.post(f"/api/content/{item['id']}/audit", headers=moderator["headers"], json={"decision": "overturn"})
    body = r.json()
    assert body["status"] == "approved"
    assert body["synopsis"] == "It was fine all along."


# ---- wired into bulk_import's auto-approve branch ----

LONG = "A warm, well told picture book about a curious little octopus who explores the reef with friends."


@pytest.fixture()
def catalogue(client: TestClient):
    from app.storage import db

    before = dict(db.content)
    yield db
    db.content.clear()
    db.content.update(before)


def test_bulk_import_auto_approved_items_get_a_synopsis(catalogue, monkeypatch):
    monkeypatch.setattr(bulk_import.content_sources, "search_for_import", lambda topic, media_type, limit: [{
        "external_id": "g1", "type": "book", "title": "Octopus Book 1", "description": LONG,
        "authors": ["A. Writer"], "thumbnail": "https://img.example/1.jpg",
        "external_ref": "https://books.example/1", "categories": ["Juvenile Fiction"], "maturity": "NOT_MATURE",
    }])
    monkeypatch.setattr(bulk_import.ai_assist, "triage_candidates", lambda cands, media_type, topic, vocab: [{
        "decision": "approve", "confidence": "high", "on_topic": True, "reason": "A gentle reef story.",
        "age_bands": ["5-8"], "genres": ["ocean"],
    }])
    monkeypatch.setattr(bulk_import.moderation, "flagged_many", lambda texts: [False for _ in texts])
    monkeypatch.setattr(bulk_import.embeddings, "embed_texts", lambda texts: [[0.1, 0.2]] * len(texts))
    monkeypatch.setattr(bulk_import.ai_assist, "generate_synopsis", lambda item: "A real synopsis for the octopus book.")

    result = bulk_import.run("octopus", "book")
    assert result["approved"] == 1
    item = catalogue.content[result["items"][0]["id"]]
    assert item["synopsis"] == "A real synopsis for the octopus book."


# ---- reaches the child as part of a recommendation ----

def test_recommendation_carries_the_synopsis_through_to_the_child(client: TestClient, child_session: dict, monkeypatch):
    from app.routers import chat as chat_router
    from app.brain import BrainResult
    from app.storage import db

    real_item = db.approved_content()[0]
    real_item["synopsis"] = "A real synopsis, distinct from the one-line reason."

    class Fake:
        def respond(self, *args, **kwargs):
            return BrainResult(reply="Here!", recommendations=[{
                "id": real_item["id"], "type": real_item["type"], "title": real_item["title"],
                "explanation": "Fits what you asked for.", "description": real_item.get("description", ""),
                "synopsis": real_item.get("synopsis"), "external_ref": None, "thumbnail": None,
                "genres": real_item.get("genres", []),
            }])

    monkeypatch.setattr(chat_router, "get_brain", lambda: Fake())
    r = client.post("/api/chat", headers=child_session["headers"], json={"message": "something fun"})
    rec = r.json()["recommendations"][0]
    assert rec["synopsis"] == "A real synopsis, distinct from the one-line reason."
    assert rec["explanation"] == "Fits what you asked for."
