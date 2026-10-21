"""System Admin — SA01-14. SA01/02 (login/logout) reuse the shared
/api/auth endpoints (see conftest.py's `admin` fixture)."""
from fastapi.testclient import TestClient


def test_sa04_05_search_and_view_user(client: TestClient, admin: dict, parent: dict):
    r = client.get("/api/admin/users", headers=admin["headers"], params={"q": parent["email"]})
    assert r.status_code == 200
    assert len(r.json()) == 1
    user_id = r.json()[0]["id"]

    r = client.get(f"/api/admin/users/{user_id}", headers=admin["headers"])
    assert r.status_code == 200
    assert r.json()["email"] == parent["email"]


def test_sa06_07_suspend_and_unsuspend(client: TestClient, admin: dict, parent: dict):
    user_id = client.get("/api/admin/users", headers=admin["headers"],
                          params={"q": parent["email"]}).json()[0]["id"]

    r = client.post(f"/api/admin/users/{user_id}/suspend", headers=admin["headers"])
    assert r.status_code == 200

    r = client.post("/api/auth/login", json={"email": parent["email"], "password": parent["password"]})
    assert r.status_code == 403  # actually blocked, not just flagged

    r = client.post(f"/api/admin/users/{user_id}/unsuspend", headers=admin["headers"])
    assert r.status_code == 200
    r = client.post("/api/auth/login", json={"email": parent["email"], "password": parent["password"]})
    assert r.status_code == 200


def test_sa03_reset_user_password(client: TestClient, admin: dict, parent: dict):
    user_id = client.get("/api/admin/users", headers=admin["headers"],
                          params={"q": parent["email"]}).json()[0]["id"]
    r = client.post(f"/api/admin/users/{user_id}/reset-password", headers=admin["headers"],
                     json={"new_password": "AdminReset123"})
    assert r.status_code == 200

    r = client.post("/api/auth/login", json={"email": parent["email"], "password": "AdminReset123"})
    assert r.status_code == 200


def test_sa08_system_health_has_real_metrics(client: TestClient, admin: dict):
    """Not just counts — the URS's own SA08 wording ("API uptime, error
    rates, NLP/recommendation service latency") requires all three, closed
    as a real gap during the 2026-09-07 URS cross-check (see app/metrics.py
    and agent-context/prototype-real-integrations.md §15)."""
    r = client.get("/api/admin/stats", headers=admin["headers"])
    assert r.status_code == 200
    body = r.json()
    for field in ("uptime_seconds", "error_rate", "avg_latency_ms", "sample_size",
                  "nlp_avg_latency_ms", "nlp_sample_size"):
        assert field in body, f"missing SA08 metric: {field}"


def test_sa08_nlp_latency_reflects_real_chat_traffic(client: TestClient, admin: dict):
    """Deliberately self-contained (own parent/child, not the shared
    `parent`/`child_session` fixtures) — this module's other tests mutate
    the shared parent's password/tokens (SA03/SA06/SA07), which would make
    a shared `child_session` fixture unreliable depending on test order."""
    signup = client.post("/api/auth/signup", json={"email": "sa08.parent@example.com",
                                                     "password": "Sa08Pass123", "name": "SA08 Parent"}).json()
    headers = {"Authorization": f"Bearer {signup['token']}"}
    client.post("/api/auth/verify/confirm", json={"token": signup["verify_token"]})
    client.post("/api/account/consent", headers=headers, json={"password": "Sa08Pass123"})
    child = client.post("/api/children", headers=headers, json={"name": "SA08 Kid", "age_band": "5-8"}).json()
    child_headers = {"Authorization": f"Bearer {client.post('/api/children/link', json={'login_id': child['login_id'], 'pin': child['pin']}).json()['token']}"}

    before = client.get("/api/admin/stats", headers=admin["headers"]).json()["nlp_sample_size"]
    client.post("/api/chat/sessions", headers=child_headers)
    client.post("/api/chat", headers=child_headers, json={"message": "a book please"})
    after = client.get("/api/admin/stats", headers=admin["headers"]).json()
    assert after["nlp_sample_size"] == before + 1
    assert after["nlp_avg_latency_ms"] is not None


def test_sa09_10_11_13_config_sections_readable_and_editable(client: TestClient, admin: dict):
    for section in ("integrations", "compliance", "settings", "billing"):
        r = client.get(f"/api/admin/config/{section}", headers=admin["headers"])
        assert r.status_code == 200, section

    r = client.get("/api/admin/config/compliance", headers=admin["headers"])
    assert "openai_zdr_status" in r.json()  # URS §2.5 — must stay visible here

    r = client.put("/api/admin/config/settings", headers=admin["headers"],
                    json={"app_name": "Pip Test", "maintenance_mode": True, "support_email": "help@pip.local"})
    assert r.status_code == 200
    assert r.json()["maintenance_mode"] is True
    # Maintenance mode now really pauses parents and children, so switch it
    # back off or every later test in this file would be turned away.
    client.put("/api/admin/config/settings", headers=admin["headers"], json={"maintenance_mode": False})

    r = client.get("/api/admin/config/unknown-section", headers=admin["headers"])
    assert r.status_code == 404


def test_sa12_edit_project_website(client: TestClient, admin: dict):
    r = client.get("/api/admin/config/website", headers=admin["headers"])
    original = r.json()

    r = client.put("/api/admin/config/website", headers=admin["headers"],
                    json={**original, "announcement": "Test announcement"})
    assert r.status_code == 200
    assert r.json()["announcement"] == "Test announcement"

    # a public visitor immediately sees the change — SA12's whole point
    r = client.get("/api/public/site")
    assert r.json()["announcement"] == "Test announcement"


def test_sa14_support_tickets(client: TestClient, admin: dict):
    # Tickets are raised by parents now; none are seeded. Own parent here: the
    # shared one is suspended and re-tokened by the SA03/SA06/SA07 tests above.
    signup = client.post("/api/auth/signup", json={"email": "sa14.parent@example.com", "password": "TestPass123", "name": "SA14 Parent"})
    assert signup.status_code == 200, signup.text
    parent_headers = {"Authorization": f"Bearer {signup.json()['token']}"}
    r = client.post("/api/account/support", headers=parent_headers,
                    json={"subject": "Voice not working", "message": "The mic button does nothing for my son."})
    assert r.status_code == 201
    r = client.get("/api/admin/tickets", headers=admin["headers"])
    assert r.status_code == 200
    tickets = r.json()
    assert len(tickets) >= 1

    r = client.post(f"/api/admin/tickets/{tickets[0]['id']}/resolve", headers=admin["headers"])
    assert r.status_code == 200
    assert r.json()["status"] == "resolved"
