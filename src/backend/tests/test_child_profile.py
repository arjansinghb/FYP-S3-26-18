"""PA07-PA10 (Create/Edit/Delete Child Profile, PIN), CH01/CH02 (PIN login),
free-tier limits, and cross-parent access control.
"""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_free_tier_child_limit(client: TestClient, signed_up_parent: dict) -> None:
    token = signed_up_parent["token"]
    headers = {"Authorization": f"Bearer {token}"}
    first = client.post("/children", headers=headers, json={"name": "One", "dob": "2018-01-01", "pin": "111111"})
    assert first.status_code == 201

    second = client.post("/children", headers=headers, json={"name": "Two", "dob": "2019-01-01", "pin": "222222"})
    assert second.status_code == 403


def test_age_band_derived_from_dob(client: TestClient, signed_up_parent: dict) -> None:
    token = signed_up_parent["token"]
    headers = {"Authorization": f"Bearer {token}"}
    young = client.post("/children", headers=headers, json={"name": "Young", "dob": "2020-01-01", "pin": "111111"})
    assert young.json()["age_band"] == "5-8"


def test_child_login_activation_flag(client: TestClient, child_profile: dict) -> None:
    child_id = child_profile["id"]
    first_login = client.post(f"/children/{child_id}/login", json={"pin": "111222"})
    assert first_login.status_code == 200
    assert first_login.json()["activated"] is True

    second_login = client.post(f"/children/{child_id}/login", json={"pin": "111222"})
    assert second_login.json()["activated"] is False


def test_wrong_pin_rejected(client: TestClient, child_profile: dict) -> None:
    resp = client.post(f"/children/{child_profile['id']}/login", json={"pin": "000000"})
    assert resp.status_code == 401


def test_cross_parent_cannot_access_others_child(client: TestClient, child_profile: dict) -> None:
    other = client.post(
        "/auth/signup", json={"email": "other@example.com", "password": "testpassword123", "display_name": "Other"}
    )
    other_token = other.json()["token"]
    resp = client.get(f"/children/{child_profile['id']}", headers={"Authorization": f"Bearer {other_token}"})
    assert resp.status_code == 403


def test_delete_child_cascades(client: TestClient, signed_up_parent: dict, child_profile: dict) -> None:
    token = signed_up_parent["token"]
    headers = {"Authorization": f"Bearer {token}"}
    child_id = child_profile["id"]

    resp = client.delete(f"/children/{child_id}", headers=headers)
    assert resp.status_code == 204
    assert client.get(f"/children/{child_id}", headers=headers).status_code == 404
