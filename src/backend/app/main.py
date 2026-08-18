"""FastAPI entrypoint. Run locally with:

    cd src/backend && uvicorn app.main:app --reload --port 8000

Deployed to Vercel as serverless functions per agent-context/CLAUDE.md §5 (team
pivot from the PRD's own hosting silence — PRD names no hosting platform at all).
"""
from __future__ import annotations

import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.core import metrics
from app.core.config import get_settings
from app.routers import account, admin, auth, chat, children, favourites, moderation, notifications, parent_dashboard

settings = get_settings()

app = FastAPI(
    title="FYP-26-S3-18 Backend",
    description="Chatbot API for book & video recommendation for kids.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _record_metrics(request: Request, call_next):
    """Feeds app/core/metrics.py — see that module's docstring. Times every
    request and records its outcome so SA08 (View System Health) can report
    real uptime/error-rate/NLP-latency numbers per the URS's requirement."""
    start = time.monotonic()
    try:
        response = await call_next(request)
    except Exception:
        metrics.record_request(request.url.path, (time.monotonic() - start) * 1000, 500)
        raise
    metrics.record_request(request.url.path, (time.monotonic() - start) * 1000, response.status_code)
    return response

app.include_router(auth.router)
app.include_router(account.router)
app.include_router(children.router)
app.include_router(chat.router)
app.include_router(favourites.router)
app.include_router(notifications.router)
app.include_router(parent_dashboard.router)
app.include_router(moderation.router)
app.include_router(admin.router)


@app.get("/health")
def health() -> dict:
    """Not a PRD use case — ops/dev convenience endpoint (SA08-adjacent)."""
    return {
        "status": "ok",
        "firebase_configured": settings.firebase_configured,
        "openai_configured": settings.openai_configured,
    }
