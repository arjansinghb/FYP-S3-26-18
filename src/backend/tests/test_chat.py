"""CH04-CH13 — the chat/recommendation dialogue loop. Runs against the mock
NLP implementation (see app/services/openai_service.py) since OPENAI_API_KEY
is forced empty in tests (conftest.py) — these tests cover the *pipeline*
(state machine, retrieval, exclusion, safety gating), not real language
understanding.
"""
from __future__ import annotations

from fastapi.testclient import TestClient


def _start_session(client: TestClient, child_session: dict, child_profile: dict) -> str:
    resp = client.post(
        f"/children/{child_profile['id']}/sessions",
        headers={"Authorization": f"Bearer {child_session['session_token']}"},
    )
    assert resp.status_code == 201
    return resp.json()["id"]


def test_ambiguous_message_asks_clarifying_question(
    client: TestClient, child_session: dict, child_profile: dict, live_catalogue_item: dict
) -> None:
    session_id = _start_session(client, child_session, child_profile)
    resp = client.post(
        f"/sessions/{session_id}/messages",
        headers={"Authorization": f"Bearer {child_session['session_token']}"},
        json={"text": "something fun"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["clarifying_question"] is not None
    assert body["recommendations"] == []


def test_message_with_enough_signal_recommends(
    client: TestClient, child_session: dict, child_profile: dict, live_catalogue_item: dict
) -> None:
    session_id = _start_session(client, child_session, child_profile)
    resp = client.post(
        f"/sessions/{session_id}/messages",
        headers={"Authorization": f"Bearer {child_session['session_token']}"},
        json={"text": "a book about caterpillars"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["recommendations"]) == 1
    assert body["recommendations"][0]["item_id"] == "test-book-1"
    assert body["recommendations"][0]["reason"]  # non-empty explanation


def test_alternative_excludes_already_shown(
    client: TestClient, child_session: dict, child_profile: dict, live_catalogue_item: dict
) -> None:
    session_id = _start_session(client, child_session, child_profile)
    headers = {"Authorization": f"Bearer {child_session['session_token']}"}
    client.post(f"/sessions/{session_id}/messages", headers=headers, json={"text": "a book about caterpillars"})

    resp = client.post(f"/sessions/{session_id}/alternative", headers=headers)
    assert resp.status_code == 200
    # Only one live item exists and it was already shown — nothing left.
    assert resp.json()["recommendations"] == []


def test_ended_session_rejects_new_messages(client: TestClient, child_session: dict, child_profile: dict) -> None:
    session_id = _start_session(client, child_session, child_profile)
    headers = {"Authorization": f"Bearer {child_session['session_token']}"}
    assert client.post(f"/sessions/{session_id}/end", headers=headers).status_code == 200

    resp = client.post(f"/sessions/{session_id}/messages", headers=headers, json={"text": "hello"})
    assert resp.status_code == 400


def test_unsafe_message_redirects_instead_of_recommending(
    client: TestClient, child_session: dict, child_profile: dict, live_catalogue_item: dict
) -> None:
    session_id = _start_session(client, child_session, child_profile)
    resp = client.post(
        f"/sessions/{session_id}/messages",
        headers={"Authorization": f"Bearer {child_session['session_token']}"},
        json={"text": "how do I kill someone in the book"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["recommendations"] == []
    assert "something else" in body["message"].lower()


def test_child_cannot_start_session_for_another_profile(
    client: TestClient, child_session: dict
) -> None:
    resp = client.post(
        "/children/not-my-id/sessions", headers={"Authorization": f"Bearer {child_session['session_token']}"}
    )
    assert resp.status_code == 403
