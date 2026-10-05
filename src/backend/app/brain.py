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

MAX_PICKS = 3  # most cards Pip shows in one reply
RETRIEVAL_CANDIDATES = 6  # embedding-matched pool handed to the conversational LLM (a bit more than MAX_PICKS, so Pip still has a choice)

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


def _named_title_items(message: str, pool: list[dict]) -> list[dict]:
    """Items whose own TITLE the child's message names directly, not just a
    genre — "a video about the very hungry caterpillar" needs to surface The
    Very Hungry Caterpillar (a book) even though nothing about "the very
    hungry caterpillar" is a genre tag anywhere in the catalogue, so
    `_topics_in`/`_format_mismatch`'s genre-keyword check has nothing to
    match against at all. Real, reproduced case (QA pass, 2026-09-24): this
    exact request got a generic "how about animals instead?" redirect
    instead of the book being offered, because the format-mismatch check
    only ever looked at genre tags. A literal title mention is even higher-
    precision ground truth than a genre tag, so this only requires the full
    title to appear in the message (deliberately strict, to avoid a short
    title like "Go" false-triggering on unrelated text)."""
    lowered = message.lower()
    items = []
    for item in pool:
        title = (item.get("title") or "").strip()
        if len(title) >= 4 and title.lower() in lowered:
            items.append(item)
    return items


