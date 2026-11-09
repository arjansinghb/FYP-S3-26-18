"""A genre the child's message literally names must always reach the
model's candidate list (app/brain.py's _named_genre_items) — the answer to
a real, reproduced bug: "I want to read a book about robots" retrieved
four completely unrelated books while the two books actually tagged
"robots" never appeared in the top embedding matches at all (Kiefer,
2026-09-24, confirmed across 9 of 22 real catalogue genres, not a one-off).
"""
import json
from unittest.mock import MagicMock

from app.brain import OpenAIBrain, _named_genre_items

CATALOGUE = [
    {"id": "r1", "type": "book", "title": "Robots for Kids", "description": "All about robots.", "genres": ["robots"]},
    {"id": "r2", "type": "book", "title": "300 Fantastic Facts: Robots", "description": "Robot facts.", "genres": ["robots"]},
    {"id": "b1", "type": "book", "title": "Sing It Out", "description": "A singalong.", "genres": []},
    {"id": "b2", "type": "book", "title": "Cosmic Treasure Hunt", "description": "A space story.", "genres": ["space"]},
]


# ---- _named_genre_items, directly ----

def test_returns_items_tagged_with_a_genre_named_in_the_message():
    items = _named_genre_items("I want to read a book about robots", CATALOGUE)
    assert {i["id"] for i in items} == {"r1", "r2"}


def test_is_plural_tolerant_and_case_insensitive():
    items = _named_genre_items("ROBOT stories please", CATALOGUE)
    assert {i["id"] for i in items} == {"r1", "r2"}


def test_empty_when_no_catalogue_genre_is_named():
    assert _named_genre_items("I want a book about dragons", CATALOGUE) == []


def test_respects_the_per_topic_cap():
    many = [{"id": f"x{i}", "type": "book", "title": f"Robot Book {i}", "description": "x", "genres": ["robots"]} for i in range(5)]
    items = _named_genre_items("a book about robots", many, per_topic=2)
    assert len(items) == 2


# ---- wired into OpenAIBrain.respond(), even when embedding retrieval misses ----

def _brain_with_captured_request(response_payload):
    captured = {}

    def fake_create(**kw):
        captured["messages"] = kw["messages"]
        return MagicMock(choices=[MagicMock(message=MagicMock(content=json.dumps(response_payload)))])

    brain = OpenAIBrain.__new__(OpenAIBrain)
    brain._client = MagicMock()
    brain._client.chat.completions.create = fake_create
    brain._model = "fake"
    return brain, captured


def test_a_named_genre_reaches_the_model_even_when_embedding_retrieval_misses_it(monkeypatch):
    """Reproduces the exact real bug: embedding retrieval (mocked here to
    return the unrelated items, the same shape the real top_matches call
    returned for "robots" in production) must not be the only thing
    deciding what the model can possibly recommend."""
    from app import brain as brain_module

    monkeypatch.setattr(brain_module.embeddings, "embed_text", lambda text: [0.1, 0.2])
    monkeypatch.setattr(
        brain_module.embeddings, "top_matches",
        lambda query_embedding, catalogue, limit=4: [CATALOGUE[2], CATALOGUE[3]],  # Sing It Out, Cosmic Treasure Hunt
    )
    brain, captured = _brain_with_captured_request({"reply": "Here!", "picks": [], "missing": None})
    brain.respond("I want to read a book about robots", "5-8", CATALOGUE)

    user_content = captured["messages"][-1]["content"]
    brief = json.loads(user_content.split("Catalogue:\n", 1)[1].split("\n\nTopics", 1)[0])
    titles = {c["title"] for c in brief}
    assert "Robots for Kids" in titles or "300 Fantastic Facts: Robots" in titles


def test_no_named_genre_leaves_pure_embedding_retrieval_untouched(monkeypatch):
    from app import brain as brain_module

    monkeypatch.setattr(brain_module.embeddings, "embed_text", lambda text: [0.1, 0.2])
    monkeypatch.setattr(
        brain_module.embeddings, "top_matches",
        lambda query_embedding, catalogue, limit=4: [CATALOGUE[2]],  # Sing It Out only
    )
    brain, captured = _brain_with_captured_request({"reply": "Here!", "picks": [], "missing": None})
    brain.respond("surprise me with something fun", "5-8", CATALOGUE)

    user_content = captured["messages"][-1]["content"]
    brief = json.loads(user_content.split("Catalogue:\n", 1)[1].split("\n\nTopics", 1)[0])
    assert [c["title"] for c in brief] == ["Sing It Out"]
