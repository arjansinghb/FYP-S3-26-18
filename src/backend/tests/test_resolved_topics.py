"""Resurfacing a topic Pip once had to say "Oops" to a specific child about,
once real approved content actually covers it (GET /api/chat/resolved-topics,
app/brain.py's covering_item) — the "pick up where you left off" continuity
extended to a gap that's since been filled (Kiefer, 2026-09-24).
"""
from fastapi.testclient import TestClient

from app.brain import covering_item


# ---- covering_item, directly ----

CATALOGUE = [
    {"id": "b1", "type": "book", "title": "The Dragon Who Sneezed", "description": "A giggly dragon.", "genres": ["funny"]},
    {"id": "b2", "type": "book", "title": "Luna's Moon Trip", "description": "A rocket to the moon.", "genres": ["space"]},
    {"id": "v1", "type": "video", "title": "Mermaid Tales", "description": "Under the sea adventures.", "genres": ["ocean"]},
]


def test_covering_item_returns_the_matching_item():
    assert covering_item("dragons", CATALOGUE)["id"] == "b1"
    assert covering_item("mermaids", CATALOGUE)["id"] == "v1"


def test_covering_item_is_none_when_nothing_matches():
    assert covering_item("pirates", CATALOGUE) is None


def test_covering_item_respects_format():
    assert covering_item("mermaids", CATALOGUE, "video")["id"] == "v1"
    assert covering_item("mermaids", CATALOGUE, "book") is None


def test_covering_item_with_no_real_words_returns_none():
    assert covering_item("!!!", CATALOGUE) is None


# ---- the endpoint ----

def test_returns_null_with_no_activity(client: TestClient, child_session: dict):
    from app.storage import db

    db.activity[child_session["child"]["id"]] = []
    db.children[child_session["child"]["id"]]["notified_resolved_topics"] = []
    assert client.get("/api/chat/resolved-topics", headers=child_session["headers"]).json() is None


def test_returns_null_when_the_missed_topic_still_is_not_covered(client: TestClient, child_session: dict):
    from app.storage import db

    cid = child_session["child"]["id"]
    db.children[cid]["notified_resolved_topics"] = []
    db.activity[cid] = [{"session_id": "s1", "message": "x", "reply": "y", "rec_ids": [], "missed_topic": "zzznotcovered"}]
    assert client.get("/api/chat/resolved-topics", headers=child_session["headers"]).json() is None


def test_surfaces_a_now_covered_topic(client: TestClient, child_session: dict):
    from app.storage import db

    cid = child_session["child"]["id"]
    real_item = db.approved_content()[0]
    real_genre = real_item["genres"][0]
    db.children[cid]["notified_resolved_topics"] = []
    db.activity[cid] = [{"session_id": "s1", "message": "x", "reply": "y", "rec_ids": [], "missed_topic": real_genre}]

    r = client.get("/api/chat/resolved-topics", headers=child_session["headers"])
    body = r.json()
    assert body["topic"] == real_genre
    assert body["item"]["id"] in {c["id"] for c in db.approved_content()}

    # the GET is read-only — asking again (nothing acked yet) still returns it
    assert client.get("/api/chat/resolved-topics", headers=child_session["headers"]).json()["topic"] == real_genre


def test_acking_a_topic_stops_it_being_resurfaced(client: TestClient, child_session: dict):
    from app.storage import db

    cid = child_session["child"]["id"]
    real_item = db.approved_content()[0]
    real_genre = real_item["genres"][0]
    db.children[cid]["notified_resolved_topics"] = []
    db.activity[cid] = [{"session_id": "s1", "message": "x", "reply": "y", "rec_ids": [], "missed_topic": real_genre}]

    r = client.post("/api/chat/resolved-topics/ack", headers=child_session["headers"], json={"topic": real_genre})
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert db.children[cid]["notified_resolved_topics"] == [real_genre]
    assert client.get("/api/chat/resolved-topics", headers=child_session["headers"]).json() is None


def test_acking_the_same_topic_twice_does_not_duplicate_it(client: TestClient, child_session: dict):
    from app.storage import db

    cid = child_session["child"]["id"]
    db.children[cid]["notified_resolved_topics"] = []
    client.post("/api/chat/resolved-topics/ack", headers=child_session["headers"], json={"topic": "space"})
    client.post("/api/chat/resolved-topics/ack", headers=child_session["headers"], json={"topic": "space"})
    assert db.children[cid]["notified_resolved_topics"] == ["space"]


def test_ack_requires_a_child_session(client: TestClient):
    assert client.post("/api/chat/resolved-topics/ack", json={"topic": "space"}).status_code in (401, 403)


def test_an_older_covered_topic_is_found_even_behind_a_newer_uncovered_one(client: TestClient, child_session: dict):
    """Scans back past a still-uncovered recent miss to find an older one
    that IS covered now, instead of stopping at the very latest miss."""
    from app.storage import db

    cid = child_session["child"]["id"]
    real_item = db.approved_content()[0]
    real_genre = real_item["genres"][0]
    db.children[cid]["notified_resolved_topics"] = []
    db.activity[cid] = [
        {"session_id": "s1", "message": "x", "reply": "y", "rec_ids": [], "missed_topic": real_genre},
        {"session_id": "s1", "message": "x", "reply": "y", "rec_ids": [], "missed_topic": "zzzstillnotcovered"},
    ]
    body = client.get("/api/chat/resolved-topics", headers=child_session["headers"]).json()
    assert body["topic"] == real_genre


def test_requires_a_child_session(client: TestClient):
    assert client.get("/api/chat/resolved-topics").status_code in (401, 403)
