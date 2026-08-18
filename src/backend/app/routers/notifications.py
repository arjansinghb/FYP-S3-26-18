"""PA20 (Receive Notifications) / PA22 (Set Notification Preferences). See
app/models/notification.py for why this is an in-app list rather than
email/push.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.deps import get_current_parent
from app.models.notification import Notification, NotificationPreferences
from app.models.parent import Parent
from app.models.push import PushSubscriptionCreate
from app.repositories import notifications as notifications_repo
from app.repositories import parents as parents_repo
from app.repositories import push_subscriptions as push_subs_repo

router = APIRouter(tags=["notifications"])


@router.get("/notifications", response_model=list[Notification])
def list_notifications(parent: Parent = Depends(get_current_parent)) -> list[Notification]:
    """PA20 — Receive Notifications."""
    return notifications_repo.list_notifications_for_parent(parent.id)


@router.post("/notifications/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def mark_notification_read(notification_id: str, parent: Parent = Depends(get_current_parent)) -> None:
    notification = notifications_repo.get_notification(notification_id)
    if notification is None or notification.parent_id != parent.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    notifications_repo.mark_read(notification_id)


@router.get("/account/notification-preferences", response_model=NotificationPreferences)
def get_notification_preferences(parent: Parent = Depends(get_current_parent)) -> NotificationPreferences:
    return parent.notification_preferences


@router.patch("/account/notification-preferences", response_model=NotificationPreferences)
def update_notification_preferences(
    data: NotificationPreferences, parent: Parent = Depends(get_current_parent)
) -> NotificationPreferences:
    """PA22 — Set Notification Preferences."""
    parents_repo.update_parent(parent.id, notification_preferences=data.model_dump())
    return data


# ---------------------------------------------------------------------------
# Web Push subscription management — PA20/PA22's push leg, dev-session
# 2026-08-17. See app/services/push_service.py's module docstring.
# ---------------------------------------------------------------------------


class VapidPublicKey(BaseModel):
    public_key: str
    configured: bool


@router.get("/notifications/push/public-key", response_model=VapidPublicKey)
def get_push_public_key() -> VapidPublicKey:
    """Public (no auth needed — it's, by definition, the public half of the
    keypair) so the frontend can pass it to
    `PushManager.subscribe({applicationServerKey})` before the parent is
    necessarily logged in on this device yet."""
    settings = get_settings()
    return VapidPublicKey(public_key=settings.vapid_public_key, configured=settings.push_configured)


@router.post("/notifications/push/subscribe", status_code=status.HTTP_201_CREATED)
def subscribe_to_push(data: PushSubscriptionCreate, parent: Parent = Depends(get_current_parent)) -> dict:
    push_subs_repo.add_subscription(parent.id, data)
    return {"message": "Subscribed."}


class PushUnsubscribeRequest(BaseModel):
    endpoint: str


@router.post("/notifications/push/unsubscribe", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def unsubscribe_from_push(data: PushUnsubscribeRequest, parent: Parent = Depends(get_current_parent)) -> None:
    push_subs_repo.remove_subscription_by_endpoint(parent.id, data.endpoint)
