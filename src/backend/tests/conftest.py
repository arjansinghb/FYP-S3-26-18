"""Test setup — forces mock-brain + no-Firestore mode regardless of what's in
the repo's real `.env` (which has live OpenAI/Firebase credentials). Tests must be free,
deterministic, and never touch real OpenAI/Firestore, so this overrides the
relevant env vars *before* app.config (and anything that imports it) ever
runs — same technique, and same reasoning, as the team's other
implementation's tests/conftest.py (frontend-visual-overhaul branch).

This is why the env-patching happens at module import time, before any
`from app...` import — pytest imports conftest.py before collecting any
test in this directory, so this is the one place guaranteed to run first.
"""
from __future__ import annotations

import os

os.environ["OPENAI_API_KEY"] = ""
os.environ["FIREBASE_PROJECT_ID"] = ""
os.environ["FIREBASE_ADMIN_CREDENTIALS_PATH"] = "/nonexistent/firebase-admin.json"
os.environ["GOOGLE_BOOKS_API_KEY"] = ""
os.environ["YOUTUBE_DATA_API_KEY"] = ""
os.environ["RESEND_API_KEY"] = ""  # never email anyone from the test suite
os.environ["INPUT_MODERATION_ENABLED"] = "false"  # no key -> no-op anyway, explicit for clarity
os.environ["EMAIL_DOMAIN_CHECK_ENABLED"] = "false"  # no real DNS lookups from a free, deterministic suite

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client() -> TestClient:
    """Module-scoped: one fresh backend + one fresh TestClient per test FILE.
    `app.storage.db` is a process-wide singleton created once at import time
    (see storage.py's own docstring on why — it's the whole persistence
    design this branch deliberately kept, per Kiefer's "match quality, not
    structure" call), so re-running its constructor is how a test file gets
    a clean slate: fresh `_seed()` fixtures, zero leftover state from any
    other test file. `settings.firebase_configured` is False under this
    conftest's env, so `Database.__init__` always takes the `_seed()` path,
    never a real Firestore read/write — see storage.py's `__init__`."""
    from app.main import app
    from app.storage import Database, db

    Database.__init__(db)  # re-seed the shared singleton for this test file
    return TestClient(app)


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def parent(client: TestClient) -> dict:
    """UV05 — a freshly signed-up, NOT YET verified/consented parent. Most
    tests need more than this (see `active_parent` below); kept separate
    because several real checks specifically depend on the unverified/
    no-consent state (PA07 blocked before consent, etc.)."""
    r = client.post(
        "/api/auth/signup",
        json={"email": "parent.one@example.com", "password": "TestPass123", "name": "Test Parent One"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    return {"token": body["token"], "account": body["account"], "verify_token": body["verify_token"],
            "email": "parent.one@example.com", "password": "TestPass123", "headers": _auth(body["token"])}


@pytest.fixture(scope="module")
def active_parent(client: TestClient, parent: dict) -> dict:
    """PA28/UV06 already done — verified + consented, ready to create a
    child profile (PA07's real precondition, see routers/children.py)."""
    r = client.post("/api/auth/verify/confirm", json={"token": parent["verify_token"]})
    assert r.status_code == 200, r.text
    r = client.post("/api/account/consent", headers=parent["headers"], json={"password": parent["password"]})
    assert r.status_code == 200, r.text
    return parent


@pytest.fixture(scope="module")
def child(client: TestClient, active_parent: dict) -> dict:
    """PA07 — one child profile under `active_parent`, free-tier (1 of 1)."""
    r = client.post("/api/children", headers=active_parent["headers"], json={"name": "Test Kid", "age_band": "5-8"})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture(scope="module")
def child_session(client: TestClient, child: dict) -> dict:
    """CH01 — the child's own device-linking session (not the parent's)."""
    r = client.post("/api/children/link", json={"login_id": child["login_id"], "pin": child["pin"]})
    assert r.status_code == 200, r.text
    body = r.json()
    return {"token": body["token"], "child": body["child"], "headers": _auth(body["token"])}


@pytest.fixture(scope="module")
def moderator(client: TestClient) -> dict:
    """CM01 — the seeded demo moderator account (app/storage.py's `_seed`)."""
    r = client.post("/api/auth/login", json={"email": "moderator@pip.local", "password": "moderator123"})
    assert r.status_code == 200, r.text
    return {"headers": _auth(r.json()["token"])}


@pytest.fixture(scope="module")
def admin(client: TestClient) -> dict:
    """SA01 — the seeded demo admin account (app/storage.py's `_seed`)."""
    r = client.post("/api/auth/login", json={"email": "admin@pip.local", "password": "admin123"})
    assert r.status_code == 200, r.text
    return {"headers": _auth(r.json()["token"])}
