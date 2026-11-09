"""PA03 — the public password-reset flow. The reset code must only ever be handed back in the response in explicit dev mode."""
from fastapi.testclient import TestClient

from app.config import settings


def test_pa03_reset_code_is_not_returned_by_default(client: TestClient, active_parent: dict, monkeypatch):
    monkeypatch.setattr(settings, "DEV_RETURN_RESET_TOKEN", False)
    r = client.post("/api/auth/reset-password/request", json={"email": active_parent["email"]})
    assert r.status_code == 200
    assert r.json()["token"] is None


def test_pa03_unknown_email_gets_the_same_answer(client: TestClient, monkeypatch):
    monkeypatch.setattr(settings, "DEV_RETURN_RESET_TOKEN", False)
    r = client.post("/api/auth/reset-password/request", json={"email": "nobody@example.com"})
    assert r.status_code == 200
    assert r.json()["token"] is None


def test_pa03_dev_mode_returns_a_code_that_resets_the_password(client: TestClient, active_parent: dict, monkeypatch):
    monkeypatch.setattr(settings, "DEV_RETURN_RESET_TOKEN", True)
    r = client.post("/api/auth/reset-password/request", json={"email": active_parent["email"]})
    token = r.json()["token"]
    assert token
    r = client.post("/api/auth/reset-password/confirm", json={"token": token, "new_password": "BrandNew123"})
    assert r.status_code == 200
    r = client.post("/api/auth/login", json={"email": active_parent["email"], "password": "BrandNew123"})
    assert r.status_code == 200
