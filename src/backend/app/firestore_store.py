"""Optional Firestore-backed persistence for storage.py's in-memory Database.

This is the ONE place that talks to Firestore, per storage.py's own docstring
("this whole file gets replaced by Firebase ... swapping the storage does not
touch the routers or the brain"). In practice the routers mutate `db`'s plain
Python dicts/lists directly in a lot of places (e.g. `item["status"] =
"approved"`), so a full per-record Firestore rewrite would mean touching every
router. Lighter-weight version that keeps that promise: `Database` still IS
the in-memory dict store (nothing about how routers use it changes), it just
loads its full state from one Firestore snapshot at startup and saves it back
after every mutating request (see main.py's persistence middleware) — so nothing
is lost on restart, without rewriting the routers' storage.py call sites.

Trade-off worth knowing: this snapshots the *whole* prototype state as a
handful of Firestore documents, not fine-grained per-record documents/queries.
Totally fine at this app's size (a few users/children/catalogue items for a
prototype/demo); not the pattern you'd want at real production scale — that's
what the team's other implementation (frontend-visual-overhaul branch) already
does properly with real per-collection Firestore access.

Collections live under `prototype_state/` specifically so they can never
collide with the other branch's schema (`parents`, `child_profiles`, etc.) —
same Firebase project, deliberately separate namespace.

Falls back to a no-op everywhere when `settings.firebase_configured` is False,
so the backend keeps running with zero setup exactly like before this pass.
"""
from __future__ import annotations

from .config import settings

_DOC_ID = "snapshot"
_COLLECTION = "prototype_state"

_client = None


def _get_client():
    global _client
    if _client is not None:
        return _client

    import firebase_admin
    from firebase_admin import credentials, firestore

    if not firebase_admin._apps:
        cred = credentials.Certificate(str(settings.firebase_admin_credentials_full_path))
        firebase_admin.initialize_app(cred, {"projectId": settings.FIREBASE_PROJECT_ID})
    _client = firestore.client()
    return _client


def load_state() -> dict | None:
    """Returns the last-saved state dict, or None if Firestore isn't
    configured or nothing has been saved yet (first run)."""
    if not settings.firebase_configured:
        return None
    try:
        doc = _get_client().collection(_COLLECTION).document(_DOC_ID).get()
    except Exception:
        # Real network/credentials/project issue — don't take the whole
        # backend down over it, just fall back to a fresh in-memory seed.
        return None
    return doc.to_dict() if doc.exists else None


def save_state(state: dict) -> None:
    if not settings.firebase_configured:
        return
    try:
        _get_client().collection(_COLLECTION).document(_DOC_ID).set(state)
    except Exception:
        # Best-effort persistence — a transient write failure shouldn't turn
        # into a 500 for the request that triggered it.
        pass
