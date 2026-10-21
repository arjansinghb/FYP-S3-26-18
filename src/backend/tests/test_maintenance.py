"""Maintenance mode (SA11): parents, children and visitors are paused with a
503 and a friendly message; admins and moderators keep working."""
import pytest
from fastapi.testclient import TestClient

from app import maintenance


@pytest.fixture()
def maintenance_on(client: TestClient):
    from app.storage import db

    db.system["settings"]["maintenance_mode"] = True
    maintenance._last_check = 10**12  # don't let the throttled re-read interfere in tests
    yield
    db.system["settings"]["maintenance_mode"] = False


def test_everything_works_while_it_is_off(client: TestClient, active_parent: dict, child: dict):
    assert client.get("/api/children", headers=active_parent["headers"]).status_code == 200
    assert client.get("/api/public/maintenance").json()["active"] is False


def test_parents_are_paused_with_a_friendly_message(client: TestClient, active_parent: dict, maintenance_on):
    r = client.get("/api/children", headers=active_parent["headers"])
    assert r.status_code == 503
    body = r.json()
    assert body["maintenance"] is True and "try again" in body["detail"].lower() and body["support_email"] == "help@pip.local"
    assert r.headers.get("retry-after") == "300"


def test_children_and_anonymous_visitors_are_paused_too(client: TestClient, child_session: dict, child: dict, maintenance_on):
    assert client.get("/api/chat/favourites", headers=child_session["headers"]).status_code == 503
    assert client.post("/api/children/link", json={"login_id": child["login_id"], "pin": child["pin"]}).status_code == 503
    assert client.post("/api/auth/signup", json={"email": "new@example.com", "password": "Passw0rd!", "name": "N"}).status_code == 503


def test_the_paused_response_still_carries_cors_headers(client: TestClient, active_parent: dict, maintenance_on):
    r = client.get("/api/children", headers={**active_parent["headers"], "Origin": "http://localhost:5173"})
    assert r.status_code == 503 and r.headers.get("access-control-allow-origin")


def test_health_and_public_data_and_status_stay_open(client: TestClient, maintenance_on):
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/public/site").status_code == 200
    status = client.get("/api/public/maintenance").json()
    assert status["active"] is True and status["support_email"] == "help@pip.local"


def test_admin_and_moderator_keep_working(client: TestClient, admin: dict, moderator: dict, maintenance_on):
    assert client.get("/api/admin/users", headers=admin["headers"]).status_code == 200
    assert client.get("/api/reports", headers=moderator["headers"]).status_code == 200


def test_staff_can_still_log_in_but_a_parent_cannot(client: TestClient, parent: dict, maintenance_on):
    assert client.post("/api/auth/login", json={"email": "moderator@pip.local", "password": "moderator123"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "admin@pip.local", "password": "admin123"}).status_code == 200
    r = client.post("/api/auth/login", json={"email": parent["email"], "password": parent["password"]})
    assert r.status_code == 503 and "try again" in r.json()["detail"].lower()


def test_an_admin_can_switch_it_on_and_off_from_settings(client: TestClient, admin: dict, active_parent: dict):
    from app.storage import db

    maintenance._last_check = 10**12
    try:
        assert client.put("/api/admin/config/settings", headers=admin["headers"], json={"maintenance_mode": True}).status_code == 200
        assert client.get("/api/children", headers=active_parent["headers"]).status_code == 503
        assert client.put("/api/admin/config/settings", headers=admin["headers"], json={"maintenance_mode": False}).status_code == 200
        assert client.get("/api/children", headers=active_parent["headers"]).status_code == 200
    finally:
        db.system["settings"]["maintenance_mode"] = False
