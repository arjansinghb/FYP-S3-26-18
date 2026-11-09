"""SA08 — real system-health metrics, not just counts.

URS's SA08 description is specific: "Displays system-level metrics: API
uptime, error rates, NLP/recommendation service latency." Before this, the
admin stats endpoint only had request counts and a raw process uptime — a
gap found while cross-checking the URS.

In-process rolling window (last N requests), fed by main.py's
`track_request` middleware. Deliberately simple — no external metrics
backend for a prototype at this scale — but the numbers are real, computed
from actual request timings, not fabricated placeholders.
"""
from __future__ import annotations

import time
from collections import deque

_WINDOW = 500  # last N requests kept for the rolling stats

# Each entry: (timestamp, duration_seconds, status_code, is_chat_path)
_requests: deque[tuple[float, float, int, bool]] = deque(maxlen=_WINDOW)


def record(duration: float, status_code: int, path: str) -> None:
    # Exact match, not a prefix — /api/chat is the one endpoint that actually
    # calls the brain (see routers/chat.py's bare POST ""); /api/chat/sessions,
    # /api/chat/favourite(s), /api/chat/feedback etc. never touch the LLM and
    # would otherwise water down "NLP latency" with near-zero-latency requests.
    is_chat = path == "/api/chat"
    _requests.append((time.time(), duration, status_code, is_chat))


def snapshot() -> dict:
    """Real numbers computed from whatever's currently in the window — empty
    window (fresh boot, no traffic yet) reports zeros/None rather than
    fabricating a number, which is the honest thing to show on a health page."""
    if not _requests:
        return {
            "sample_size": 0,
            "error_rate": 0.0,
            "avg_latency_ms": None,
            "nlp_avg_latency_ms": None,
            "nlp_sample_size": 0,
        }
    total = len(_requests)
    errors = sum(1 for _, _, code, _ in _requests if code >= 500)
    avg_latency = sum(d for _, d, _, _ in _requests) / total
    chat_durations = [d for _, d, _, is_chat in _requests if is_chat]
    return {
        "sample_size": total,
        "error_rate": round(errors / total, 4),
        "avg_latency_ms": round(avg_latency * 1000, 1),
        "nlp_avg_latency_ms": round(sum(chat_durations) / len(chat_durations) * 1000, 1) if chat_durations else None,
        "nlp_sample_size": len(chat_durations),
    }
