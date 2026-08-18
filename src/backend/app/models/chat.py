"""Chat session/message models.

Covers CH04 (Start Chat Session), CH05 (End Chat Session), CH06 (Send
Natural-Language Query), CH07 (Respond to Clarifying Question), CH08/CH09
(Receive Book/Video Recommendation), CH10 (View Recommendation Explanation),
CH11 (Listen to Recommendation, TTS — optional playback of CH10's text, not
modelled separately here), CH17 (Give Feedback on Recommendation), and CH18
(Request Alternative Recommendation).

Implements the dialogue state machine from agent-context/CLAUDE.md §5.1:
GREETING -> COLLECTING (<=2 clarifying rounds) -> RECOMMENDING -> REACTING -> loop
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Sender = Literal["child", "bot"]
Format = Literal["book", "video", "either"]
SessionStatus = Literal["active", "ended"]


class Slots(BaseModel):
    format: Format | None = None
    topic: str | None = None
    mood: str | None = None
    difficulty: str | None = None

    def merge(self, other: "Slots") -> "Slots":
        """Newer non-null values win; keep prior ones otherwise (accumulates
        across turns rather than resetting each message)."""
        data = self.model_dump()
        for k, v in other.model_dump().items():
            if v is not None:
                data[k] = v
        return Slots(**data)

    def is_empty(self) -> bool:
        return not any(self.model_dump().values())


class ChatSession(BaseModel):
    id: str
    child_id: str
    started_at: datetime
    ended_at: datetime | None = None
    status: SessionStatus = "active"
    slots: Slots = Field(default_factory=Slots)
    clarifying_rounds: int = 0
    shown_item_ids: list[str] = Field(default_factory=list)  # excluded from "something else" (CH18)
    summary: str | None = None


class MessageCreate(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class RecommendationOut(BaseModel):
    """One catalogue item + why it was picked — CH08/CH09 (recommendation) +
    CH10 (explanation reason) combined into one payload. `embed_url` is
    CH12 (Watch Embedded Video) — set only for `type == "video"`, see
    app/services/recommendation_service.py's `_embed_url`."""

    item_id: str
    title: str
    type: Literal["book", "video"]
    reason: str
    embed_url: str | None = None


class Message(BaseModel):
    id: str
    session_id: str
    sender: Sender
    text: str
    timestamp: datetime
    slots: Slots | None = None
    recommendation_refs: list[str] = Field(default_factory=list)


class BotReply(BaseModel):
    """Response shape for POST /sessions/{id}/messages and /alternative."""

    message: str
    clarifying_question: str | None = None
    recommendations: list[RecommendationOut] = Field(default_factory=list)
    session_status: SessionStatus = "active"


class FeedbackCreate(BaseModel):
    """CH17 — Give Feedback on Recommendation."""

    item_id: str
    liked: bool


class SessionWithMessages(ChatSession):
    """PA14 — View Child's Activity: a session plus its full transcript, for
    the parent dashboard's chronological log view."""

    messages: list[Message] = Field(default_factory=list)
