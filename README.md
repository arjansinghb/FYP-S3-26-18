# FYP-26-S3-18: Pip, a chatbot for book and video recommendations for kids

CSIT321 Final Year Project (UOW / SIM), Session 3, 2026.
Project ID: **CSIT-26-S3-18** · Group ID: **FYP-26-S3-18**

**Pip** helps parents and children (ages 5 to 12) find age-appropriate books and
videos by talking to a friendly character instead of searching a catalogue. Every
recommendation comes from a closed, human-moderated catalogue and arrives with a short
reason a child can understand. Parents get their own dashboard to see what their child
asked for, review it, and set limits.

## Try it

| | |
|---|---|
| Web app (installable PWA) | https://fyp-pip-frontend.vercel.app |
| API | https://fyp-pip-backend.vercel.app (interactive docs at `/docs`) |
| Source code | https://github.com/arjansinghb/FYP-S3-26-18 |

**Roles and how to sign in**

- **Parent:** use *Parent sign up* on the landing page. The live demo sends email through a sandbox
  sender that only reaches its owner, so the verification link is shown on screen instead.
- **Child:** the parent creates a child profile, then opens the profile's *Edit* tab to get a
  Login ID and a 6-digit PIN. The child signs in at `/child`.
- **Moderator and admin (demo accounts, for assessment only):**

  | Role | Email | Password |
  |---|---|---|
  | Moderator | `moderator@pip.local` | `moderator123` |
  | Admin | `admin@pip.local` | `admin123` |

  Staff sign in on the same login screen as parents.

## What it does

**Child**
- Talk to Pip by voice or typing. Pip answers aloud and shows three picks, each with a reason.
- Open details, watch an embedded video, save a favourite, or say "Loved it" / "Not for me".
- Browse by topic, and keep everything saved in *My Library*.
- Tell Pip about a saved book or video in their own words. Pip never marks an answer wrong;
  the parent confirms or declines it, and confirmed explanations move the child through three
  levels (Explorer, Adventurer, Storyteller).
- Pip only talks about books and videos, and redirects anything else.
- PIN sign-in that locks after five wrong tries until a parent unlocks the profile.

**Parent**
- Sign-up with email verification and verifiable parental consent before any child data is stored.
- Child profiles (date of birth sets the age band, interests, reading level), with a generated
  Login ID and PIN.
- Per child: chat history by session, favourites (approve, block or report a title), reports and
  moderator feedback, explanations to confirm or decline, safety settings (books, videos or both).
- Premium: insights and trends, a level journey, and side-by-side comparison of children.
- Notifications (in-app and email), chat-history retention, scheduled deletion of a child's data,
  a help desk, a product review, and a Free/Premium subscription (billing is simulated).

**Content moderator**
- Review new submissions (with an AI pre-screen), approve or reject, and browse the catalogue.
- Search and import from Google Books and YouTube, bulk import with AI triage, and an AI audit that
  spot-checks what the AI approved on its own.
- Handle parent reports and answer parents with a note.

**System admin**
- System health (uptime, error rate, latency), user search with suspend and unsuspend, parent review
  moderation, system settings (maintenance mode, integrations, retention, website, pricing), and
  support tickets.

**Safety, in layers:** curated catalogue only, input moderation and guardrails before a message reaches
the model, personal details scrubbed from a child's message, age-band filtering, rate limiting, and
human moderation of every catalogue entry.

## Plans

| | Free | Premium |
|---|---|---|
| Child profiles | 1 | up to 4 |
| Saved favourites | 5 per child | unlimited |
| Activity history | basic log | full history, trends, level journey, comparison |
| Chat with Pip | unlimited | unlimited |

Prices are set by the admin (default SGD 9.90 per month or SGD 99 per year). Payments are simulated;
no real card is ever charged.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19, Vite, React Router (installable PWA) |
| Backend | Python, FastAPI |
| AI | OpenAI API: chat model for conversation, embeddings for retrieval, text-to-speech, moderation |
| Database and auth | Firebase Firestore (whole-state snapshot), with an in-memory fallback for local runs |
| Email | Resend (sandbox) |
| Content sources | Google Books API, YouTube Data API v3 (moderator import only) |
| Hosting | Vercel (frontend and backend as two projects) |

## Repository layout

```
docs/       Project documents (charter, requirements, research, design, testing, ...)
src/
  backend/    FastAPI app, tests (pytest), scripts
  frontend/   React app
website/    Notes on the project website (the site itself is the landing page of the frontend)
```

## Run it locally

Needs **Python 3.11+** and **Node.js 20+**. The backend runs with no keys at all (placeholder
brain, in-memory storage); add keys to switch on the real services. Details are in
[`src/README.md`](src/README.md).

```bash
# Backend (http://localhost:8000, API docs at /docs)
cd src/backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

```bash
# Frontend (http://localhost:5173)
cd src/frontend
npm install
npm run dev
```

```bash
# Backend tests (401 tests; no network, no real keys needed)
cd src/backend
pip install pytest
python -m pytest tests -q
```

## Known limitations

- Billing is a simulation; no payment provider is connected.
- Email goes through a sandbox sender, so verification links appear on screen and password-reset
  codes can only be received by the sandbox owner's address.
- Push notifications are not available (the toggle is shown as "coming soon").
- The *block links* safety switch is stored but not yet enforced by the backend.
- All application state is kept in a single Firestore document, which is fine for a demo but would
  need per-record storage at larger scale.
- The demo moderator and admin accounts above are for assessment and will be removed afterwards.

## Team

| Name | Role |
|---|---|
| Arjan Singh Bhasin | Project Manager |
| Desmond Won Thiang Feng | Technical Writing |
| Lee Jihyeon | Research |
| Kiefer Russell Sulijanto | Programming |
| Tan Kian Hong | Testing |

Supervisor: **Terence Chew** · Assessor: **Mr. Premarajan**

## Deliverables and dates

| Deliverable | Due |
|---|---|
| Final product and documentation (source code, final technical document, user manual, peer assessment, project and marketing videos, slides) | 14 Nov 2026 |
| Final presentation (about 30 minutes) | 21 Nov 2026 |
| Final online submission to SIM | 25 Nov 2026 |

All deliverables are named with the group ID prefix, for example `FYP-26-S3-18_FTD`.
