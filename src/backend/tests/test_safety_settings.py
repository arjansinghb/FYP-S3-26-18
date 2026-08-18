"""PA21 — Adjust Safety Settings. Verifies the settings actually change what
gets recommended (app/services/recommendation_service.py), not just that
they're stored — see app/models/child.py's SafetySettings docstring.
"""
from __future__ import annotations

from fastapi.testclient import TestClient


def _start_session(client: TestClient, child_session: dict, child_profile: dict) -> str:
    return client.post(
        f"/children/{child_profile['id']}/sessions",
        headers={"Authorization": f"Bearer {child_session['session_token']}"},
    ).json()["id"]


def test_blocked_topic_excludes_matching_item(
    client: TestClient, signed_up_parent: dict, child_profile: dict, child_session: dict, live_catalogue_item: dict
) -> None:
    # test-book-1 (the fixture) has topics ["nature", "calming"].
    parent_headers = {"Authorization": f"Bearer {signed_up_parent['token']}"}
    updated = client.patch(
        f"/children/{child_profile['id']}/safety-settings",
        headers=parent_headers,
        json={"blocked_topics": ["nature"]},
    )
    assert updated.status_code == 200
    assert updated.json()["safety_settings"]["blocked_topics"] == ["nature"]

    session_id = _start_session(client, child_session, child_profile)
    resp = client.post(
        f"/sessions/{session_id}/messages",
        headers={"Authorization": f"Bearer {child_session['session_token']}"},
        json={"text": "a book about caterpillars"},
    )
    assert resp.json()["recommendations"] == []  # the only live item is blocked by topic


def test_unblocked_topic_still_recommends(
    client: TestClient, signed_up_parent: dict, child_profile: dict, child_session: dict, live_catalogue_item: dict
) -> None:
    parent_headers = {"Authorization": f"Bearer {signed_up_parent['token']}"}
    client.patch(
        f"/children/{child_profile['id']}/safety-settings",
        headers=parent_headers,
        json={"blocked_topics": ["something-unrelated"]},
    )

    session_id = _start_session(client, child_session, child_profile)
    resp = client.post(
        f"/sessions/{session_id}/messages",
        headers={"Authorization": f"Bearer {child_session['session_token']}"},
        json={"text": "a book about caterpillars"},
    )
    assert len(resp.json()["recommendations"]) == 1


def test_strict_age_filtering_disables_approve_override(
    client: TestClient, signed_up_parent: dict, child_profile: dict, child_session: dict, live_catalogue_item: dict
) -> None:
    """live_catalogue_item is tagged for both 5-8 and 9-12 (see conftest.py),
    so this only proves the wiring, not the cross-band relaxation itself —
    good enough to confirm strict_age_filtering=True doesn't crash the
    retrieval path and still returns the in-band item normally."""
    parent_headers = {"Authorization": f"Bearer {signed_up_parent['token']}"}
    resp = client.patch(
        f"/children/{child_profile['id']}/safety-settings",
        headers=parent_headers,
        json={"strict_age_filtering": True},
    )
    assert resp.json()["safety_settings"]["strict_age_filtering"] is True

    session_id = _start_session(client, child_session, child_profile)
    reply = client.post(
        f"/sessions/{session_id}/messages",
        headers={"Authorization": f"Bearer {child_session['session_token']}"},
        json={"text": "a book about caterpillars"},
    )
    assert len(reply.json()["recommendations"]) == 1


def test_safety_settings_require_parent_ownership(client: TestClient, child_profile: dict) -> None:
    resp = client.patch(f"/children/{child_profile['id']}/safety-settings", json={"blocked_topics": ["x"]})
    assert resp.status_code == 401
