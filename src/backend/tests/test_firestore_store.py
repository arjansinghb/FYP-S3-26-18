"""Firestore persistence (app/firestore_store.py) — specifically the
embeddings-split fix: catalogue item embeddings must live in their OWN small
per-item documents, never inline in the single whole-state snapshot document,
because that snapshot blowing past Firestore's ~1 MiB per-document cap once
the catalogue grew was a real, reproduced bug (silent save failures — see
that file's module docstring for the full story).

Nothing here touches real Firestore: `_get_client` is monkeypatched to a tiny
in-memory fake that implements just the surface this module actually calls
(collection/document/get/set/batch/stream), so these tests run everywhere
tests already do, with real assertions on real (fake-backed) round-trips.
"""
from __future__ import annotations

import json

import pytest

from app import firestore_store as fs


class _FakeDoc:
    def __init__(self, store: dict, key: str):
        self._store, self._key = store, key
        self.id = key  # real DocumentSnapshot.id — _load_embeddings reads this in .stream()

    def get(self):
        return self

    @property
    def exists(self):
        return self._key in self._store

    def to_dict(self):
        return self._store.get(self._key)

    def set(self, data):
        self._store[self._key] = data


class _FakeBatch:
    def __init__(self):
        self._writes = []

    def set(self, doc_ref, data):
        self._writes.append((doc_ref, data))

    def commit(self):
        for doc_ref, data in self._writes:
            doc_ref.set(data)
        self._writes.clear()


class _FakeCollection:
    def __init__(self, client: "FakeFirestoreClient", name: str):
        self._client, self._name = client, name

    def document(self, doc_id):
        return _FakeDoc(self._client.stores.setdefault(self._name, {}), doc_id)

    def stream(self):
        for doc_id, data in self._client.stores.get(self._name, {}).items():
            yield _FakeDoc(self._client.stores[self._name], doc_id)


class FakeFirestoreClient:
    """`stores["prototype_state"]["snapshot"]` = the main doc's data;
    `stores["prototype_state_embeddings"][content_id]` = that item's doc."""

    def __init__(self):
        self.stores: dict[str, dict] = {}
        self.batch_calls = 0

    def collection(self, name):
        return _FakeCollection(self, name)

    def batch(self):
        self.batch_calls += 1
        return _FakeBatch()


@pytest.fixture(autouse=True)
def fake_client(monkeypatch):
    client = FakeFirestoreClient()
    monkeypatch.setattr(fs, "_client", client)
    monkeypatch.setattr(fs, "_get_client", lambda: client)
    monkeypatch.setattr(type(fs.settings), "firebase_configured", property(lambda self: True))
    # _embeddings_cache is a module-level, in-process cache (see its own
    # comment in firestore_store.py) meant to survive across requests within
    # one warm instance — but that means it also survives across tests in
    # this file unless reset here, which would let one test's cached values
    # silently suppress another test's expected writes.
    monkeypatch.setattr(fs, "_embeddings_cache", None)
    return client


def _content(n=1, with_embedding=True):
    return {
        f"c{i}": {
            "id": f"c{i}", "title": f"Book {i}", "status": "approved",
            "embedding": ([0.1, 0.2, 0.3] if with_embedding else None),
        }
        for i in range(n)
    }


def _full_state(content):
    # Every key save_state actually gets called with, per storage.py's save().
    return {
        "accounts": {}, "children": {}, "content": content, "favourites": {}, "activity": {},
        "feedback": {}, "reports": [], "tickets": [], "content_overrides": {}, "notifications": [],
        "billing_records": [], "chat_sessions": {}, "deletion_requests": [], "reviews": {},
        "system": {}, "tokens": {}, "verify_tokens": {}, "reset_tokens": {}, "topic_misses": [],
    }


# ---- save_state strips embeddings out of the main doc ----

def test_save_state_never_puts_embeddings_in_the_main_document(fake_client):
    fs.save_state(_full_state(_content(3)))
    main_doc = fake_client.stores["prototype_state"]["snapshot"]
    assert all("embedding" not in item for item in main_doc["content"].values())
    # every other field survives untouched
    assert {main_doc["content"][f"c{i}"]["title"] for i in range(3)} == {"Book 0", "Book 1", "Book 2"}


def test_save_state_writes_one_small_document_per_embedding(fake_client):
    fs.save_state(_full_state(_content(3)))
    emb_store = fake_client.stores["prototype_state_embeddings"]
    assert set(emb_store.keys()) == {"c0", "c1", "c2"}
    assert emb_store["c0"]["embedding"] == [0.1, 0.2, 0.3]


def test_items_without_an_embedding_get_no_embedding_document(fake_client):
    content = _content(2, with_embedding=False)
    fs.save_state(_full_state(content))
    assert fake_client.stores.get("prototype_state_embeddings", {}) == {}


