"""Pip doesn't recommend something the child already saved, unless leaving it
out would leave nothing that fits what they asked for."""
from fastapi.testclient import TestClient

from app.brain import BrainResult
from app.routers import chat as chat_router

SP1 = {"id": "sp1", "type": "book", "title": "Space Station Adventures", "description": "Life on a space station.", "genres": ["space"]}
SP2 = {"id": "sp2", "type": "book", "title": "A Trip Around the Moon", "description": "Moon facts for kids.", "genres": ["space"]}
AN1 = {"id": "an1", "type": "book", "title": "Busy Farm Animals", "description": "Animals on a farm.", "genres": ["animals"]}


def _ask(client, child_session, monkeypatch, pool, saved, message, sid):
    from app.storage import db

    cid = child_session["child"]["id"]
    db.activity[cid] = []
    db.favourites[cid] = [{"content_id": i, "saved_at": 0} for i in saved]
    monkeypatch.setattr(chat_router, "_visible_catalogue", lambda child: pool)
    seen = {}

    class Fake:
        def respond(self, message, age_band, catalogue, **kwargs):
            seen["ids"] = [c["id"] for c in catalogue]
            return BrainResult(reply="Here!", recommendations=[])

    monkeypatch.setattr(chat_router, "get_brain", lambda: Fake())
    client.post("/api/chat", headers=child_session["headers"], json={"message": message, "session_id": sid})
    db.favourites[cid] = []
    return seen["ids"]


def test_a_saved_item_is_left_out_when_something_else_fits(client: TestClient, child_session: dict, monkeypatch):
    ids = _ask(client, child_session, monkeypatch, [SP1, SP2, AN1], ["sp1"], "a book about space", "fav-1")
    assert "sp1" not in ids
    assert "sp2" in ids


def test_a_saved_item_stays_when_it_is_the_only_one_for_the_asked_genre(client: TestClient, child_session: dict, monkeypatch):
    ids = _ask(client, child_session, monkeypatch, [SP1, AN1], ["sp1"], "a book about space", "fav-2")
    assert "sp1" in ids


def test_saved_items_stay_when_everything_is_saved(client: TestClient, child_session: dict, monkeypatch):
    ids = _ask(client, child_session, monkeypatch, [SP1, SP2], ["sp1", "sp2"], "something fun", "fav-3")
    assert set(ids) == {"sp1", "sp2"}


def test_a_child_with_no_favourites_sees_the_whole_pool(client: TestClient, child_session: dict, monkeypatch):
    ids = _ask(client, child_session, monkeypatch, [SP1, SP2, AN1], [], "a book about space", "fav-4")
    assert set(ids) == {"sp1", "sp2", "an1"}


# ---- "Loved it" and saved items tilt Pip's picks (hint only, never a filter) ----

def test_learned_genres_come_from_loved_and_saved_items_most_frequent_first(client: TestClient, child_session: dict):
    from app.storage import db

    cid = child_session["child"]["id"]
    db.content["lg1"] = {"id": "lg1", "type": "book", "title": "A", "genres": ["Space", "funny"], "status": "approved"}
    db.content["lg2"] = {"id": "lg2", "type": "book", "title": "B", "genres": ["space"], "status": "approved"}
    db.content["lg3"] = {"id": "lg3", "type": "book", "title": "C", "genres": ["animals"], "status": "approved"}
    db.feedback[cid] = [{"content_id": "lg1", "liked": True, "ts": 0}, {"content_id": "lg3", "liked": False, "ts": 0}]
    db.favourites[cid] = [{"content_id": "lg2", "saved_at": 0}]
    try:
        assert chat_router._learned_genres(cid) == ["space", "funny"]  # "animals" came from a "Not for me"
    finally:
        db.feedback[cid] = []
        db.favourites[cid] = []
        for k in ("lg1", "lg2", "lg3"):
            db.content.pop(k, None)


