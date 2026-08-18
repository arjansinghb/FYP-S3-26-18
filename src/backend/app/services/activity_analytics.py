"""PA31 (Activity Trends) / PA32 (Multi-Child Comparative Insights) — Premium-
gated aggregate views computed on top of existing chat_sessions/favourites
data (see repositories/chat.py, repositories/favourites.py). No new persisted
state — these are read-time roll-ups, recomputed on every call. Fine at this
dataset size (a family's chat history); would need real aggregation
(scheduled roll-up docs) before this scaled past a few thousand sessions.
"""
from __future__ import annotations

from collections import Counter
from datetime import timedelta

from app.models.analytics import ActivityTrends, ChildInsight
from app.models.child import ChildProfile
from app.repositories import chat as chat_repo
from app.repositories import favourites as favourites_repo


def build_trends(child_id: str) -> ActivityTrends:
    """PA31 — weekly session counts + most-requested topics, on top of the
    same session data PA14's raw activity log already exposes."""
    sessions = chat_repo.list_sessions_for_child(child_id)

    weekly_counts: Counter[str] = Counter()
    topic_counts: Counter[str] = Counter()
    for session in sessions:
        week_start = (session.started_at - timedelta(days=session.started_at.weekday())).date().isoformat()
        weekly_counts[week_start] += 1
        if session.slots.topic:
            topic_counts[session.slots.topic] += 1

    return ActivityTrends(
        child_id=child_id,
        total_sessions=len(sessions),
        sessions_by_week=dict(sorted(weekly_counts.items())),
        top_topics=[topic for topic, _ in topic_counts.most_common(5)],
    )


def build_insight(child: ChildProfile) -> ChildInsight:
    """PA32 — one row of the cross-child comparison table."""
    sessions = chat_repo.list_sessions_for_child(child.id)
    favourites = favourites_repo.list_favourites(child.id)
    return ChildInsight(
        child_id=child.id,
        child_name=child.name,
        total_sessions=len(sessions),
        total_favourites=len(favourites),
    )
