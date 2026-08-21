"""FastAPI application entry point for the Pip backend.

Run from src/backend/ with:
    uvicorn app.main:app --reload

Interactive API docs are then at http://localhost:8000/docs
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import admin, auth, chat, child, children, content, health, oversight, public, reports

app = FastAPI(
    title="Pip — Kids' Book & Video Recommendation API",
    description="FYP-26-S3-18 backend. Provider-agnostic; runs with a placeholder brain until a real LLM is connected.",
    version="0.1.0",
)

# Let the React dev server (any localhost port) call the API during development.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(public.router)
app.include_router(auth.router)
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