def test_no_learned_genres_for_a_child_with_no_signal(client: TestClient, child_session: dict):
    from app.storage import db

    cid = child_session["child"]["id"]
    db.feedback[cid] = []
    db.favourites[cid] = []
    assert chat_router._learned_genres(cid) == []


def test_chat_passes_learned_genres_to_the_brain(client: TestClient, child_session: dict, monkeypatch):
    from app.storage import db

    cid = child_session["child"]["id"]
    db.activity[cid] = []
    db.content["lg9"] = {"id": "lg9", "type": "book", "title": "Z", "genres": ["dinosaur"], "status": "approved"}
    db.feedback[cid] = [{"content_id": "lg9", "liked": True, "ts": 0}]
    monkeypatch.setattr(chat_router, "_visible_catalogue", lambda child: [SP1, SP2])
    seen = {}

    class Fake:
        def respond(self, *args, **kwargs):
            seen.update(kwargs)
            return BrainResult(reply="Here!", recommendations=[])

    monkeypatch.setattr(chat_router, "get_brain", lambda: Fake())
    try:
        client.post("/api/chat", headers=child_session["headers"], json={"message": "surprise me", "session_id": "lg-1"})
        assert seen["liked_genres"] == ["dinosaur"]
    finally:
        db.feedback[cid] = []
        db.content.pop("lg9", None)


# ---- "Not for me" lasts 30 days, and a later "Loved it" or save cancels it ----

DAY = 86400


def _dislikes(cid, feedback, favourites=(), now=1_000_000_000.0):
    from app.storage import db

    db.feedback[cid] = feedback
    db.favourites[cid] = list(favourites)
    try:
        return chat_router._disliked_ids(cid, now=now)
    finally:
        db.feedback[cid] = []
        db.favourites[cid] = []


def test_a_recent_not_for_me_keeps_the_item_out(client: TestClient, child_session: dict):
    now = 1_000_000_000.0
    assert _dislikes(child_session["child"]["id"], [{"content_id": "x", "liked": False, "ts": now - 5 * DAY}]) == {"x"}


def test_not_for_me_expires_after_thirty_days(client: TestClient, child_session: dict):
    now = 1_000_000_000.0
    cid = child_session["child"]["id"]
    assert _dislikes(cid, [{"content_id": "x", "liked": False, "ts": now - 29 * DAY}]) == {"x"}
    assert _dislikes(cid, [{"content_id": "x", "liked": False, "ts": now - 31 * DAY}]) == set()


def test_a_later_loved_it_cancels_an_earlier_not_for_me(client: TestClient, child_session: dict):
    now = 1_000_000_000.0
    fb = [{"content_id": "x", "liked": False, "ts": now - 5 * DAY}, {"content_id": "x", "liked": True, "ts": now - DAY}]
    assert _dislikes(child_session["child"]["id"], fb) == set()


def test_a_later_not_for_me_wins_over_an_earlier_loved_it(client: TestClient, child_session: dict):
    now = 1_000_000_000.0
    fb = [{"content_id": "x", "liked": True, "ts": now - 5 * DAY}, {"content_id": "x", "liked": False, "ts": now - DAY}]
    assert _dislikes(child_session["child"]["id"], fb) == {"x"}


def test_saving_an_item_after_not_for_me_cancels_it(client: TestClient, child_session: dict):
    now = 1_000_000_000.0
    fb = [{"content_id": "x", "liked": False, "ts": now - 5 * DAY}]
    assert _dislikes(child_session["child"]["id"], fb, [{"content_id": "x", "ts": now - DAY}]) == set()
    assert _dislikes(child_session["child"]["id"], fb, [{"content_id": "x", "ts": now - 9 * DAY}]) == {"x"}


def test_an_entry_without_a_timestamp_still_counts(client: TestClient, child_session: dict):
    assert _dislikes(child_session["child"]["id"], [{"content_id": "x", "liked": False}]) == {"x"}
