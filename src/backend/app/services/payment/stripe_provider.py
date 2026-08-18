"""StripePaymentProvider — the production swap-in for `SimulatedPaymentProvider`
(see `base.py`'s module docstring), NOT implemented yet. Deliberately a
stub, not a real integration: there's no Stripe account/API key for this
project, and wiring one up is a real-money decision outside a dev pass's
scope — see the FYP's own README "Known Gaps".

To actually implement this later:
  1. `pip install stripe`, add it to requirements.txt.
  2. Get a Stripe account + API key (test-mode is free), set STRIPE_API_KEY
     in .env (see app/core/config.py's `stripe_configured` — once that key is
     set, app/services/payment/provider.py will select this class instead of
     SimulatedPaymentProvider automatically, no other code changes needed).
  3. Implement each method against Stripe's actual API:
     - save_payment_method -> stripe.PaymentMethod.attach + a SetupIntent
       (never handle/log the raw card number server-side — this should be a
       Stripe Elements/Payment Element token from the frontend, not the raw
       digits this interface's `card_number` param currently accepts; that
       param shape is fine for the simulated provider but is *not* PCI-safe
       for a real one, flagging that explicitly so it isn't missed).
     - charge_subscription -> stripe.Subscription.create (or a recurring
       Price + Checkout Session, depending on whether self-serve checkout or
       server-driven billing is wanted).
     - cancel_subscription -> stripe.Subscription.cancel.
"""
from __future__ import annotations

from app.services.payment.base import PaymentProvider, ProviderChargeResult, ProviderPaymentMethod


class StripePaymentProvider(PaymentProvider):
    def save_payment_method(
        self, parent_id: str, card_number: str, exp_month: int, exp_year: int
    ) -> ProviderPaymentMethod:
        raise NotImplementedError("StripePaymentProvider is a production stub — see this module's docstring.")

    def charge_subscription(
        self, parent_id: str, payment_method_reference: str, amount_cents: int
    ) -> ProviderChargeResult:
        raise NotImplementedError("StripePaymentProvider is a production stub — see this module's docstring.")

    def cancel_subscription(self, parent_id: str) -> None:
        raise NotImplementedError("StripePaymentProvider is a production stub — see this module's docstring.")
