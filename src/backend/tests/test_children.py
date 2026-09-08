"""Child profile management (PA07-10, PA13, PA18, PA21, PA33) and the child
device-linking/login flow (CH01/CH02). CH03 (child log out) is a pure
frontend token-drop with no backend call — nothing to unit-test there, same
reasoning scripts/smoke_test.py uses."""
from fastapi.testclient import TestClient


def test_pa07_create_child_generates_unique_code(client: TestClient, child: dict):
    """`child` fixture already did PA07 (after consent) — check its shape."""
    assert child["name"] == "Test Kid"
    assert child["age_band"] == "5-8"
    code = child["linking_code"]
    assert code.isdigit() and len(code) == 6


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
    old_code = child["linking_code"]
    r = client.post(f"/api/children/{child['id']}/regenerate-pin", headers=active_parent["headers"])
    assert r.status_code == 200
    new_code = r.json()["linking_code"]
    assert new_code != old_code
    assert new_code.isdigit() and len(new_code) == 6
    child["linking_code"] = new_code  # keep the fixture in sync for later tests in this module


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


def test_ch01_link_with_code_and_pin(client: TestClient, child: dict):
    code = child["linking_code"]
    r = client.post("/api/children/link", json={"code": code, "pin": code})
    assert r.status_code == 200
    body = r.json()
    assert body["child"]["id"] == child["id"]
    assert "token" in body


def test_ch02_return_login_and_lockout(client: TestClient, active_parent: dict, child: dict):
    code = child["linking_code"]
    r = client.post(f"/api/children/{child['id']}/login", json={"pin": code})
    assert r.status_code == 200

    for _ in range(5):
        client.post(f"/api/children/{child['id']}/login", json={"pin": "000000"})
    r = client.post(f"/api/children/{child['id']}/login", json={"pin": code})  # right PIN, but now locked
    assert r.status_code == 403

    r = client.post(f"/api/children/{child['id']}/unlock", headers=active_parent["headers"])
    assert r.status_code == 200
    assert r.json()["locked"] is False

    r = client.post(f"/api/children/{child['id']}/login", json={"pin": code})
    assert r.status_code == 200


def test_pa09_delete_child(client: TestClient, active_parent: dict, child: dict):
    """Placed last in this module — `child` no longer exists for any test
    after this one to depend on."""
    r = client.delete(f"/api/children/{child['id']}", headers=active_parent["headers"])
    assert r.status_code == 204

    # deleting frees the free-tier slot back up
    r = client.post("/api/children", headers=active_parent["headers"], json={"name": "Replacement Kid", "age_band": "5-8"})
    assert r.status_code == 201
