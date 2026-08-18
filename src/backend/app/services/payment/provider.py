"""Picks the payment provider implementation, once, based on
`settings.stripe_configured` — mirrors `app/repositories/store.py`'s
`get_store()` exactly (same local-dev-vs-production selection shape as
Firestore/local-JSON there). See `base.py`'s module docstring for why.
"""
from __future__ import annotations

from functools import lru_cache

from app.core.config import get_settings
from app.services.payment.base import PaymentProvider


@lru_cache
def get_payment_provider() -> PaymentProvider:
    settings = get_settings()
    if settings.stripe_configured:
        from app.services.payment.stripe_provider import StripePaymentProvider

        return StripePaymentProvider()
    from app.services.payment.simulated import SimulatedPaymentProvider

    return SimulatedPaymentProvider()
