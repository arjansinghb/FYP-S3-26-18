"""Child profile management (PA07-10, PA13, PA18, PA21, PA33) and the child
device-linking/login flow (CH01/CH02). CH03 (child log out) is a pure
frontend token-drop with no backend call — nothing to unit-test there, same
reasoning scripts/smoke_test.py uses."""
from fastapi.testclient import TestClient


def test_pa07_create_child_generates_unique_code(client: TestClient, child: dict):
    """`child` fixture already did PA07 (after consent) — check its shape.
    login_id/pin are two genuinely separate values (2026-09-09) — alphanumeric
    identifier vs. numeric secret, see storage.create_child's docstring."""
    assert child["name"] == "Test Kid"
    assert child["age_band"] == "5-8"
    login_id, pin = child["login_id"], child["pin"]
    assert len(login_id) == 6 and login_id.isalnum() and login_id == login_id.upper()
    assert pin.isdigit() and len(pin) == 6
    assert login_id != pin


def test_pa33_free_tier_capped_at_one_child(client: TestClient, active_parent: dict, child: dict):
    r = client.post("/api/children", headers=active_parent["headers"], json={"name": "Second Kid", "age_band": "9-12"})
    assert r.status_code == 403
    assert "Premium" in r.json()["detail"]


def test_pa08_edit_child_and_pa13_reading_level(client: TestClient, active_parent: dict, child: dict):
    r = client.patch(f"/api/children/{child['id']}", headers=active_parent["headers"],
                      json={"reading_level": "early"})
    assert r.status_code == 200
    assert r.json()["reading_level"] == "early"

    # PA13 explicitly clearing it back — exclude_unset semantics (see
    # routers/children.py) must actually let a parent clear the field, not
    # just set it once.
    r = client.patch(f"/api/children/{child['id']}", headers=active_parent["headers"], json={"reading_level": None})
    assert r.status_code == 200
    assert r.json()["reading_level"] is None


def test_pa10_regenerate_pin(client: TestClient, active_parent: dict, child: dict):
    old_pin = child["pin"]
    r = client.post(f"/api/children/{child['id']}/regenerate-pin", headers=active_parent["headers"])
    assert r.status_code == 200
    body = r.json()
    new_pin = body["pin"]
    assert new_pin != old_pin
    assert new_pin.isdigit() and len(new_pin) == 6
    assert body["login_id"] == child["login_id"]  # regenerating the PIN doesn't touch login_id
    child["pin"] = new_pin  # keep the fixture in sync for later tests in this module


def test_pa10_regenerate_login_id(client: TestClient, active_parent: dict, child: dict):
    old_login_id = child["login_id"]
    r = client.post(f"/api/children/{child['id']}/regenerate-login-id", headers=active_parent["headers"])
    assert r.status_code == 200
    body = r.json()
    new_login_id = body["login_id"]
    assert new_login_id != old_login_id
    assert len(new_login_id) == 6 and new_login_id.isalnum()
    assert body["pin"] == child["pin"]  # regenerating the login ID doesn't touch the PIN
    child["login_id"] = new_login_id  # keep the fixture in sync for later tests in this module


def test_pa21_safety_settings(client: TestClient, active_parent: dict, child: dict):
    r = client.put(f"/api/children/{child['id']}/settings", headers=active_parent["headers"],
                    json={"allow_books": True, "allow_videos": False, "block_external_links": True})
    assert r.status_code == 200
    assert r.json()["settings"]["allow_videos"] is False


def test_pa18_content_overrides(client: TestClient, active_parent: dict, child: dict, moderator: dict):
    r = client.post("/api/content", headers=moderator["headers"],
                     json={"type": "book", "title": "Override Target", "description": "d",
                           "age_bands": ["5-8"], "genres": []})
    item_id = r.json()["id"]

    r = client.put(f"/api/children/{child['id']}/content-overrides/{item_id}", headers=active_parent["headers"],
                    json={"action": "hide"})
    assert r.status_code == 200

    r = client.get(f"/api/children/{child['id']}/content-overrides", headers=active_parent["headers"])
    assert r.status_code == 200
    assert any(o["content_id"] == item_id and o["action"] == "hide" for o in r.json())

    r = client.delete(f"/api/children/{child['id']}/content-overrides/{item_id}", headers=active_parent["headers"])
    assert r.status_code == 204


