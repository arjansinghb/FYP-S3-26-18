"""PA20 (notifications), PA22 (notification preferences), PA23-27 (billing,
simulated — no real Stripe account exists), PA31/32 (trends/comparison,
Premium), PA33 (multi-child, Premium half), PA34 (unlimited favourites,
Premium half — the free-tier cap itself is tested in test_chat.py).

PA35 (Switch Between Child Profiles) has no dedicated backend endpoint —
it's a frontend-only tab filter over the same `GET /api/children` list
(see ParentDashboard.jsx's `activeChildId` state, explicitly tagged
"PA35 switcher" in that file) — PA32's multi-child fetch below is what
backs it at the API layer; nothing further to unit-test server-side.
"""
from fastapi.testclient import TestClient


def test_pa22_notification_preferences(client: TestClient, active_parent: dict):
    r = client.get("/api/account/notification-preferences", headers=active_parent["headers"])
    assert r.status_code == 200
    r = client.patch("/api/account/notification-preferences", headers=active_parent["headers"], json={"in_app": True})
    assert r.status_code == 200


def test_pa20_list_notifications(client: TestClient, active_parent: dict):
    r = client.get("/api/account/notifications", headers=active_parent["headers"])
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_pa23_subscription_status_starts_free(client: TestClient, active_parent: dict):
    r = client.get("/api/account/subscription", headers=active_parent["headers"])
    assert r.status_code == 200
    assert r.json()["tier"] == "free"


def test_pa24_subscribe_requires_payment_method_first(client: TestClient, active_parent: dict):
    r = client.post("/api/account/subscribe", headers=active_parent["headers"], json={"billing_cycle": "monthly"})
    assert r.status_code == 400  # PA26's real precondition, not a soft warning

    r = client.put("/api/account/payment-method", headers=active_parent["headers"],
                    json={"brand": "visa", "last4": "4242"})
    assert r.status_code == 200

    r = client.post("/api/account/subscribe", headers=active_parent["headers"], json={"billing_cycle": "monthly"})
    assert r.status_code == 200
    assert r.json()["tier"] == "premium"


def test_pa27_billing_history_has_a_record(client: TestClient, active_parent: dict):
    r = client.get("/api/account/billing-history", headers=active_parent["headers"])
    assert r.status_code == 200
    assert len(r.json()) >= 1


def test_pa25_cancel_is_scheduled_not_instant(client: TestClient, active_parent: dict):
    r = client.post("/api/account/cancel-premium", headers=active_parent["headers"])
    assert r.status_code == 200
    body = r.json()
    assert body["tier"] == "premium"  # still premium — takes effect at period end
    assert body["cancel_at"]

    r = client.post("/api/account/resume-premium", headers=active_parent["headers"])
    assert r.status_code == 200
    assert not r.json()["cancel_at"]


def test_pa33_second_child_allowed_on_premium(client: TestClient, active_parent: dict, child: dict):
    r = client.post("/api/children", headers=active_parent["headers"], json={"name": "Second Kid", "age_band": "9-12"})
    assert r.status_code == 201
    second = r.json()
    assert second["login_id"] != child["login_id"]


def test_pa31_child_trends(client: TestClient, active_parent: dict, child: dict):
    r = client.get(f"/api/children/{child['id']}/trends", headers=active_parent["headers"])
    assert r.status_code == 200


def test_pa32_multi_child_comparison(client: TestClient, active_parent: dict):
    """Depends on test_pa33 above having already added a second child in
    this same module-scoped db — ordering matters here, same as the rest
    of this file's narrative style."""
    r = client.get("/api/children/compare", headers=active_parent["headers"])
    assert r.status_code == 200
    assert len(r.json()) == 2


# Ultra-tier tests removed on the trimmed-demo branch — Ultra doesn't exist
# here (models.AccountTier is Free/Premium only). See prototype-real-
# integrations for the full Ultra-tier coverage.


def test_subscribe_rejects_unknown_tier(client: TestClient, active_parent: dict):
    """Trimmed-demo branch: "ultra" is no longer a valid SubscribeRequest
    tier at all — Pydantic itself rejects it (422) before any handler code
    runs, rather than the app accepting and then mishandling it."""
    r = client.post("/api/account/subscribe", headers=active_parent["headers"], json={"tier": "ultra", "billing_cycle": "monthly"})
    assert r.status_code == 422
