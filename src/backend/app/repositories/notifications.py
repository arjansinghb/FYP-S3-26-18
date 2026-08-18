"""Typed CRUD for `notifications/{notificationId}` — PA20/PA22.
See app/models/notification.py.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.models.notification import Notification, NotificationType
from app.models.parent import Parent
from app.repositories.store import COLLECTION_NOTIFICATIONS, get_store


def notify_if_enabled(
    parent: Parent, type: NotificationType, title: str, body: str, child_id: str | None = None
) -> Notification | None:
    """Trigger-site helper (see app/routers/children.py's child_login and
    app/routers/moderation.py's resolve_flagged_content) — respects PA22
    before writing anything. Returns None (no-op) if the parent has that
    notification type turned off. Records which channels were *enabled* on
    the notification (`channels_attempted`) — see app/models/notification.py.

    dev-session 2026-08-17: the `push` leg is now a real attempt (see
    app/services/push_service.py), not just a recorded intent — every
    device the parent has subscribed gets a real Web Push message. `email`
    is still recorded-but-not-delivered — no email transport exists for
    generic notification content (as opposed to PA03/UV06's auth-flow
    emails, which do go out for real via Firebase — see
    app/core/firebase.py — because those specifically go through Identity
    Toolkit's own sendOobCode, not a general-purpose mailer this project
    doesn't have)."""
    if not parent.notification_preferences.allows(type):
        return None
    channels = parent.notification_preferences.channels
    channels_attempted = [
        name for name, enabled in (("in_app", channels.in_app), ("email", channels.email), ("push", channels.push))
        if enabled
    ] or ["in_app"]
    notification = create_notification(parent.id, type, title, body, child_id, channels_attempted)
    if channels.push:
        from app.services import push_service

        push_service.send_push_to_parent(parent.id, title, body)
    return notification


def create_notification(
    parent_id: str,
    type: NotificationType,
    title: str,
    body: str,
    child_id: str | None = None,
    channels_attempted: list[str] | None = None,
) -> Notification:
    notification = Notification(
        id=str(uuid.uuid4()),
        parent_id=parent_id,
        type=type,
        title=title,
        body=body,
        child_id=child_id,
        created_at=datetime.now(timezone.utc),
        channels_attempted=channels_attempted or ["in_app"],
    )
    get_store().create(COLLECTION_NOTIFICATIONS, notification.id, notification.model_dump())
    return notification


def get_notification(notification_id: str) -> Notification | None:
    doc = get_store().get(COLLECTION_NOTIFICATIONS, notification_id)
    return Notification(**doc) if doc else None


def list_notifications_for_parent(parent_id: str) -> list[Notification]:
    """PA20 — Receive Notifications (pull model — client loads this list; see
    app/models/notification.py's module docstring for why there's no push
    transport)."""
    docs = get_store().list(COLLECTION_NOTIFICATIONS, {"parent_id": parent_id})
    return sorted((Notification(**d) for d in docs), key=lambda n: n.created_at, reverse=True)


def mark_read(notification_id: str) -> None:
    get_store().update(COLLECTION_NOTIFICATIONS, notification_id, {"read_at": datetime.now(timezone.utc)})


def delete_notifications_for_parent(parent_id: str) -> None:
    """Cascade delete — PA06 Delete Account."""
    store = get_store()
    for notification in list_notifications_for_parent(parent_id):
        store.delete(COLLECTION_NOTIFICATIONS, notification.id)
