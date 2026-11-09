"""Support tickets raised by parents, chat-history retention (PA29/SA10), the
compliance switches that now do something, and the email notification channel."""
import time

from fastapi.testclient import TestClient

DAY = 86400


# ---------- support tickets ----------

def _ticket(client, parent, subject="Cannot log in", message="My child's PIN stopped working today."):
    return client.post("/api/account/support", headers=parent["headers"], json={"subject": subject, "message": message})


def test_a_parent_can_raise_a_ticket_and_see_it(client: TestClient, active_parent: dict, admin: dict):
    r = _ticket(client, active_parent, "Ticket A", "Something went wrong with the Library page.")
    assert r.status_code == 201 and r.json()["status"] == "open"
    mine = client.get("/api/account/support", headers=active_parent["headers"]).json()
    assert any(t["subject"] == "Ticket A" for t in mine)
    all_tickets = client.get("/api/admin/tickets", headers=admin["headers"]).json()
    t = next(t for t in all_tickets if t["subject"] == "Ticket A")
    assert t["from_email"] == active_parent["email"] and t["parent_id"]
    # The admin's Support tab shows who it's from and the ticket's id.
    assert t["parent_name"] and t["id"]


def test_admin_ticket_list_fills_in_the_name_for_older_tickets(client: TestClient, active_parent: dict, admin: dict):
    from app.storage import db

    r = _ticket(client, active_parent, "Old ticket", "A ticket saved before names were stored on tickets.")
    stored = next(t for t in db.tickets if t["id"] == r.json()["id"])
    stored.pop("parent_name", None)
    listed = client.get("/api/admin/tickets", headers=admin["headers"]).json()
    t = next(t for t in listed if t["id"] == r.json()["id"])
    assert t["parent_name"] == db.accounts[stored["parent_id"]]["name"]


def test_ticket_text_is_trimmed_and_validated(client: TestClient, active_parent: dict):
    assert _ticket(client, active_parent, "  ", "x" * 20).status_code == 422
    assert _ticket(client, active_parent, "Hello there", "short").status_code == 422
    assert _ticket(client, active_parent, "x" * 101, "y" * 20).status_code == 422
    r = _ticket(client, active_parent, "  Trimmed subject  ", "  A message that is long enough.  ")
    assert r.json()["subject"] == "Trimmed subject" and r.json()["message"] == "A message that is long enough."


def test_open_tickets_are_capped_per_parent(client: TestClient, active_parent: dict):
    from app.storage import db

    mine = [t for t in db.tickets if t.get("parent_id") == db.find_account_by_email(active_parent["email"])["id"]]
    for t in mine:
        t["status"] = "resolved"
    for i in range(5):
        assert _ticket(client, active_parent, f"Cap {i} ticket", "A message that is long enough.").status_code == 201
    assert _ticket(client, active_parent, "One too many", "A message that is long enough.").status_code == 409


def test_resolving_a_ticket_notifies_the_parent(client: TestClient, active_parent: dict, admin: dict):
    from app.storage import db

    for t in db.tickets:
        t["status"] = "resolved"
    _ticket(client, active_parent, "Notify me please", "A message that is long enough.")
    tid = next(t["id"] for t in client.get("/api/account/support", headers=active_parent["headers"]).json() if t["status"] == "open")
    client.post(f"/api/admin/tickets/{tid}/resolve", headers=admin["headers"])
    notes = client.get("/api/account/notifications", headers=active_parent["headers"]).json()
    assert any("Notify me please" in n["body"] and n["title"].startswith("Your support request") for n in notes)


def test_only_parents_can_raise_tickets(client: TestClient, moderator: dict):
    assert _ticket(client, moderator).status_code in (401, 403)


# ---------- retention ----------

def _seed_old_chat(child_id, age_days):
    from app.storage import db

    db.activity[child_id] = [
        {"ts": time.time() - age_days * DAY, "session_id": "old", "message": "hi", "reply": "hello", "rec_ids": []},
        {"ts": time.time() - 1 * DAY, "session_id": "new", "message": "hi again", "reply": "hello", "rec_ids": []},
    ]
    db.chat_sessions["old"] = {"id": "old", "child_id": child_id, "started_at": time.time() - age_days * DAY, "ended_at": None}
    db.chat_sessions["new"] = {"id": "new", "child_id": child_id, "started_at": time.time() - DAY, "ended_at": None}


def test_standard_retention_deletes_chats_older_than_the_admin_period(client: TestClient, child: dict, admin: dict):
    from app.storage import db

    _seed_old_chat(child["id"], 400)  # default admin period is 365 days
    assert db.apply_retention(force=True) >= 2
    assert [a["session_id"] for a in db.activity[child["id"]]] == ["new"]
    assert "old" not in db.chat_sessions and "new" in db.chat_sessions


def test_the_admin_setting_is_what_decides_standard(client: TestClient, child: dict):
    from app.storage import db

    db.system["compliance"]["data_retention_days"] = 100
    try:
        _seed_old_chat(child["id"], 150)
        db.apply_retention(force=True)
        assert [a["session_id"] for a in db.activity[child["id"]]] == ["new"]
        db.system["compliance"]["data_retention_days"] = 1  # never below the 7 day floor
        assert db.standard_retention_days() == 7
    finally:
        db.system["compliance"]["data_retention_days"] = 365


