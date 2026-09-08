"""Pip's "brain": turns a child's message into a spoken reply + recommendations.

This is the ONE swap point for the AI provider. `PlaceholderBrain` is the
original keyword stand-in (no API key needed); `OpenAIBrain` below is the real
LLM, selected automatically via BRAIN_PROVIDER (see config.py) once
OPENAI_API_KEY is set — the routers never change either way, they only ever
call `get_brain().respond(...)`.
"""
import json
import random
from dataclasses import dataclass, field
from functools import lru_cache

from . import embeddings, moderation, pii
from .config import settings

RETRIEVAL_CANDIDATES = 4  # embedding-matched pool handed to the conversational LLM

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
    """No real intelligence — just keyword matching over the catalogue.
    Ignores `history` (no API key means no model to feed context to) and
    `reading_level` (PA13) — there's no language model here to actually
    tune sentence complexity with; the mock brain's whole job is
    deterministic free/test-mode operation, not a faithful stand-in for
    every real-brain behaviour."""

    def respond(self, message: str, age_band: str | None, catalogue: list[dict],
                history: list[dict] | None = None, reading_level: str | None = None) -> BrainResult:
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

        # filter the (already-approved, already age/PA18-filtered by the
        # caller — see chat.py's _visible_catalogue) catalogue. Re-checking
        # age_band here used to be real but redundant when the caller
        # always passed None; now that chat.py passes the real age_band
        # (so OpenAIBrain can use it for language tuning, see that class's
        # own respond()), re-filtering by it here would incorrectly
        # re-exclude items a parent explicitly allowed off-band via PA18's
        # "approve" override — so this brain, like that one, trusts the
        # pool it's given instead of re-deriving age eligibility itself.
        def matches(item):
            if wanted_type and item["type"] != wanted_type:
                return False
            if wanted_genres and not set(wanted_genres) & set(item.get("genres", [])):
                return False
            return True

        picks = [c for c in catalogue if matches(c)]

        # if genre asked but nothing matched, relax the genre filter
        if not picks and wanted_genres:
            picks = [c for c in catalogue if not wanted_type or c["type"] == wanted_type]

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
                "thumbnail": item.get("thumbnail"),
                "genres": item.get("genres", []),
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


