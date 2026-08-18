# Source Code

Tech stack (per PRD §5 + team decisions, see `agent-context/CLAUDE.md` §5 for
the full rationale — that file is git-ignored/local-only, see its Rule 0):

```
src/
  backend/    Python + FastAPI — API, recommendation engine, NLP pipeline.
              See src/backend/README.md for setup/run instructions.
  frontend/   React chat UI + parent dashboard. Not started yet.
```

Backend and frontend both deploy to Vercel. Firebase (Firestore + Auth) is the
database/auth layer; OpenAI supplies the LLM + embeddings.
