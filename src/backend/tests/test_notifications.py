"""PA20 (Receive Notifications) / PA22 (Set Notification Preferences).
Triggers: CH01/child_login activation and CM12/resolve_flagged_content — see
app/routers/children.py and app/routers/moderation.py.
"""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_child_activation_notifies_parent(client: TestClient, child_profile: dict, signed_up_parent: dict) -> None:
    parent_headers = {"Authorization": f"Bearer {signed_up_parent['token']}"}
    assert client.get("/notifications", headers=parent_headers).json() == []

    login = client.post(f"/children/{child_profile['id']}/login", json={"pin": "111222"})
    assert login.status_code == 200
    assert login.json()["activated"] is True

    notifications = client.get("/notifications", headers=parent_headers).json()
    assert len(notifications) == 1
    assert notifications[0]["type"] == "child_activated"
    assert notifications[0]["read_at"] is None

    # Second login for the same profile isn't a fresh activation -> no new notification.
    client.post(f"/children/{child_profile['id']}/login", json={"pin": "111222"})
    assert len(client.get("/notifications", headers=parent_headers).json()) == 1


def test_flag_resolution_notifies_parent(
    client: TestClient, moderator_session: dict, signed_up_parent: dict, child_profile: dict, live_catalogue_item: dict
) -> None:
    parent_headers = {"Authorization": f"Bearer {signed_up_parent['token']}"}
    flag = client.post(
        "/flags",
        headers=parent_headers,
        json={"child_id": child_profile["id"], "catalogue_item_id": "test-book-1", "reason": "too scary"},
    ).json()

    mod_headers = {"Authorization": f"Bearer {moderator_session['token']}"}
    client.post(f"/moderation/flags/{flag['id']}/resolve?resolution=removed", headers=mod_headers)

    notifications = client.get("/notifications", headers=parent_headers).json()
    assert any(n["type"] == "flag_resolved" for n in notifications)


def test_mark_notification_read(client: TestClient, child_profile: dict, signed_up_parent: dict) -> None:
    parent_headers = {"Authorization": f"Bearer {signed_up_parent['token']}"}
    client.post(f"/children/{child_profile['id']}/login", json={"pin": "111222"})
    notification_id = client.get("/notifications", headers=parent_headers).json()[0]["id"]

    resp = client.post(f"/notifications/{notification_id}/read", headers=parent_headers)
    assert resp.status_code == 204
    updated = client.get("/notifications", headers=parent_headers).json()[0]
    assert updated["read_at"] is not None


def test_disabled_preference_suppresses_notification(
    client: TestClient, child_profile: dict, signed_up_parent: dict
) -> None:
    parent_headers = {"Authorization": f"Bearer {signed_up_parent['token']}"}
    prefs = client.patch(
        "/account/notification-preferences",
        headers=parent_headers,
        json={"child_activated": False, "flag_resolved": True},
    )
    assert prefs.status_code == 200
    assert prefs.json()["child_activated"] is False

    client.post(f"/children/{child_profile['id']}/login", json={"pin": "111222"})
    assert client.get("/notifications", headers=parent_headers).json() == []


def test_notifications_require_auth(client: TestClient) -> None:
    assert client.get("/notifications").status_code == 401
