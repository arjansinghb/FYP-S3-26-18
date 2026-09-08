"""Parent account basics — PA01-06, PA28 (consent), PA29 (privacy), PA30
(child data deletion request)."""
from fastapi.testclient import TestClient


def test_pa01_login(client: TestClient, parent: dict):
    r = client.post("/api/auth/login", json={"email": parent["email"], "password": parent["password"]})
    assert r.status_code == 200
    assert r.json()["account"]["email"] == parent["email"]


def test_pa01_wrong_password_rejected(client: TestClient, parent: dict):
    r = client.post("/api/auth/login", json={"email": parent["email"], "password": "WrongPassword1"})
    assert r.status_code == 401


def test_pa04_view_account(client: TestClient, parent: dict):
    r = client.get("/api/auth/me", headers=parent["headers"])
    assert r.status_code == 200
    assert r.json()["email"] == parent["email"]


def test_pa05_update_account(client: TestClient, parent: dict):
    r = client.patch("/api/auth/me", headers=parent["headers"], json={"name": "Updated Name"})
    assert r.status_code == 200
    assert r.json()["name"] == "Updated Name"


def test_pa28_consent_requires_correct_password(client: TestClient, parent: dict):
    r = client.post("/api/account/consent", headers=parent["headers"], json={"password": "wrong"})
    assert r.status_code == 401

    r = client.post("/api/account/consent", headers=parent["headers"], json={"password": parent["password"]})
    assert r.status_code == 200
    assert r.json()["given"] is True


def test_pa07_blocked_before_verification_and_consent(client: TestClient):
    """A separate, still-unverified/no-consent parent — proves PA07's real
    precondition gate, not just that it eventually succeeds (see `child`
    fixture in other test files for the "after consent" path)."""
    r = client.post(
        "/api/auth/signup",
        json={"email": "no.consent@example.com", "password": "NoConsent1", "name": "No Consent"},
    )
    headers = {"Authorization": f"Bearer {r.json()['token']}"}
    r = client.post("/api/children", headers=headers, json={"name": "Kid", "age_band": "5-8"})
    assert r.status_code == 403  # not verified yet

    verify_token = client.post(
        "/api/auth/signup",
        json={"email": "no.consent2@example.com", "password": "NoConsent1", "name": "No Consent 2"},
    ).json()  # separate account so we test the "verified but no consent" branch cleanly
    headers2 = {"Authorization": f"Bearer {verify_token['token']}"}
    client.post("/api/auth/verify/confirm", json={"token": verify_token["verify_token"]})
    r = client.post("/api/children", headers=headers2, json={"name": "Kid", "age_band": "5-8"})
    assert r.status_code == 403  # verified, but no consent yet


def test_pa29_privacy_settings(client: TestClient, active_parent: dict):
    r = client.get("/api/account/privacy-settings", headers=active_parent["headers"])
    assert r.status_code == 200
    r = client.patch("/api/account/privacy-settings", headers=active_parent["headers"],
                      json={"retention_preference": "minimal"})
    assert r.status_code == 200
    assert r.json()["retention_preference"] == "minimal"


def test_pa30_data_deletion_request_lifecycle(client: TestClient, active_parent: dict, child: dict):
    r = client.post(f"/api/account/children/{child['id']}/data-deletion", headers=active_parent["headers"])
    assert r.status_code == 200
    request = r.json()

    r = client.get(f"/api/account/children/{child['id']}/data-deletion", headers=active_parent["headers"])
    assert r.status_code == 200
    assert len(r.json()) == 1

    r = client.post(f"/api/account/data-deletion/{request['id']}/cancel", headers=active_parent["headers"])
    assert r.status_code == 200


def test_pa06_delete_account(client: TestClient):
    r = client.post(
        "/api/auth/signup",
        json={"email": "delete.me@example.com", "password": "DeleteMe123", "name": "Delete Me"},
    )
    headers = {"Authorization": f"Bearer {r.json()['token']}"}
    r = client.delete("/api/auth/me", headers=headers)
    assert r.status_code == 204

    r = client.post("/api/auth/login", json={"email": "delete.me@example.com", "password": "DeleteMe123"})
    assert r.status_code == 401  # account is really gone, not just hidden
