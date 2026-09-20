"""Pip's "brain": turns a child's message into a spoken reply + recommendations.

This is the ONE swap point for the AI provider. `PlaceholderBrain` is the
original keyword stand-in (no API key needed); `OpenAIBrain` below is the real
LLM, selected automatically via BRAIN_PROVIDER (see config.py) once
OPENAI_API_KEY is set — the routers never change either way, they only ever
call `get_brain().respond(...)`.
"""
import json
import random
import re
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
GREETING_WORDS = {"hi", "hello", "hey", "hiya", "yo", "howdy"}
THANKS_WORDS = {"thanks", "thank", "thx", "ty"}


def _available_topics(pool: list[dict], limit: int = 12) -> list[str]:
    """Every genre tag actually present in the pool a child can be shown
    from, most common first. This is the ONLY source Pip may draw a "how
    about ... instead?" suggestion from when what the child asked for has no
    match — a suggested topic that isn't really in the catalogue would just
    send them into a second dead end."""
    counts: dict[str, int] = {}
    for item in pool:
        for genre in item.get("genres", []):
            counts[genre] = counts.get(genre, 0) + 1
    return [g for g, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]]


def _topics_in(text: str, topics: list[str]) -> list[str]:
    """Which of `topics` are mentioned in `text` (whole word, plural-tolerant:
    "pirate" matches the tag "pirates")."""
    lowered = text.lower()
    found = []
    for topic in topics:
        base = topic.lower().rstrip("s") or topic.lower()
        if re.search(rf"\b{re.escape(base)}(?:s|es)?\b", lowered):
            found.append(topic)
    return found


STRONG_BOOK_RE = re.compile(r"\b(?:books?|stor(?:y|ies)|read(?:ing)?)\b")
STRONG_VIDEO_RE = re.compile(r"\b(?:videos?|watch(?:ing)?|movies?|clips?|cartoons?)\b")


def _format_mismatch(message: str, pool: list[dict]) -> tuple[str, list[dict]]:
    """The child asked for a topic in one format ("a book about pirates") and
    the catalogue only has it in the other (a pirate video). That's known
    exactly in code, so the chat model is TOLD instead of left to notice: it
    gets a factual note plus the matching item in its numbered list, and can
    offer "no book, but I do have a video about it" before falling back to
    some other related topic."""
    lowered = message.lower()
    is_book, is_video = bool(STRONG_BOOK_RE.search(lowered)), bool(STRONG_VIDEO_RE.search(lowered))
    if is_book == is_video:  # neither named, or both — nothing to mismatch against
        return "", []
    wanted = "book" if is_book else "video"
    notes, items = [], []
    for topic in _topics_in(message, _available_topics(pool, limit=100)):
        of_topic = [c for c in pool if topic in c.get("genres", [])]
        if of_topic and not any(c["type"] == wanted for c in of_topic):
            other = of_topic[0]
            items.append(other)
            notes.append(
                f'The catalogue has no {wanted} about {topic}, but it DOES have a {other["type"]} about it '
                f'("{other["title"]}") — offer that {other["type"]} first.'
            )
    return " ".join(notes), items


