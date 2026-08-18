"""Picks the local-dev-store or real Firestore implementation, once, based on
whether `settings.firebase_configured` — see app/core/config.py and
agent-context/CLAUDE.md §12.
"""
from __future__ import annotations

from functools import lru_cache

from app.core.config import get_settings
from app.repositories.base import DocumentStore


@lru_cache
def get_store() -> DocumentStore:
    settings = get_settings()
    if settings.firebase_configured:
        from app.repositories.firestore_store import FirestoreStore

        return FirestoreStore()
    from app.repositories.local_store import LocalJSONStore

    return LocalJSONStore()


# Collection name constants — keep routers/services from typo-ing string literals.
COLLECTION_PARENTS = "parents"
COLLECTION_CHILD_PROFILES = "child_profiles"
COLLECTION_CHAT_SESSIONS = "chat_sessions"
COLLECTION_MESSAGES = "messages"
COLLECTION_FAVOURITES = "favourites"
COLLECTION_CATALOGUE_ITEMS = "catalogue_items"
COLLECTION_STAFF_ACCOUNTS = "staff_accounts"
COLLECTION_FLAGS = "flags"
COLLECTION_FEEDBACK = "feedback"  # CH17 — Give Feedback on Recommendation
COLLECTION_CONTENT_OVERRIDES = "content_overrides"  # PA18
COLLECTION_DEV_USERS = "dev_users"  # local-dev-store-only: email/password for signup/login without Firebase
COLLECTION_SYSTEM_SETTINGS = "system_settings"  # SA10/SA11, one singleton doc (id "default")
COLLECTION_NOTIFICATIONS = "notifications"  # PA20/PA22
COLLECTION_BILLING_RECORDS = "billing_records"  # PA24-27 (simulated)
COLLECTION_PUSH_SUBSCRIPTIONS = "push_subscriptions"  # PA20/PA22 real push, dev-session 2026-08-17
