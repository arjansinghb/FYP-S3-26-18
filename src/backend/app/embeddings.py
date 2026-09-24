"""Embedding-based content matching — the second half of URS Design
Constraint 3: "The recommendation engine is constrained to the OpenAI API
for both the conversational LLM and embedding-based content matching."

This is the retrieval step: a catalogue item's embedding (computed once, when
it's approved — see routers/content.py) is compared by cosine similarity
against the child's message embedding, and only the closest few items are
ever shown to the conversational LLM (app/brain.py's OpenAIBrain) to pick a
reply from. The LLM never sees or free-selects from the whole catalogue —
retrieval and conversation are two separate model calls, not one call doing
both jobs.
"""
from __future__ import annotations

from .config import settings

EMBEDDING_MODEL = "text-embedding-3-small"


def embed_text(text: str) -> list[float] | None:
    """Returns None (not an error) if OpenAI isn't configured or the call
    fails — callers should fall back to a non-embedding path rather than
    crash the chat loop over it."""
    if not settings.OPENAI_API_KEY or not text.strip():
        return None
    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        resp = client.embeddings.create(model=EMBEDDING_MODEL, input=text[:8000])
        return resp.data[0].embedding
    except Exception:
        return None


def embed_texts(texts: list[str]) -> list[list[float] | None]:
    """Batch form of embed_text — one API call for the lot (bulk import embeds
    a dozen items at once). Same contract: a None per text when unavailable."""
    out: list[list[float] | None] = [None] * len(texts)
    if not settings.OPENAI_API_KEY or not texts:
        return out
    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        resp = client.embeddings.create(model=EMBEDDING_MODEL, input=[t[:8000] or " " for t in texts])
        for row in resp.data:
            out[row.index] = row.embedding
    except Exception:
        pass
    return out


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if not norm_a or not norm_b:
        return 0.0
    return dot / (norm_a * norm_b)


def top_matches(query_embedding: list[float], catalogue: list[dict], limit: int = 4) -> list[dict]:
    """Ranks `catalogue` (each item optionally carrying an `embedding` list)
    by similarity to `query_embedding`, highest first. Items with no stored
    embedding sort last (rather than being dropped) so a freshly-approved
    item that hasn't been embedded yet is still recommendable, just not
    preferentially ranked by relevance."""
    scored = [
        (cosine_similarity(query_embedding, item["embedding"]) if item.get("embedding") else -1.0, item)
        for item in catalogue
    ]
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _, item in scored[:limit]]
