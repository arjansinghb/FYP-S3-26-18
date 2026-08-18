"""OpenAI wrapper — the only module that touches the OpenAI API. Falls back to
a deterministic mock implementation when `settings.openai_configured` is False,
so the chat pipeline is testable/demoable without a real API key or burning
credits — see agent-context/CLAUDE.md §12. Mocks are clearly not real NLP; swap
in a real `OPENAI_API_KEY` (see .env.example) to get real behaviour, no code
changes required.

Two usages kept conceptually separate per agent-context/CLAUDE.md §7's closing
note: (a) the conversational/LLM layer — `extract_slots_and_clarify`,
`explain_recommendation`; (b) the embeddings layer — `embed_text`. Never let (a)
do (b)'s job: the LLM is never asked to "just recommend a book," only to
describe items the retrieval step (recommendation_service.py) already picked.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from app.core.config import get_settings
from app.models.chat import Slots

SYSTEM_PROMPT = (
    "You are a friendly companion for a child aged {age_band}. You only ever talk "
    "about books and videos from the provided catalogue list — never invent, "
    "describe, or recommend anything not in that list, and never answer questions "
    "unrelated to finding a book or video. If the request is unclear, ask exactly "
    "one short, simple question to narrow it down. Speak in short, age-appropriate "
    "sentences."
)

# Only the slot-extraction call is JSON-mode — this instruction must NOT be part
# of the base SYSTEM_PROMPT above, or the explanation call (which wants plain
# text) starts wrapping its answer in a JSON blob too (real bug hit during
# testing: gpt-4o-mini took "respond only in JSON" literally for both calls).
JSON_MODE_INSTRUCTION = " Respond only in the given JSON schema."

SLOT_SCHEMA_INSTRUCTIONS = (
    'Extract slots from the conversation so far and decide whether to ask a '
    'clarifying question. Respond with JSON matching this shape exactly: '
    '{"slots": {"format": "book|video|either|null", "topic": "string|null", '
    '"mood": "string|null", "difficulty": "string|null"}, "confidence": '
    '"low|medium|high", "needs_clarification": true|false, "clarifying_question": '
    '"string|null"}'
)


def moderate_input(text: str) -> bool:
    """Input filtering layer (CLAUDE.md §3 point 2). Returns True if `text` is
    safe to pass on to the main chat model."""
    settings = get_settings()
    if not settings.openai_configured:
        return _mock_moderate(text)

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    result = client.moderations.create(input=text)
    return not result.results[0].flagged


def extract_slots_and_clarify(
    conversation_text: str,
    current_slots: Slots,
    age_band: str,
    rounds_used: int,
    round_cap: int,
) -> dict[str, Any]:
    """(a) conversational layer — one structured JSON-mode call per turn."""
    settings = get_settings()
    if not settings.openai_configured:
        return _mock_extract_slots(conversation_text, current_slots, rounds_used, round_cap)

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    response = client.chat.completions.create(
        model=settings.openai_chat_model,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": SYSTEM_PROMPT.format(age_band=age_band) + JSON_MODE_INSTRUCTION + "\n\n" + SLOT_SCHEMA_INSTRUCTIONS,
            },
            {
                "role": "user",
                "content": f"Current known slots: {current_slots.model_dump_json()}\n"
                f"Conversation so far:\n{conversation_text}",
            },
        ],
    )
    return json.loads(response.choices[0].message.content)


def explain_recommendation(item_title: str, item_synopsis: str, slots: Slots, age_band: str) -> str:
    """(a) conversational layer — CH10's one-sentence explanation, constrained
    to only describe the given catalogue item's own metadata (never free
    generation — see agent-context/CLAUDE.md §3 point 3)."""
    settings = get_settings()
    if not settings.openai_configured:
        return _mock_explain(item_title, slots)

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    prompt = (
        f"Write ONE short, friendly sentence (age {age_band}) explaining why "
        f"'{item_title}' fits what the child asked for. Use only this synopsis — "
        f"never add facts not in it: {item_synopsis}. Child's request context: "
        f"{slots.model_dump_json()}."
    )
    response = client.chat.completions.create(
        model=settings.openai_chat_model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT.format(age_band=age_band)},
            {"role": "user", "content": prompt},
        ],
    )
    return response.choices[0].message.content.strip()


def embed_text(text: str) -> list[float]:
    """(b) embeddings layer — used for both catalogue items (at CM09/CM10
    tagging time, see scripts/seed_catalogue.py) and per-turn query text
    (recommendation_service.py)."""
    settings = get_settings()
    if not settings.openai_configured:
        return _mock_embed(text)

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    response = client.embeddings.create(model=settings.openai_embedding_model, input=text)
    return response.data[0].embedding


# ---------------------------------------------------------------------------
# Mock implementations — deterministic, no network calls. Active whenever
# OPENAI_API_KEY isn't set. Same function signatures as above so routers/
# services never need to know which path is active.
# ---------------------------------------------------------------------------

_MOOD_WORDS = ["funny", "exciting", "calm", "calming", "scary", "silly", "adventurous", "sad", "happy"]
_FORMAT_WORDS = {
    "book": "book",
    "read": "book",
    "story": "book",
    "video": "video",
    "watch": "video",
    "show": "video",
}
_STOP_WORDS = {
    "book", "video", "read", "story", "watch", "show", "something", "about",
    "want", "like", "find", "give", "help", "please", "with", "that", "have",
}
_UNSAFE_PATTERN = re.compile(r"\b(kill|suicide|self-harm|drugs|porn|sex)\b", re.IGNORECASE)


def _mock_moderate(text: str) -> bool:
    return not _UNSAFE_PATTERN.search(text)


def _mock_extract_slots(conversation_text: str, current: Slots, rounds_used: int, round_cap: int) -> dict[str, Any]:
    text = conversation_text.lower()

    fmt = current.format
    if fmt is None:
        for word, mapped in _FORMAT_WORDS.items():
            if word in text:
                fmt = mapped
                break

    mood = current.mood
    if mood is None:
        for word in _MOOD_WORDS:
            if word in text:
                mood = word
                break

    topic = current.topic
    if topic is None:
        words = re.findall(r"[a-zA-Z]{4,}", text)
        candidates = [w for w in words if w not in _STOP_WORDS and w not in _MOOD_WORDS and w not in _FORMAT_WORDS]
        if candidates:
            topic = candidates[-1]

    needs_clarification = False
    clarifying_question = None
    if fmt is None and rounds_used < round_cap:
        needs_clarification = True
        clarifying_question = "Would you like a book or a video?"
    elif topic is None and rounds_used < round_cap:
        needs_clarification = True
        clarifying_question = "What kind of thing are you interested in — like animals, space, or something else?"

    return {
        "slots": {"format": fmt, "topic": topic, "mood": mood, "difficulty": current.difficulty},
        "confidence": "medium",
        "needs_clarification": needs_clarification,
        "clarifying_question": clarifying_question,
    }


def _mock_explain(item_title: str, slots: Slots) -> str:
    bits = []
    if slots.mood:
        bits.append(f"it's a {slots.mood} pick")
    if slots.topic:
        bits.append(f"it's about {slots.topic}")
    reason = " and ".join(bits) if bits else "it matches what you're looking for"
    return f'I picked "{item_title}" because {reason}!'


def _mock_embed(text: str, dims: int = 64) -> list[float]:
    """Deterministic hash-based pseudo-embedding — enough to sanity-check the
    retrieval/cosine-similarity plumbing end-to-end locally. NOT real semantic
    similarity. Real OpenAI embeddings kick in automatically once
    OPENAI_API_KEY is set (see get_settings().openai_configured)."""
    tokens = re.findall(r"[a-zA-Z]+", text.lower())
    vec = [0.0] * dims
    for tok in tokens:
        h = int(hashlib.sha256(tok.encode()).hexdigest(), 16)
        vec[h % dims] += 1.0
    norm = sum(v * v for v in vec) ** 0.5
    if norm > 0:
        vec = [v / norm for v in vec]
    return vec
