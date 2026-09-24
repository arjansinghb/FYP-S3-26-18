"""routers/chat.py's `already_shown_note` computation — the fix for a real,
reproduced bug (QA pass, 2026-09-24): asking Pip the exact same narrow-topic
question repeatedly in one session got a coin-flip "here's something" /
"there isn't any" answer, because CH18's own already-shown exclusion (see
`_shown_ids`) emptied the pool before the model ever saw it, with nothing
telling the model WHY it was empty. This checks that chat.py detects that
exact situation and passes an explicit note through to the brain, so the
model can say "you've already seen everything on that" instead of guessing.
"""
from fastapi.testclient import TestClient

from app.brain import BrainResult
from app.routers import chat as chat_router


def test_no_note_on_the_first_ask(client: TestClient, child_session: dict, monkeypatch):
    from app.storage import db

    cid = child_session["child"]["id"]
    db.activity[cid] = []

    pool = [{"id": "sp1", "type": "book", "title": "Space Station Adventures",
             "description": "Life on a space station.", "genres": ["space"]}]
    monkeypatch.setattr(chat_router, "_visible_catalogue", lambda child: pool)

    captured = {}

    class Fake:
        def respond(self, *args, **kwargs):
            captured.update(kwargs)
            return BrainResult(reply="Here!", recommendations=[{
                "id": "sp1", "type": "book", "title": "Space Station Adventures",
                "explanation": "x", "description": "", "synopsis": None,
                "external_ref": None, "thumbnail": None, "genres": ["space"],
            }])

    monkeypatch.setattr(chat_router, "get_brain", lambda: Fake())

    r = client.post("/api/chat", headers=child_session["headers"],
                     json={"message": "a book about space", "session_id": "exhaust-1"})
    assert r.json()["recommendations"]
    assert captured.get("already_shown_note") is None


def test_note_set_once_the_only_named_genre_match_was_already_shown(client: TestClient, child_session: dict, monkeypatch):
    from app.storage import db

    cid = child_session["child"]["id"]
    db.activity[cid] = []

    pool = [{"id": "sp1", "type": "book", "title": "Space Station Adventures",
             "description": "Life on a space station.", "genres": ["space"]}]
    monkeypatch.setattr(chat_router, "_visible_catalogue", lambda child: pool)

    captured = {}

    class Fake:
        def respond(self, *args, **kwargs):
            captured.update(kwargs)
            return BrainResult(reply="Here!", recommendations=[{
                "id": "sp1", "type": "book", "title": "Space Station Adventures",
                "explanation": "x", "description": "", "synopsis": None,
                "external_ref": None, "thumbnail": None, "genres": ["space"],
            }])

    monkeypatch.setattr(chat_router, "get_brain", lambda: Fake())
    sid = "exhaust-2"

    client.post("/api/chat", headers=child_session["headers"], json={"message": "a book about space", "session_id": sid})
    client.post("/api/chat", headers=child_session["headers"], json={"message": "a book about space", "session_id": sid})

    note = captured.get("already_shown_note")
    assert note is not None
    assert "already been shown" in note
    assert "never say it doesn't exist" in note


def test_no_note_when_a_different_unshown_match_still_remains(client: TestClient, child_session: dict, monkeypatch):
    """Two space items: showing one shouldn't claim the topic is exhausted
    while the other is still available to recommend."""
    from app.storage import db

    cid = child_session["child"]["id"]
    db.activity[cid] = []

    pool = [
        {"id": "sp1", "type": "book", "title": "Space Station Adventures",
         "description": "Life on a space station.", "genres": ["space"]},
        {"id": "sp2", "type": "book", "title": "A Trip Around the Moon",
         "description": "Moon facts for kids.", "genres": ["space"]},
    ]
    monkeypatch.setattr(chat_router, "_visible_catalogue", lambda child: pool)

    captured = {}

    class Fake:
        def respond(self, *args, **kwargs):
            captured.update(kwargs)
            return BrainResult(reply="Here!", recommendations=[{
                "id": "sp1", "type": "book", "title": "Space Station Adventures",
                "explanation": "x", "description": "", "synopsis": None,
                "external_ref": None, "thumbnail": None, "genres": ["space"],
            }])

    monkeypatch.setattr(chat_router, "get_brain", lambda: Fake())
    sid = "exhaust-3"

    client.post("/api/chat", headers=child_session["headers"], json={"message": "a book about space", "session_id": sid})
    client.post("/api/chat", headers=child_session["headers"], json={"message": "a book about space", "session_id": sid})

    assert captured.get("already_shown_note") is None
