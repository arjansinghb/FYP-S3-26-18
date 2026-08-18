"""Test setup — forces local-dev-store + mock-NLP mode regardless of what's
in the repo's real `.env` (which now has live Firebase/OpenAI credentials —
see agent-context/CLAUDE.md §12). Tests should be deterministic, free, and
not touch real Firebase/OpenAI, so this overrides the relevant env vars
*before* app.core.config (and anything that imports it) ever runs.

This is why this file does its env-patching at import time, before any
`from app...` import — pytest imports conftest.py before collecting tests in
this directory, so this is the one place guaranteed to run first.
"""
from __future__ import annotations

import os

os.environ["FIREBASE_ADMIN_CREDENTIALS_PATH"] = "/nonexistent/firebase-admin.json"
os.environ["FIREBASE_PROJECT_ID"] = ""
os.environ["OPENAI_API_KEY"] = ""
os.environ["SESSION_SECRET"] = "test-secret-not-for-production"

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient

from app.repositories.local_store import _DATA_FILE  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_local_store():
    """Every test starts from an empty local JSON store."""
    if _DATA_FILE.exists():
        _DATA_FILE.unlink()
    yield
    if _DATA_FILE.exists():
        _DATA_FILE.unlink()


@pytest.fixture()
def client() -> TestClient:
    from app.main import app

    return TestClient(app)


@pytest.fixture()
def signed_up_parent(client: TestClient) -> dict:
    """A parent who's signed up and consented — most tests need at least this much."""
    resp = client.post(
        "/auth/signup",
        json={"email": "parent@example.com", "password": "testpassword123", "display_name": "Test Parent"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    token = body["token"]
    # PA28 — dev-session 2026-08-17: consent now re-verifies the password
    # (see app/routers/account.py's ConsentRequest docstring).
    client.post(
        "/account/consent", headers={"Authorization": f"Bearer {token}"}, json={"password": "testpassword123"}
    )
    return {"token": token, "parent": body["parent"]}


@pytest.fixture()
def child_profile(client: TestClient, signed_up_parent: dict) -> dict:
    """A child profile (PIN 111222) under `signed_up_parent`."""
    token = signed_up_parent["token"]
    resp = client.post(
        "/children",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Timmy", "dob": "2018-01-01", "pin": "111222"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture()
def child_session(client: TestClient, child_profile: dict) -> dict:
    """A logged-in child session token for `child_profile`."""
    resp = client.post(f"/children/{child_profile['id']}/login", json={"pin": "111222"})
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.fixture()
def live_catalogue_item() -> dict:
    """Inserts one live, 5-8-and-9-12 catalogue item directly via the
    repository layer (bypassing the moderation pipeline, which is tested
    separately in test_moderation.py) — most chat/favourite tests just need
    *something* recommendable to exist."""
    from datetime import datetime, timezone

    from app.models.catalogue import CatalogueItem
    from app.repositories import catalogue as catalogue_repo
    from app.services import openai_service

    item = CatalogueItem(
        id="test-book-1",
        title="The Very Hungry Caterpillar",
        type="book",
        synopsis="A caterpillar eats a lot of food and turns into a butterfly.",
        age_bands=["5-8", "9-12"],
        genre="picture book",
        topics=["nature", "calming"],
        embedding=openai_service.embed_text("The Very Hungry Caterpillar caterpillar butterfly nature calming"),
        status="live",
        created_at=datetime.now(timezone.utc),
    )
    catalogue_repo.create_item(item)
    return item.model_dump()


@pytest.fixture()
def moderator_session(client: TestClient) -> dict:
    from app.core.security import hash_secret
    from app.repositories import staff as staff_repo

    staff = staff_repo.create_staff("moderator@example.com", "moderator", hash_secret("modpass123"))
    resp = client.post("/moderation/login", json={"email": "moderator@example.com", "password": "modpass123"})
    assert resp.status_code == 200, resp.text
    return {"token": resp.json()["token"], "staff": staff}


@pytest.fixture()
def admin_session(client: TestClient) -> dict:
    from app.core.security import hash_secret
    from app.repositories import staff as staff_repo

    staff = staff_repo.create_staff("admin@example.com", "admin", hash_secret("adminpass123"))
    resp = client.post("/moderation/login", json={"email": "admin@example.com", "password": "adminpass123"})
    assert resp.status_code == 200, resp.text
    return {"token": resp.json()["token"], "staff": staff}
