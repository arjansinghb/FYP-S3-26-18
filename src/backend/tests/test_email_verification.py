"""UV06 — Verify Account. See app/services/auth_service.py: no email
transport is wired up, so the request step returns the token directly rather
than emailing it (dev/testing convenience, same pattern as PA03 password
reset).
"""
from __future__ import annotations

from fastapi.testclient import TestClient


def _signup(client: TestClient) -> dict:
    resp = client.post(
        "/auth/signup",
        json={"email": "verify@example.com", "password": "testpassword123", "display_name": "V"},
    )
    return resp.json()


def test_new_account_starts_unverified(client: TestClient) -> None:
    parent = _signup(client)
    assert parent["parent"]["email_verified"] is False


def test_request_then_confirm_verifies_account(client: TestClient) -> None:
    parent = _signup(client)
    headers = {"Authorization": f"Bearer {parent['token']}"}

    requested = client.post("/auth/verify-email/request", headers=headers)
    assert requested.status_code == 202
    token = requested.json()["verification_token"]
    assert token

    confirmed = client.post("/auth/verify-email/confirm", json={"token": token})
    assert confirmed.status_code == 200
    assert confirmed.json()["email_verified"] is True

    # Reflected on the account itself afterwards.
    account = client.get("/account", headers=headers).json()
    assert account["email_verified"] is True


def test_already_verified_short_circuits(client: TestClient) -> None:
    parent = _signup(client)
    headers = {"Authorization": f"Bearer {parent['token']}"}
    token = client.post("/auth/verify-email/request", headers=headers).json()["verification_token"]
    client.post("/auth/verify-email/confirm", json={"token": token})

    again = client.post("/auth/verify-email/request", headers=headers)
    assert again.json()["message"] == "Already verified."
    assert again.json()["verification_token"] is None


def test_garbage_token_rejected(client: TestClient) -> None:
    resp = client.post("/auth/verify-email/confirm", json={"token": "not-a-real-token"})
    assert resp.status_code == 400


def test_request_verification_requires_auth(client: TestClient) -> None:
    assert client.post("/auth/verify-email/request").status_code == 401
