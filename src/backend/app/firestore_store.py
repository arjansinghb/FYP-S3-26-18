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

import json

from .config import settings

_DOC_ID = "snapshot"
_COLLECTION = "prototype_state"

_client = None


def _pack_embeddings(state: dict) -> dict:
    """Firestore indexes every element of every array field by default, and
    caps the total index entries per document — fine for this app's
    "whole state as one document" design (see this file's own docstring)
    right up until a catalogue item's real embedding (1536 floats,
    text-embedding-3-small) gets involved: a few dozen items' worth of
    embeddings alone blew past that per-document limit, and every save
    since then failed with INDEX_ENTRIES_COUNT_LIMIT_EXCEEDED — silently,
    because save_state()'s own except-and-ignore swallowed it (reasonable
    for a transient write hiccup, not for a deterministic one that repeats
    on every single save forever). Found live: real catalogue-expansion
    work this session kept vanishing on every backend restart even though
    Firebase itself was genuinely configured and reachable.
    Fix: store each embedding as one opaque JSON string instead of a
    native array before writing — Firestore indexes a string field as a
    single entry regardless of what's inside it, so this sidesteps the
    limit entirely without changing how storage.py's own routers use
    `embedding` as a real list at runtime (only this serialisation
    boundary knows the difference — see _unpack_embeddings below)."""
    content = state.get("content")
    if not isinstance(content, dict):
        return state
    packed = dict(state)
    packed["content"] = {
        cid: (
            {**item, "embedding": json.dumps(item["embedding"])}
            if isinstance(item, dict) and isinstance(item.get("embedding"), list)
            else item
        )
        for cid, item in content.items()
    }
    return packed


def _unpack_embeddings(state: dict) -> dict:
    content = state.get("content")
    if not isinstance(content, dict):
        return state
    for item in content.values():
        if isinstance(item, dict) and isinstance(item.get("embedding"), str):
            try:
                item["embedding"] = json.loads(item["embedding"])
            except (json.JSONDecodeError, TypeError):
                item["embedding"] = None
    return state


def _get_client():
    global _client
    if _client is not None:
        return _client

    import firebase_admin
    from firebase_admin import credentials, firestore

    if not firebase_admin._apps:
        # Vercel (and serverless platforms generally) have no writable/
        # persistent filesystem to upload secrets/firebase-admin.json to —
        # it's also deliberately gitignored, so a GitHub-triggered deploy
        # wouldn't have the file even if the platform did support one. The
        # real credential there is FIREBASE_ADMIN_CREDENTIALS_JSON, the
        # service account key's raw JSON *content* pasted into a Vercel env
        # var. Local dev keeps using the file path exactly as before —
        # this only adds a second, env-var-based way in, doesn't remove
        # the first.
        if settings.FIREBASE_ADMIN_CREDENTIALS_JSON:
            cred = credentials.Certificate(json.loads(settings.FIREBASE_ADMIN_CREDENTIALS_JSON))
        else:
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
    if not doc.exists:
        return None
    data = doc.to_dict()
    return _unpack_embeddings(data) if data else data


def save_state(state: dict) -> None:
    if not settings.firebase_configured:
        return
    try:
        _get_client().collection(_COLLECTION).document(_DOC_ID).set(_pack_embeddings(state))
    except Exception:
        # Best-effort persistence — a transient write failure shouldn't turn
        # into a 500 for the request that triggered it. NOTE: this used to
        # also be silently hiding a deterministic, always-repeating failure
        # (see _pack_embeddings' docstring) — if data stops persisting
        # again, don't assume "just a blip," reproduce save_state() in a
        # standalone script with the try/except removed and read the real
        # exception before assuming this fallback is doing its job.
        pass
