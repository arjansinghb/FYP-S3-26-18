"""Date of birth on child profiles, the child Browse screen, and articulation
levels (CH21/CH22, PA34-PA37). Ordering matters inside this file (module-scoped
db), same as the rest of the suite."""
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.storage import db


def _dob_for_age(years: int) -> str:
    today = date.today()
    return date(today.year - years, 1, 1).isoformat() if (today.month, today.day) >= (1, 1) else ""


# ---------- date of birth replaces the age-band dropdown ----------

def test_dob_derives_age_band(client: TestClient, active_parent: dict):
    r = client.post("/api/children", headers=active_parent["headers"], json={"name": "Dobby", "dob": _dob_for_age(7)})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["age_band"] == "5-8" and body["dob"] == _dob_for_age(7)
    assert body["articulation_level"] == "explorer" and body["articulation_progress"] == 0

    r = client.patch(f"/api/children/{body['id']}", headers=active_parent["headers"], json={"dob": _dob_for_age(10)})
    assert r.status_code == 200
    assert r.json()["age_band"] == "9-12"
    client.delete(f"/api/children/{body['id']}", headers=active_parent["headers"])


@pytest.mark.parametrize("payload", [
    {"name": "Too Young", "dob": _dob_for_age(3)},
    {"name": "Too Old", "dob": _dob_for_age(15)},
    {"name": "Future", "dob": "2999-01-01"},
    {"name": "Garbage", "dob": "not-a-date"},
])
def test_dob_outside_range_or_invalid_is_rejected(client: TestClient, active_parent: dict, payload: dict):
    r = client.post("/api/children", headers=active_parent["headers"], json=payload)
    assert r.status_code == 422


def test_dob_or_age_band_is_required(client: TestClient, active_parent: dict):
    r = client.post("/api/children", headers=active_parent["headers"], json={"name": "Nobody"})
    assert r.status_code == 422


# ---------- helpers for the rest of the file ----------

@pytest.fixture(scope="module")
def saved_items(client: TestClient, child_session: dict) -> list[str]:
    """Four 5-8 items saved to the child's Library (the free cap is 5)."""
    pool = [c["id"] for c in db.approved_content() if "5-8" in c.get("age_bands", [])]
    assert len(pool) >= 4
    ids = pool[:4]
    for cid in ids:
        r = client.post("/api/chat/favourite", headers=child_session["headers"], json={"content_id": cid, "liked": True})
        assert r.status_code == 201, r.text
    return ids


def _explain(client, child_session, content_id, text="I liked the part with the funny dog."):
    return client.post(
        "/api/articulation/explanations", headers=child_session["headers"],
        json={"content_id": content_id, "text": text, "input_mode": "text"},
    )


# ---------- CH21: explaining a saved item ----------

def test_child_can_only_explain_a_saved_item(client: TestClient, child_session: dict, saved_items: list[str]):
    unsaved = next(c["id"] for c in db.approved_content() if c["id"] not in saved_items)
    assert _explain(client, child_session, unsaved).status_code == 404


def test_explain_logs_and_pip_replies_warmly(client: TestClient, child_session: dict, active_parent: dict,
                                              child: dict, saved_items: list[str]):
    r = _explain(client, child_session, saved_items[0])
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["saved"] is True and body["pip_reply"]
    lowered = body["pip_reply"].lower()
    for forbidden in ("wrong", "incorrect", "level", "parent", "score"):
        assert forbidden not in lowered

    favs = client.get("/api/chat/favourites", headers=child_session["headers"]).json()
    assert next(f for f in favs if f["id"] == saved_items[0])["told_pip"] is True
    assert next(f for f in favs if f["id"] == saved_items[1])["told_pip"] is False

    # the parent was notified and sees it waiting
    notes = client.get("/api/account/notifications", headers=active_parent["headers"]).json()
    assert any(n["type"] == "explanation" for n in notes)
    rows = client.get(f"/api/children/{child['id']}/explanations", headers=active_parent["headers"]).json()
    assert len(rows) == 1 and rows[0]["status"] == "pending"
    assert rows[0]["text"] == "I liked the part with the funny dog."
    assert rows[0]["level_at"] == "explorer" and rows[0]["level_descriptor"]


