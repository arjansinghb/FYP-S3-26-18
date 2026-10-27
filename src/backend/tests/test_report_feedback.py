"""A moderator's decision on a parent's report (CM12) comes back to that parent
(PA17/PA20): what was decided, plus an optional separate note. Never shown to the child."""
from fastapi.testclient import TestClient


def _report(client, moderator, active_parent, child, title):
    item = client.post("/api/content", headers=moderator["headers"],
                       json={"type": "book", "title": title, "description": "d", "age_bands": ["5-8"], "genres": []}).json()
    r = client.post(f"/api/children/{child['id']}/report", headers=active_parent["headers"],
                    json={"content_id": item["id"], "reason": "not sure about this"})
    return item, r.json()["report_id"]


def _mine(client, active_parent, report_id):
    rows = client.get("/api/children/reports", headers=active_parent["headers"]).json()
    return next(r for r in rows if r["id"] == report_id)


def test_an_open_report_has_no_outcome_yet(client: TestClient, moderator: dict, active_parent: dict, child: dict):
    _, rid = _report(client, moderator, active_parent, child, "Open Report Book")
    row = _mine(client, active_parent, rid)
    assert row["status"] == "open" and row["outcome"] is None and row["note"] is None and row["resolved_at"] is None


def test_dismissing_tells_the_parent_it_was_reviewed_with_no_change(client: TestClient, moderator: dict, active_parent: dict, child: dict):
    item, rid = _report(client, moderator, active_parent, child, "Dismissed Book")
    r = client.post(f"/api/reports/{rid}/resolve", headers=moderator["headers"], json={"action": "dismiss"})
    assert r.status_code == 200
    row = _mine(client, active_parent, rid)
    assert row["status"] == "resolved" and row["outcome"] == "no_change" and row["note"] is None
    assert row["resolved_at"] is not None
    live = client.get("/api/content", headers=moderator["headers"], params={"status": "approved"}).json()
    assert any(c["id"] == item["id"] for c in live)  # dismissing leaves the content alone


def test_removing_records_the_outcome(client: TestClient, moderator: dict, active_parent: dict, child: dict):
    _, rid = _report(client, moderator, active_parent, child, "Removed Book")
    client.post(f"/api/reports/{rid}/resolve", headers=moderator["headers"], json={"action": "remove"})
    assert _mine(client, active_parent, rid)["outcome"] == "removed"


# ---- the note to the parent is its own action, not part of dismissing ----

def test_a_note_does_not_change_the_reports_status(client: TestClient, moderator: dict, active_parent: dict, child: dict):
    _, rid = _report(client, moderator, active_parent, child, "Noted Open Book")
    r = client.post(f"/api/reports/{rid}/note", headers=moderator["headers"], json={"note": "  We are looking at this one.  "})
    assert r.status_code == 200
    row = _mine(client, active_parent, rid)
    assert row["note"] == "We are looking at this one." and row["status"] == "open" and row["outcome"] is None


def test_a_note_can_be_replaced_while_the_report_is_open(client: TestClient, moderator: dict, active_parent: dict, child: dict):
    _, rid = _report(client, moderator, active_parent, child, "Replaced Note Book")
    client.post(f"/api/reports/{rid}/note", headers=moderator["headers"], json={"note": "First note."})
    client.post(f"/api/reports/{rid}/note", headers=moderator["headers"], json={"note": "Updated note."})
    assert _mine(client, active_parent, rid)["note"] == "Updated note."


def test_no_note_can_be_added_once_the_report_is_resolved(client: TestClient, moderator: dict, active_parent: dict, child: dict):
    _, rid = _report(client, moderator, active_parent, child, "Resolved No Note Book")
    client.post(f"/api/reports/{rid}/note", headers=moderator["headers"], json={"note": "Looking into it."})
    client.post(f"/api/reports/{rid}/resolve", headers=moderator["headers"], json={"action": "dismiss"})
    r = client.post(f"/api/reports/{rid}/note", headers=moderator["headers"], json={"note": "Too late."})
    assert r.status_code == 409
    row = _mine(client, active_parent, rid)
    assert row["note"] == "Looking into it."  # the earlier note stays; the outcome is final


