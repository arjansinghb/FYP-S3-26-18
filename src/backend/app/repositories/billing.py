"""Typed CRUD for `billing_records/{recordId}` — PA24/PA25/PA27 (simulated).
See app/models/billing.py.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.models.billing import BillingEventType, BillingRecord
from app.repositories.store import COLLECTION_BILLING_RECORDS, get_store


def create_billing_record(
    parent_id: str,
    event: BillingEventType,
    amount_cents: int,
    description: str,
    provider_reference: str | None = None,
) -> BillingRecord:
    record = BillingRecord(
        id=str(uuid.uuid4()),
        parent_id=parent_id,
        event=event,
        amount_cents=amount_cents,
        description=description,
        created_at=datetime.now(timezone.utc),
        provider_reference=provider_reference,
    )
    get_store().create(COLLECTION_BILLING_RECORDS, record.id, record.model_dump())
    return record


def list_billing_records(parent_id: str) -> list[BillingRecord]:
    """PA27 — View Billing History."""
    docs = get_store().list(COLLECTION_BILLING_RECORDS, {"parent_id": parent_id})
    return sorted((BillingRecord(**d) for d in docs), key=lambda r: r.created_at, reverse=True)


def delete_billing_records_for_parent(parent_id: str) -> None:
    """Cascade delete — PA06 Delete Account."""
    store = get_store()
    for record in list_billing_records(parent_id):
        store.delete(COLLECTION_BILLING_RECORDS, record.id)