def test_same_item_cannot_be_explained_twice_while_pending(client: TestClient, child_session: dict, saved_items: list[str]):
    assert _explain(client, child_session, saved_items[0]).status_code == 409


def test_unsafe_text_is_turned_away_and_does_not_use_up_the_item(client: TestClient, child_session: dict,
                                                                    saved_items: list[str], monkeypatch):
    from app import moderation
    monkeypatch.setattr(moderation, "is_unsafe", lambda text: True)
    r = _explain(client, child_session, saved_items[1], "something unsafe")
    assert r.status_code == 201 and r.json()["saved"] is False
    monkeypatch.undo()
    assert _explain(client, child_session, saved_items[1]).status_code == 201  # still free to try


def test_child_level_never_reveals_what_is_waiting(client: TestClient, child_session: dict):
    r = client.get("/api/articulation/level", headers=child_session["headers"])
    assert r.status_code == 200
    body = r.json()
    assert body["level"] == "explorer" and body["label"] == "Explorer"
    assert body["pending"] == 0 and body["needed"] == 3 and body["next_label"] == "Adventurer"


# ---------- PA35: confirm / decline, and the three-confirmation rule ----------

def test_decline_frees_the_item_and_never_shows_to_the_child(client: TestClient, child_session: dict,
                                                              active_parent: dict, child: dict, saved_items: list[str]):
    rows = client.get(f"/api/children/{child['id']}/explanations", headers=active_parent["headers"]).json()
    target = next(r for r in rows if r["content_id"] == saved_items[1])
    r = client.post(f"/api/explanations/{target['id']}/decline", headers=active_parent["headers"])
    assert r.status_code == 200 and r.json()["explanation"]["status"] == "declined"
    assert r.json()["level"]["progress"] == 0

    favs = client.get("/api/chat/favourites", headers=child_session["headers"]).json()
    assert next(f for f in favs if f["id"] == saved_items[1])["told_pip"] is False
    assert "declined" not in str(favs).lower()
    assert _explain(client, child_session, saved_items[1], "A second try, I liked the ending.").status_code == 201

    again = client.post(f"/api/explanations/{target['id']}/decline", headers=active_parent["headers"])
    assert again.status_code == 409  # already reviewed


def test_free_parent_sees_only_pending_and_no_trends(client: TestClient, active_parent: dict, child: dict):
    rows = client.get(f"/api/children/{child['id']}/explanations", headers=active_parent["headers"]).json()
    assert rows and all(r["status"] == "pending" for r in rows)
    r = client.get(f"/api/children/{child['id']}/articulation-trends", headers=active_parent["headers"])
    assert r.status_code == 403


def test_three_confirmations_promote_one_level(client: TestClient, child_session: dict, active_parent: dict,
                                                child: dict, saved_items: list[str]):
    assert _explain(client, child_session, saved_items[2], "The bear shared his honey.").status_code == 201
    pending = [r for r in client.get(f"/api/children/{child['id']}/explanations",
                                      headers=active_parent["headers"]).json() if r["status"] == "pending"]
    assert len(pending) == 3

    results = [client.post(f"/api/explanations/{p['id']}/confirm", headers=active_parent["headers"]).json() for p in pending]
    assert [r["level"]["progress"] for r in results[:2]] == [1, 2]
    assert results[-1]["leveled_up"] is True
    assert results[-1]["level"]["level"] == "adventurer" and results[-1]["level"]["progress"] == 0
    # each explanation was judged at the level the child had when they wrote it
    assert all(r["explanation"]["level_at"] == "explorer" for r in results)

    lu = client.get("/api/articulation/level-up", headers=child_session["headers"]).json()["level_up"]
    assert lu["from"] == "explorer" and lu["to"] == "adventurer" and lu["to_label"] == "Adventurer"
    assert client.post("/api/articulation/level-up/ack", headers=child_session["headers"]).status_code == 204
    assert client.get("/api/articulation/level-up", headers=child_session["headers"]).json()["level_up"] is None


