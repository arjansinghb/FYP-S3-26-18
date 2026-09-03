"""Runtime configuration, driven by environment variables.

Everything still has a safe default so the backend runs with NO setup and NO
API keys (placeholder brain, in-memory storage) — same promise as before. Real
keys, when present, are picked up automatically: no separate "prototype" env
file to maintain, this loads the same root-level `.env` the team's other
implementation (frontend-visual-overhaul branch) already uses, plus an
optional backend-local `.env` override — see .env.example for what each
variable does.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

_BACKEND_DIR = Path(__file__).resolve().parents[1]  # src/backend/
_REPO_ROOT = _BACKEND_DIR.parents[1]  # repo root

# Repo-root .env first (shared defaults, e.g. the real Firebase/OpenAI keys
# already set up for the other branch), then a backend-local .env can override
# any single value without touching the shared file.
load_dotenv(_REPO_ROOT / ".env", override=False)
load_dotenv(_BACKEND_DIR / ".env", override=True)


class Settings:
    # Which "brain" powers Pip's replies.
    #   "placeholder" -> keyword stand-in, no keys needed
    #   "openai"       -> real LLM (app/brain.py's OpenAIBrain)
    #   "anthropic"    -> not implemented yet, same swap point
    # Auto-detected below when BRAIN_PROVIDER isn't set explicitly: real key
    # present -> "openai", otherwise falls back to the free placeholder so the
    # backend still runs for anyone without a key.
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
    OPENAI_CHAT_MODEL = os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini")
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

    BRAIN_PROVIDER = os.getenv("BRAIN_PROVIDER") or ("openai" if OPENAI_API_KEY else "placeholder")

    # --- URS §2.5 Constraint 3 / Assumption 3: OpenAI's Zero Data Retention
    # (ZDR) status for under-13 users is explicitly flagged as "unresolved...
    # a decision is needed before implementation begins." Nothing in code can
    # actually secure ZDR — that's a real agreement with OpenAI, not a
    # setting — so this exists to make the CURRENT status visible (surfaced
    # in SA10 compliance config, logged at startup) instead of silently
    # treating it as resolved. See PII_SCRUB_ENABLED below for the one
    # mitigation code actually can do regardless of this status.
    #   "unresolved"     -> default. Real child conversation text is sent to
    #                       OpenAI's standard API (30-day abuse-monitoring
    #                       retention applies) with no ZDR agreement in place.
    #   "accepted_risk"  -> the team has knowingly decided to proceed without
    #                       ZDR for this phase (e.g. coursework prototype, no
    #                       real children's data) — an explicit choice, not a
    #                       silent default.
    #   "confirmed"      -> a real ZDR agreement with OpenAI is in place.
    ZDR_STATUS = os.getenv("ZDR_STATUS", "unresolved")

    # Strips likely-PII patterns (emails, phone numbers, street-address-like
    # strings) from a child's message before it's sent to OpenAI for
    # embedding or chat completion — see app/pii.py. Independent of ZDR
    # status: real defense-in-depth either way, on by default.
    PII_SCRUB_ENABLED = os.getenv("PII_SCRUB_ENABLED", "true").lower() != "false"

    # --- Firebase (Firestore persistence for the prototype's storage.py —
    # see app/firestore_store.py, the storage swap point) ---
    FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "")
    FIREBASE_ADMIN_CREDENTIALS_PATH = os.getenv("FIREBASE_ADMIN_CREDENTIALS_PATH", "./secrets/firebase-admin.json")

    # --- Content source APIs (not wired into an endpoint yet — reserved for
    # a future CM03 "import from Google Books/YouTube" pass) ---
    GOOGLE_BOOKS_API_KEY = os.getenv("GOOGLE_BOOKS_API_KEY", "")
    YOUTUBE_DATA_API_KEY = os.getenv("YOUTUBE_DATA_API_KEY", "")

    # Allow the React dev server (any localhost port) to call the API.
    CORS_ORIGIN_REGEX = os.getenv("CORS_ORIGIN_REGEX", r"http://localhost:\d+")

    @property
    def firebase_admin_credentials_full_path(self) -> Path:
        p = Path(self.FIREBASE_ADMIN_CREDENTIALS_PATH)
        return p if p.is_absolute() else (_BACKEND_DIR / p)

    @property
    def firebase_configured(self) -> bool:
        """True once a real Firebase Admin service-account file + project id
        exist. Until then, storage.py stays in-memory-only (same behaviour as
        before this pass) — see app/firestore_store.py."""
        return bool(self.FIREBASE_PROJECT_ID) and self.firebase_admin_credentials_full_path.is_file()

    @property
    def openai_configured(self) -> bool:
        return bool(self.OPENAI_API_KEY)


settings = Settings()
