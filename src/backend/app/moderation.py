"""Input safety: screens a child's message for unsafe *topics* before it
ever reaches the conversational model — a real, separate layer from
app/pii.py's scrubbing (that hides identifying details in text that's
still sent on; this decides whether to send the message on to the model
at all). Part of this project's documented safety stack from early on
("screen the child's message before it reaches any model; redirect rather
than answer if it's steering toward an unsafe topic") but never actually
implemented until now — a real, verified gap found during a full-system
audit, not a hypothetical one.

Uses OpenAI's Moderation API (`omni-moderation-latest`, free — no extra
cost or key beyond the OPENAI_API_KEY already configured for chat/
embeddings). This is one additional layer, not *the* safety control: the
structural guarantee this product actually relies on is that Pip can only
ever recommend items from the human-moderated catalogue (see brain.py) —
that holds regardless of whether this check runs, fails, or is disabled.
"""
from __future__ import annotations

from .config import settings

# A short, friendly redirect — never explains *why* (a young child doesn't
# need the mechanics of content moderation described to them), just
# gently steers back to what Pip actually does.
REDIRECT_REPLY = "Let's talk about something else! What kind of book or video sounds fun to you today?"


def is_unsafe(text: str) -> bool:
    """True if `text` was flagged by OpenAI's Moderation API. False if it's
    fine, or if the check couldn't run at all (no key configured, or the
    API call itself failed) — this fails OPEN on availability, not safety:
    a moderation-API hiccup shouldn't take down the whole chat feature,
    and the catalogue-only recommendation guarantee behind it is the real
    backstop regardless of whether this specific check ran."""
    if not text or not text.strip() or not settings.INPUT_MODERATION_ENABLED or not settings.OPENAI_API_KEY:
        return False
    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        result = client.moderations.create(input=text)
        return bool(result.results[0].flagged)
    except Exception:
        return False
