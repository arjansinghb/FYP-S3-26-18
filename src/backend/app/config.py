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

    # Real TTS for Pip's voice (chat.py's /api/chat/speech) — replaces the
    # browser's own Web Speech API, whose voice quality/availability varies
    # wildly per device/OS and, on some devices, has no decent voice at all.
    # "nova" is OpenAI's bright/energetic preset voice — Kiefer compared it
    # against "shimmer" (warmer/calmer) by ear and picked nova as the better
    # fit for a kids' companion. "tts-1" (not "tts-1-hd") is the cheaper,
    # lower-latency model — plenty for short chat replies. No new API key
    # needed, reuses OPENAI_API_KEY above.
    OPENAI_TTS_MODEL = os.getenv("OPENAI_TTS_MODEL", "tts-1")
    OPENAI_TTS_VOICE = os.getenv("OPENAI_TTS_VOICE", "nova")

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

    # Screens a child's message through OpenAI's (free) Moderation API
    # before it reaches the main chat model — a real, separate layer from
    # PII_SCRUB_ENABLED above (that hides identifying details; this checks
    # whether the message itself is steering toward an unsafe topic and
    # redirects instead of answering). Documented as part of this
    # project's safety stack from early on but never actually implemented
    # until now — see app/moderation.py. On by default, same reasoning as
    # PII scrubbing.
    INPUT_MODERATION_ENABLED = os.getenv("INPUT_MODERATION_ENABLED", "true").lower() != "false"

    # --- Firebase (Firestore persistence for the prototype's storage.py —
    # see app/firestore_store.py, the storage swap point) ---
    FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "")
    FIREBASE_ADMIN_CREDENTIALS_PATH = os.getenv("FIREBASE_ADMIN_CREDENTIALS_PATH", "./secrets/firebase-admin.json")
    # Vercel deploy path (2026-09-08) — the service account key's raw JSON
    # *content*, pasted into a Vercel env var, since secrets/firebase-admin.json
    # is deliberately gitignored (never committed) and a serverless platform
    # has nothing to upload it TO even if it were. Local dev is untouched —
    # this is empty there, so firestore_store.py keeps using the file path.
    FIREBASE_ADMIN_CREDENTIALS_JSON = os.getenv("FIREBASE_ADMIN_CREDENTIALS_JSON", "")

    # --- Content source APIs (not wired into an endpoint yet — reserved for
    # a future CM03 "import from Google Books/YouTube" pass) ---
    GOOGLE_BOOKS_API_KEY = os.getenv("GOOGLE_BOOKS_API_KEY", "")
    YOUTUBE_DATA_API_KEY = os.getenv("YOUTUBE_DATA_API_KEY", "")

    # --- UV06/PA03 real email delivery (app/email_service.py). No key ->
    # both flows fall back to the original dev-mode "token comes back in the
    # API response instead of being emailed" behaviour, same as before this
    # setting existed. RESEND_FROM defaults to Resend's own shared testing
    # sender, which works with zero domain setup — good enough for a
    # prototype; swap in a verified custom domain address for anything more
    # than that.
    RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
    RESEND_FROM = os.getenv("RESEND_FROM", "Pip <onboarding@resend.dev>")

    # Allow the React dev server (any localhost port) to call the API.
    CORS_ORIGIN_REGEX = os.getenv("CORS_ORIGIN_REGEX", r"http://localhost:\d+")

    @property
    def firebase_admin_credentials_full_path(self) -> Path:
        p = Path(self.FIREBASE_ADMIN_CREDENTIALS_PATH)
        return p if p.is_absolute() else (_BACKEND_DIR / p)

    @property
    def firebase_configured(self) -> bool:
        """True once a real Firebase Admin credential (either the local
        JSON file, or FIREBASE_ADMIN_CREDENTIALS_JSON for a serverless
        deploy — see that setting's own comment) + project id exist.
        Until then, storage.py stays in-memory-only (same behaviour as
        before this pass) — see app/firestore_store.py."""
        has_cred = bool(self.FIREBASE_ADMIN_CREDENTIALS_JSON) or self.firebase_admin_credentials_full_path.is_file()
        return bool(self.FIREBASE_PROJECT_ID) and has_cred

    @property
    def openai_configured(self) -> bool:
        return bool(self.OPENAI_API_KEY)

    @property
    def resend_configured(self) -> bool:
        return bool(self.RESEND_API_KEY)


settings = Settings()
