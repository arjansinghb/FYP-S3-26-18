"""Payment provider abstraction — PA24-27 (Premium billing). Mirrors
`app/repositories/base.py`'s `DocumentStore` pattern exactly: routers/services
never talk to a concrete provider, only through this interface, obtained via
`get_payment_provider()` in `provider.py`.

Per supervisor guidance (dev-session 2026-08-11): the billing flow should run
against a *simulated* provider for now — no real money, no external account
needed for development or demo — but shaped like a real gateway's API (a
payment-method reference you charge against, a charge/subscription result
with its own status) rather than ad-hoc mock logic bolted onto the router.
That's what makes `StripePaymentProvider` (see `stripe_provider.py`) a
drop-in swap for production later instead of a rewrite: same interface, same
call sites, only `get_payment_provider()`'s selection logic changes.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class ProviderPaymentMethod:
    """What a provider hands back after registering a card — never the raw
    card number, whether the provider is real or simulated (see
    SimulatedPaymentProvider's own docstring for why that discipline still
    matters even when nothing is actually charged)."""

    provider_reference: str  # e.g. Stripe's `pm_...` payment-method id
    brand: str
    last4: str
    exp_month: int
    exp_year: int


@dataclass
class ProviderChargeResult:
    provider_reference: str  # e.g. Stripe's `in_...`/`ch_...` id
    status: str  # "succeeded" | "failed"


class PaymentProvider(ABC):
    @abstractmethod
    def save_payment_method(
        self, parent_id: str, card_number: str, exp_month: int, exp_year: int
    ) -> ProviderPaymentMethod:
        """PA26 — Update Payment Method."""

    @abstractmethod
    def charge_subscription(
        self, parent_id: str, payment_method_reference: str, amount_cents: int
    ) -> ProviderChargeResult:
        """PA24 — Subscribe to Premium."""

    @abstractmethod
    def cancel_subscription(self, parent_id: str) -> None:
        """PA25 — Cancel Premium."""
