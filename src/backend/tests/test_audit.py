"""QA audit: a random slice of bulk import's auto-triaged decisions (app/
bulk_import.py's AUDIT_SAMPLE_RATE) sit in GET /api/content/audit-queue for a
moderator to confirm or overturn (POST /{id}/audit) after the fact. This is a
post-hoc spot-check, not a second gate before publish — nothing here can keep
an item off the queue's other side; it can only catch a bad AI call later.
"""
import pytest
from fastapi.testclient import TestClient

from app import ai_assist, bulk_import, content_sources, embeddings, moderation

LONG = "A warm, well told picture book about a curious little octopus who explores the reef with friends."


def book(n, **over):
    return {"external_id": f"g{n}", "type": "book", "title": f"Octopus Book {n}", "description": LONG,
            "authors": ["A. Writer"], "thumbnail": f"https://img.example/{n}.jpg",
            "external_ref": f"https://books.example/{n}", "categories": ["Juvenile Fiction"],
            "maturity": "NOT_MATURE", **over}


def good(**over):
    return {"decision": "approve", "confidence": "high", "on_topic": True, "unsuitable": False,
            "reason": "A gentle reef story.", "age_bands": ["5-8"], "genres": ["ocean"], **over}


@pytest.fixture(autouse=True)
def fakes(monkeypatch):
    state = {"found": [], "verdicts": None, "flagged": set()}
    monkeypatch.setattr(content_sources, "search_for_import", lambda topic, media_type, limit: state["found"])
    monkeypatch.setattr(ai_assist, "triage_candidates",
                        lambda cands, media_type, topic, vocab: state["verdicts"] if state["verdicts"] is not None else [None] * len(cands))
    monkeypatch.setattr(moderation, "flagged_many",
                        lambda texts: [any(f in t for f in state["flagged"]) for t in texts])
    monkeypatch.setattr(embeddings, "embed_texts", lambda texts: [[0.1, 0.2]] * len(texts))
    monkeypatch.setattr(embeddings, "embed_text", lambda text: [0.3, 0.4])
    return state


@pytest.fixture()
def catalogue(client: TestClient):
    from app.storage import db

    before = dict(db.content)
    yield db
    db.content.clear()
    db.content.update(before)


def _always_sampled(monkeypatch):
    monkeypatch.setattr(bulk_import.random, "random", lambda: 0.0)  # < any positive rate


def _never_sampled(monkeypatch):
    monkeypatch.setattr(bulk_import.random, "random", lambda: 0.999)


# ---- sampling ----

def test_a_sampled_approved_item_lands_pending_audit(fakes, catalogue, monkeypatch):
    _always_sampled(monkeypatch)
    fakes["found"] = [book(1)]
    fakes["verdicts"] = [good()]
    result = bulk_import.run("octopus", "book")
    assert result["items"][0]["sampled_for_audit"] is True
    assert catalogue.content[result["items"][0]["id"]]["audit_status"] == "pending"


def test_an_unsampled_item_is_marked_not_sampled(fakes, catalogue, monkeypatch):
    _never_sampled(monkeypatch)
    fakes["found"] = [book(1)]
    fakes["verdicts"] = [good()]
    result = bulk_import.run("octopus", "book")
    assert result["items"][0]["sampled_for_audit"] is False
    assert catalogue.content[result["items"][0]["id"]]["audit_status"] == "not_sampled"


def test_a_pending_human_review_item_is_never_sampled(fakes, catalogue, monkeypatch):
    """Only decisions the AI made ALONE (approved/rejected) are audit
    candidates — a "needs review" item is about to be read by a human anyway."""
    _always_sampled(monkeypatch)
    fakes["found"] = [book(1)]
    fakes["verdicts"] = [{**good(), "confidence": "medium"}]  # -> pending
    result = bulk_import.run("octopus", "book")
    assert result["items"][0]["outcome"] == "pending"
    assert "audit_status" not in catalogue.content[result["items"][0]["id"]]


# ---- the queue ----

def test_audit_queue_lists_only_sampled_items_oldest_first(client: TestClient, catalogue, moderator: dict):
    from app.storage import db

    db.add_content({"type": "book", "title": "A", "description": "x", "age_bands": ["5-8"], "genres": []},
                   status="approved")["audit_status"] = None  # a normal approval: never in the queue
    a = db.add_content({"type": "book", "title": "B", "description": "x", "age_bands": ["5-8"], "genres": []}, status="approved")
    a["audit_status"], a["reviewed_at"] = "pending", 100
    c = db.add_content({"type": "book", "title": "C", "description": "x", "age_bands": ["5-8"], "genres": []}, status="rejected")
    c["audit_status"], c["reviewed_at"] = "pending", 50
    d = db.add_content({"type": "book", "title": "D", "description": "x", "age_bands": ["5-8"], "genres": []}, status="approved")
    d["audit_status"] = "confirmed"  # already audited: not in the queue

    r = client.get("/api/content/audit-queue", headers=moderator["headers"])
    assert r.status_code == 200
    body = r.json()
    assert [i["title"] for i in body["items"]] == ["C", "B"]  # oldest (lowest reviewed_at) first
    assert body["pending_count"] == 2 and body["confirmed"] == 1 and body["accuracy"] == 1.0  # D, confirmed with nothing overturned yet


