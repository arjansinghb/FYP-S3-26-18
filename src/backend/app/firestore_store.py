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

# Catalogue-item embeddings (1536 floats, text-embedding-3-small — see
# app/embeddings.py) live in their OWN collection, one small document per
# item, instead of inline in the single `_COLLECTION`/`_DOC_ID` snapshot doc
# above. Real, reproduced bug this closes (2026-09-23): Firestore caps a
# single document at ~1 MiB. One embedding serialised is ~31 KB — a few
# dozen approved items and the WHOLE snapshot (every user, every catalogue
# item, everything) blows past that cap. save_state()'s own except-and-
# ignore then silently swallows every save from that point on: the API
# still answers 200 with real-looking ids (the in-memory mutation for that
# one request genuinely happened), but nothing persists, and the very next
# request anywhere in the app — not just catalogue ones — reloads the last
# state that DID fit and quietly loses everything since. Reproduced live
# via bulk-import (app/bulk_import.py): four import runs in a row returned
# success, and a moment later none of the 13 new items existed in
# Firestore at all. An EARLIER pass already hit a *related* but different
# Firestore limit here — see _pack_embeddings' docstring below, kept for
# backward-compatible reads of a snapshot saved before this fix — but that
# fix only reduced the number of *indexed array entries* an embedding
# counted as; the embedding's raw bytes were still sitting inside the same
# one document, so total document SIZE kept growing right along with the
# catalogue regardless. Splitting embeddings into their own per-item
# documents removes the ceiling entirely: Firestore's size cap is per
# document, not per collection, so this scales to a real catalogue size
# the single-document design never could, without abandoning that design
# for everything else (still "totally fine at this app's size", per this
# file's own docstring above).
_EMBEDDINGS_COLLECTION = "prototype_state_embeddings"

_client = None


def _pack_embeddings(state: dict) -> dict:
    """Kept ONLY so `load_state` can still read a snapshot saved before the
    embeddings-split fix above (where a catalogue item's embedding was
    stored inline as a packed JSON string) — `save_state` no longer calls
    this; it strips embeddings out entirely instead (see `_strip_content_embeddings`).
    Firestore indexes every element of every array field by default and
    caps the total index entries per document — an embedding's raw
    `[float, ...]` blew past that on its own, so this stored it as one
    opaque JSON string instead (a string field indexes as a single entry
    regardless of what's inside it). Left here, unused by the write path,
    purely as the historical record of that first fix."""
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
    """The read-side counterpart to `_pack_embeddings` above — reverses that
    old packed-string format for any item saved before the embeddings-split
    fix. `load_state` runs this FIRST, then overlays the new per-item
    embeddings collection on top (see `_load_embeddings`) for anything this
    doesn't already cover — together they make the transition to the new
    storage shape a transparent one-time migration, not a manual step."""
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


def _strip_content_embeddings(content: dict) -> dict:
    """A copy of `content` with every item's `embedding` field removed —
    what actually goes into the main snapshot document now. The real list
    lives only in `_EMBEDDINGS_COLLECTION`, one document per item (see
    `_save_embeddings`/`_load_embeddings`)."""
    return {
        cid: ({k: v for k, v in item.items() if k != "embedding"} if isinstance(item, dict) else item)
        for cid, item in content.items()
    }


def _save_embeddings(content: dict) -> None:
    """One small document per catalogue item that actually HAS a computed
    embedding, batched (Firestore caps a batch at 500 writes; chunked well
    under that). Rewrites all of them on every call rather than tracking
    which ones actually changed — matches this file's existing "whole
    state, every mutating request" trade-off (see the module docstring):
    simpler, and cheap at this app's real catalogue size. Nothing here
    deletes a document for an item that's lost its embedding (rejected,
    etc.) — a stray leftover embedding for a non-approved item is inert
    (approved_content()/top_matches never look at it) and not worth the
    extra round-trip to clean up."""
    client = _get_client()
    coll = client.collection(_EMBEDDINGS_COLLECTION)
    items_with_embeddings = [
        (cid, item["embedding"]) for cid, item in content.items()
        if isinstance(item, dict) and isinstance(item.get("embedding"), list)
    ]
    for start in range(0, len(items_with_embeddings), 400):
        batch = client.batch()
        for cid, embedding in items_with_embeddings[start:start + 400]:
            batch.set(coll.document(cid), {"embedding": embedding})
        batch.commit()


def _load_embeddings() -> dict[str, list]:
    """`{content_id: embedding}` for every item that has one saved. Any
    Firestore hiccup here degrades to "no embeddings loaded this run" rather
    than failing the whole state load — same fail-open posture as
    embeddings.py's own embed_text: a missing embedding just means that
    item sorts last in retrieval (see embeddings.top_matches), never a crash."""
    try:
        return {doc.id: (doc.to_dict() or {}).get("embedding") for doc in _get_client().collection(_EMBEDDINGS_COLLECTION).stream()}
    except Exception:
        return {}


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
    if not data:
        return data
    data = _unpack_embeddings(data)  # backward-compat: pre-migration inline embeddings, if any remain
    content = data.get("content")
    if isinstance(content, dict):
        embeddings = _load_embeddings()
        for cid, item in content.items():
            if isinstance(item, dict) and not item.get("embedding") and cid in embeddings:
                item["embedding"] = embeddings[cid]
    return data


def save_state(state: dict) -> None:
    if not settings.firebase_configured:
        return
    try:
        content = state.get("content")
        if isinstance(content, dict):
            _save_embeddings(content)
            state = {**state, "content": _strip_content_embeddings(content)}
        _get_client().collection(_COLLECTION).document(_DOC_ID).set(state)
    except Exception:
        # Best-effort persistence — a transient write failure shouldn't turn
        # into a 500 for the request that triggered it. NOTE: this used to
        # also be silently hiding a deterministic, always-repeating failure
        # (see this file's module docstring, both the embeddings-split note
        # above and _pack_embeddings' own history) — if data stops
        # persisting again, don't assume "just a blip," reproduce
        # save_state() in a standalone script with the try/except removed
        # and read the real exception before assuming this fallback is
        # doing its job.
        pass
