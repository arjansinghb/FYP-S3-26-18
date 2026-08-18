"""PA20/PA22 real push delivery — dev-session 2026-08-17. See
app/services/push_service.py's module docstring for the VAPID-vs-FCM
decision. A `PushSubscription` is the browser's own `PushSubscriptionJSON`
shape (from `PushManager.subscribe()`), stored as-is so it can be replayed
straight into `pywebpush.webpush()`.
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionCreate(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys


class PushSubscription(BaseModel):
    id: str
    parent_id: str
    endpoint: str
    keys: PushSubscriptionKeys
    created_at: datetime
