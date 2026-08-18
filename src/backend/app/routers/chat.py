"""CH04 (Start Chat Session), CH05 (End Chat Session), CH06-CH10 (the message
loop, handled together in POST .../messages — see app/services/chat_service.py),
CH17 (Give Feedback), CH18 (Request Alternative Recommendation).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import get_child_dual_auth, get_current_child
from app.models.chat import BotReply, ChatSession, FeedbackCreate, Message, MessageCreate, SessionWithMessages
from app.models.child import ChildProfile
from app.repositories import chat as chat_repo
from app.repositories import feedback as feedback_repo
from app.services import chat_service

router = APIRouter(tags=["chat"])


def _get_owned_session(session_id: str, child: ChildProfile) -> ChatSession:
    session = chat_repo.get_session(session_id)
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    if session.child_id != child.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your session")
    return session


@router.post("/children/{child_id}/sessions", response_model=ChatSession, status_code=status.HTTP_201_CREATED)
def start_session(child_id: str, child: ChildProfile = Depends(get_current_child)) -> ChatSession:
    """CH04 — Start Chat Session."""
    if child.id != child_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your profile")
    return chat_repo.create_session(child_id)


@router.post("/sessions/{session_id}/messages", response_model=BotReply)
def send_message(session_id: str, data: MessageCreate, child: ChildProfile = Depends(get_current_child)) -> BotReply:
    """CH06 (Send Natural-Language Query) through CH07/CH08/CH09/CH10."""
    session = _get_owned_session(session_id, child)
    if session.status == "ended":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Session already ended — start a new one")
    return chat_service.handle_message(session, child, data.text)


@router.get("/sessions/{session_id}/messages", response_model=list[Message])
def get_session_messages(session_id: str, child: ChildProfile = Depends(get_current_child)) -> list[Message]:
    """Not its own PRD use case — supports resuming/rendering a session's
    transcript client-side (e.g. after a page reload) without re-deriving it
    from individual POST /messages responses."""
    _get_owned_session(session_id, child)
    return chat_repo.list_messages(session_id)


@router.post("/sessions/{session_id}/alternative", response_model=BotReply)
def request_alternative(session_id: str, child: ChildProfile = Depends(get_current_child)) -> BotReply:
    """CH18 — Request Alternative Recommendation."""
    session = _get_owned_session(session_id, child)
    return chat_service.request_alternative(session, child)


@router.post("/sessions/{session_id}/end", response_model=ChatSession)
def end_session(session_id: str, child: ChildProfile = Depends(get_current_child)) -> ChatSession:
    """CH05 — End Chat Session."""
    _get_owned_session(session_id, child)
    chat_repo.end_session(session_id)
    return chat_repo.get_session(session_id)


@router.get("/children/{child_id}/sessions", response_model=list[ChatSession])
def list_sessions(child_id: str, child: ChildProfile = Depends(get_child_dual_auth)) -> list[ChatSession]:
    """Session summaries only (no transcripts) — reachable by child or parent."""
    return chat_repo.list_sessions_for_child(child_id)


@router.get("/children/{child_id}/activity", response_model=list[SessionWithMessages])
def get_activity(child_id: str, child: ChildProfile = Depends(get_child_dual_auth)) -> list[SessionWithMessages]:
    """PA14 — View Child's Activity: full chronological chat/recommendation
    log, each session with its complete transcript."""
    sessions = chat_repo.list_sessions_for_child(child_id)
    return [
        SessionWithMessages(**session.model_dump(), messages=chat_repo.list_messages(session.id))
        for session in sessions
    ]


@router.post("/recommendations/{item_id}/feedback", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def give_feedback(item_id: str, data: FeedbackCreate, child: ChildProfile = Depends(get_current_child)) -> None:
    """CH17 — Give Feedback on Recommendation. Persisted (see
    app/repositories/feedback.py); not yet read back into recommendation
    ranking — see src/backend/README.md known gaps."""
    feedback_repo.add_feedback(child.id, item_id, data.liked)