def test_storyteller_is_the_top_and_stops_counting(client: TestClient, child_session: dict, active_parent: dict,
                                                    child: dict, saved_items: list[str]):
    db.children[child["id"]]["articulation_level"] = "storyteller"
    db.children[child["id"]]["articulation_progress"] = 0
    assert _explain(client, child_session, saved_items[3], "They built a rocket together.").status_code == 201
    pending = next(r for r in client.get(f"/api/children/{child['id']}/explanations",
                                          headers=active_parent["headers"]).json() if r["status"] == "pending")
    r = client.post(f"/api/explanations/{pending['id']}/confirm", headers=active_parent["headers"]).json()
    assert r["explanation"]["status"] == "confirmed" and r["leveled_up"] is False
    assert r["level"]["level"] == "storyteller" and r["level"]["progress"] == 0 and r["level"]["next_level"] is None


def test_parent_cannot_touch_another_familys_explanations(client: TestClient, child_session: dict, saved_items: list[str]):
    other = client.post("/api/auth/signup", json={"email": "other.parent@example.com", "password": "TestPass123",
                                                    "name": "Other Parent"}).json()
    headers = {"Authorization": f"Bearer {other['token']}"}
    eid = next(iter(db.explanations))
    assert client.post(f"/api/explanations/{eid}/confirm", headers=headers).status_code == 404


def test_premium_gets_history_and_trends(client: TestClient, active_parent: dict, child: dict):
    client.put("/api/account/payment-method", headers=active_parent["headers"], json={"brand": "visa", "last4": "4242"})
    assert client.post("/api/account/subscribe", headers=active_parent["headers"],
                       json={"billing_cycle": "monthly"}).status_code == 200
    rows = client.get(f"/api/children/{child['id']}/explanations", headers=active_parent["headers"]).json()
    assert {"confirmed", "declined"} <= {r["status"] for r in rows}

    t = client.get(f"/api/children/{child['id']}/articulation-trends", headers=active_parent["headers"]).json()
    assert t["total"] == len(rows) and t["confirmed"] >= 4 and t["declined"] == 1
    assert [s["level"] for s in t["level_history"]][:2] == ["explorer", "adventurer"]
    assert t["top_genres"] and len(t["explained_per_week"]) == 8 and t["explained_per_week"][-1] == t["total"]


def test_child_data_deletion_clears_explanations(client: TestClient, child: dict):
    assert any(e["child_id"] == child["id"] for e in db.explanations.values())
    db._clear_child_data(child["id"], full=False)
    assert not any(e["child_id"] == child["id"] for e in db.explanations.values())
    assert db.children[child["id"]]["articulation_level"] == "storyteller"  # earned level is the child's, not "data"


# ---------- Browse ----------

def test_browse_categories_and_type_filter(client: TestClient, child_session: dict):
    cats = client.get("/api/browse/categories", headers=child_session["headers"]).json()
    assert cats and all(c["count"] > 0 for c in cats)
    books_only = client.get("/api/browse/categories?type=book", headers=child_session["headers"]).json()
    assert sum(c["count"] for c in books_only) <= sum(c["count"] for c in cats)


def test_browse_items_pagination_and_age_band(client: TestClient, child_session: dict):
    first = client.get("/api/browse/items?limit=2", headers=child_session["headers"]).json()
    assert len(first["items"]) == 2 and first["has_more"] is True
    second = client.get("/api/browse/items?limit=2&offset=2", headers=child_session["headers"]).json()
    assert not {i["id"] for i in first["items"]} & {i["id"] for i in second["items"]}
    everything = client.get("/api/browse/items?limit=24", headers=child_session["headers"]).json()
    assert everything["has_more"] is False
    for item in everything["items"]:
        assert "5-8" in db.content[item["id"]]["age_bands"]  # same age filter Pip's own picks use
        assert item["explanation"] and "description" in item


def test_browse_genre_filter(client: TestClient, child_session: dict):
    r = client.get("/api/browse/items?genre=animals", headers=child_session["headers"]).json()
    assert r["total"] > 0
    assert all("animals" in [g.lower() for g in i["genres"]] for i in r["items"])


