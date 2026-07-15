# Source Code

Tech stack: **TBD** — to be finalized as part of PRD tool selection
(Week 2-5). Once decided, this will likely split into:

```
src/
  frontend/   Chat UI + browsing interface
  backend/    API, recommendation engine, NLP pipeline
```

Candidates to evaluate (see `../docs/02-research/`): a Python backend
(Flask/FastAPI/Django) with an NLP library (spaCy, Rasa, or an LLM API via
LangChain) is a natural fit for the NLP/recommendation requirements; pair
with a JS frontend (React) or a mobile framework if targeting a mobile app
per the brief's "chatbot app" framing.
