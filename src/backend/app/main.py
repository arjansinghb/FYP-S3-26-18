"""FastAPI application entry point for the Pip backend.

Run from src/backend/ with:
    uvicorn app.main:app --reload

Interactive API docs are then at http://localhost:8000/docs
"""
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import account, admin, auth, chat, child, children, content, health, oversight, public, reports
from .storage import db

logger = logging.getLogger("pip")

app = FastAPI(
    title="Pip — Kids' Book & Video Recommendation API",
    description="FYP-26-S3-18 backend. Provider-agnostic; runs with a placeholder brain until a real LLM is connected.",
    version="0.1.0",
)


@app.on_event("startup")
def _warn_if_zdr_unresolved() -> None:
    """URS §2.5 Constraint 3 / Assumption 3 — not a resolvable-by-code
    setting (see config.py's ZDR_STATUS docstring), so this exists purely to
    make the current state loud and visible in server logs on every boot,
    the same way it's already visible via SA10 (system.compliance config)."""
    if settings.BRAIN_PROVIDER == "openai" and settings.ZDR_STATUS == "unresolved":
        logger.warning(
            "⚠️  OpenAI ZDR status is 'unresolved' (see URS §2.5) — real child "
            "chat text is going to OpenAI's standard API (30-day abuse-monitoring "
            "retention, no Zero Data Retention agreement). Set ZDR_STATUS=accepted_risk "
            "in .env once the team has knowingly decided this is OK for now (e.g. "
            "coursework prototype, no real children's data), or ZDR_STATUS=confirmed "
            "once a real agreement is in place with OpenAI."
        )

# Let the React dev server (any localhost port) call the API during development.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def persist_state(request: Request, call_next):
    """Snapshot the in-memory store to Firestore after any request that could
    have changed it — no-op when Firebase isn't configured (see
    app/firestore_store.py). Keeps every router exactly as-is; this is the
    only place that knows persistence exists at all."""
    response = await call_next(request)
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and response.status_code < 400:
        db.save()
    return response


app.include_router(health.router)
app.include_router(public.router)
app.include_router(auth.router)
app.include_router(account.router)
app.include_router(children.router)
app.include_router(oversight.router)
app.include_router(chat.router)
app.include_router(child.router)
app.include_router(content.router)
app.include_router(reports.router)
app.include_router(admin.router)


@app.get("/")
def root():
    return {"service": "pip-backend", "docs": "/docs", "health": "/api/health"}
