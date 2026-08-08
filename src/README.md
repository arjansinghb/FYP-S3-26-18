# Source Code

The application source for FYP-26-S3-18 — a chatbot that recommends
age-appropriate books and videos to children (5–12), with a parent
oversight dashboard. Delivered as an installable Progressive Web App (PWA).

## Tech stack (finalized in the PRD)

| Layer | Choice | Notes |
|---|---|---|
| **Frontend** | React (via Vite) | Child-facing avatar chat UI + parent dashboard. Ships as an installable PWA. |
| **Backend** | Python + FastAPI | API, recommendation logic, and the NLP/LLM conversation layer live together in one language. |
| **AI / recommendation** | OpenAI API | Powers the conversational understanding and the ANN-based recommendation engine. Provider compliance (under-13 / Zero Data Retention) is owned by the lead programmer. |
| **Database + Auth** | Firebase (Firestore + Authentication) | Parent accounts, linked child profiles, chat/recommendation history. |
| **Content sources** | Google Books API (books); YouTube Data API v3, restricted to a curated allowlist (video) | Closed, vetted catalogue — never open/unfiltered sources. |

## Folder layout

```
src/
  frontend/   React (Vite) app — child avatar chat UI + parent dashboard (PWA)
  backend/    Python + FastAPI — API, recommendation engine, NLP/LLM pipeline
```

## Running locally

Prerequisites: **Node.js LTS** (frontend) and **Python 3.11+** (backend).

```
# Frontend
cd frontend
npm install
npm run dev

# Backend (once added)
cd backend
python -m venv .venv
# activate the venv, then:
pip install -r requirements.txt
uvicorn main:app --reload
```

API keys (OpenAI, Firebase, Google Books, YouTube) are supplied via
environment variables / local config and are **never** committed to the repo.
