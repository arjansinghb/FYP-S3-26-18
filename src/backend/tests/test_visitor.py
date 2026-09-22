"""Unregistered Visitor — UV01-07.

UV07 (Install the Application / PWA) isn't a backend API at all — it's the
frontend's manifest.webmanifest + service worker (src/frontend/public/),
verified separately by checking those files actually exist and are served;
nothing here to unit-test at the API layer.
"""
from fastapi.testclient import TestClient


def test_uv01_02_landing_content(client: TestClient):
    r = client.get("/api/public/site")
    assert r.status_code == 200
    body = r.json()
    assert "site_title" in body and "tagline" in body


def test_uv03_subscription_plans(client: TestClient):
    r = client.get("/api/public/plans")
    assert r.status_code == 200
    body = r.json()
    assert "currency" in body
    assert "premium_monthly_price" in body  # trimmed-demo branch: Ultra tier removed


def test_uv02_catalogue_sample_only_approved(client: TestClient, moderator: dict):
    """The landing page's "peek at the catalogue" (UV02) — real approved
    content only, never a pending/rejected item leaking to an unregistered
    visitor."""
    r = client.post(
        "/api/content", headers=moderator["headers"],
        json={"type": "book", "title": "Sample Book", "description": "d",
              "age_bands": ["5-8"], "genres": ["fun"]},
    )
    assert r.status_code == 201
    r = client.get("/api/public/catalogue-sample", params={"limit": 50})
    assert r.status_code == 200
    titles = [c["title"] for c in r.json()]
    assert "Sample Book" in titles
    assert all("source_url" not in c and "external_ref" not in c for c in r.json())


def test_uv05_signup(client: TestClient):
    r = client.post(
        "/api/auth/signup",
        json={"email": "visitor.signup@example.com", "password": "VisitorPass1", "name": "Visitor Signup"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["account"]["verified"] is False  # UV06 not done yet
    assert body["account"]["email"] == "visitor.signup@example.com"
    assert "verify_token" in body  # dev-mode: no email service, token comes back directly


def test_uv05_duplicate_email_rejected(client: TestClient):
    client.post("/api/auth/signup", json={"email": "dup@example.com", "password": "DupPass123", "name": "Dup"})
    r = client.post("/api/auth/signup", json={"email": "dup@example.com", "password": "DupPass123", "name": "Dup2"})
    assert r.status_code == 409


def test_uv06_verify_account(client: TestClient):
    r = client.post(
        "/api/auth/signup",
        json={"email": "verify.me@example.com", "password": "VerifyPass1", "name": "Verify Me"},
    )
    verify_token = r.json()["verify_token"]
    r = client.post("/api/auth/verify/confirm", json={"token": verify_token})
    assert r.status_code == 200
    assert r.json()["verified"] is True

    r = client.post("/api/auth/verify/confirm", json={"token": "not-a-real-token"})
    assert r.status_code == 400
