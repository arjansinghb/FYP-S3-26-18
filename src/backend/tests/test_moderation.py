"""CM01-CM13 — the moderation pipeline: import -> review -> approve/reject ->
tag -> live. Runs against a fake search source (patched) rather than the real
Google Books/YouTube APIs — network calls don't belong in a unit test suite.
"""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_import_starts_pending_review(client: TestClient, moderator_session: dict) -> None:
    headers = {"Authorization": f"Bearer {moderator_session['token']}"}
    resp = client.post(
        "/catalogue/import",
        headers=headers,
        json={"external_id": "abc123", "type": "book", "title": "Test Book", "synopsis": "A test synopsis."},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "pendingReview"
    assert body["id"] == "book-abc123"


def test_import_is_idempotent(client: TestClient, moderator_session: dict) -> None:
    headers = {"Authorization": f"Bearer {moderator_session['token']}"}
    payload = {"external_id": "dup1", "type": "book", "title": "Dup", "synopsis": "S"}
    first = client.post("/catalogue/import", headers=headers, json=payload)
    second = client.post("/catalogue/import", headers=headers, json=payload)
    assert first.json()["id"] == second.json()["id"]


def test_full_pipeline_promotes_to_live(client: TestClient, moderator_session: dict) -> None:
    headers = {"Authorization": f"Bearer {moderator_session['token']}"}
    imported = client.post(
        "/catalogue/import",
        headers=headers,
        json={"external_id": "flow1", "type": "book", "title": "Flow Book", "synopsis": "S"},
    ).json()
    item_id = imported["id"]

    assert any(i["id"] == item_id for i in client.get("/moderation/queue", headers=headers).json())

    approved = client.post(f"/catalogue/{item_id}/approve", headers=headers)
    assert approved.json()["status"] == "pendingTagging"

    tagged = client.post(f"/catalogue/{item_id}/age-bands", headers=headers, json={"age_bands": ["5-8"]})
    assert tagged.json()["status"] == "pendingTagging"  # metadata not set yet

    live = client.post(
        f"/catalogue/{item_id}/metadata", headers=headers, json={"genre": "fiction", "topics": ["fun"]}
    )
    assert live.json()["status"] == "live"
    assert live.json()["embedding"] is not None


def test_reject_sets_status_and_blocks_double_action(client: TestClient, moderator_session: dict) -> None:
    headers = {"Authorization": f"Bearer {moderator_session['token']}"}
    imported = client.post(
        "/catalogue/import", headers=headers, json={"external_id": "rej1", "type": "book", "title": "R", "synopsis": "S"}
    ).json()
    item_id = imported["id"]

    rejected = client.post(f"/catalogue/{item_id}/reject", headers=headers, json={"reason": "not appropriate"})
    assert rejected.json()["status"] == "rejected"

    # Can't approve something already rejected.
    resp = client.post(f"/catalogue/{item_id}/approve", headers=headers)
    assert resp.status_code == 400


def test_staff_login_required_for_catalogue_routes(client: TestClient) -> None:
    assert client.get("/moderation/queue").status_code == 401


def test_flag_review_and_resolve(
    client: TestClient, moderator_session: dict, signed_up_parent: dict, child_profile: dict, live_catalogue_item: dict
) -> None:
    parent_headers = {"Authorization": f"Bearer {signed_up_parent['token']}"}
    flag = client.post(
        "/flags",
        headers=parent_headers,
        json={"child_id": child_profile["id"], "catalogue_item_id": "test-book-1", "reason": "too scary"},
    )
    assert flag.status_code == 201
    flag_id = flag.json()["id"]

    mod_headers = {"Authorization": f"Bearer {moderator_session['token']}"}
    queue = client.get("/moderation/flags", headers=mod_headers)
    assert any(f["id"] == flag_id for f in queue.json())

    resolved = client.post(f"/moderation/flags/{flag_id}/resolve?resolution=removed", headers=mod_headers)
    assert resolved.status_code == 200
    assert resolved.json()["status"] == "removed"

    # The parent's own view reflects the resolution.
    mine = client.get("/flags", headers=parent_headers)
    assert mine.json()[0]["status"] == "removed"
