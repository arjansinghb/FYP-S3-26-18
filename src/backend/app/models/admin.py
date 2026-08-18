"""System Admin (SA03-SA11, SA13) response models."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.models.child import ChildProfilePublic
from app.models.parent import AccountStatus, Parent, SubscriptionTier


class AdminUserSummary(BaseModel):
    id: str
    email: str
    display_name: str
    subscription_tier: SubscriptionTier
    status: AccountStatus
    created_at: datetime


class AdminUserDetail(BaseModel):
    parent: Parent
    children: list[ChildProfilePublic]


class SystemHealth(BaseModel):
    """SA08 — View System Health/Monitoring. The URS requires "API uptime,
    error rates, NLP/recommendation service latency" specifically — the
    uptime_seconds/error_rate_window/nlp_avg_latency_ms fields below are real
    measured numbers from app/core/metrics.py's in-process request timing,
    not hardcoded. See that module's docstring for the one honest caveat:
    it's per-process, not a multi-instance observability pipeline."""

    status: str
    firebase_configured: bool
    openai_configured: bool
    catalogue_item_count: int
    parent_count: int
    child_profile_count: int
    uptime_seconds: float
    window_seconds: int
    request_count_window: int
    error_count_window: int
    error_rate_window: float
    avg_latency_ms: float | None
    nlp_avg_latency_ms: float | None
    nlp_sample_count_window: int


class IntegrationStatus(BaseModel):
    """SA09 — Manage API Integrations. Read-only view of which env-var-backed
    integrations are configured; actual key rotation happens via `.env` /
    deployment secrets, not through this API (see src/backend/README.md)."""

    firebase: bool
    openai: bool
    google_books: bool
    youtube_data: bool


class SystemSettings(BaseModel):
    """SA10 (Compliance & Data-Retention) + SA11 (System Settings) + SA13
    (Manage Billing System Configuration) — one generic settings doc, matching
    CLAUDE.md §6's single `systemSettings/{doc}` collection rather than
    splitting into three."""

    data_retention_days: int = 365
    default_age_band_threshold: int = 9  # PA07's derive_age_band split point

    # SA13 — admin-configurable Premium pricing (PA24 reads these instead of
    # a hardcoded constant; see app/models/billing.py's PREMIUM_MONTHLY_PRICE_CENTS,
    # now just the shipped default for a fresh settings doc).
    premium_monthly_price_cents: int = 999
    premium_annual_price_cents: int = 9990  # ~2 months free vs. paying monthly x12

    # Content safety — CLAUDE.md §5's "curated allowlist of vetted channel/
    # source IDs" for YouTube search (see content_source_service.search_videos).
    # Empty by default: falls back to the existing open safeSearch=strict
    # search until an admin actually curates a list — CM06/CM07's human
    # review is still a real gate either way, this narrows what a moderator
    # sees to search *from* in the first place.
    youtube_channel_allowlist: list[str] = Field(default_factory=list)

    updated_at: datetime | None = None
