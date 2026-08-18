"""PA18 — Hide Specific Content (approve/block override) actually affecting
recommendations, not just being stored.
"""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_block_override_excludes_item_from_recommendations(
    client: TestClient, signed_up_parent: dict, child_session: dict, child_profile: dict, live_catalogue_item: dict
) -> None:
    parent_headers = {"Authorization": f"Bearer {signed_up_parent['token']}"}
    override = client.post(
        f"/children/{child_profile['id']}/content-overrides",
        headers=parent_headers,
        json={"catalogue_item_id": "test-book-1", "decision": "block"},
    )
    assert override.status_code == 201

    child_headers = {"Authorization": f"Bearer {child_session['session_token']}"}
    session_id = client.post(f"/children/{child_profile['id']}/sessions", headers=child_headers).json()["id"]
    reply = client.post(
        f"/sessions/{session_id}/messages", headers=child_headers, json={"text": "a book about caterpillars"}
    )
    # The only live item is blocked -> nothing left to recommend.
    assert reply.json()["recommendations"] == []
