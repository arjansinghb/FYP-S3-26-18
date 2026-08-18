"""Response shapes for PA31 (View Full Activity History & Trends) and PA32
(View Multi-Child Comparative Insights) — both Premium-gated, both computed
read-time roll-ups over existing chat/favourites data rather than new
persisted state. See app/services/activity_analytics.py.
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class ActivityTrends(BaseModel):
    """PA31 — the free-tier PA14 activity log (chat.py's GET .../activity)
    already covers the raw transcript; this is the "trends" layer promised in
    the landing page's Premium pitch (see src/frontend/src/parent/LandingPage.tsx)
    that the PRD draft named but earlier builds hadn't actually computed."""

    child_id: str
    total_sessions: int
    sessions_by_week: dict[str, int] = Field(default_factory=dict)  # ISO week-start date -> session count
    top_topics: list[str] = Field(default_factory=list)


class ChildInsight(BaseModel):
    """One child's row in PA32's cross-child comparison table."""

    child_id: str
    child_name: str
    total_sessions: int
    total_favourites: int
