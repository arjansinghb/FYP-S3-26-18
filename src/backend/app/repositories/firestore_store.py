"""Firestore-backed `DocumentStore`, used once `settings.firebase_configured` is
True (a real service-account JSON is present, see app/core/config.py).
"""
from __future__ import annotations

from typing import Any

from app.repositories.base import DocumentExistsError, DocumentNotFoundError, DocumentStore


class FirestoreStore(DocumentStore):
    def __init__(self) -> None:
        # Imported lazily so `firebase_admin` (and its network/creds init) is
        # never touched in local-dev-store mode.
        import firebase_admin
        from firebase_admin import credentials, firestore

        from app.core.config import get_settings

        settings = get_settings()
        if not firebase_admin._apps:
            cred = credentials.Certificate(str(settings.firebase_admin_credentials_full_path))
            firebase_admin.initialize_app(cred, {"projectId": settings.firebase_project_id})
        self._db = firestore.client()

    def create(self, collection: str, doc_id: str, data: dict[str, Any]) -> None:
        ref = self._db.collection(collection).document(doc_id)
        if ref.get().exists:
            raise DocumentExistsError(f"{collection}/{doc_id} already exists")
        ref.set(data)

    def get(self, collection: str, doc_id: str) -> dict[str, Any] | None:
        snap = self._db.collection(collection).document(doc_id).get()
        return snap.to_dict() if snap.exists else None

    def update(self, collection: str, doc_id: str, data: dict[str, Any]) -> None:
        ref = self._db.collection(collection).document(doc_id)
        if not ref.get().exists:
            raise DocumentNotFoundError(f"{collection}/{doc_id} not found")
        ref.set(data, merge=True)

    def delete(self, collection: str, doc_id: str) -> None:
        self._db.collection(collection).document(doc_id).delete()

    def list(self, collection: str, where: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        query = self._db.collection(collection)
        for field, value in (where or {}).items():
            query = query.where(field, "==", value)
        return [doc.to_dict() for doc in query.stream()]