def test_minimal_keeps_chats_for_thirty_days_only(client: TestClient, active_parent: dict, child: dict):
    from app.storage import db

    client.patch("/api/account/privacy-settings", headers=active_parent["headers"], json={"retention_preference": "minimal"})
    try:
        _seed_old_chat(child["id"], 45)
        db.apply_retention(force=True)
        assert [a["session_id"] for a in db.activity[child["id"]]] == ["new"]
    finally:
        client.patch("/api/account/privacy-settings", headers=active_parent["headers"], json={"retention_preference": "standard"})


def test_retention_keeps_favourites_and_recent_chats(client: TestClient, child: dict):
    from app.storage import db

    db.favourites[child["id"]] = [{"content_id": "keepme", "ts": time.time() - 500 * DAY}]
    _seed_old_chat(child["id"], 10)
    db.apply_retention(force=True)
    assert len(db.activity[child["id"]]) == 2  # 10 days is inside the period
    assert db.favourites[child["id"]][0]["content_id"] == "keepme"
    db.favourites[child["id"]] = []


def test_privacy_settings_report_the_real_periods(client: TestClient, active_parent: dict):
    r = client.get("/api/account/privacy-settings", headers=active_parent["headers"]).json()
    assert r["standard_days"] == 365 and r["minimal_days"] == 30


# ---------- compliance switches ----------

def test_allow_under_13_off_pauses_child_profiles_and_sign_in(client: TestClient, active_parent: dict, child: dict):
    from app.storage import db

    db.system["compliance"]["allow_under_13"] = False
    try:
        r = client.post("/api/children", headers=active_parent["headers"], json={"name": "Nope", "age_band": "5-8"})
        assert r.status_code == 403 and "paused" in r.json()["detail"]
        r = client.post("/api/children/link", json={"login_id": child["login_id"], "pin": child["pin"]})
        assert r.status_code == 403 and "paused" in r.json()["detail"].lower()
    finally:
        db.system["compliance"]["allow_under_13"] = True
    assert client.post("/api/children/link", json={"login_id": child["login_id"], "pin": child["pin"]}).status_code == 200


def test_pdpa_mode_decides_whether_consent_is_required(client: TestClient):
    from app.storage import db

    email = f"pdpa{int(time.time())}@example.com"
    r = client.post("/api/auth/signup", json={"email": email, "password": "Passw0rd!", "name": "No Consent"})
    token = r.json()["token"]
    verify = r.json().get("verify_token")
    headers = {"Authorization": f"Bearer {token}"}
    if verify:
        client.post("/api/auth/verify/confirm", json={"token": verify})
    body = {"name": "Kid", "age_band": "5-8"}
    assert client.post("/api/children", headers=headers, json=body).status_code == 403  # PDPA mode is on by default
    db.system["compliance"]["pdpa_mode"] = False
    try:
        assert client.post("/api/children", headers=headers, json=body).status_code == 201
    finally:
        db.system["compliance"]["pdpa_mode"] = True


# ---------- email channel ----------

def _capture_emails(monkeypatch):
    from app import email_service

    sent = []
    monkeypatch.setattr(email_service, "_send", lambda to, subject, html: sent.append((to, subject, html)) or True)
    return sent


def test_email_channel_sends_the_notification(client: TestClient, active_parent: dict, monkeypatch):
    from app.storage import db

    sent = _capture_emails(monkeypatch)
    account = db.find_account_by_email(active_parent["email"])
    account["notification_preferences"] = {"channels": {"in_app": True, "email": True, "push": False}}
    notif = db.add_notification(account["id"], "flag_resolved", "Your report has been reviewed", "“Some Book” reviewed <b>x</b>.")
    assert notif is not None
    assert len(sent) == 1 and sent[0][0] == active_parent["email"] and sent[0][1] == "Your report has been reviewed"
    assert "&lt;b&gt;" in sent[0][2] and "<b>x</b>" not in sent[0][2]  # message text is escaped


def test_email_off_sends_nothing_and_email_only_still_works(client: TestClient, active_parent: dict, monkeypatch):
    from app.storage import db

    sent = _capture_emails(monkeypatch)
    account = db.find_account_by_email(active_parent["email"])
    account["notification_preferences"] = {"channels": {"in_app": True, "email": False, "push": False}}
    db.add_notification(account["id"], "x", "T1", "B1")
    assert sent == []
    account["notification_preferences"] = {"channels": {"in_app": False, "email": True, "push": False}}
    assert db.add_notification(account["id"], "x", "T2", "B2") is None  # nothing stored in-app...
    assert len(sent) == 1 and sent[0][1] == "T2"  # ...but the email still goes out
    account["notification_preferences"] = {"channels": {"in_app": True, "email": False, "push": False}}


# ---------- verification email carries a link to the app ----------

def test_verification_email_is_a_link_to_the_confirm_page(monkeypatch):
    from app import email_service
    from app.config import settings

    sent = {}
    monkeypatch.setattr(email_service, "_send", lambda to, subject, html: sent.update(to=to, subject=subject, html=html) or True)
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://pip.example/", raising=False)
    assert email_service.send_verification_email("maya@example.com", "tok/en+1") is True
    link = "https://pip.example/parent/verify?token=tok%2Fen%2B1"
    assert email_service.verification_link("tok/en+1") == link
    assert link in sent["html"] and "Verify my email" in sent["html"] and sent["to"] == "maya@example.com"
