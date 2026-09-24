"""Pip's reply behaviour when what a child asks for isn't in the catalogue,
plus staying relevant to what they actually said (supervisor feedback:
"Oops, there currently isn't any book related to X, would you like Y
instead?" — and Pip should always answer what the child said, within Pip's
own scope, never wander off it).

Pure unit tests over the brain classes with a tiny hand-built catalogue —
no client/DB needed. The real (OpenAI) brain is exercised through a fake
client so the prompt/retrieval plumbing is checked without any API call.
"""
import json
from types import SimpleNamespace

from app import brain as brain_module
from app.brain import OpenAIBrain, PlaceholderBrain

CATALOGUE = [
    {"id": "b1", "type": "book", "title": "The Dragon Who Sneezed", "description": "A giggly dragon.",
     "genres": ["funny", "animals"]},
    {"id": "b2", "type": "book", "title": "Luna's Moon Trip", "description": "A rocket to the moon.",
     "genres": ["space", "adventure"]},
    {"id": "v1", "type": "video", "title": "Amazing Rainforest Animals", "description": "Jungle creatures.",
     "genres": ["animals", "nature"]},
]


def test_mock_no_topic_match_offers_related_topic():
    result = PlaceholderBrain().respond("Do you have a book about dinosaurs?", "5-8", CATALOGUE)
    assert result.recommendations == []
    assert result.reply.startswith("Oops, there currently isn't any book related to dinosaur")
    assert "Would you like to read about" in result.reply


def test_mock_no_format_match_offers_the_other_format():
    books_only = [c for c in CATALOGUE if c["type"] == "book"]
    result = PlaceholderBrain().respond("I want a video please", "5-8", books_only)
    assert result.recommendations == []
    assert "Oops" in result.reply and "video" in result.reply
    assert "book" in result.reply  # offers the format that does exist


def test_mock_real_match_still_recommends():
    result = PlaceholderBrain().respond("a funny book please", "5-8", CATALOGUE)
    assert [r["id"] for r in result.recommendations] == ["b1"]


def test_mock_greeting_gets_a_real_reply_not_a_random_pick():
    result = PlaceholderBrain().respond("hi!", "5-8", CATALOGUE)
    assert result.recommendations == []
    assert "Pip" in result.reply


class _FakeCompletions:
    def __init__(self, payload: dict):
        self.payload = payload
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(self.payload)))])


def _openai_brain(payload: dict) -> tuple[OpenAIBrain, _FakeCompletions]:
    completions = _FakeCompletions(payload)
    brain = OpenAIBrain.__new__(OpenAIBrain)
    brain._client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    brain._model = "fake-model"
    return brain, completions


def test_openai_brain_gets_topic_list_and_no_match_rules(monkeypatch):
    monkeypatch.setattr(brain_module.embeddings, "embed_text", lambda text: None)
    reply = "Oops, there currently isn't any book about pirates — would you like to read about adventure instead?"
    brain, completions = _openai_brain({"reply": reply, "picks": []})

    result = brain.respond("a book about pirates", "5-8", CATALOGUE)

    assert result.reply == reply and result.recommendations == []
    call = completions.calls[0]
    system_prompt = call["messages"][0]["content"]
    assert "Oops, there currently isn't any" in system_prompt  # the no-match shape is spelled out
    assert "out of scope" in system_prompt  # and so is staying inside Pip's remit
    user_message = call["messages"][-1]["content"]
    assert "topics the catalogue covers overall" in user_message.lower()
    assert '"adventure"' in user_message and '"funny"' in user_message  # real topics only


def test_openai_brain_short_followup_puts_the_offered_topic_first(monkeypatch):
    monkeypatch.setattr(brain_module.embeddings, "embed_text", lambda text: None)
    brain, completions = _openai_brain({"reply": "Here you go!", "picks": [{"index": 0, "why": "It's an adventure."}]})
    history = [{
        "message": "a book about pirates",
        "reply": "Oops, there currently isn't any book about pirates — would you like to read about adventure instead?",
    }]

    result = brain.respond("yes please", "5-8", CATALOGUE, history=history)

    user_message = completions.calls[0]["messages"][-1]["content"]
    # "yes please" has no topic of its own; Pip's offer ("adventure") supplies
    # it, so the adventure book leads the numbered list the model picks from.
    assert user_message.index("Luna's Moon Trip") < user_message.index("The Dragon Who Sneezed")
    assert [r["id"] for r in result.recommendations] == ["b2"]


