"""Typed CRUD over `DocumentStore` for `chatSessions/{sessionId}` and its
`messages/{messageId}` (flattened — see app/repositories/base.py docstring).
See app/models/chat.py.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.models.chat import ChatSession, Message, Slots
from app.repositories.store import COLLECTION_CHAT_SESSIONS, COLLECTION_MESSAGES, get_store


def create_session(child_id: str) -> ChatSession:
    """CH04 — Start Chat Session."""
    session = ChatSession(id=str(uuid.uuid4()), child_id=child_id, started_at=datetime.now(timezone.utc))
    get_store().create(COLLECTION_CHAT_SESSIONS, session.id, session.model_dump())
    return session


def get_session(session_id: str) -> ChatSession | None:
    doc = get_store().get(COLLECTION_CHAT_SESSIONS, session_id)
    return ChatSession(**doc) if doc else None


def update_session(session_id: str, **fields) -> None:
    get_store().update(COLLECTION_CHAT_SESSIONS, session_id, fields)


def end_session(session_id: str, summary: str | None = None) -> None:
    """CH05 — End Chat Session."""
    update_session(session_id, status="ended", ended_at=datetime.now(timezone.utc), summary=summary)


def add_message(
    session_id: str,
    sender: str,
    text: str,
    slots: Slots | None = None,
    recommendation_refs: list[str] | None = None,
) -> Message:
    message = Message(
        id=str(uuid.uuid4()),
        session_id=session_id,
        sender=sender,
        text=text,
        timestamp=datetime.now(timezone.utc),
        slots=slots,
        recommendation_refs=recommendation_refs or [],
    )
    get_store().create(COLLECTION_MESSAGES, message.id, message.model_dump())
    return message


def list_messages(session_id: str) -> list[Message]:
    docs = get_store().list(COLLECTION_MESSAGES, {"session_id": session_id})
    return sorted((Message(**d) for d in docs), key=lambda m: m.timestamp)


def list_sessions_for_child(child_id: str) -> list[ChatSession]:
    """PA14 — View Child's Activity."""
    docs = get_store().list(COLLECTION_CHAT_SESSIONS, {"child_id": child_id})
    return sorted((ChatSession(**d) for d in docs), key=lambda s: s.started_at)


def delete_sessions_for_child(child_id: str) -> None:
    """Cascade delete — see app/repositories/children.py's `cascade_delete_child`."""
    store = get_store()
    for session in list_sessions_for_child(child_id):
        for message in list_messages(session.id):
            store.delete(COLLECTION_MESSAGES, message.id)
        store.delete(COLLECTION_CHAT_SESSIONS, session.id)