def _offered_topic_items(last_turn: dict, pool: list[dict], per_topic: int = 3) -> list[dict]:
    """Items for the topic Pip just OFFERED as an alternative ("...would you
    like to read about the ocean instead?"). When the child answers with a
    bare "yes please", embedding retrieval has nothing to go on — and Pip's
    own reply still names the topic they originally asked for ("pirates"), so
    it pulls the wrong way. Topics named in Pip's last reply but NOT in the
    child's own message before it are exactly the offered ones."""
    topics = _available_topics(pool, limit=100)
    asked = set(_topics_in(last_turn["message"], topics))
    offered = [t for t in _topics_in(last_turn["reply"], topics) if t not in asked]
    items: list[dict] = []
    for topic in offered:
        items.extend([c for c in pool if topic in c.get("genres", [])][:per_topic])
    return items


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
        words = set(message.lower().replace("!", " ").replace("?", " ").replace(",", " ").replace(".", " ").split())

        # Small talk that's still squarely Pip's job — a greeting or a
        # thank-you deserves a real reply, not a random book pick.
        if words and words <= GREETING_WORDS | {"there", "pip"}:
            return BrainResult(
                reply="Hi there! I'm Pip — I help you find fun books and videos. What are you in the mood for today?",
                recommendations=[],
            )
        if words & THANKS_WORDS and not any(w in text for w in VIDEO_WORDS + BOOK_WORDS):
            return BrainResult(reply="You're so welcome! Want me to find you another book or video?", recommendations=[])

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

        # Asked for something specific (a topic and/or a format) but nothing
        # in the pool fits: say so honestly and offer something that DOES
        # exist, instead of quietly handing back an unrelated pick (the old
        # "relax the genre filter" behaviour — supervisor feedback: Pip
        # should reply "Oops, there currently isn't any book related to X,
        # would you like Y instead?", not pretend a random item was a match).
        if not picks and (wanted_genres or wanted_type):
            return self._no_match(catalogue, wanted_type, wanted_genres)

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
    def _no_match(catalogue: list[dict], wanted_type: str | None, wanted_genres: list[str]) -> BrainResult:
        topic = wanted_genres[0] if wanted_genres else None
        kind = wanted_type or "book or video"
        if topic:
            missing = f"there currently isn't any {kind} related to {topic}"
        else:
            missing = f"there currently aren't any {kind}s to show you"

        of_that_type = [c for c in catalogue if not wanted_type or c["type"] == wanted_type]
        related = [t for t in _available_topics(of_that_type) if t not in wanted_genres]
        if related:
            verb = {"book": "read about", "video": "watch something about"}.get(wanted_type, "check out something about")
            return BrainResult(reply=f"Oops, {missing}. Would you like to {verb} {related[0]} instead?", recommendations=[])
        if wanted_type and any(c["type"] != wanted_type for c in catalogue):
            other = "video" if wanted_type == "book" else "book"
            return BrainResult(reply=f"Oops, {missing}. Would you like a {other} instead?", recommendations=[])
        return BrainResult(
            reply=f"Oops, {missing}. Try asking me for something else — like funny stories, animals, or space!",
            recommendations=[],
        )

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
                reply="I don't have anything new to show you right now — try asking for a different kind of story, or ask a grown-up to add more books and videos!",
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

        # A short answer ("yes please", "sure", "that one") has no topic of its
        # own — it's replying to what Pip just offered. Put the offered
        # topic's items first so the chat model can actually recommend them.
        if history and len(message.split()) <= 4:
            offered = _offered_topic_items(history[-1], pool)
            if offered:
                offered_ids = {c["id"] for c in offered}
                candidates = (offered + [c for c in candidates if c["id"] not in offered_ids])[: RETRIEVAL_CANDIDATES + 2]

        mismatch_note, mismatch_items = _format_mismatch(message, pool)
        if mismatch_items:
            ids = {c["id"] for c in mismatch_items}
            candidates = (mismatch_items + [c for c in candidates if c["id"] not in ids])[: RETRIEVAL_CANDIDATES + 2]

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
        # Turn 1-2 of a conversation → OK to just chat/ask instead of forcing
        # a recommendation every time (real gap flagged 2026-09-11: Pip was
        # always pushing 1-2 "best guess" cards even off a single vague
        # word, reading more like a search box than a companion — see the
        # project's own stated §2.1-style dialogue-loop intent). From turn 3
        # on, lean toward actually recommending with best-effort rather than
        # stalling forever — no server-side round counter exists, so
        # `len(history)` is used as a simple, good-enough proxy for "how far
        # into this conversation are we."
        turn_number = len(history) + 1
        system_prompt = (
            "You are Pip, a friendly companion chatting with a child to help them find a book or "
            "video to enjoy — talk like a warm, curious friend having a real back-and-forth, not a "
            "search engine that dumps results for every message. Only recommend something once you "
            "actually have a reasonable sense of what they're in the mood for (format, topic, or "
            "feeling) — if their message is vague and you don't genuinely have enough to go on, it's "
            "completely fine to just chat and ask ONE short, friendly clarifying question instead of "
            "recommending anything (return an empty \"picks\" list on turns like that). "
            f"This is exchange {turn_number} of this conversation — " + (
                "you've had some back-and-forth already, so lean toward actually recommending "
                "something now with your best-effort guess rather than asking yet another question, "
                "even if it isn't a perfect match. "
                if turn_number >= 3 else
                "it's still early, so don't feel pressured to recommend on every single turn — a "
                "genuine question or two first reads as real conversation, not a stalling tactic. "
            )
            + "Never force exactly 2 picks just to fill space: pick 1 if only one genuinely fits, or "
            "0 while you're still figuring out what they want. "
            "You may ONLY recommend items from the numbered catalogue list given to you below — "
            "never invent a title, never describe or mention anything not in that list. "
            "Match rule: only pick an item if it genuinely fits what the child asked for — the "
            "topic, AND the format (book vs video) when they named one. Never recommend something "
            "unrelated just to have something to show. If NONE of the numbered items genuinely fits "
            "what they asked for, recommend nothing (empty \"picks\") and say so honestly and warmly "
            "in this shape: \"Oops, there currently isn't any <book/video> about <what they asked "
            "for> — would you like to <read/watch> something about <a related topic> instead?\" "
            "(say \"book\" or \"video\" only if they named a format, otherwise \"book or video\"). "
            "But if a numbered item matches the topic they asked for in the OTHER format (they "
            "asked for a book and only a video fits, or the reverse), offer that first instead, "
            "e.g. \"Oops, there isn't any book about pirates, but I do have a pirate video — want "
            "to watch it?\" and only then fall back to a related topic. "
            "Choose that related topic ONLY from the \"topics the catalogue covers\" list given "
            "below the catalogue — the one closest in meaning to what they wanted — never invent one. "
            "If they've already been shown everything that fits earlier in this conversation, say "
            "you've shown them everything you have on that topic (rather than saying there's "
            "nothing) and offer a related topic the same way. If they say no to something you "
            "offered, or ask for something different, do NOT repeat the \"Oops\" line — just say "
            "that's fine and offer a different topic from the list, or ask what they'd like. If they say yes to something you "
            "offered, recommend from the numbered list right away instead of asking again. "
            "Always answer what the child actually said, in a way that's relevant to it — never "
            "ignore their question or reply with something unrelated to it. Everything that is part "
            "of being Pip is in scope: greetings and friendly small talk (reply warmly, then bring "
            "it back to books and videos), questions about you (you're Pip, a friendly helper who "
            "finds books and videos), questions about a book or video you already mentioned (answer "
            "ONLY from the title/description you were given — if you don't have that detail, say so "
            "honestly instead of guessing), and feedback like \"I don't like that one\" (be "
            "understanding and offer something different). Anything outside that — homework, "
            "general knowledge, other topics, games, jokes, requests to do something else — is out "
            "of scope: don't answer it; kindly say you can only help with books and videos, then "
            "ask what they'd like to read or watch. Never ask the child for personal details (their full "
            "name, address, school, phone number, or exactly where they live) — their age band is "
            "all you need, and you already have it. If they share personal information anyway, "
            "don't repeat it back, comment on it, or dwell on it — just gently continue the "
            "conversation about books and videos. "
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
            "content": (
                f"Child's message: {message!r}\n\nCatalogue:\n{json.dumps(catalogue_brief)}\n\n"
                f"Topics the catalogue covers overall (the ONLY topics you may suggest as an "
                f"alternative): {json.dumps(_available_topics(pool))}"
                + (f"\n\nNote: {mismatch_note}" if mismatch_note else "")
            ),
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
