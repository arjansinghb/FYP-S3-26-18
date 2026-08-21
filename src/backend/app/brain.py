"""Pip's "brain": turns a child's message into a spoken reply + recommendations.

This is the ONE swap point for the AI provider. Right now it uses a keyword
placeholder (no API key needed). Later, add an OpenAIBrain / AnthropicBrain
class with the same `.respond()` shape and select it via BRAIN_PROVIDER — the
routers never change, because they only call `get_brain().respond(...)`.
"""
import random
from dataclasses import dataclass, field

from .config import settings

# genre keywords the placeholder understands -> catalogue genre tags
GENRE_KEYWORDS = {
    "funny": ["funny", "laugh", "silly", "joke", "giggle"],
    "space": ["space", "planet", "star", "moon", "rocket", "galaxy"],
    "dinosaur": ["dinosaur", "dino", "t-rex", "rex"],
    "animals": ["animal", "dog", "cat", "lion", "tiger", "jungle"],
    "adventure": ["adventure", "explore", "quest", "brave"],
    "cosy": ["scared", "sad", "sleep", "bedtime", "cosy", "calm"],
    "science": ["science", "experiment", "how", "why", "work"],
    "mystery": ["mystery", "detective", "secret", "clue"],
}
BOOK_WORDS = ["book", "read", "story", "stories"]
VIDEO_WORDS = ["video", "watch", "movie", "show", "clip"]


@dataclass
class BrainResult:
    reply: str
    recommendations: list = field(default_factory=list)  # list of content dicts


class PlaceholderBrain:
    """No real intelligence — just keyword matching over the catalogue."""

    def respond(self, message: str, age_band: str | None, catalogue: list[dict]) -> BrainResult:
        text = f" {message.lower()} "

        wanted_type = None
        if any(w in text for w in VIDEO_WORDS):
            wanted_type = "video"
        elif any(w in text for w in BOOK_WORDS):
            wanted_type = "book"

        wanted_genres = [
            genre for genre, words in GENRE_KEYWORDS.items()
            if any(f" {w}" in text for w in words)
        ]

        # filter the (already-approved) catalogue
        def matches(item):
            if age_band and age_band not in item["age_bands"]:
                return False
            if wanted_type and item["type"] != wanted_type:
                return False
            if wanted_genres and not set(wanted_genres) & set(item.get("genres", [])):
                return False
            return True

        picks = [c for c in catalogue if matches(c)]

        # if genre asked but nothing matched, relax the genre filter
        if not picks and wanted_genres:
            picks = [c for c in catalogue if (not age_band or age_band in c["age_bands"])
                     and (not wanted_type or c["type"] == wanted_type)]

        random.shuffle(picks)
        picks = picks[:2]

        if not picks:
            return BrainResult(
                reply="Ooh, tell me more! Do you like funny stories, exciting ones, or something about animals or space?",
                recommendations=[],
            )

        top = picks[0]
        why = self._explain(top, wanted_genres)
        kind = "book" if top["type"] == "book" else "video"
        reply = f"Ooh, I found something! How about the {kind} '{top['title']}'? {why} Want me to find another one?"

        recs = []
        for item in picks:
            recs.append({
                "id": item["id"],
                "type": item["type"],
                "title": item["title"],
                "explanation": self._explain(item, wanted_genres),
                "description": item.get("description", ""),
                "external_ref": item.get("external_ref"),
            })
        return BrainResult(reply=reply, recommendations=recs)

    @staticmethod
    def _explain(item: dict, wanted_genres: list[str]) -> str:
        genres = item.get("genres", [])
        hit = next((g for g in wanted_genres if g in genres), None)
        if hit == "funny":
            return "It's really funny and should make you giggle!"
        if hit == "space":
            return "It's all about space and rockets — super cool!"
        if hit in ("animals",):
            return "It's full of friendly animals!"
        if hit == "dinosaur":
            return "It's got awesome dinosaurs in it!"
        if hit == "cosy":
            return "It's gentle and cosy — perfect for a calm moment."
        return item.get("description", "I think you'll really like it!")


def get_brain():
    """Return the active brain. Add real providers here later."""
    provider = settings.BRAIN_PROVIDER.lower()
    if provider == "placeholder":
        return PlaceholderBrain()
    # Placeholders for the real providers (added when a key is available):
    #   if provider == "openai":    return OpenAIBrain(settings.OPENAI_API_KEY)
    #   if provider == "anthropic": return AnthropicBrain(settings.ANTHROPIC_API_KEY)
    raise NotImplementedError(
        f"BRAIN_PROVIDER '{provider}' is not wired up yet. "
        "Use 'placeholder' for now; real LLM providers get added at the AI-integration step."
    )
