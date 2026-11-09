# Source code

The application behind Pip, a chatbot that recommends age-appropriate books and videos to
children (5 to 12), with a dashboard for parents and consoles for moderators and admins. It is
delivered as an installable Progressive Web App (PWA).

```
src/
  backend/    Python + FastAPI: API, recommendation logic, moderation, storage, tests
  frontend/   React + Vite: child chat, parent dashboard, moderator and admin consoles
```

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React 19, Vite 8, React Router 7 | One app with four areas: `/child`, `/parent`, `/moderator`, `/admin` (plus the landing page at `/`). |
| Backend | Python, FastAPI | About 114 endpoints, grouped in `app/routers/`. |
| AI | OpenAI API | Chat model (`gpt-4o-mini` by default) for conversation, embeddings for catalogue retrieval, text-to-speech, and the moderation API. |
| Storage | Firebase Firestore | The whole application state is saved as one snapshot document. Without Firebase it runs in memory and resets on restart. |
| Email | Resend | Verification and reset emails. Without a key the codes are returned or shown on screen (dev only). |
| Content sources | Google Books, YouTube Data API v3 | Used only by the moderator import tools, never at chat time. |
| Hosting | Vercel | Backend and frontend are two separate projects (`backend/vercel.json`, `frontend/vercel.json`). |

## Run it locally

Prerequisites: **Python 3.11+** and **Node.js 20+**. The two apps are separate processes.

```bash
# 1. Backend, from the repository root
cd src/backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload      # http://localhost:8000 (docs at /docs)
```

```bash
# 2. Frontend, in a second terminal
cd src/frontend
npm install
npm run dev                        # http://localhost:5173
```

The frontend talks to `http://localhost:8000` by default. To point it elsewhere, create
`src/frontend/.env.local` with `VITE_API_BASE=http://localhost:<port>`.

With no configuration at all the backend uses a placeholder brain and in-memory storage, which is
enough to click through every screen. To use the real services, copy `backend/.env.example` to
`backend/.env` and fill in the keys you have (OpenAI, Firebase, Google Books, YouTube, Resend).
Keys are read from the environment and are **never** committed.

## Tests and checks

```bash
cd src/backend
pip install pytest
python -m pytest tests -q          # 401 tests, no network or real keys needed
python scripts/smoke_test.py --base-url http://localhost:8000    # end-to-end against a running backend
```

```bash
cd src/frontend
npm run lint
npm run build
```

More detail: [`backend/README.md`](backend/README.md) and [`frontend/README.md`](frontend/README.md).
