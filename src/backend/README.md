# Backend — Pip API (FastAPI)

The "engine room" for FYP-26-S3-18. Runs **with no API keys and no database
setup** using a placeholder brain and in-memory storage, so anyone on the team
can start it in one command. Real services (LLM provider, Firebase, content
APIs) plug in later at single, isolated swap points.

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
  Swap `BRAIN_PROVIDER` from `placeholder` to `openai`/`anthropic` later —
  nothing else changes.
- **Storage is isolated** (`app/storage.py`): in-memory dicts today, Firebase
  later, without touching the routers.
- Data resets on restart (in-memory) — expected for a prototype.

A demo **moderator** account is seeded: `moderator@pip.local` / `moderator123`.

## Not built yet (deliberately out of the backbone)

Payments/subscription, notifications, verifiable parental consent, multi-child
analytics, and the full admin suite — see the PRD use-case list.
