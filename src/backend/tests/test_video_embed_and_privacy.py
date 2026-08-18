"""CH12 (Watch Embedded Video) / PA29 (Manage Data Privacy Settings) — two
gaps found during a review pass (dev-session 2026-08-10) where `RecommendationOut`
never carried anything a child could actually watch, and
`Parent.data_privacy_settings` had no update endpoint at all. See
app/services/recommendation_service.py's `_embed_url` and
app/routers/account.py's `update_privacy_settings`.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi.testclient import TestClient


def _live_video_item() -> dict:
    from app.models.catalogue import CatalogueItem
    from app.repositories import catalogue as catalogue_repo
    from app.services import openai_service

    item = CatalogueItem(
        id="video-dQw4w9WgXcQ",
        title="A Nature Walk",
        type="video",
        synopsis="A calm nature documentary for kids.",
        age_bands=["5-8", "9-12"],
        genre="documentary",
        topics=["nature", "calming"],
        embedding=openai_service.embed_text("A Nature Walk nature documentary calming"),
        status="live",
        created_at=datetime.now(timezone.utc),
    )
    catalogue_repo.create_item(item)
    return item.model_dump()


def test_video_recommendation_carries_embed_url(
    client: TestClient, child_session: dict, child_profile: dict
) -> None:
    _live_video_item()
    headers = {"Authorization": f"Bearer {child_session['session_token']}"}
    session_id = client.post(f"/children/{child_profile['id']}/sessions", headers=headers).json()["id"]

    resp = client.post(f"/sessions/{session_id}/messages", headers=headers, json={"text": "a video about nature"})
    recs = resp.json()["recommendations"]
    assert len(recs) == 1
    assert recs[0]["type"] == "video"
    assert recs[0]["embed_url"] == "https://www.youtube.com/embed/dQw4w9WgXcQ"


def test_book_recommendation_has_no_embed_url(
    client: TestClient, child_session: dict, child_profile: dict, live_catalogue_item: dict
) -> None:
    headers = {"Authorization": f"Bearer {child_session['session_token']}"}
    session_id = client.post(f"/children/{child_profile['id']}/sessions", headers=headers).json()["id"]
    resp = client.post(
        f"/sessions/{session_id}/messages", headers=headers, json={"text": "a book about caterpillars"}
    )
    recs = resp.json()["recommendations"]
    assert len(recs) == 1
    assert recs[0]["type"] == "book"
    assert recs[0]["embed_url"] is None


def test_update_privacy_settings(client: TestClient, signed_up_parent: dict) -> None:
    headers = {"Authorization": f"Bearer {signed_up_parent['token']}"}
    assert client.get("/account", headers=headers).json()["data_privacy_settings"]["retention_preference"] == "standard"

    resp = client.patch("/account/privacy-settings", headers=headers, json={"retention_preference": "minimal"})
    assert resp.status_code == 200
    assert resp.json()["retention_preference"] == "minimal"

    account = client.get("/account", headers=headers).json()
    assert account["data_privacy_settings"]["retention_preference"] == "minimal"


def test_privacy_settings_requires_auth(client: TestClient) -> None:
    assert client.patch("/account/privacy-settings", json={"retention_preference": "minimal"}).status_code == 401
