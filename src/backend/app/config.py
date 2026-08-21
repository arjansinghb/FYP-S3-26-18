"""Runtime configuration, driven by environment variables.

Everything has a safe default so the backend runs with NO setup and NO API
keys. Real keys (LLM provider, Firebase, content APIs) get supplied later via
environment variables / a .env file — see .env.example.
"""
import os


class Settings:
    # Which "brain" powers Pip's replies.
    #   "placeholder" -> keyword stand-in, no keys needed (default)
    #   "openai" / "anthropic" -> real LLM (added later, needs a key)
    BRAIN_PROVIDER = os.getenv("BRAIN_PROVIDER", "placeholder")

    # Keys for later — unused while BRAIN_PROVIDER is "placeholder".
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

    # Allow the React dev server (any localhost port) to call the API.
    CORS_ORIGIN_REGEX = os.getenv("CORS_ORIGIN_REGEX", r"http://localhost:\d+")


settings = Settings()