def _format_mismatch(message: str, pool: list[dict]) -> tuple[str, list[dict]]:
    """The child asked for a topic in one format ("a book about pirates") and
    the catalogue only has it in the other (a pirate video) — or named a
    specific title that exists, just not in the format they asked for. That's
    known exactly in code, so the chat model is TOLD instead of left to
    notice: it gets a factual note plus the matching item in its numbered
    list, and can offer "no book, but I do have a video about it" before
    falling back to some other related topic."""
    lowered = message.lower()
    is_book, is_video = bool(STRONG_BOOK_RE.search(lowered)), bool(STRONG_VIDEO_RE.search(lowered))
    if is_book == is_video:  # neither named, or both — nothing to mismatch against
        return "", []
    wanted = "book" if is_book else "video"
    notes, items, seen_ids = [], [], set()

    for topic in _topics_in(message, _available_topics(pool, limit=100)):
        of_topic = [c for c in pool if topic in c.get("genres", [])]
        if of_topic and not any(c["type"] == wanted for c in of_topic):
            other = of_topic[0]
            if other["id"] not in seen_ids:
                seen_ids.add(other["id"])
                items.append(other)
                notes.append(
                    f'The catalogue has no {wanted} about {topic}, but it DOES have a {other["type"]} about it '
                    f'("{other["title"]}") — offer that {other["type"]} first.'
                )

    for other in _named_title_items(message, pool):
        if other["type"] != wanted and other["id"] not in seen_ids:
            seen_ids.add(other["id"])
            items.append(other)
            notes.append(
                f'The child named "{other["title"]}" directly, which the catalogue has as a {other["type"]}, '
                f'not a {wanted} — offer that {other["type"]} first, per the format-exception rule.'
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


def _named_genre_items(message: str, pool: list[dict], per_topic: int = 3) -> list[dict]:
    """Items for a genre the child's OWN message literally names ("a book
    about robots"). Guarantees a human-curated genre tag (CM10) is never
    silently dropped just because embedding similarity alone didn't rank
    the matching item(s) inside the top RETRIEVAL_CANDIDATES — real,
    reproduced case (Kiefer, 2026-09-24): "I want to read a book about
    robots" retrieved four completely unrelated books (a Barbie singalong,
    a space story, a lion story, a dinosaur story) while the two books
    actually tagged "robots" never appeared in the top matches at all,
    purely because their title/description text didn't happen to phrase
    things close enough to the query in embedding space — confirmed across
    9 of 22 real catalogue genres the same way (ocean, pirates, music,
    family, art, magic, superheroes, mystery, robots), not a one-off. A
    moderator's own genre tag is reliable, human-verified ground truth
    that a fuzzy text-similarity search alone shouldn't be allowed to
    override just because a title happens to be phrased unhelpfully."""
    topics = _topics_in(message, _available_topics(pool, limit=100))
    items: list[dict] = []
    for topic in topics:
        items.extend([c for c in pool if topic in c.get("genres", [])][:per_topic])
    return items


@dataclass
class BrainResult:
    reply: str
    recommendations: list = field(default_factory=list)  # list of content dicts
    # Set only when Pip said "Oops, nothing about X" — the topic the child asked
    # for that the catalogue can't serve, and in which format. routers/chat.py
    # tallies these (storage.record_topic_miss) so moderators can see which
    # topics to import next. Nothing about the child is attached.
    missed_topic: str | None = None
    missed_format: str | None = None  # "book" | "video" | "any"


_TOPIC_OK_RE = re.compile(r"^[a-z][a-z' -]{1,38}[a-z]$")
_TOPIC_STOPWORDS = {"a", "an", "the", "some", "any", "book", "books", "video", "videos", "story", "stories", "about", "of"}


def clean_missed_topic(raw) -> str | None:
    """Model output -> a short, plain topic label or None. Letters only, at
    most three words, no filler ("a book about"): anything else (digits, links,
    emails, a full sentence) is dropped rather than stored."""
    if not isinstance(raw, str):
        return None
    text = re.sub(r"\s+", " ", raw.strip().lower())
    words = [w for w in text.split(" ") if w not in _TOPIC_STOPWORDS]
    text = " ".join(words)
    if not text or len(words) > 3 or not _TOPIC_OK_RE.match(text):
        return None
    return text


def topic_is_covered(topic: str, items: list[dict], fmt: str = "any") -> bool:
    """True if some item already speaks to `topic` (every word of it appears,
    plural-tolerant, in one item's title, description or genres). Used to keep
    a "miss" honest: a topic the catalogue does cover isn't demand for new
    content, whatever the model said. `fmt` ("book" | "video") narrows it to
    that format — a child who asked for a VIDEO about mystery isn't served by
    a mystery book."""
    if fmt in ("book", "video"):
        items = [i for i in items if i.get("type") == fmt]
    stems = [w.rstrip("s") or w for w in re.findall(r"[a-z']+", topic.lower())]
    if not stems:
        return True
    patterns = [re.compile(rf"\b{re.escape(stem)}(?:s|es)?\b") for stem in stems]
    for item in items:
        text = " ".join([item.get("title", ""), item.get("description", ""), *item.get("genres", [])]).lower()
        if all(p.search(text) for p in patterns):
            return True
    return False


def covering_item(topic: str, items: list[dict], fmt: str = "any") -> dict | None:
    """The first item (in `items`' own order) that satisfies topic_is_covered's
    exact match rule, returned instead of just True/False — for anything that
    needs to point at a real item once a gap turns out to be filled (see
    routers/chat.py's GET /resolved-topics: "Pip once said no to this child
    about X, X is covered now, here's the actual thing to mention"). Kept as
    its own function rather than refactoring topic_is_covered to use it —
    that function's existing tests pin its exact contract (including the
    "no real words in topic" edge case, which has no sensible single-item
    equivalent here) and this only ever runs on a topic that's already
    passed clean_missed_topic's validation, so that edge case never applies
    to this caller anyway."""
    if fmt in ("book", "video"):
        items = [i for i in items if i.get("type") == fmt]
    stems = [w.rstrip("s") or w for w in re.findall(r"[a-z']+", topic.lower())]
    if not stems:
        return None
    patterns = [re.compile(rf"\b{re.escape(stem)}(?:s|es)?\b") for stem in stems]
    for item in items:
        text = " ".join([item.get("title", ""), item.get("description", ""), *item.get("genres", [])]).lower()
        if all(p.search(text) for p in patterns):
            return item
    return None


class PlaceholderBrain:
    """No real intelligence — just keyword matching over the catalogue.
    Ignores `history` (no API key means no model to feed context to),
    `reading_level` (PA13) — there's no language model here to actually
    tune sentence complexity with —, `interests` (same reason: nothing
    here reads a system prompt), `liked_genres` (ditto), and `already_shown_note`, which only
    means something to a model that can read prose; the mock brain's whole
    job is deterministic free/test-mode operation, not a faithful stand-in
    for every real-brain behaviour."""

    def respond(self, message: str, age_band: str | None, catalogue: list[dict],
                history: list[dict] | None = None, reading_level: str | None = None,
                already_shown_note: str | None = None, interests: list[str] | None = None,
                liked_genres: list[str] | None = None) -> BrainResult:
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
        picks = picks[:MAX_PICKS]

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
                "synopsis": item.get("synopsis"),
                "external_ref": item.get("external_ref"),
                "thumbnail": item.get("thumbnail"),
                "genres": item.get("genres", []),
            })
        return BrainResult(reply=reply, recommendations=recs)

    def explain_reply(self, name: str, age_band: str | None, item: dict, text: str, level: str) -> str:
        """Pip's answer to a child explaining a saved book/video (CH21).
        Warm and never judging: no mention of right or wrong, of levels, or of
        the parent reviewing it."""
        title = item.get("title", "that")
        return (
            f"Thank you for telling me about {title}, {name}! I loved hearing it in your own words. "
            "Do you want to find something else to read or watch together?"
        )

    @staticmethod
    def _no_match(catalogue: list[dict], wanted_type: str | None, wanted_genres: list[str]) -> BrainResult:
        topic = wanted_genres[0] if wanted_genres else None
        kind = wanted_type or "book or video"
        if topic:
            missing = f"there currently isn't any {kind} related to {topic}"
        else:
            missing = f"there currently aren't any {kind}s to show you"

        # Only a named topic is demand worth tallying; "any video" with none
        # in the pool is a catalogue-size problem, not a topic to import.
        miss = {"missed_topic": topic, "missed_format": wanted_type or "any"} if topic else {}

        of_that_type = [c for c in catalogue if not wanted_type or c["type"] == wanted_type]
        related = [t for t in _available_topics(of_that_type) if t not in wanted_genres]
        if related:
            verb = {"book": "read about", "video": "watch something about"}.get(wanted_type, "check out something about")
            return BrainResult(reply=f"Oops, {missing}. Would you like to {verb} {related[0]} instead?", recommendations=[], **miss)
        if wanted_type and any(c["type"] != wanted_type for c in catalogue):
            other = "video" if wanted_type == "book" else "book"
            return BrainResult(reply=f"Oops, {missing}. Would you like a {other} instead?", recommendations=[], **miss)
        return BrainResult(
            reply=f"Oops, {missing}. Try asking me for something else — like funny stories, animals, or space!",
            recommendations=[], **miss,
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

    def explain_reply(self, name: str, age_band: str | None, item: dict, text: str, level: str) -> str:
        """CH21: Pip answers a child who just explained a saved book/video in
        their own words. A short, warm reply written by the chat model, with
        hard rules in the prompt: never judge correctness, never add facts about
        the story (the model doesn't "know" catalogue items, see this class's
        docstring), never mention levels or that a parent will read it. Falls
        back to the placeholder wording if the call fails, so a child is never
        left without an answer."""
        fallback = PlaceholderBrain().explain_reply(name, age_band, item, text, level)
        band = "ages 5 to 8" if age_band == "5-8" else "ages 9 to 12"
        system = (
            f"You are Pip, a gentle, cheerful reading buddy talking to a child ({band}) named {name}. "
            f"The child just told you in their own words about a {item.get('type', 'book')} called "
            f"\"{item.get('title', '')}\". Reply in 2 or 3 short, warm sentences.\n"
            "Rules:\n"
            "- Pick out one specific thing the child said and reflect it back with delight.\n"
            "- NEVER say whether they were right or wrong, never correct them, never grade or compare.\n"
            "- Do NOT add any facts about the story that the child did not say.\n"
            "- Never mention levels, scores, progress, or that a grown-up will read this.\n"
            "- You may end with ONE simple, friendly question about their favourite part.\n"
            "- Simple words for the child's age. No emojis."
        )
        try:
            resp = self._client.chat.completions.create(
                model=self._model,
                temperature=0.6,
                max_tokens=120,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": text}],
            )
            reply = (resp.choices[0].message.content or "").strip()
        except Exception:
            return fallback
        if not reply:
            return fallback
        from . import guardrails

        reply, _ = guardrails.check_output(reply)
        return reply or fallback

    def respond(self, message: str, age_band: str | None, catalogue: list[dict],
                history: list[dict] | None = None, reading_level: str | None = None,
                already_shown_note: str | None = None, interests: list[str] | None = None,
                liked_genres: list[str] | None = None) -> BrainResult:
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
        path — a real, verified gap, not a hypothetical one.

        `already_shown_note` — a factual note from the caller (chat.py) when
        it excluded items from `catalogue` because this child was already
        shown them earlier in this session, AND those items would otherwise
        have matched a genre the child's current message names. Without
        this, the model sees an empty or thin candidate list with no way to
        tell "nothing on this topic exists" from "you already showed them
        everything on this topic" — real, reproduced inconsistency (QA pass,
        2026-09-24): the exact same repeated request got a coin-flip
        "here's something" / "there isn't any" answer turn to turn, because
        that distinction was left for the model to guess at from prose
        conversation history instead of being told outright.

        `interests` — genres a parent picked for this child at PA07/PA08
        profile setup (ChildCreate/ChildUpdate.interests), from the same
        genre vocabulary the catalogue itself is tagged with. Unlike
        `reading_level` above, this DOES feed retrieval (folded into the
        embedding query below), not just phrasing — the whole point (an
        assessor's own ask) is that Pip already has a real signal about
        this child's taste going into the very first message of a
        session, instead of only ever learning it by asking or by what
        got liked/saved after the fact. Still never the only signal: it's
        blended into one embedding query alongside the actual message, so
        a child asking for something else entirely isn't dragged back
        toward a declared interest that has nothing to do with what they
        just asked for."""
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
        if interests:
            # Appended once, not repeated per turn — its share of the
            # blended embedding shrinks naturally as real conversation
            # accumulates, so it nudges an early/vague turn toward known
            # tastes without overriding a later, specific, different ask.
            retrieval_text = f"{retrieval_text} (likes: {', '.join(interests)})"
        if liked_genres:
            # Same idea as `interests`, from what the child has loved or saved
            # before: appended once so it only tips a vague turn.
            retrieval_text = f"{retrieval_text} (enjoyed before: {', '.join(liked_genres)})"
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

        # A genre the child's message literally names must always be
        # retrievable — see _named_genre_items' own docstring for the real,
        # reproduced retrieval-miss bug this closes (embedding similarity
        # alone missed a moderator-tagged match for 9 of 22 real catalogue
        # genres tested). Runs regardless of message length/history, unlike
        # the two guarantees above — a clear, explicit "book about X" should
        # never depend on embedding luck.
        named_genre_items = _named_genre_items(message, pool)
        if named_genre_items:
            ids = {c["id"] for c in named_genre_items}
            candidates = (named_genre_items + [c for c in candidates if c["id"] not in ids])[: RETRIEVAL_CANDIDATES + 2]

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
        # Pulled out to their own named variables (were inline conditional
        # expressions stitched into one giant concatenated paragraph) purely
        # for readability — same wording, same behaviour, just no longer a
        # single run-on string that's hard to audit or safely edit one rule
        # at a time. The prompt itself below is restructured into headed
        # sections for the same reason: production chat systems generally
        # hold up better under a real spec (role / rules / format) than one
        # dense paragraph, both for a human maintaining it and for the model
        # actually following it turn after turn.
        pacing_note = (
            "You've already had some back-and-forth, so lean toward actually recommending "
            "something now with your best-effort guess, even if it isn't a perfect match."
            if turn_number >= 3 else
            "It's still early — you don't need to recommend on every turn. A genuine question "
            "or two first reads as real conversation, not stalling."
        )
        reading_level_note = ""
        if reading_level:
            reading_level_note = (
                f'This child\'s parent has set their reading level as "{reading_level}" — match '
                "your sentences and word choice to that level specifically (simpler vocabulary and "
                "shorter sentences for an earlier reader, richer language for a confident one), on "
                "top of the age-band guidance above."
            )
        interests_note = ""
        if interests:
            interests_note = (
                f"## What you already know about this child\n"
                f"This child's parent says they especially enjoy: {', '.join(interests)}. You don't need "
                f"to ask what they're interested in — you already have a real signal, so it's fine to lean "
                f"on it, especially early in a conversation or when their message is vague (e.g. \"surprise "
                f"me\" or \"I want something to read\"). Never let it override what they're actually asking "
                f"for right now, though — if they name a different topic or format, that wins; a declared "
                f"interest is a tiebreaker and a good first guess, never a rule that forces a pick.\n"
            )
        liked_note = ""
        if liked_genres:
            liked_note = (
                f"## What this child has loved before\n"
                f"They marked things as loved or saved them in these genres: {', '.join(liked_genres)}. "
                f"It's a good first guess when their message is vague, but never let it override what "
                f"they're asking for right now, and never narrow your picks to it.\n"
            )
        system_prompt = f"""You are Pip, a friendly companion chatting with a child to help them find a book or video to enjoy. Talk like a warm, curious friend having a real back-and-forth — never like a search engine dumping results for every message.

{interests_note}
{liked_note}
## Conversation flow
- This is exchange {turn_number} of this conversation. {pacing_note}
- Only recommend once you have a reasonable sense of what they're in the mood for (format, topic, or feeling). If their message is vague and you don't genuinely have enough to go on, it's completely fine to just chat and ask ONE short, friendly clarifying question instead — return an empty "picks" list on turns like that.
- Aim to recommend 3 when three or more items reasonably fit what they asked for (when they named no format, a mix of books and videos works well), 2 when only two fit, and just 1 if only one fits. Recommend 0 while you're still figuring out what they want. Never recommend more than 3, and never add an item that doesn't fit just to reach a number.
- Use the conversation so far for context: if you already asked a clarifying question and the child is now answering it, combine that with what they said earlier rather than asking again. Never repeat a question you've already asked in this conversation.

## What's in scope
Everything that's part of being Pip:
- Greetings and friendly small talk — INCLUDING a child just sharing something harmless about their day, feelings or life the way they'd chat with a friend ("I had pizza for dinner", "my dog did something funny", "I'm bored"). Actually engage with what they said (react to it, ask a small follow-up, show a bit of your own personality) like a real friend would, not a quick warm line you rush past on your way back to business. Let a little banter breathe for a turn or two before naturally steering back toward books and videos — that back-and-forth IS being a companion, not a detour from the job.
- Questions about you (you're Pip, a friendly helper who finds books and videos).
- Questions about a book or video you already mentioned — answer ONLY from the title/description you were given; if you don't have that detail, say so honestly instead of guessing.
- Feedback like "I don't like that one" — be understanding and offer something different.

Always answer what the child actually said, in a way that's relevant to it — never ignore their message or reply with something unrelated to it.

## What's out of scope
Homework, general-knowledge or factual questions, requests to write/solve/translate/code something, games, jokes/riddles, news, or weather. Don't answer any of it — kindly say you can only help with books and videos, then ask what they'd like to read or watch.

## Recommending — catalogue and matching rules
- You may ONLY recommend items from the numbered catalogue list given below — never invent a title, never describe or mention anything not in that list.
- Match rule: only pick an item if it genuinely fits what the child asked for — the topic, AND the format (book vs video) when they named one. Never recommend something unrelated just to have something to show.
- If NONE of the numbered items genuinely fits what they asked for: recommend nothing (empty "picks") and say so honestly and warmly, in this shape: "Oops, there currently isn't any <book/video> about <what they asked for> — would you like to <read/watch> something about <a related topic> instead?" (say "book" or "video" only if they named a format, otherwise "book or video").
  - Exception: if a numbered item matches their topic in the OTHER format (they asked for a book and only a video fits, or the reverse), offer that first instead — e.g. "Oops, there isn't any book about pirates, but I do have a pirate video — want to watch it?" — and only fall back to a related topic if there's no other-format match either.
  - Choose the related topic ONLY from the "topics the catalogue covers" list given below the catalogue — the one closest in meaning to what they wanted. Never invent one.
- If they've already been shown everything that fits earlier in this conversation, say you've shown them everything you have on that topic (never say there's nothing) and offer a related topic the same way.
- If they say no to something you offered, or ask for something different: don't repeat the "Oops" line — just say that's fine and offer a different topic, or ask what they'd like.
- If they say yes to something you offered: recommend from the numbered list right away, don't ask again.

## Privacy
Never ask the child for personal details — their full name, address, school, phone number, or exactly where they live. Their age band is all you need, and you already have it.

If they share personal information anyway — even mixed into ordinary chatter ("my school is Lincoln Elementary", "I live on Maple Street", "my name is Jamie") — do NOT repeat the specific identifying detail back, do NOT use it in your reply, do NOT ask a follow-up about it, and do NOT comment on it, even warmly. This overrides the small-talk guidance above: react to the rest of what they said (the feeling, the event) while treating the identifying detail itself as if you hadn't read it. Just gently continue the conversation about books and videos.

## Speaking style
Speak in warm, short, age-appropriate sentences for a child aged {age_band or "5-12"}. {reading_level_note}

## Output format
Respond ONLY with JSON of this exact shape (the example lists 3 picks; use 3, 2, 1 or 0 as described above):
{{"reply": "string", "picks": [{{"index": 0, "why": "one short sentence"}}, {{"index": 2, "why": "one short sentence"}}, {{"index": 3, "why": "one short sentence"}}], "missing": null or {{"topic": "string", "format": "book" | "video" | "any"}}}}

- "reply" is read directly by the child: warm, natural sentences that name each picked item by its real "title" from the list. Never say "index", never a bare number standing in for a book or video, and never mention internal details like "the list" or "the catalogue".
- "index" numbers (0, 1, 2, ...) exist ONLY to identify your picks — internal bookkeeping the child must never see. The numbered list is given fresh every turn and its numbering can differ from earlier turns — only ever use an index from THIS turn's list, never one mentioned earlier.
- "missing" is set ONLY when you used the "Oops" line because nothing in the list fits a topic they asked for: then it's the topic in their own words (1-3 lowercase words, never a person's name) plus the format they wanted. In every other case "missing" is null — including when they've already seen everything on that topic, or are just chatting."""
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
                + (f"\n\nNote: {already_shown_note}" if already_shown_note else "")
            ),
        })

        try:
            resp = self._client.chat.completions.create(
                model=self._model,
                response_format={"type": "json_object"},
                # Was 0.7 — lowered after a real, reproduced inconsistency
                # (QA pass, 2026-09-24): the exact same repeated request for
                # a narrow sub-topic ("space station") flip-flopped between
                # "here's something" and "there isn't any" turn to turn, even
                # with identical candidates on the table each time — a
                # borderline "does this genuinely fit" call landing
                # differently by chance, not a logic bug. `reply`/`picks`
                # share one call (splitting them risks the Vercel timeout
                # noted in this project's own hosting notes), so this is a
                # single shared dial: 0.4 keeps enough variation for warm,
                # non-repetitive phrasing (see `ai_assist.py`'s own 0.2 for
                # a purely mechanical triage task, which would read as flat
                # and robotic here) while making the actual fit/pick
                # decision meaningfully more consistent run to run.
                temperature=0.4,
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
        for pick in (data.get("picks") or [])[:MAX_PICKS]:
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
                "synopsis": item.get("synopsis"),
                "external_ref": item.get("external_ref"),
                "thumbnail": item.get("thumbnail"),
                "genres": item.get("genres", []),
            })
        reply = data.get("reply") or "Here's something you might like!"
        result = BrainResult(reply=reply, recommendations=recs)
        missing = data.get("missing")
        if not recs and isinstance(missing, dict):  # a "miss" means nothing was recommended
            result.missed_topic = clean_missed_topic(missing.get("topic"))
            fmt = missing.get("format")
            result.missed_format = fmt if fmt in ("book", "video") else "any"
        return result


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