def test_a_large_number_of_embeddings_is_batched_under_the_500_write_cap(fake_client, monkeypatch):
    calls = []
    real_batch = fake_client.batch
    monkeypatch.setattr(fake_client, "batch", lambda: (calls.append(1), real_batch())[1])
    fs.save_state(_full_state(_content(900)))
    assert len(calls) == 3  # 900 items / 400-per-batch chunks -> 3 commits
    assert len(fake_client.stores["prototype_state_embeddings"]) == 900


# ---- load_state reassembles items from the separate collection ----

def test_load_state_merges_the_separate_embedding_back_onto_its_item(fake_client):
    fs.save_state(_full_state(_content(2)))
    loaded = fs.load_state()
    assert loaded["content"]["c0"]["embedding"] == [0.1, 0.2, 0.3]
    assert loaded["content"]["c1"]["embedding"] == [0.1, 0.2, 0.3]


def test_load_state_leaves_an_item_with_no_saved_embedding_as_none(fake_client):
    fs.save_state(_full_state(_content(1, with_embedding=False)))
    loaded = fs.load_state()
    assert loaded["content"]["c0"].get("embedding") is None


def test_a_missing_embeddings_collection_degrades_to_no_embeddings_not_a_crash(fake_client):
    # Main doc saved the old way (nothing ever wrote to the embeddings collection).
    fake_client.stores["prototype_state"] = {"snapshot": _full_state(_content(1, with_embedding=False))}
    loaded = fs.load_state()
    assert loaded["content"]["c0"].get("embedding") is None


# ---- backward compatibility: a snapshot saved before this fix ----

def test_a_pre_migration_inline_packed_embedding_still_loads(fake_client):
    """Simulates exactly what production had on disk before this fix: the
    OLD _pack_embeddings format (embedding stored as a JSON string, inline
    in the main doc) — with nothing yet in the new separate collection."""
    old_style = _full_state({"c0": {"id": "c0", "title": "Old Book", "status": "approved", "embedding": json.dumps([9.0, 8.0])}})
    fake_client.stores["prototype_state"] = {"snapshot": old_style}
    loaded = fs.load_state()
    assert loaded["content"]["c0"]["embedding"] == [9.0, 8.0]


def test_one_save_after_loading_an_old_snapshot_migrates_it_to_the_new_shape(fake_client):
    old_style = _full_state({"c0": {"id": "c0", "title": "Old Book", "status": "approved", "embedding": json.dumps([9.0, 8.0])}})
    fake_client.stores["prototype_state"] = {"snapshot": old_style}

    loaded = fs.load_state()  # unpacks the old inline string into a real list
    fs.save_state(loaded)     # the split-write path takes it from here

    main_doc = fake_client.stores["prototype_state"]["snapshot"]
    assert "embedding" not in main_doc["content"]["c0"]  # no longer inline at all
    assert fake_client.stores["prototype_state_embeddings"]["c0"]["embedding"] == [9.0, 8.0]
    # and it still round-trips correctly on the next load
    assert fs.load_state()["content"]["c0"]["embedding"] == [9.0, 8.0]


# ---- the real-world failure this whole fix targets ----

def test_the_document_that_used_to_overflow_now_stays_tiny(fake_client):
    """The reproduced bug: a combined snapshot with real-sized embeddings
    (~31KB each, per the live measurement that found this bug) blew past
    Firestore's ~1MiB per-document cap once the catalogue had a few dozen
    approved items. With embeddings split out, the main document's size no
    longer scales with catalogue size AT ALL."""
    big_content = {
        f"c{i}": {"id": f"c{i}", "title": f"Book {i}", "status": "approved",
                  "description": "x" * 500, "embedding": [0.123456789] * 1536}
        for i in range(80)  # comfortably more than what broke production
    }
    fs.save_state(_full_state(big_content))

    main_doc_size = len(json.dumps(fake_client.stores["prototype_state"]["snapshot"]))
    assert main_doc_size < 100_000  # nowhere near the ~1,048,487-byte cap
    # nothing was lost — it's just stored differently
    assert len(fake_client.stores["prototype_state_embeddings"]) == 80
    assert fs.load_state()["content"]["c79"]["embedding"] == [0.123456789] * 1536


# ---- fail-safe behaviour is unchanged ----

def test_save_state_swallows_a_write_failure_without_raising(fake_client, monkeypatch):
    def boom(data):
        raise RuntimeError("simulated Firestore outage")

    monkeypatch.setattr(fake_client.collection("prototype_state").document("snapshot"), "set", boom)
    fs.save_state(_full_state(_content(1)))  # must not raise


def test_load_state_returns_none_on_a_read_failure(fake_client, monkeypatch):
    def boom():
        raise RuntimeError("simulated Firestore outage")

    monkeypatch.setattr(fake_client.collection("prototype_state").document("snapshot"), "get", boom)
    assert fs.load_state() is None


def test_not_configured_is_a_no_op_both_ways(monkeypatch):
    monkeypatch.setattr(type(fs.settings), "firebase_configured", property(lambda self: False))
    fs.save_state(_full_state(_content(1)))  # no client ever touched, no error
    assert fs.load_state() is None