def test_the_moderator_list_carries_the_cover_image(client: TestClient, moderator: dict, active_parent: dict, child: dict):
    item = client.post("/api/content", headers=moderator["headers"],
                       json={"type": "book", "title": "Cover Book", "description": "d", "age_bands": ["5-8"], "genres": [],
                             "thumbnail": "https://example.com/c.jpg"}).json()
    rid = client.post(f"/api/children/{child['id']}/report", headers=active_parent["headers"],
                      json={"content_id": item["id"], "reason": "x"}).json()["report_id"]
    rows = client.get("/api/reports", headers=moderator["headers"]).json()
    assert next(r for r in rows if r["id"] == rid)["thumbnail"] == "https://example.com/c.jpg"


def test_the_note_reaches_the_parents_notifications(client: TestClient, moderator: dict, active_parent: dict, child: dict):
    _, rid = _report(client, moderator, active_parent, child, "Notified Book")
    client.post(f"/api/reports/{rid}/note", headers=moderator["headers"], json={"note": "Not enough detail to act on."})
    notes = client.get("/api/account/notifications", headers=active_parent["headers"]).json()
    mine = [n for n in notes if "Notified Book" in n["body"] and "Note from our team" in n["body"]]
    assert mine and "Not enough detail to act on." in mine[0]["body"]


def test_resolving_alone_sends_no_note(client: TestClient, moderator: dict, active_parent: dict, child: dict):
    _, rid = _report(client, moderator, active_parent, child, "Plain Resolve Book")
    client.post(f"/api/reports/{rid}/resolve", headers=moderator["headers"], json={"action": "dismiss"})
    notes = client.get("/api/account/notifications", headers=active_parent["headers"]).json()
    assert not any("Plain Resolve Book" in n["body"] and "Note from our team" in n["body"] for n in notes)


def test_blank_or_overlong_notes_and_unknown_reports_are_rejected(client: TestClient, moderator: dict, active_parent: dict, child: dict):
    _, rid = _report(client, moderator, active_parent, child, "Bad Note Book")
    assert client.post(f"/api/reports/{rid}/note", headers=moderator["headers"], json={"note": "   "}).status_code == 422
    assert client.post(f"/api/reports/{rid}/note", headers=moderator["headers"], json={"note": "x" * 301}).status_code == 422
    assert client.post("/api/reports/nope/note", headers=moderator["headers"], json={"note": "hi"}).status_code == 404


def test_only_a_moderator_can_send_a_note(client: TestClient, moderator: dict, active_parent: dict, child: dict):
    _, rid = _report(client, moderator, active_parent, child, "Role Check Book")
    assert client.post(f"/api/reports/{rid}/note", headers=active_parent["headers"], json={"note": "hi"}).status_code in (401, 403)


def test_pa16_report_a_chat_exchange(client, active_parent, child, moderator):
    """A parent can report one exchange from the child's chat history; the
    moderator sees the excerpt, and it can only be dismissed (nothing to remove)."""
    from app.storage import db
    ts = 1_700_000_000.123
    db.activity.setdefault(child["id"], []).append({"ts": ts, "message": "Tell me about X", "reply": "Here is a story."})

    r = client.post(f"/api/children/{child['id']}/report", headers=active_parent["headers"],
                    json={"chat_ts": ts, "reason": "Pip's answer felt off"})
    assert r.status_code == 201
    report_id = r.json()["report_id"]

    r = client.post(f"/api/children/{child['id']}/report", headers=active_parent["headers"],
                    json={"chat_ts": 1.0, "reason": "x"})
    assert r.status_code == 404  # no such exchange
    r = client.post(f"/api/children/{child['id']}/report", headers=active_parent["headers"], json={"reason": "x"})
    assert r.status_code == 422  # neither a catalogue item nor a chat message

    mine = client.get(f"/api/children/{child['id']}/reports", headers=active_parent["headers"]).json()
    rep = next(x for x in mine if x["id"] == report_id)
    assert rep["content_title"] == "Chat reply" and "Tell me about X" in rep["excerpt"]

    r = client.post(f"/api/reports/{report_id}/resolve", headers=moderator["headers"], json={"action": "remove"})
    assert r.status_code == 422
    r = client.post(f"/api/reports/{report_id}/resolve", headers=moderator["headers"], json={"action": "dismiss"})
    assert r.status_code == 200 and r.json()["status"] == "resolved"