def test_only_moderators_can_reach_the_queue(client: TestClient, active_parent: dict):
    assert client.get("/api/content/audit-queue", headers=active_parent["headers"]).status_code == 403
    assert client.get("/api/content/audit-queue").status_code in (401, 403)


# ---- confirm / overturn ----

def test_confirm_leaves_the_item_exactly_as_it_was(client: TestClient, catalogue, moderator: dict):
    from app.storage import db

    item = db.add_content({"type": "book", "title": "Real Octopus Book", "description": "x",
                           "age_bands": ["5-8"], "genres": []}, status="approved")
    item["audit_status"] = "pending"

    r = client.post(f"/api/content/{item['id']}/audit", headers=moderator["headers"], json={"decision": "confirm"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "approved" and body["audit_status"] == "confirmed"
    assert body["audited_by"] and body["audited_at"]
    assert item in db.approved_content()


def test_overturning_an_approval_pulls_it_from_the_catalogue(client: TestClient, catalogue, moderator: dict):
    from app.storage import db

    item = db.add_content({"type": "book", "title": "Actually Not Fine", "description": "x",
                           "age_bands": ["5-8"], "genres": []}, status="approved")
    item["audit_status"] = "pending"

    r = client.post(f"/api/content/{item['id']}/audit", headers=moderator["headers"],
                    json={"decision": "overturn", "note": "Too scary for 5-8 after all."})
    body = r.json()
    assert body["status"] == "rejected" and body["audit_status"] == "overturned"
    assert body["audit_note"] == "Too scary for 5-8 after all."
    assert item not in db.approved_content()


def test_overturning_a_rejection_publishes_it_and_embeds_it(client: TestClient, catalogue, moderator: dict, fakes):
    from app.storage import db

    item = db.add_content({"type": "book", "title": "Actually Fine After All", "description": "x",
                           "age_bands": ["5-8"], "genres": [], "embedding": None}, status="rejected")
    item["audit_status"] = "pending"

    r = client.post(f"/api/content/{item['id']}/audit", headers=moderator["headers"], json={"decision": "overturn"})
    body = r.json()
    assert body["status"] == "approved" and body["audit_status"] == "overturned"
    assert item in db.approved_content()
    assert item["embedding"] == [0.3, 0.4]  # it went live, so it must be retrievable


def test_an_item_that_was_never_sampled_cannot_be_audited(client: TestClient, catalogue, moderator: dict):
    from app.storage import db

    item = db.add_content({"type": "book", "title": "Ordinary Approval", "description": "x",
                           "age_bands": ["5-8"], "genres": []}, status="approved")  # no audit_status at all
    r = client.post(f"/api/content/{item['id']}/audit", headers=moderator["headers"], json={"decision": "confirm"})
    assert r.status_code == 409


def test_an_item_cannot_be_audited_twice(client: TestClient, catalogue, moderator: dict):
    from app.storage import db

    item = db.add_content({"type": "book", "title": "Double Check Me", "description": "x",
                           "age_bands": ["5-8"], "genres": []}, status="approved")
    item["audit_status"] = "pending"
    assert client.post(f"/api/content/{item['id']}/audit", headers=moderator["headers"], json={"decision": "confirm"}).status_code == 200
    again = client.post(f"/api/content/{item['id']}/audit", headers=moderator["headers"], json={"decision": "overturn"})
    assert again.status_code == 409
    assert item["status"] == "approved"  # the second call never touched it


def test_a_missing_item_is_404(client: TestClient, moderator: dict):
    r = client.post("/api/content/does-not-exist/audit", headers=moderator["headers"], json={"decision": "confirm"})
    assert r.status_code == 404


def test_only_moderators_can_audit(client: TestClient, catalogue, active_parent: dict):
    from app.storage import db

    item = db.add_content({"type": "book", "title": "X", "description": "x", "age_bands": ["5-8"], "genres": []}, status="approved")
    item["audit_status"] = "pending"
    r = client.post(f"/api/content/{item['id']}/audit", headers=active_parent["headers"], json={"decision": "confirm"})
    assert r.status_code == 403


def test_accuracy_reflects_confirm_vs_overturn(client: TestClient, catalogue, moderator: dict):
    from app.storage import db

    items = [db.add_content({"type": "book", "title": f"Item {n}", "description": "x",
                             "age_bands": ["5-8"], "genres": []}, status="approved") for n in range(4)]
    for i in items:
        i["audit_status"] = "pending"

    client.post(f"/api/content/{items[0]['id']}/audit", headers=moderator["headers"], json={"decision": "confirm"})
    client.post(f"/api/content/{items[1]['id']}/audit", headers=moderator["headers"], json={"decision": "confirm"})
    client.post(f"/api/content/{items[2]['id']}/audit", headers=moderator["headers"], json={"decision": "confirm"})
    client.post(f"/api/content/{items[3]['id']}/audit", headers=moderator["headers"], json={"decision": "overturn"})

    body = client.get("/api/content/audit-queue", headers=moderator["headers"]).json()
    assert body["confirmed"] == 3 and body["overturned"] == 1 and body["accuracy"] == 0.75