def test_for_you_uses_interests_but_never_narrows_browse(client: TestClient, child_session: dict, child: dict):
    assert client.get("/api/browse/for-you", headers=child_session["headers"]).json() == []  # no interests yet
    before = client.get("/api/browse/items?limit=24", headers=child_session["headers"]).json()["total"]

    db.children[child["id"]]["interests"] = ["animals", "dinosaur"]
    row = client.get("/api/browse/for-you", headers=child_session["headers"]).json()
    assert row and all({"animals", "dinosaur"} & {g.lower() for g in i["genres"]} for i in row)
    assert client.get("/api/browse/items?limit=24", headers=child_session["headers"]).json()["total"] == before


def test_gender_never_changes_what_the_child_sees(client: TestClient, child_session: dict, child: dict):
    """PDPA position: gender is stored but never used to filter or rank."""
    db.children[child["id"]]["interests"] = ["animals"]

    def snapshot():
        h = child_session["headers"]
        return (
            client.get("/api/browse/categories", headers=h).json(),
            client.get("/api/browse/items?limit=24", headers=h).json(),
            client.get("/api/browse/for-you", headers=h).json(),
        )

    results = []
    for gender in (None, "girl", "boy", "prefer_not_to_say"):
        db.children[child["id"]]["gender"] = gender
        results.append(snapshot())
    assert all(r == results[0] for r in results)


# ---------- interests are a fixed list ----------

def test_interests_keep_only_the_fixed_list(client: TestClient, active_parent: dict, child: dict):
    r = client.patch(f"/api/children/{child['id']}", headers=active_parent["headers"],
                     json={"interests": ["Animals", "animals", "dragons", "my secret nickname", "space"]})
    assert r.status_code == 200
    assert r.json()["interests"] == ["animals", "space"]


def test_removing_and_resaving_a_favourite_does_not_reset_its_explanation(client: TestClient, child_session: dict,
                                                                            saved_items: list[str]):
    """The "used" marker lives on the explanation, not on the favourite, so a
    child can't explain, un-save, re-save and explain the same item again."""
    item = saved_items[3]
    h = child_session["headers"]
    assert client.post("/api/chat/favourite", headers=h, json={"content_id": item, "liked": True}).status_code == 201
    assert _explain(client, child_session, item, "My first explanation.").status_code == 201
    assert client.delete(f"/api/chat/favourite/{item}", headers=h).status_code in (200, 204)
    assert all(f["id"] != item for f in client.get("/api/chat/favourites", headers=h).json())
    assert client.post("/api/chat/favourite", headers=h, json={"content_id": item, "liked": True}).status_code == 201

    back = next(f for f in client.get("/api/chat/favourites", headers=h).json() if f["id"] == item)
    assert back["told_pip"] is True  # still marked as told
    assert _explain(client, child_session, item, "Trying to tell it again.").status_code == 409


def test_item_is_used_up_per_level_and_opens_again_after_moving_up(client: TestClient, child_session: dict, child: dict,
                                                                    saved_items: list[str]):
    """Moving up a level makes every book available again: a Free child with 5
    favourites can still reach the top level. Same level stays blocked."""
    h = child_session["headers"]
    item = saved_items[0]
    db.children[child["id"]]["articulation_level"] = "explorer"
    assert client.post("/api/chat/favourite", headers=h, json={"content_id": item, "liked": True}).status_code == 201
    assert _explain(client, child_session, item, "Told at explorer level.").status_code == 201
    assert _explain(client, child_session, item, "Again, same level.").status_code == 409

    db.children[child["id"]]["articulation_level"] = "adventurer"  # as if the parent's third confirmation promoted them
    favs = client.get("/api/chat/favourites", headers=h).json()
    assert next(f for f in favs if f["id"] == item)["told_pip"] is False  # the card offers "Tell Pip about this" again
    again = _explain(client, child_session, item, "Now with more detail: what happened and why.")
    assert again.status_code == 201
    levels = sorted(e["level_at"] for e in db.explanations.values() if e["child_id"] == child["id"] and e["content_id"] == item)
    assert levels == ["adventurer", "explorer"]  # each judged at the level it was told at
    assert _explain(client, child_session, item, "And again.").status_code == 409
