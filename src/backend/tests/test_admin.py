"""SA03-SA11 — System Admin. Role separation (moderator vs admin) and the
suspend/unsuspend -> login-blocking effect.
"""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_moderator_cannot_access_admin_routes(client: TestClient, moderator_session: dict) -> None:
    resp = client.get("/admin/system-health", headers={"Authorization": f"Bearer {moderator_session['token']}"})
    assert resp.status_code == 403


def test_admin_can_access_admin_routes(client: TestClient, admin_session: dict) -> None:
    resp = client.get("/admin/system-health", headers={"Authorization": f"Bearer {admin_session['token']}"})
    assert resp.status_code == 200
    assert resp.json()["firebase_configured"] is False  # forced off in tests, see conftest.py


def test_suspend_blocks_login(client: TestClient, admin_session: dict, signed_up_parent: dict) -> None:
    admin_headers = {"Authorization": f"Bearer {admin_session['token']}"}
    parent_id = signed_up_parent["parent"]["id"]

    suspend = client.post(f"/admin/users/{parent_id}/suspend", headers=admin_headers)
    assert suspend.json()["status"] == "suspended"

    login = client.post("/auth/login", json={"email": "parent@example.com", "password": "testpassword123"})
    assert login.status_code == 403

    client.post(f"/admin/users/{parent_id}/unsuspend", headers=admin_headers)
    login_again = client.post("/auth/login", json={"email": "parent@example.com", "password": "testpassword123"})
    assert login_again.status_code == 200


def test_search_users_by_email(client: TestClient, admin_session: dict, signed_up_parent: dict) -> None:
    resp = client.get("/admin/users?q=parent@example.com", headers={"Authorization": f"Bearer {admin_session['token']}"})
    assert resp.status_code == 200
    assert len(resp.json()) == 1
