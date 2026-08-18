"""
App settings, loaded from environment variables / .env files.

Local dev convenience: looks for a `.env` first in `src/backend/`, then falls back
to the repo root `.env` (the one templated by `.env.example` at the repo root),
so you don't need two separate env files for one dev machine.

See agent-context/CLAUDE.md §5/§6 for why these specific variables exist.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parents[2]  # src/backend/
_REPO_ROOT = _BACKEND_DIR.parents[1]  # repo root

# Load repo-root .env first (shared defaults), then backend-local .env can override.
load_dotenv(_REPO_ROOT / ".env", override=False)
load_dotenv(_BACKEND_DIR / ".env", override=True)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    # --- Firebase (client config, mirrored so the backend can call Identity
    # Toolkit REST endpoints for password login/reset — see services/firebase_auth.py) ---
    firebase_api_key: str = ""
    firebase_auth_domain: str = ""
    firebase_project_id: str = ""
    firebase_storage_bucket: str = ""
    firebase_messaging_sender_id: str = ""
    firebase_app_id: str = ""

    # --- Firebase Admin SDK (backend only) ---
    firebase_admin_credentials_path: str = "./secrets/firebase-admin.json"

    # --- OpenAI ---
    openai_api_key: str = ""
    openai_chat_model: str = "gpt-4o-mini"
    openai_embedding_model: str = "text-embedding-3-small"

    # --- Content source APIs ---
    google_books_api_key: str = ""
    youtube_data_api_key: str = ""

    # --- Payments (PA24-27, simulated by default — see
    # app/services/payment/. Blank until a real Stripe integration is ever
    # wired up for production; StripePaymentProvider is a documented stub
    # until then, see its own module docstring.) ---
    stripe_api_key: str = ""

    # --- Web Push (PA20/PA22, dev-session 2026-08-17) — see
    # app/services/push_service.py for why this is a standalone VAPID
    # keypair rather than FCM. ---
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:admin@example.com"

    # --- Backend ---
    backend_port: int = 8000
    cors_origin: str = "http://localhost:3000"

    # --- App-specific (not in the shared .env.example; backend-only knobs) ---
    # Used to sign both the child-PIN session token (CH01/CH02, always — the
    # child never goes through Firebase Auth) and, only in local-dev-store mode
    # (no Firebase configured), a stand-in parent session token.
    session_secret: str = "dev-only-insecure-secret-change-me"
    clarifying_round_cap: int = 2
    free_tier_favourites_cap: int = 5
    recommendation_batch_size: int = 3

    @property
    def firebase_admin_credentials_full_path(self) -> Path:
        p = Path(self.firebase_admin_credentials_path)
        return p if p.is_absolute() else (_BACKEND_DIR / p)

    @property
    def firebase_configured(self) -> bool:
        """True once a real Firebase Admin service-account file exists.

        Until then, the app runs in local dev-store mode (app/repositories) so it's
        possible to build/test the core loop without a live Firebase project — see
        agent-context/CLAUDE.md §12 and src/backend/README.md.
        """
        return self.firebase_admin_credentials_full_path.is_file() and bool(self.firebase_project_id)

    @property
    def openai_configured(self) -> bool:
        """True once a real OpenAI key is set; otherwise services/openai_service.py
        falls back to a deterministic mock so the chat loop is still testable."""
        return bool(self.openai_api_key)

    @property
    def stripe_configured(self) -> bool:
        """True once a real Stripe key is set; until then
        app/services/payment/provider.py serves SimulatedPaymentProvider —
        billing stays fully testable/demoable with no external account."""
        return bool(self.stripe_api_key)

    @property
    def push_configured(self) -> bool:
        """True once a VAPID keypair is set — see app/services/push_service.py."""
        return bool(self.vapid_public_key and self.vapid_private_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
