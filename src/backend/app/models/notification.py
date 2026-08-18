"""Notifications — PA20 (Receive Notifications) / PA22 (Set Notification
Preferences).

`in_app` and `push` are both real deliveries now (dev-session 2026-08-17 —
see app/services/push_service.py for the push transport, a standalone
VAPID/Web Push setup, not FCM). `email` is still recorded-but-not-delivered:
no general-purpose transactional-email transport exists for this project
(as distinct from PA03/UV06's auth-flow emails, which *do* go out for real
via Firebase's Identity Toolkit — see app/core/firebase.py — because that's
a narrower, already-available mechanism specifically for auth actions, not
a general mailer). Turning `email` on doesn't silently do nothing without a
trace: `Notification.channels_attempted` records what was actually enabled
at send time, so "I turned on email but never got one" is diagnosable
rather than mysterious — flag to Kiefer if/when the team wants real
notification email (needs either an SMTP account he provides credentials
for, or a Firebase Extension like Trigger Email, neither of which this
pass could set up on its own).

`Notification` rows are created server-side at a few trigger points (see
app/routers/children.py's child_login and app/routers/moderation.py's
resolve_flagged_content) and read back here.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

NotificationType = Literal["flag_resolved", "child_activated"]
NotificationChannel = Literal["in_app", "email", "push"]


class NotificationChannels(BaseModel):
    """PA22 — which channels a notification goes out on. `email`/`push` are
    schema-ready, not wired to a real transport yet — see module docstring."""

    in_app: bool = True
    email: bool = False
    push: bool = False


class NotificationPreferences(BaseModel):
    """PA22. Event types both default True — a parent opts OUT of a type,
    rather than having to opt in before receiving anything. Channels default
    to in-app only, the one channel that's actually functional."""

    flag_resolved: bool = True
    child_activated: bool = True
    channels: NotificationChannels = Field(default_factory=NotificationChannels)

    def allows(self, notification_type: NotificationType) -> bool:
        return bool(getattr(self, notification_type, True))


class Notification(BaseModel):
    id: str
    parent_id: str
    type: NotificationType
    title: str
    body: str
    child_id: str | None = None
    created_at: datetime
    read_at: datetime | None = None
    # Which channels were enabled at send time — always includes "in_app"
    # (the only one that's real); "email"/"push" appearing here means the
    # parent had that channel on, not that an email/push actually went out.
    channels_attempted: list[NotificationChannel] = Field(default_factory=lambda: ["in_app"])
