"""PA23-PA27 — Premium billing (simulated, see app/models/billing.py)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient


def _headers(parent: dict) -> dict:
    return {"Authorization": f"Bearer {parent['token']}"}


def test_subscribe_requires_payment_method_first(client: TestClient, signed_up_parent: dict) -> None:
    resp = client.post("/account/subscribe", headers=_headers(signed_up_parent))
    assert resp.status_code == 400


def test_full_subscribe_and_cancel_flow(client: TestClient, signed_up_parent: dict) -> None:
    headers = _headers(signed_up_parent)

    pm = client.put(
        "/account/payment-method",
        headers=headers,
        json={"card_number": "4242424242424242", "exp_month": 12, "exp_year": 2030},
    )
    assert pm.status_code == 200
    assert pm.json()["last4"] == "4242"

    subscribed = client.post("/account/subscribe", headers=headers)
    assert subscribed.status_code == 200
    assert subscribed.json()["subscription_tier"] == "premium"

    # Can't subscribe twice.
    assert client.post("/account/subscribe", headers=headers).status_code == 409

    history = client.get("/account/billing-history", headers=headers).json()
    assert len(history) == 1
    assert history[0]["event"] == "subscribed"
    assert history[0]["amount_cents"] == 999

    # PA25 — cancel is scheduled for period end, not instant: still Premium
    # right after cancelling, with a cancel_at date set.
    cancelled = client.post("/account/cancel-premium", headers=headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["subscription_tier"] == "premium"
    assert cancelled.json()["subscription_cancel_at"] is not None

    history = client.get("/account/billing-history", headers=headers).json()
    assert len(history) == 2
    assert history[0]["event"] == "cancelled"  # most recent first

    # Can't cancel twice while a cancellation is already scheduled.
    assert client.post("/account/cancel-premium", headers=headers).status_code == 409


def _subscribe(client: TestClient, headers: dict, billing_cycle: str = "monthly") -> None:
    client.put(
        "/account/payment-method", headers=headers, json={"card_number": "4242424242424242", "exp_month": 1, "exp_year": 2030}
    )
    resp = client.post("/account/subscribe", headers=headers, json={"billing_cycle": billing_cycle})
    assert resp.status_code == 200, resp.text


def test_resume_premium_undoes_scheduled_cancellation(client: TestClient, signed_up_parent: dict) -> None:
    headers = _headers(signed_up_parent)
    _subscribe(client, headers)

    # Nothing scheduled yet -> resume is a no-op error.
    assert client.post("/account/resume-premium", headers=headers).status_code == 409

    cancelled = client.post("/account/cancel-premium", headers=headers).json()
    assert cancelled["subscription_cancel_at"] is not None

    resumed = client.post("/account/resume-premium", headers=headers)
    assert resumed.status_code == 200
    assert resumed.json()["subscription_cancel_at"] is None
    assert resumed.json()["subscription_tier"] == "premium"

    # Nothing scheduled anymore -> resume is a no-op error again.
    assert client.post("/account/resume-premium", headers=headers).status_code == 409


def test_annual_billing_cycle_charges_annual_price(client: TestClient, signed_up_parent: dict) -> None:
    headers = _headers(signed_up_parent)
    _subscribe(client, headers, billing_cycle="annual")

    history = client.get("/account/billing-history", headers=headers).json()
    assert history[0]["amount_cents"] == 9990  # PREMIUM_ANNUAL_PRICE_CENTS default

    account = client.get("/account", headers=headers).json()
    assert account["subscription_billing_cycle"] == "annual"


def test_cancellation_lazily_downgrades_once_past_cancel_at(client: TestClient, signed_up_parent: dict) -> None:
    """PA25 — the actual downgrade happens lazily on the next authenticated
    request once `subscription_cancel_at` is in the past (see
    core/deps.py's `_apply_pending_cancellation`) — simulate that by writing
    an already-past cancel_at directly via the repository layer, the same
    class of test-only shortcut `live_catalogue_item` uses in conftest.py."""
    headers = _headers(signed_up_parent)
    _subscribe(client, headers)
    parent_id = client.get("/account", headers=headers).json()["id"]

    from app.repositories import parents as parents_repo

    parents_repo.update_parent(parent_id, subscription_cancel_at=datetime.now(timezone.utc) - timedelta(days=1))

    account = client.get("/account", headers=headers).json()
    assert account["subscription_tier"] == "free"
    assert account["subscription_cancel_at"] is None


def test_card_number_never_persisted(client: TestClient, signed_up_parent: dict) -> None:
    headers = _headers(signed_up_parent)
    client.put(
        "/account/payment-method",
        headers=headers,
        json={"card_number": "4111111111111111", "exp_month": 1, "exp_year": 2028},
    )
    account = client.get("/account", headers=headers).json()
    assert "4111111111111111" not in str(account["payment_method"])
    assert account["payment_method"]["last4"] == "1111"


def test_billing_requires_auth(client: TestClient) -> None:
    assert client.get("/account/billing-history").status_code == 401
