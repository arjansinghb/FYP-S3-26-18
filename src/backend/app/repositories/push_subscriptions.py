"""Typed CRUD for `push_subscriptions/{id}` — PA20/PA22 real push delivery.
See app/models/push.py / app/services/push_service.py.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.models.push import PushSubscription, PushSubscriptionCreate
from app.repositories.store import COLLECTION_PUSH_SUBSCRIPTIONS, get_store


def add_subscription(parent_id: str, data: PushSubscriptionCreate) -> PushSubscription:
    """Idempotent on `endpoint` — re-subscribing the same browser/device
    (e.g. after a service-worker update) replaces its old row rather than
    piling up duplicates."""
    store = get_store()
    for existing in list_subscriptions(parent_id):
        if existing.endpoint == data.endpoint:
            store.delete(COLLECTION_PUSH_SUBSCRIPTIONS, existing.id)
    sub = PushSubscription(
        id=str(uuid.uuid4()),
        parent_id=parent_id,
        endpoint=data.endpoint,
        keys=data.keys,
        created_at=datetime.now(timezone.utc),
    )
    store.create(COLLECTION_PUSH_SUBSCRIPTIONS, sub.id, sub.model_dump())
    return sub


def list_subscriptions(parent_id: str) -> list[PushSubscription]:
    docs = get_store().list(COLLECTION_PUSH_SUBSCRIPTIONS, {"parent_id": parent_id})
    return [PushSubscription(**d) for d in docs]


def remove_subscription_by_endpoint(parent_id: str, endpoint: str) -> None:
    store = get_store()
    for existing in list_subscriptions(parent_id):
        if existing.endpoint == endpoint:
            store.delete(COLLECTION_PUSH_SUBSCRIPTIONS, existing.id)


def remove_subscription(subscription_id: str) -> None:
    """Used by push_service.py to prune a dead subscription (410 Gone from
    the push service — the browser unsubscribed or the endpoint expired)."""
    get_store().delete(COLLECTION_PUSH_SUBSCRIPTIONS, subscription_id)
