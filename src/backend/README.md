# Backend: Pip API (FastAPI)

The API behind Pip: accounts and roles, child profiles, the chat and recommendation loop,
moderation, parent oversight, billing (simulated), notifications and the admin tools.
Interactive docs for every endpoint are served at `/docs` when it is running.

## Run it

```bash
cd src/backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

- API root and health check: http://localhost:8000/api/health
- Interactive API docs: http://localhost:8000/docs

It starts with **no keys and no database**: a placeholder brain and in-memory storage (data resets on
restart). Real services switch on automatically when their keys are present.

## Configuration

Copy `.env.example` to `.env`. Everything is optional.

| Variable | What it does |
|---|---|
| `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, `BRAIN_PROVIDER` | Real conversation and explanations (`placeholder` or `openai`; auto-detected from the key). |
| `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE` | Voice for Pip's spoken replies. |
| `FIREBASE_PROJECT_ID`, `FIREBASE_ADMIN_CREDENTIALS_PATH` or `FIREBASE_ADMIN_CREDENTIALS_JSON` | Save the application state to Firestore. |
| `GOOGLE_BOOKS_API_KEY`, `YOUTUBE_DATA_API_KEY` | Moderator search and import. |
| `RESEND_API_KEY`, `RESEND_FROM`, `FRONTEND_URL` | Real verification and reset emails. |
| `DEV_RETURN_RESET_TOKEN` | Local development only: return the password-reset code in the response when no email can be sent. Never enable it in a deployed app. |
| `INPUT_MODERATION_ENABLED`, `GUARDRAILS_ENABLED`, `SCOPE_CLASSIFIER_ENABLED`, `PII_SCRUB_ENABLED`, `CHAT_RATE_LIMIT_PER_MIN`, `MAX_MESSAGE_CHARS` | Safety layers in front of the model. |
| `EMAIL_DOMAIN_CHECK_ENABLED` | Reject sign-ups whose email domain has no mail server. |
| `ZDR_STATUS` | Records the status of OpenAI zero data retention for under-13 users (shown in the admin settings). |
| `CORS_ORIGIN_REGEX` | Which web origins may call the API (default: any localhost port). |

## Layout

```
app/
  main.py            FastAPI app, middleware (maintenance mode, persistence, metrics)
  routers/           One file per area: auth, account, children, chat, browse, articulation,
                     content (moderator), reports, oversight (parent), admin, public, health
  brain.py           The conversation layer. Picks only from the catalogue it is given.
  embeddings.py      Embedding-based retrieval of catalogue items
  guardrails.py, moderation.py, pii.py   Safety layers before a message reaches the model
  storage.py         All application data (in memory), with Firestore snapshots via firestore_store.py
  content_sources.py, bulk_import.py     Google Books / YouTube search and bulk import
  email_service.py, email_validation.py  Email delivery and address checks
tests/               pytest suite (401 tests)
scripts/             smoke_test.py (end-to-end), seed_real_catalogue.py
api/index.py         Entry point for the Vercel deployment
```

## Tests

```bash
pip install pytest
python -m pytest tests -q          # 401 tests; always runs with the placeholder brain and no Firestore
python scripts/smoke_test.py --base-url http://localhost:8000
```

`smoke_test.py` walks through every role against a running backend and deletes the accounts and
data it creates. Against a deployed backend, add `--email-domain <a domain with mail servers>`.

## Design choices

- **The catalogue is the only source of recommendations.** Retrieval picks the candidates and the
  model only decides how to talk about them. Any item it returns that was not a candidate is dropped.
- **The model is behind one interface** (`app/brain.py`), so the provider can change without touching
  the routers.
- **Storage is isolated** in `storage.py` and `firestore_store.py`. Requests that change data reload the
  latest snapshot first and save it afterwards, so several serverless instances stay consistent.
- Passwords are hashed (PBKDF2-SHA256 with a per-account salt). A child's PIN is stored so a parent
  can read it back from the dashboard, and five wrong tries lock the profile.

## Demo accounts

A moderator (`moderator@pip.local` / `moderator123`) and an admin (`admin@pip.local` / `admin123`) are
created automatically for assessment. They will be removed after the project is assessed.

## Known limitations

- Billing is simulated; no payment provider is connected.
- All state lives in one Firestore document (about 1 MiB limit), so this suits a demo, not large scale.
- The *block links* safety switch is stored but not yet enforced.
- Push notifications are not implemented.
