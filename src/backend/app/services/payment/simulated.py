"""SimulatedPaymentProvider — the only provider actually wired into this
build (see `provider.py`). Shaped like a real gateway's response (opaque
provider-side references, a charge status) rather than just echoing back
whatever was sent in, specifically so the round-trip through `PaymentProvider`
is exercised for real (routers never see a raw card number after this point,
never assume a charge is free/instant beyond a mock status field) — the goal
is that swapping in `StripePaymentProvider` later changes nothing upstream.

Never touches the network, never touches real money, needs no API key.
"""
from __future__ import annotations

import uuid

from app.services.payment.base import PaymentProvider, ProviderChargeResult, ProviderPaymentMethod


class SimulatedPaymentProvider(PaymentProvider):
    def save_payment_method(
        self, parent_id: str, card_number: str, exp_month: int, exp_year: int
    ) -> ProviderPaymentMethod:
        return ProviderPaymentMethod(
            provider_reference=f"sim_pm_{uuid.uuid4().hex[:20]}",
            brand="card",
            last4=card_number[-4:],
            exp_month=exp_month,
            exp_year=exp_year,
        )

    def charge_subscription(
        self, parent_id: str, payment_method_reference: str, amount_cents: int
    ) -> ProviderChargeResult:
        return ProviderChargeResult(provider_reference=f"sim_ch_{uuid.uuid4().hex[:20]}", status="succeeded")

    def cancel_subscription(self, parent_id: str) -> None:
        return None
