# Backend — Pip API (FastAPI)

The "engine room" for FYP-26-S3-18. Still runs **with no API keys and no
database setup** using a placeholder brain and in-memory storage, so anyone on
the team can start it in one command — but now also picks up real services
automatically the moment their keys are present, at the same two isolated swap
points the file layout was always meant for:

- **`app/brain.py`** — `OpenAIBrain` calls the real OpenAI API once
  `OPENAI_API_KEY` is set (`BRAIN_PROVIDER` auto-detects this — see
  `.env.example`), constrained to only ever recommend items from the
  catalogue it's given (never invents a title).
- **`app/storage.py` + `app/firestore_store.py`** — once `FIREBASE_PROJECT_ID`
  + a service-account file are configured, the in-memory store is loaded from
  and saved back to Firestore (a coarse whole-state snapshot under a
  `prototype_state` collection, kept deliberately separate from the other
  branch's schema in the same project — see `firestore_store.py`'s docstring
  for why this isn't fine-grained per-record Firestore access).

Both fall back to the original zero-setup behaviour with no keys configured.

## Run it

```
cd src/backend
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

- API root: http://localhost:8000/
- Health check: http://localhost:8000/api/health
- **Interactive API docs (try every endpoint): http://localhost:8000/docs**

## What's built (core backbone)

| Area | Use cases | Endpoints |
|---|---|---|
| Accounts & auth | UV05, PA01/02, CM01, SA01 | `/api/auth/signup`, `/login`, `/logout`, `/me` |
| Child profiles + linking | PA07-PA10, PA13, CH01, CH02 | `/api/children`, `/api/children/link` |
| Chat → recommendation loop | CH06-CH10, CH15-CH17 | `/api/chat`, `/api/chat/favourite`, `/favourites`, `/feedback` |
| Content + moderation | CM03-CM09, CM13 | `/api/content` (+ `/approve`, `/reject`) |
| Parent oversight | PA14, PA15, PA16 | `/api/children/{id}/activity`, `/favourites`, `/report` |

## Key design choices

- **Provider-agnostic brain** (`app/brain.py`): the only place the AI lives.
  `BRAIN_PROVIDER` picks `placeholder` or `openai` — nothing else changes.
- **Storage is isolated** (`app/storage.py` + `app/firestore_store.py`):
  in-memory dicts either way, optionally snapshotted to/from Firestore,
  without touching the routers.
- With no Firebase configured, data still resets on restart (in-memory) —
  expected for a quick local demo.

A demo **moderator** account is seeded: `moderator@pip.local` / `moderator123`
(and an admin: `admin@pip.local` / `admin123`) — persisted like everything
else once Firestore is configured, so these keep working across restarts too.

## Not built yet (deliberately out of the backbone)

Payments/subscription, notifications, verifiable parental consent, multi-child
analytics, and the full admin suite — see the PRD use-case list.
