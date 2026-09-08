"""The child chat loop — CH04-20 — plus the parent-side oversight views that
depend on real chat activity: PA14 (activity), PA15/19 (favourites +
external link), PA16/17 (report content + status), and PA34's free-tier
cap (the Premium "unlimited" half is a one-line tier check already covered
by test_billing_notifications.py's subscribe flow).

Runs against the mock PlaceholderBrain (see conftest.py — no OPENAI_API_KEY
under test), which is real keyword matching over the actual seeded
catalogue, not a hardcoded canned reply — see app/brain.py's own docstring
on why this mock is correct-as-is for tests, not a placeholder-for-later.
"""
from fastapi.testclient import TestClient


def test_ch04_start_session(client: TestClient, child_session: dict):
    r = client.post("/api/chat/sessions", headers=child_session["headers"])
    assert r.status_code == 201
    body = r.json()
    assert body["child_id"] == child_session["child"]["id"]
    child_session["session_id"] = body["id"]


def test_ch06_08_09_10_send_message_get_recommendation(client: TestClient, child_session: dict):
    r = client.post(
        "/api/chat", headers=child_session["headers"],
        json={"message": "I would like a funny book please", "session_id": child_session["session_id"]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["reply"]  # CH10 — always comes with an explanation, never a bare list
    assert len(body["recommendations"]) >= 1  # CH08 — the seeded catalogue always has approved books
    rec = body["recommendations"][0]
    assert rec["type"] == "book"
    assert rec["explanation"]  # CH10 again, per-item
    child_session["last_rec_id"] = rec["id"]


def test_ch15_16_save_and_view_favourite(client: TestClient, child_session: dict):
    item_id = child_session["last_rec_id"]
    r = client.post("/api/chat/favourite", headers=child_session["headers"], json={"content_id": item_id, "liked": True})
    assert r.status_code == 201

    r = client.get("/api/chat/favourites", headers=child_session["headers"])
    assert r.status_code == 200
    favs = r.json()
    assert any(f["id"] == item_id for f in favs)
    # CH16 must NOT leak the staff/parent-only external_ref to the child client
    assert all("external_ref" not in f for f in favs)


def test_ch17_feedback(client: TestClient, child_session: dict):
    item_id = child_session["last_rec_id"]
    r = client.post("/api/chat/feedback", headers=child_session["headers"], json={"content_id": item_id, "liked": True})
    assert r.status_code == 200


def test_ch18_request_alternative(client: TestClient, child_session: dict):
    r = client.post(
        "/api/chat", headers=child_session["headers"],
        json={"message": "something else please", "session_id": child_session["session_id"]},
    )
    assert r.status_code == 200


def test_ch19_20_choose_and_edit_avatar(client: TestClient, child_session: dict):
    r = client.put("/api/child/avatar", headers=child_session["headers"], json={"avatar": "blue"})
    assert r.status_code == 200
    assert r.json()["avatar"] == "blue"


def test_ch05_end_session(client: TestClient, child_session: dict):
    session_id = child_session["session_id"]
    r = client.post(f"/api/chat/sessions/{session_id}/end", headers=child_session["headers"])
    assert r.status_code == 200
    assert r.json()["ended_at"] is not None


def test_pa14_view_activity(client: TestClient, active_parent: dict, child: dict):
    r = client.get(f"/api/children/{child['id']}/activity", headers=active_parent["headers"])
    assert r.status_code == 200
    assert len(r.json()) >= 1  # the chat turn above is logged


def test_pa15_19_view_favourites_with_external_link(client: TestClient, active_parent: dict, child: dict):
    r = client.get(f"/api/children/{child['id']}/favourites", headers=active_parent["headers"])
    assert r.status_code == 200
    favs = r.json()
    assert len(favs) >= 1
    # PA19 — unlike CH16's child-facing view above, the PARENT view is
    # allowed to carry external_ref (books only; None for a video is fine).
    assert "external_ref" in favs[0]


def test_pa16_17_report_content(client: TestClient, active_parent: dict, child: dict):
    fav_item_id = client.get(f"/api/children/{child['id']}/favourites", headers=active_parent["headers"]).json()[0]["id"]
    r = client.post(f"/api/children/{child['id']}/report", headers=active_parent["headers"],
                     json={"content_id": fav_item_id, "reason": "not age-appropriate"})
    assert r.status_code == 201

    r = client.get(f"/api/children/{child['id']}/reports", headers=active_parent["headers"])
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["status"] == "open"

    r = client.get("/api/children/reports", headers=active_parent["headers"])
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_pa34_free_tier_favourites_capped_at_five(client: TestClient, active_parent: dict, child: dict,
                                                    child_session: dict, moderator: dict):
    """Six distinct approved items, save five (already 1 saved earlier in
    this module — top up to 5), the 6th must 403 with a clear reason."""
    existing = client.get(f"/api/children/{child['id']}/favourites", headers=active_parent["headers"]).json()
    already_saved = len(existing)
    needed = 5 - already_saved + 1  # one extra to push past the cap
    new_ids = []
    for i in range(needed):
        r = client.post("/api/content", headers=moderator["headers"],
                         json={"type": "book", "title": f"Cap Test Book {i}", "description": "d",
                               "age_bands": ["5-8"], "genres": []})
        new_ids.append(r.json()["id"])

    for item_id in new_ids[:-1]:
        r = client.post("/api/chat/favourite", headers=child_session["headers"], json={"content_id": item_id, "liked": True})
        assert r.status_code == 201

    r = client.post("/api/chat/favourite", headers=child_session["headers"],
                     json={"content_id": new_ids[-1], "liked": True})
    assert r.status_code == 403
    assert "Premium" in r.json()["detail"]
