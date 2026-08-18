"""Local JSON-file-backed `DocumentStore`, used when Firebase Admin credentials
aren't configured (`settings.firebase_configured is False`) — see
agent-context/CLAUDE.md §12: lets the core loop be built/tested/demoed without a
live Firebase project. Not for production use: single JSON file, read+rewritten
on every write, no concurrency control. Good enough for one dev process.
"""
from __future__ import annotations

import json
import threading
from datetime import date, datetime
from pathlib import Path
from typing import Any

from app.repositories.base import DocumentExistsError, DocumentNotFoundError, DocumentStore

_DATA_FILE = Path(__file__).resolve().parents[2] / "data" / "local_store.json"


def _json_default(obj: Any) -> Any:
    if isinstance(obj, (datetime, date)):
        return {"__type__": "datetime" if isinstance(obj, datetime) else "date", "value": obj.isoformat()}
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


def _json_object_hook(d: dict[str, Any]) -> Any:
    if d.get("__type__") == "datetime":
        return datetime.fromisoformat(d["value"])
    if d.get("__type__") == "date":
        return date.fromisoformat(d["value"])
    return d


class LocalJSONStore(DocumentStore):
    def __init__(self, path: Path = _DATA_FILE) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            self._write({})

    def _read(self) -> dict[str, dict[str, Any]]:
        if not self._path.exists():
            return {}
        with self._path.open("r") as f:
            content = f.read().strip()
            if not content:
                return {}
            return json.loads(content, object_hook=_json_object_hook)

    def _write(self, data: dict[str, dict[str, Any]]) -> None:
        with self._path.open("w") as f:
            json.dump(data, f, default=_json_default, indent=2)

    def create(self, collection: str, doc_id: str, data: dict[str, Any]) -> None:
        with self._lock:
            db = self._read()
            db.setdefault(collection, {})
            if doc_id in db[collection]:
                raise DocumentExistsError(f"{collection}/{doc_id} already exists")
            db[collection][doc_id] = data
            self._write(db)

    def get(self, collection: str, doc_id: str) -> dict[str, Any] | None:
        with self._lock:
            db = self._read()
            return db.get(collection, {}).get(doc_id)

    def update(self, collection: str, doc_id: str, data: dict[str, Any]) -> None:
        with self._lock:
            db = self._read()
            existing = db.get(collection, {}).get(doc_id)
            if existing is None:
                raise DocumentNotFoundError(f"{collection}/{doc_id} not found")
            existing.update(data)
            db[collection][doc_id] = existing
            self._write(db)

    def delete(self, collection: str, doc_id: str) -> None:
        with self._lock:
            db = self._read()
            db.get(collection, {}).pop(doc_id, None)
            self._write(db)

    def list(self, collection: str, where: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        with self._lock:
            db = self._read()
            docs = list(db.get(collection, {}).values())
        if not where:
            return docs
        return [d for d in docs if all(d.get(k) == v for k, v in where.items())]