def test_openai_brain_is_told_when_the_topic_only_exists_in_the_other_format(monkeypatch):
    monkeypatch.setattr(brain_module.embeddings, "embed_text", lambda text: None)
    pool = CATALOGUE + [{"id": "v2", "type": "video", "title": "Pirate Island", "description": "Pirates!",
                         "genres": ["pirates"]}]
    brain, completions = _openai_brain({"reply": "Oops, no pirate book, but I have a video!", "picks": []})

    brain.respond("Do you have any books about pirates?", "5-8", pool)

    user_message = completions.calls[0]["messages"][-1]["content"]
    assert 'The catalogue has no book about pirates, but it DOES have a video about it ("Pirate Island")' in user_message
    assert "Pirate Island" in user_message.split("Catalogue:")[1].split("Topics the catalogue")[0]  # and it's pickable


# ---- named-title format mismatch (real gap, QA pass 2026-09-24: "a video
# about the very hungry caterpillar" fell through the genre-only mismatch
# check entirely, since "the very hungry caterpillar" is a title, not a
# genre tag, and got a generic unrelated-topic redirect instead of the book
# being offered) ----

def test_named_title_items_matches_a_title_named_directly_in_the_message():
    pool = CATALOGUE + [{"id": "b3", "type": "book", "title": "The Sleepy Otter", "description": "A calm story.",
                         "genres": ["cosy"]}]
    items = brain_module._named_title_items("I want a video about the sleepy otter please", pool)
    assert [i["id"] for i in items] == ["b3"]


def test_named_title_items_empty_when_no_title_is_named():
    assert brain_module._named_title_items("something fun please", CATALOGUE) == []


def test_format_mismatch_covers_a_named_title_not_just_a_genre():
    pool = CATALOGUE + [{"id": "b3", "type": "book", "title": "The Sleepy Otter", "description": "A calm story.",
                         "genres": ["cosy"]}]
    note, items = brain_module._format_mismatch("I want a video about the sleepy otter", pool)
    assert [i["id"] for i in items] == ["b3"]
    assert 'The child named "The Sleepy Otter" directly' in note
    assert "offer that book first" in note


def test_openai_brain_is_told_when_a_named_title_only_exists_in_the_other_format(monkeypatch):
    monkeypatch.setattr(brain_module.embeddings, "embed_text", lambda text: None)
    pool = CATALOGUE + [{"id": "b3", "type": "book", "title": "The Sleepy Otter", "description": "A calm story.",
                         "genres": ["cosy"]}]
    brain, completions = _openai_brain({"reply": "No otter video, but there's a book!", "picks": []})

    brain.respond("I want a video about the sleepy otter", "5-8", pool)

    user_message = completions.calls[0]["messages"][-1]["content"]
    assert 'The child named "The Sleepy Otter" directly' in user_message
    assert "The Sleepy Otter" in user_message.split("Catalogue:")[1].split("Topics the catalogue")[0]


# ---- already_shown_note — the exhaustion-consistency fix (real,
# reproduced bug, QA pass 2026-09-24: the exact same repeated request got a
# coin-flip "here's something" / "there isn't any" answer turn to turn,
# because nothing told the model whether an empty candidate list meant the
# topic never existed or had just already been fully shown) ----

def test_already_shown_note_reaches_the_model_when_given(monkeypatch):
    monkeypatch.setattr(brain_module.embeddings, "embed_text", lambda text: None)
    brain, completions = _openai_brain({"reply": "You've seen everything I have on that!", "picks": []})

    brain.respond("a book about space again", "5-8", CATALOGUE,
                  already_shown_note="Every catalogue item matching space has already been shown this session.")

    user_message = completions.calls[0]["messages"][-1]["content"]
    assert "Every catalogue item matching space has already been shown this session." in user_message


def test_no_already_shown_note_adds_nothing_extra(monkeypatch):
    monkeypatch.setattr(brain_module.embeddings, "embed_text", lambda text: None)
    brain, completions = _openai_brain({"reply": "Here!", "picks": []})

    brain.respond("a funny book please", "5-8", CATALOGUE)

    user_message = completions.calls[0]["messages"][-1]["content"]
    assert user_message.count("\n\nNote:") == 0


# ---- privacy prompt — strengthened wording (real gap, QA pass
# 2026-09-24: a child sharing a fabricated school name mid-conversation got
# it echoed back and built on, because the small-talk "engage warmly"
# guidance and the privacy "don't repeat it back" guidance could point in
# different directions on a message that mixes both) ----

def test_system_prompt_tells_the_model_privacy_overrides_small_talk(monkeypatch):
    monkeypatch.setattr(brain_module.embeddings, "embed_text", lambda text: None)
    brain, completions = _openai_brain({"reply": "Here!", "picks": []})

    brain.respond("hi", "5-8", CATALOGUE)

    system_prompt = completions.calls[0]["messages"][0]["content"]
    assert "do NOT repeat the specific identifying detail back" in system_prompt
    assert "This overrides the small-talk guidance above" in system_prompt
