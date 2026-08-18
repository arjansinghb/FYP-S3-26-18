"""Minimal document-store interface. Both the Firestore-backed and local
JSON-file-backed implementations (see `firestore_store.py` / `local_store.py`)
satisfy this — routers/services depend on this interface, never on a concrete
implementation, via `get_store()` in `store.py`.

Operates on plain dicts (already JSON/Firestore-safe types); Pydantic model
(de)serialization happens in the router/service layer. This also means nested
Firestore subcollections from agent-context/CLAUDE.md §6
(`parents/{id}/childProfiles/{id}/...`) are flattened here into top-level
collections with a foreign-key field (`parent_id`, `child_id`, `session_id`) —
functionally equivalent for the query patterns this app needs (get-by-id,
list-where-field-equals), and it keeps one code path working against both a
real Firestore project and the local dev store.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class DocumentStore(ABC):
    @abstractmethod
    def create(self, collection: str, doc_id: str, data: dict[str, Any]) -> None:
        """Create a new document. Raises if `doc_id` already exists in `collection`."""

    @abstractmethod
    def get(self, collection: str, doc_id: str) -> dict[str, Any] | None:
        ...

    @abstractmethod
    def update(self, collection: str, doc_id: str, data: dict[str, Any]) -> None:
        """Partial update (merge), matching Firestore's `.set(..., merge=True)`."""

    @abstractmethod
    def delete(self, collection: str, doc_id: str) -> None:
        ...

    @abstractmethod
    def list(self, collection: str, where: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """List documents in `collection`, optionally filtered by exact-match
        field equality (all conditions ANDed) — the only query shape this app
        currently needs."""


class DocumentExistsError(Exception):
    pass


class DocumentNotFoundError(Exception):
    pass