def test_ch01_link_with_login_id_and_pin(client: TestClient, child: dict):
    r = client.post("/api/children/link", json={"login_id": child["login_id"], "pin": child["pin"]})
    assert r.status_code == 200
    body = r.json()
    assert body["child"]["id"] == child["id"]
    assert "token" in body


def test_ch01_link_rejects_login_id_without_matching_pin(client: TestClient, child: dict):
    """The whole point of splitting login_id/pin — knowing one alone must
    not be enough."""
    r = client.post("/api/children/link", json={"login_id": child["login_id"], "pin": "000000"})
    assert r.status_code in (401, 403)


def test_ch02_return_login_and_lockout(client: TestClient, active_parent: dict, child: dict):
    pin = child["pin"]
    r = client.post(f"/api/children/{child['id']}/login", json={"pin": pin})
    assert r.status_code == 200

    for _ in range(5):
        client.post(f"/api/children/{child['id']}/login", json={"pin": "000000"})
    r = client.post(f"/api/children/{child['id']}/login", json={"pin": pin})  # right PIN, but now locked
    assert r.status_code == 403

    r = client.post(f"/api/children/{child['id']}/unlock", headers=active_parent["headers"])
    assert r.status_code == 200
    assert r.json()["locked"] is False

    r = client.post(f"/api/children/{child['id']}/login", json={"pin": pin})
    assert r.status_code == 200


def test_ch02_failed_pin_attempts_survive_a_firestore_reload(client: TestClient, active_parent: dict, child: dict, monkeypatch):
    """Regression: on the deployed backend the persist_state middleware
    reloads the Firestore snapshot before every POST and only saved after
    responses < 400, so a wrong PIN (401) was never persisted — the counter
    reset on every request and the profile never locked. Simulate Firestore
    with a fake snapshot store."""
    import copy
    from app import firestore_store
    from app.storage import db

    snapshot: dict = {}
    monkeypatch.setattr(firestore_store, "save_state", lambda state: snapshot.update(copy.deepcopy(state)))
    monkeypatch.setattr(firestore_store, "load_state", lambda: copy.deepcopy(snapshot) or None)
    db.save()  # the "already in Firestore" starting point
    pin = db.children[child["id"]]["pin"]  # the fixture's copy can be stale after an earlier PIN regenerate

    for _ in range(5):
        r = client.post(f"/api/children/{child['id']}/login", json={"pin": "000000" if pin != "000000" else "111111"})
        assert r.status_code in (401, 403)
    r = client.post(f"/api/children/{child['id']}/login", json={"pin": pin})
    assert r.status_code == 403  # locked, even with the right PIN
    client.post(f"/api/children/{child['id']}/unlock", headers=active_parent["headers"])


def test_pa09_delete_child(client: TestClient, active_parent: dict, child: dict):
    """Placed last in this module — `child` no longer exists for any test
    after this one to depend on."""
    r = client.delete(f"/api/children/{child['id']}", headers=active_parent["headers"])
    assert r.status_code == 204

    # deleting frees the free-tier slot back up
    r = client.post("/api/children", headers=active_parent["headers"], json={"name": "Replacement Kid", "age_band": "5-8"})
    assert r.status_code == 201


def test_children_listed_oldest_profile_first():
    """The children come back from Firestore keyed by random id, so insertion
    order is arbitrary. The list must always put the first-registered child
    first, whatever order the dict happens to hold them in."""
    from app.storage import db
    pid = "order-test-parent"
    db.children["aaa-newer"] = {"id": "aaa-newer", "parent_id": pid, "name": "Newer", "created": 2000.0}
    db.children["zzz-older"] = {"id": "zzz-older", "parent_id": pid, "name": "Older", "created": 1000.0}
    try:
        assert [c["name"] for c in db.children_of(pid)] == ["Older", "Newer"]
    finally:
        db.children.pop("aaa-newer", None)
        db.children.pop("zzz-older", None)
