"""In-process, rolling-window request metrics for SA08 (View System Health).

The URS is explicit about what SA08 must show: "Displays system-level
metrics: API uptime, error rates, NLP/recommendation service latency." The
previous implementation only returned basic entity counts + config booleans —
this module supplies the real numbers instead.

Deliberately in-memory, not a real observability pipeline (Datadog/Prometheus/
CloudWatch etc.) — that's a proportionate choice for this project's scale, and
an honest one: these are genuinely measured request timings/outcomes, not
hardcoded placeholders, but they reset on process restart and (if ever
deployed to Vercel's serverless functions per CLAUDE.md §5) per cold start
too, since there's no shared store across instances. Good enough for the
URS's stated goal ("so that I can catch and respond to operational issues
early"); swapping in a real metrics backend is future work if this ever needs
multi-instance aggregation — flagged here rather than silently glossed over.
"""
from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass

_START_TIME = time.monotonic()
_WINDOW_SECONDS = 15 * 60  # 15-minute rolling window for rate/latency figures
_MAX_SAMPLES = 5000  # hard cap so a traffic spike can't grow this unboundedly

# Paths whose latency represents "NLP/recommendation service latency" per the
# URS wording — the chat router is where every OpenAI call (slot-extraction,
# retrieval, explanation) happens, see app/services/openai_service.py.
_NLP_PATH_PREFIXES = ("/chat",)


@dataclass(frozen=True)
class _RequestSample:
    timestamp: float
    duration_ms: float
    is_error: bool
    is_nlp: bool


_samples: deque[_RequestSample] = deque(maxlen=_MAX_SAMPLES)


def record_request(path: str, duration_ms: float, status_code: int) -> None:
    """Called once per request by the ASGI middleware in app/main.py."""
    _samples.append(
        _RequestSample(
            timestamp=time.monotonic(),
            duration_ms=duration_ms,
            is_error=status_code >= 500,
            is_nlp=path.startswith(_NLP_PATH_PREFIXES),
        )
    )


def _recent_samples() -> list[_RequestSample]:
    cutoff = time.monotonic() - _WINDOW_SECONDS
    # deque is append-only here and roughly time-ordered; a plain scan is
    # simpler than bisecting and cheap at this sample cap.
    return [s for s in _samples if s.timestamp >= cutoff]


def snapshot() -> dict:
    """Everything SA08 needs, computed from real request timing."""
    recent = _recent_samples()
    total = len(recent)
    errors = sum(1 for s in recent if s.is_error)
    all_latencies = [s.duration_ms for s in recent]
    nlp_latencies = [s.duration_ms for s in recent if s.is_nlp]
    return {
        "uptime_seconds": time.monotonic() - _START_TIME,
        "window_seconds": _WINDOW_SECONDS,
        "request_count_window": total,
        "error_count_window": errors,
        "error_rate_window": (errors / total) if total else 0.0,
        "avg_latency_ms": (sum(all_latencies) / len(all_latencies)) if all_latencies else None,
        "nlp_avg_latency_ms": (sum(nlp_latencies) / len(nlp_latencies)) if nlp_latencies else None,
        "nlp_sample_count_window": len(nlp_latencies),
    }
