"""CH15/CH16 (Save/View Favourites) + PA15 (parent-side view) + the Free-tier
cap.
"""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_save_and_view_favourite(client: TestClient, child_session: dict, child_profile: dict) -> None:
    headers = {"Authorization": f"Bearer {child_session['session_token']}"}
    resp = client.post(
        f"/children/{child_profile['id']}/favourites", headers=headers, json={"catalogue_item_id": "test-book-1"}
    )
    assert resp.status_code == 201

    listing = client.get(f"/children/{child_profile['id']}/favourites", headers=headers)
    assert len(listing.json()) == 1


def test_free_tier_favourites_cap(client: TestClient, child_session: dict, child_profile: dict) -> None:
    headers = {"Authorization": f"Bearer {child_session['session_token']}"}
    for i in range(5):
        resp = client.post(
            f"/children/{child_profile['id']}/favourites", headers=headers, json={"catalogue_item_id": f"item-{i}"}
        )
        assert resp.status_code == 201

    resp = client.post(
        f"/children/{child_profile['id']}/favourites", headers=headers, json={"catalogue_item_id": "item-6"}
    )
    assert resp.status_code == 403


def test_parent_can_view_child_favourites(
    client: TestClient, signed_up_parent: dict, child_session: dict, child_profile: dict
) -> None:
    child_headers = {"Authorization": f"Bearer {child_session['session_token']}"}
    client.post(
        f"/children/{child_profile['id']}/favourites", headers=child_headers, json={"catalogue_item_id": "test-book-1"}
    )

    parent_headers = {"Authorization": f"Bearer {signed_up_parent['token']}"}
    resp = client.get(f"/children/{child_profile['id']}/favourites", headers=parent_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1
