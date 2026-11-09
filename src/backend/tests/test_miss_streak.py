"""Breaking a streak of consecutive "Oops, nothing about X" misses with a
real recommendation instead of another topic negotiation
(routers/chat.py's MISS_STREAK_BREAK / _recent_miss_streak /
_fallback_recommendation) — the answer to "the child asks for several
things in a row the catalogue genuinely doesn't have, and Pip just keeps
saying no" (Kiefer, 2026-09-24). Without this, a real string of misses read
as Pip giving up on the child instead of the friendly companion the whole
product is supposed to be.
"""
import pytest
from fastapi.testclient import TestClient

from app.brain import BrainResult
from app.routers import chat as chat_router


def _fake_miss_brain(topic, fmt="book"):
    class Fake:
        def respond(self, *args, **kwargs):
            return BrainResult(reply=f"Oops, nothing about {topic} yet!", recommendations=[],
                                missed_topic=topic, missed_format=fmt)
    return Fake()


def _fake_hit_brain(recs):
    class Fake:
        def respond(self, *args, **kwargs):
            return BrainResult(reply="Here you go!", recommendations=recs)
    return Fake()


def _miss(client, headers, session_id, topic, monkeypatch):
    monkeypatch.setattr(chat_router, "get_brain", lambda t=topic: _fake_miss_brain(t))
    return client.post("/api/chat", headers=headers, json={"message": f"a book about {topic}", "session_id": session_id})


# ---- the endpoint, end to end ----

def test_first_two_misses_in_a_row_stay_as_plain_misses(client: TestClient, child_session: dict, monkeypatch):
    from app.storage import db

    db.activity[child_session["child"]["id"]] = []
    sid = "streak-session-1"

    assert _miss(client, child_session["headers"], sid, "narwhals", monkeypatch).json()["recommendations"] == []
    assert _miss(client, child_session["headers"], sid, "unicorns", monkeypatch).json()["recommendations"] == []


def test_the_third_miss_in_a_row_gets_a_real_recommendation_instead(client: TestClient, child_session: dict, monkeypatch):
    from app.storage import db

    db.activity[child_session["child"]["id"]] = []
    sid = "streak-session-2"

    _miss(client, child_session["headers"], sid, "narwhals", monkeypatch)
    _miss(client, child_session["headers"], sid, "unicorns", monkeypatch)
    r3 = _miss(client, child_session["headers"], sid, "mermaids", monkeypatch)
    body = r3.json()
    assert len(body["recommendations"]) == 1
    assert "haven't found exactly" in body["reply"]
    # the original topic is still tallied for moderators even though Pip
    # covered for it with a fallback pick — demand signal isn't lost
    misses = [m for m in db.topic_misses if m["topic"] == "mermaids"]
    assert misses and misses[0]["count"] == 1


def test_a_real_recommendation_resets_the_streak(client: TestClient, child_session: dict, monkeypatch):
    from app.storage import db

    db.activity[child_session["child"]["id"]] = []
    sid = "streak-session-3"

    _miss(client, child_session["headers"], sid, "narwhals", monkeypatch)
    _miss(client, child_session["headers"], sid, "unicorns", monkeypatch)

    real_item = db.approved_content()[0]
    monkeypatch.setattr(chat_router, "get_brain", lambda: _fake_hit_brain([{
        "id": real_item["id"], "type": real_item["type"], "title": real_item["title"],
        "explanation": "fun!", "description": "", "external_ref": None, "thumbnail": None,
        "genres": real_item.get("genres", []),
    }]))
    hit = client.post("/api/chat", headers=child_session["headers"], json={"message": "something fun", "session_id": sid})
    assert len(hit.json()["recommendations"]) == 1

    # streak reset to 0 by the real recommendation above — the next two
    # misses must NOT trigger the break yet
    assert _miss(client, child_session["headers"], sid, "dragons2", monkeypatch).json()["recommendations"] == []
    assert _miss(client, child_session["headers"], sid, "robots2", monkeypatch).json()["recommendations"] == []


def test_without_a_session_id_the_feature_is_skipped_entirely(client: TestClient, child_session: dict, monkeypatch):
    """No session_id -> _recent_miss_streak can't correlate turns -> always
    the plain per-turn miss behaviour, same as before this feature existed."""
    from app.storage import db

    db.activity[child_session["child"]["id"]] = []
    last = None
    for topic in ["narwhals3", "unicorns3", "mermaids3"]:
        monkeypatch.setattr(chat_router, "get_brain", lambda t=topic: _fake_miss_brain(t))
        last = client.post("/api/chat", headers=child_session["headers"], json={"message": f"a book about {topic}"})
    assert last.json()["recommendations"] == []


# ---- the two helpers, directly ----

def test_recent_miss_streak_counts_back_from_the_latest_turn_only():
    from app.routers.chat import _recent_miss_streak
    from app.storage import db

    cid, sid = "streak-child-1", "streak-sess-1"
    db.activity[cid] = [
        {"session_id": sid, "missed_topic": "x", "rec_ids": []},
        {"session_id": sid, "missed_topic": None, "rec_ids": ["r1"]},  # real rec resets it
        {"session_id": sid, "missed_topic": "y", "rec_ids": []},
        {"session_id": sid, "missed_topic": "z", "rec_ids": []},
    ]
    assert _recent_miss_streak(cid, sid) == 2
    assert _recent_miss_streak(cid, "some-other-session") == 0
    assert _recent_miss_streak(cid, None) == 0
    assert _recent_miss_streak("", sid) == 0


def test_fallback_recommendation_prefers_a_genre_the_child_already_liked(client: TestClient, child_session: dict):
    from app.routers.chat import _fallback_recommendation
    from app.storage import db

    catalogue = db.approved_content()
    liked_genres = set(catalogue[0]["genres"])  # every genre on the liked item counts as preferred
    db.feedback[child_session["child"]["id"]] = [{"content_id": catalogue[0]["id"], "liked": True}]

    for _ in range(20):  # random.choice — run enough times to be confident it's actually filtering, not luck
        pick = _fallback_recommendation(catalogue, child_session["child"])
        assert liked_genres & set(pick["genres"])


def test_fallback_recommendation_falls_back_to_the_whole_pool_with_no_signal():
    from app.routers.chat import _fallback_recommendation
    from app.storage import db

    catalogue = db.approved_content()
    pick = _fallback_recommendation(catalogue, None)
    assert pick["id"] in {c["id"] for c in catalogue}


def test_fallback_recommendation_is_none_for_an_empty_pool():
    from app.routers.chat import _fallback_recommendation

    assert _fallback_recommendation([], None) is None
