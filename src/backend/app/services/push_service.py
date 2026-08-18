"""PA20/PA22 real push delivery — dev-session 2026-08-17.

**Why raw Web Push (VAPID) instead of Firebase Cloud Messaging**, even
though this project already has a real Firebase project (see
app/core/firebase.py): FCM's *Web* push specifically requires a "Web Push
certificate" key pair generated through the Firebase Console UI (Project
Settings > Cloud Messaging > Web configuration) — there's no API for that
step, so it's not something this pass could complete on Kiefer's behalf
without him doing one manual console click. The W3C Push API + VAPID
(RFC 8292) needs no such step: any ECDSA P-256 keypair works, generated
once with `py_vapid` (see agent-context/CLAUDE.md §15.9 for the exact
one-liner used) and stored in `.env` as `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`.
`pywebpush` (added to requirements.txt) implements the encryption/signing.

Real, not a stub: `send_push` makes an actual HTTPS request to whichever
push service the browser's subscription endpoint points at (Chrome ->
FCM's own push endpoint, Firefox -> Mozilla's, etc. — the browser picks
this when the frontend calls `PushManager.subscribe()`, not this backend).
A 404/410 response means the subscription is dead (browser unsubscribed,
or the endpoint expired) — that's pruned from the store rather than
retried forever.
"""
from __future__ import annotations

import json

from pywebpush import WebPushException, webpush

from app.core.config import get_settings
from app.models.push import PushSubscription
from app.repositories import push_subscriptions as push_subs_repo


def send_push(subscription: PushSubscription, title: str, body: str) -> bool:
    """Sends one push message to one subscribed device. Returns True on
    success; on a dead subscription (404/410) it prunes the row and returns
    False; any other failure is swallowed too (push is best-effort — a
    parent who missed a push still sees the notification in-app, see
    app/repositories/notifications.py) but logged via the return value for
    the caller to count if it wants to."""
    settings = get_settings()
    if not settings.push_configured:
        return False
    try:
        webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {"p256dh": subscription.keys.p256dh, "auth": subscription.keys.auth},
            },
            data=json.dumps({"title": title, "body": body}),
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
        )
        return True
    except WebPushException as exc:
        status_code = getattr(exc.response, "status_code", None)
        if status_code in (404, 410):
            push_subs_repo.remove_subscription(subscription.id)
        return False


def send_push_to_parent(parent_id: str, title: str, body: str) -> int:
    """Sends to every device the parent has subscribed on this account
    (e.g. phone + laptop). Returns how many actually succeeded."""
    sent = 0
    for subscription in push_subs_repo.list_subscriptions(parent_id):
        if send_push(subscription, title, body):
            sent += 1
    return sent