class OpenAIBrain:
    """Real LLM-backed brain, two separate OpenAI calls per URS Design
    Constraint 3 ("constrained to the OpenAI API for both the conversational
    LLM and embedding-based content matching") — never one call doing both
    jobs:

    1. **Retrieval** (embeddings): the child's message is embedded and
       compared by cosine similarity against each catalogue item's own
       embedding (computed once, at approve-time — see
       routers/content.py's `_refresh_embedding`, not here). Only the
       closest few items become candidates.
    2. **Conversation** (chat model): sees ONLY those candidates, never the
       full catalogue, and must pick from them by id, phrasing a reply +
       per-item explanation. Any id it returns that wasn't actually in the
       candidate list is dropped rather than trusted — retrieval decides
       *what's eligible*, the chat model only decides *how to talk about it*.

    Safety/design rule (see agent-context/CLAUDE.md §2.1/§3 on the other
    branch — same principle applies here even though this file doesn't read
    that doc): the model is never asked to "know" a book or video on its own.
    """

    def __init__(self, api_key: str, model: str):
        from openai import OpenAI

        self._client = OpenAI(api_key=api_key)
        self._model = model

    def respond(self, message: str, age_band: str | None, catalogue: list[dict],
                history: list[dict] | None = None, reading_level: str | None = None) -> BrainResult:
        """`history` — prior turns *in this chat session* (see
        storage.session_history), oldest first, each `{message, reply}`.
        Real conversation memory: passed to the LLM as actual multi-turn
        chat messages (same shape ChatGPT/Claude use for their own
        context), not just summarised or dropped — this is what makes CH07
        ("Respond to Clarifying Question") actually work across turns
        instead of every message being answered in isolation.

        `reading_level` — PA13, a free-text hint a parent sets per child
        (e.g. "early", "middle", "confident reader"). Used here to tune
        HOW Pip talks about picks (vocabulary/sentence complexity in the
        reply and per-item explanations), not WHICH items are eligible —
        most catalogue items don't carry their own reading_level tag
        (that's an optional CM10 field, sparse in practice), so gating
        retrieval on it would silently empty the candidate pool for most
        children. This was previously stored and displayed on the parent
        dashboard but never actually read anywhere in the recommendation
        path — a real, verified gap, not a hypothetical one."""
        history = history or []
        # No age_band re-filter here — the caller (chat.py's
        # _visible_catalogue) already narrowed `catalogue` by age band
        # *and* applied any PA18 per-child override, including an
        # "approve" override that deliberately puts an off-band item back
        # in. Re-filtering by age_band here (this parameter is now the
        # real value, passed for the prompt's language-tuning line below,
        # not a signal to re-derive eligibility from) would silently
        # undo that override.
        pool = catalogue
        if not pool:
            return BrainResult(
                reply="I don't have anything for you just yet — ask a grown-up to add some books or videos!",
                recommendations=[],
            )

        # Input safety — checked on the raw message, before PII scrubbing
        # or anything else touches it. A flagged message never reaches
        # retrieval or the chat model at all; the child gets a gentle
        # redirect instead of Pip trying to "handle" it. See
        # app/moderation.py — this was documented as part of the safety
        # stack from early on but never actually wired in until now.
        if moderation.is_unsafe(message):
            return BrainResult(reply=moderation.REDIRECT_REPLY, recommendations=[])

        # Real ZDR is still unresolved (config.py's ZDR_STATUS) — this is a
        # narrower, separate mitigation: don't let an accidentally-typed
        # email/phone/address leave the backend at all, regardless of that
        # status. See app/pii.py's own docstring for what this can't catch.
        if settings.PII_SCRUB_ENABLED:
            message = pii.scrub(message)
            history = [{"message": pii.scrub(t["message"]), "reply": t["reply"]} for t in history]

        # ---- stage 1: embedding-based retrieval ----
        # Uses the whole conversation-so-far (not just this one message) so
        # retrieval itself has context: e.g. turn 1 "a book", turn 2 "about
        # dinosaurs" should retrieve dinosaur *books*, not rely on turn 2's
        # three words alone.
        retrieval_text = " ".join([t["message"] for t in history] + [message])
        query_embedding = embeddings.embed_text(retrieval_text)
        if query_embedding:
            candidates = embeddings.top_matches(query_embedding, pool, limit=RETRIEVAL_CANDIDATES)
        else:
            # Embedding call unavailable/failed — degrade to a random slice
            # rather than crash; still never the *whole* catalogue verbatim,
            # keeping the "small candidate set" shape the design relies on.
            shuffled = list(pool)
            random.shuffle(shuffled)
            candidates = shuffled[:RETRIEVAL_CANDIDATES]

        # ---- stage 2: conversational LLM, constrained to the candidates ----
        # Candidates are numbered 0..N instead of exposing their real (long,
        # opaque) ids to the model — a real bug found via testing: with the
        # real id sitting right next to a `title` field, the model would
        # sometimes echo the *title* back as "id" (a plausible mix-up, not
        # malicious), which then silently failed the by-id trust check below
        # and dropped the pick — the reply text would promise books that
        # never actually showed up. A small integer index the model can only
        # get from the numbered list itself removes that ambiguity entirely.
        catalogue_brief = [
            {
                "index": i, "type": c["type"], "title": c["title"],
                "genres": c.get("genres", []), "description": c.get("description", ""),
            }
            for i, c in enumerate(candidates)
        ]
        system_prompt = (
            "You are Pip, a friendly companion helping a child find a book or video to enjoy. "
            "You may ONLY recommend items from the numbered catalogue list given to you below — "
            "never invent a title, never describe or mention anything not in that list, and never "
            "answer questions unrelated to finding a book or video. Pick at most 2 items that best "
            "match what the child said; if nothing fits well, still offer your closest 1-2 guesses "
            "rather than an empty list, unless the child's message has nothing to do with "
            "books/videos at all — then return an empty picks list and ask one short, friendly "
            "clarifying question instead. "
            "\"index\" numbers (e.g. 0, 1, 2) exist ONLY to identify your picks in the JSON "
            "\"picks\" array below — they are an internal bookkeeping detail the child must never "
            "see. The \"reply\" field is read directly by the child: write it in warm, natural "
            "sentences that name each picked item by its real \"title\" from the list (never the "
            "word \"index\", never a bare number standing in for a book or video, and never any "
            "other internal detail like \"the list\" or \"the catalogue\"). "
            "This conversation may have earlier turns before this message (shown below as prior "
            "chat messages) — use them for context: if you already asked a clarifying question and "
            "the child is now answering it, combine that answer with what they said earlier rather "
            "than asking yet another question or treating this message in isolation. Don't repeat a "
            "question you've already asked in this conversation. Speak in warm, "
            "short, age-appropriate sentences for a child aged " + (age_band or "5-12") + ". "
            + (
                f"This child's parent has set their reading level as \"{reading_level}\" — keep your "
                "own sentences and word choice matched to that level specifically (simpler vocabulary "
                "and shorter sentences for an earlier reader, richer language for a confident one), "
                "on top of the age-band guidance above. "
                if reading_level else ""
            )
            + 'Respond ONLY with JSON of this exact shape: '
            '{"reply": "string", "picks": [{"index": 0, "why": "one short sentence"}]}. '
            "The numbered list is given fresh below every time and its numbering can differ from "
            "earlier turns, so only ever use an index from THIS turn's list, never one mentioned earlier."
        )
        messages = [{"role": "system", "content": system_prompt}]
        for turn in history:
            messages.append({"role": "user", "content": turn["message"]})
            messages.append({"role": "assistant", "content": turn["reply"]})
        messages.append({
            "role": "user",
            "content": f"Child's message: {message!r}\n\nCatalogue:\n{json.dumps(catalogue_brief)}",
        })

        try:
            resp = self._client.chat.completions.create(
                model=self._model,
                response_format={"type": "json_object"},
                temperature=0.7,
                timeout=15,
                messages=messages,
            )
            data = json.loads(resp.choices[0].message.content)
        except Exception:
            # Real API hiccup (network, rate limit, malformed JSON) — degrade
            # gracefully, never crash the chat loop over an external call.
            return BrainResult(
                reply="Hmm, my brain had a little hiccup! Can you try asking that again?",
                recommendations=[],
            )

        recs = []
        for pick in (data.get("picks") or [])[:2]:
            index = pick.get("index")
            # bool is an int subclass in Python — exclude explicitly so a
            # stray `true`/`false` can't be misread as index 1/0.
            if not isinstance(index, int) or isinstance(index, bool) or not (0 <= index < len(candidates)):
                continue  # ignore any index the model returned that wasn't actually offered to it
            item = candidates[index]
            recs.append({
                "id": item["id"],
                "type": item["type"],
                "title": item["title"],
                "explanation": pick.get("why") or item.get("description", ""),
                "description": item.get("description", ""),
                "external_ref": item.get("external_ref"),
                "thumbnail": item.get("thumbnail"),
                "genres": item.get("genres", []),
            })
        reply = data.get("reply") or "Here's something you might like!"
        return BrainResult(reply=reply, recommendations=recs)


@lru_cache(maxsize=1)
def _brain_for(provider: str):
    if provider == "placeholder":
        return PlaceholderBrain()
    if provider == "openai":
        return OpenAIBrain(settings.OPENAI_API_KEY, settings.OPENAI_CHAT_MODEL)
    # Placeholder for a future provider (same swap-point shape):
    #   if provider == "anthropic": return AnthropicBrain(settings.ANTHROPIC_API_KEY)
    raise NotImplementedError(
        f"BRAIN_PROVIDER '{provider}' is not wired up yet. "
        "Use 'placeholder' or 'openai' for now; other providers get added at this same swap point."
    )


def get_brain():
    """Return the active brain, cached per provider string."""
    return _brain_for(settings.BRAIN_PROVIDER.lower())
