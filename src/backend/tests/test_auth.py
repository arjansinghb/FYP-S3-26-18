"""UV05 (Sign Up), PA01 (Log In), PA02 (Log Out), PA28 (Consent)."""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_signup_creates_parent_and_token(client: TestClient) -> None:
    resp = client.post(
        "/auth/signup",
        json={"email": "new@example.com", "password": "testpassword123", "display_name": "New Parent"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["parent"]["email"] == "new@example.com"
    assert body["parent"]["consent_record"] is None
    assert body["token"]


def test_signup_duplicate_email_rejected(client: TestClient) -> None:
    payload = {"email": "dup@example.com", "password": "testpassword123", "display_name": "Dup"}
    assert client.post("/auth/signup", json=payload).status_code == 201
    resp = client.post("/auth/signup", json=payload)
    assert resp.status_code == 409


def test_login_with_correct_credentials(client: TestClient) -> None:
    client.post(
        "/auth/signup", json={"email": "login@example.com", "password": "testpassword123", "display_name": "L"}
    )
    resp = client.post("/auth/login", json={"email": "login@example.com", "password": "testpassword123"})
    assert resp.status_code == 200
    assert resp.json()["parent"]["email"] == "login@example.com"


def test_login_with_wrong_password_rejected(client: TestClient) -> None:
    client.post(
        "/auth/signup", json={"email": "wrongpw@example.com", "password": "testpassword123", "display_name": "L"}
    )
    resp = client.post("/auth/login", json={"email": "wrongpw@example.com", "password": "not-the-password"})
    assert resp.status_code == 401


def test_account_endpoint_requires_token(client: TestClient) -> None:
    assert client.get("/account").status_code == 401


def test_consent_gate_blocks_child_profile_creation(client: TestClient) -> None:
    signup = client.post(
        "/auth/signup", json={"email": "noconsent@example.com", "password": "testpassword123", "display_name": "N"}
    )
    token = signup.json()["token"]
    resp = client.post(
        "/children",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Kid", "dob": "2018-01-01", "pin": "123456"},
    )
    assert resp.status_code == 403

    consent = client.post(
        "/account/consent", headers={"Authorization": f"Bearer {token}"}, json={"password": "testpassword123"}
    )
    assert consent.status_code == 201, consent.text
    resp = client.post(
        "/children",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Kid", "dob": "2018-01-01", "pin": "123456"},
    )
    assert resp.status_code == 201
