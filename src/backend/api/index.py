"""Vercel's entry point for the FastAPI backend.

Vercel's Python runtime auto-discovers serverless functions under `api/`
and, for an ASGI app like this one (FastAPI), just needs the app object
importable from here — it handles the actual request/response translation
itself, no adapter code needed. `app.main` is the real, only FastAPI app
this whole project has; this file is purely a re-export so Vercel can find
it, not a second copy of anything.
"""
from app.main import app  # noqa: F401
