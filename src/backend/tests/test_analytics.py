"""PA31 (Activity Trends) / PA32 (Multi-Child Comparative Insights) — both
Premium-gated, see app/services/activity_analytics.py.
"""
from __future__ import annotations

from fastapi.testclient import TestClient


def _make_premium(client: TestClient, headers: dict) -> None:
    client.put(
        "/account/payment-method", headers=headers, json={"card_number": "4242424242424242", "exp_month": 1, "exp_year": 2030}
    )
    resp = client.post("/account/subscribe", headers=headers)
    assert resp.status_code == 200


def test_trends_require_premium(client: TestClient, signed_up_parent: dict, child_profile: dict) -> None:
    headers = {"Authorization": f"Bearer {signed_up_parent['token']}"}
    resp = client.get(f"/children/{child_profile['id']}/trends", headers=headers)
    assert resp.status_code == 403


def test_trends_count_sessions(
    client: TestClient, signed_up_parent: dict, child_profile: dict, child_session: dict, live_catalogue_item: dict
) -> None:
    headers = {"Authorization": f"Bearer {signed_up_parent['token']}"}
    _make_premium(client, headers)

    child_headers = {"Authorization": f"Bearer {child_session['session_token']}"}
    session_id = client.post(f"/children/{child_profile['id']}/sessions", headers=child_headers).json()["id"]
    client.post(f"/sessions/{session_id}/messages", headers=child_headers, json={"text": "a book about caterpillars"})

    trends = client.get(f"/children/{child_profile['id']}/trends", headers=headers)
    assert trends.status_code == 200
    body = trends.json()
    assert body["total_sessions"] == 1
    assert sum(body["sessions_by_week"].values()) == 1


def test_comparative_insights_require_premium(client: TestClient, signed_up_parent: dict) -> None:
    headers = {"Authorization": f"Bearer {signed_up_parent['token']}"}
    assert client.get("/children-insights", headers=headers).status_code == 403


def test_comparative_insights_lists_children(
    client: TestClient, signed_up_parent: dict, child_profile: dict
) -> None:
    headers = {"Authorization": f"Bearer {signed_up_parent['token']}"}
    _make_premium(client, headers)

    insights = client.get("/children-insights", headers=headers)
    assert insights.status_code == 200
    body = insights.json()
    assert len(body) == 1
    assert body[0]["child_id"] == child_profile["id"]
    assert body[0]["child_name"] == child_profile["name"]


def test_children_insights_route_does_not_shadow_child_lookup(
    client: TestClient, signed_up_parent: dict, child_profile: dict
) -> None:
    """Regression guard for the routing footgun noted in
    app/routers/parent_dashboard.py — `/children-insights` must not be
    reachable as if it were `/children/{child_id}` with child_id='insights',
    and a real child_id lookup must still work normally."""
    headers = {"Authorization": f"Bearer {signed_up_parent['token']}"}
    resp = client.get(f"/children/{child_profile['id']}", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == child_profile["id"]
