"""Dialogue state machine — agent-context/CLAUDE.md §5.1:

    GREETING -> COLLECTING (<=2 clarifying rounds, hard cap) -> RECOMMENDING
       -> REACTING (feedback / "something else" / save) -> loop to RECOMMENDING,
         or back to COLLECTING if the child asks for something new

GREETING is CH04 (start_session, in the router); this module covers
COLLECTING/RECOMMENDING (`handle_message`, called from CH06 onward) and the
REACTING "something else" branch (`request_alternative`, CH18).
"""
from __future__ import annotations

from app.core.config import get_settings
from app.models.chat import BotReply, ChatSession, Slots
from app.models.child import ChildProfile
from app.repositories import chat as chat_repo
from app.services import openai_service, recommendation_service

_REDIRECT_MESSAGE = "Let's talk about something else — how about we find a book or video instead?"
_NO_MATCH_MESSAGE = "I couldn't find a close match yet — want to tell me a bit more about what you're looking for?"
_NO_MORE_MESSAGE = "That's everything I've got for that request — want to try something a bit different?"
_FOUND_MESSAGE = "Here's what I found for you!"
_ALTERNATIVE_MESSAGE = "How about these instead?"


def handle_message(session: ChatSession, child: ChildProfile, text: str) -> BotReply:
    """CH06 (Send Natural-Language Query) through CH07/CH08/CH09/CH10."""
    settings = get_settings()
    age_band = child.age_band

    # Safety layer 2: input filtering (CLAUDE.md §3 point 2) — screen before
    # anything else touches the message.
    if not openai_service.moderate_input(text):
        chat_repo.add_message(session.id, "child", text)
        chat_repo.add_message(session.id, "bot", _REDIRECT_MESSAGE)
        return BotReply(message=_REDIRECT_MESSAGE, session_status=session.status)

    chat_repo.add_message(session.id, "child", text)
    history = chat_repo.list_messages(session.id)
    # Role labels here are "kid"/"bot" (both <=3 chars), not the stored "child"/
    # "bot" sender values — openai_service's mock slot-extractor does naive
    # word-frequency topic-guessing over this text and a 4+-letter "child:"
    # label was getting picked up as the topic itself. Real OpenAI extraction
    # (when configured) never sees this — it gets a proper messages array.
    conversation_text = "\n".join(f"{'kid' if m.sender == 'child' else m.sender}: {m.text}" for m in history)

    extraction = openai_service.extract_slots_and_clarify(
        conversation_text=conversation_text,
        current_slots=session.slots,
        age_band=age_band,
        rounds_used=session.clarifying_rounds,
        round_cap=settings.clarifying_round_cap,
    )
    new_slots = session.slots.merge(Slots(**extraction["slots"]))
    needs_clarification = bool(extraction["needs_clarification"]) and session.clarifying_rounds < settings.clarifying_round_cap

    if needs_clarification:
        rounds = session.clarifying_rounds + 1
        chat_repo.update_session(session.id, slots=new_slots.model_dump(), clarifying_rounds=rounds)
        question = extraction.get("clarifying_question") or "Could you tell me a bit more about what you're in the mood for?"
        chat_repo.add_message(session.id, "bot", question, slots=new_slots)
        return BotReply(message=question, clarifying_question=question, session_status=session.status)

    # COLLECTING is done (either enough signal, or the round cap was hit) -> RECOMMENDING.
    recommendations = recommendation_service.recommend(
        slots=new_slots,
        age_band=age_band,
        exclude_item_ids=session.shown_item_ids,
        child_id=session.child_id,
        blocked_topics=child.safety_settings.blocked_topics,
        strict_age_filtering=child.safety_settings.strict_age_filtering,
    )
    shown = session.shown_item_ids + [r.item_id for r in recommendations]
    chat_repo.update_session(session.id, slots=new_slots.model_dump(), shown_item_ids=shown)

    if not recommendations:
        chat_repo.add_message(session.id, "bot", _NO_MATCH_MESSAGE, slots=new_slots)
        return BotReply(message=_NO_MATCH_MESSAGE, session_status=session.status)

    chat_repo.add_message(
        session.id, "bot", _FOUND_MESSAGE, slots=new_slots, recommendation_refs=[r.item_id for r in recommendations]
    )
    return BotReply(message=_FOUND_MESSAGE, recommendations=recommendations, session_status=session.status)


def request_alternative(session: ChatSession, child: ChildProfile) -> BotReply:
    """CH18 — Request Alternative Recommendation: same slots, excluding
    whatever's already been shown this session (REACTING loop back to
    RECOMMENDING)."""
    recommendations = recommendation_service.recommend(
        slots=session.slots,
        age_band=child.age_band,
        exclude_item_ids=session.shown_item_ids,
        child_id=session.child_id,
        blocked_topics=child.safety_settings.blocked_topics,
        strict_age_filtering=child.safety_settings.strict_age_filtering,
    )
    shown = session.shown_item_ids + [r.item_id for r in recommendations]
    chat_repo.update_session(session.id, shown_item_ids=shown)

    if not recommendations:
        chat_repo.add_message(session.id, "bot", _NO_MORE_MESSAGE)
        return BotReply(message=_NO_MORE_MESSAGE, session_status=session.status)

    chat_repo.add_message(session.id, "bot", _ALTERNATIVE_MESSAGE, recommendation_refs=[r.item_id for r in recommendations])
    return BotReply(message=_ALTERNATIVE_MESSAGE, recommendations=recommendations, session_status=session.status)
