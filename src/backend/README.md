# Backend — FastAPI

Implements the full backend from `agent-context/CLAUDE.md`: all five actors
(Unregistered Visitor, Parent/Guardian, Child User, Content Moderator, System
Admin). Stack: Python + FastAPI, Firebase (Firestore + Authentication), OpenAI
(LLM + embeddings), Google Books API + YouTube Data API v3 (content ingestion),
deployed to Vercel as serverless functions (team pivot from the PRD's own
hosting silence — see CLAUDE.md §5).

## Setup

```bash
cd src/backend
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Copy the repo-root `.env.example` to `.env` (repo root, not this folder) and
fill in real values — or don't, and read on.

## Running without any real credentials (default, easiest)

The backend works out of the box with **no Firebase project, no OpenAI key,
and no Google Books/YouTube keys**:

- No `FIREBASE_ADMIN_CREDENTIALS_PATH` file present → falls back to a local
  JSON-file document store (`data/local_store.json`, gitignored) instead of
  Firestore, and to backend-issued JWTs instead of real Firebase Auth tokens.
- No `OPENAI_API_KEY` set → falls back to a deterministic mock NLP/embeddings
  implementation (`app/services/openai_service.py`) — good enough to exercise
  the full dialogue state machine and retrieval logic, **not** real language
  understanding.
- No `GOOGLE_BOOKS_API_KEY` / `YOUTUBE_DATA_API_KEY` → the moderator
  search-and-import screens (CM03) will error on search; everything else
  (manual catalogue seeding, the review/tagging pipeline) still works.

Check `GET /health` to see which mode you're in:

```bash
uvicorn app.main:app --reload --port 8000
curl http://localhost:8000/health
# {"status":"ok","firebase_configured":false,"openai_configured":false}
```

Then seed the placeholder catalogue (agent-context/CLAUDE.md §10 — test
fixtures only, never real moderated content):

```bash
python -m scripts.seed_catalogue
```

...and create a staff account so you can log into the moderator/admin console
(no public signup for staff — see app/models/staff.py):

```bash
python -m scripts.create_staff moderator@example.com yourpassword123 moderator
python -m scripts.create_staff admin@example.com yourpassword123 admin
```

Interactive API docs: http://localhost:8000/docs

## Running against real Firebase / OpenAI / Google Books / YouTube

1. Firebase: create a project, enable Firestore + Authentication
   (email/password provider), download a service-account JSON, put it at
   `./secrets/firebase-admin.json` (or wherever `FIREBASE_ADMIN_CREDENTIALS_PATH`
   points), and fill in the `FIREBASE_*` client-config vars in `.env`. Deploy
   `firestore.rules` (`firebase deploy --only firestore:rules`) — read that
   file's header comment first, it explains why these rules are defense-in-
   depth rather than the primary access control in this architecture.
2. OpenAI: set `OPENAI_API_KEY` in `.env`.
3. Google Books / YouTube: set `GOOGLE_BOOKS_API_KEY` / `YOUTUBE_DATA_API_KEY`
   in `.env` (both from Google Cloud Console — enable "Books API" / "YouTube
   Data API v3" on a project, then create + restrict an API key).

No code changes needed for any of these — `app/core/config.py`'s
`firebase_configured` / `openai_configured` properties (and the presence of
the Books/YouTube keys) flip automatically once credentials are present.

## Tests

```bash
python -m pytest tests/ -v
```

Forces local-dev-store + mock-NLP mode regardless of what's in `.env` (see
`tests/conftest.py`) — deterministic, free, no network calls. 59 tests across
auth, child profiles, the chat/recommendation loop (including CH12's video
embed URL), favourites, content overrides, the moderation pipeline, admin,
notifications, billing, analytics, safety settings, email verification, and
privacy settings — a starting point for Tan Kian Hong's testing work
(`docs/05-testing/`), not a replacement for it.

## What's implemented

- **Unregistered Visitor**: UV05 (signup), UV06 (email verification — see
  Known Gaps for why it's a returned token, not a real email). UV01-04/07 are
  frontend-only (marketing page, PWA manifest) — no backend routes needed.
- **Parent/Guardian**: PA01-10 (auth, account, child profile CRUD + PIN),
  PA12/13 (activity, reading level), PA14/15 (activity log, favourites — dual
  read access with the child, see `get_child_dual_auth`), PA16-19 (flag
  content, status, content overrides, external link), PA20/22 (in-app
  notifications + preferences, dev-session 2026-08-10 — see
  `app/models/notification.py`), PA21 (safety settings — blocked topics +
  strict age filtering, actually enforced in
  `app/services/recommendation_service.py`, not just stored), PA23-27
  (Premium billing, **simulated** — see Known Gaps), PA28 (consent, gates
  child-profile creation), PA29 (data privacy settings — was modelled but had
  no update endpoint until this pass, see `PATCH /account/privacy-settings`),
  PA30 (data deletion, simplified to immediate — see Known Gaps), PA31/32
  (activity trends + multi-child comparative insights, Premium-gated),
  PA33-35 (child-profile limit, favourites cap, switch — frontend-only for
  "switch", the rest enforced server-side).
- **Child User**: CH01/CH02 (PIN login, same endpoint — `activated` tells you
  which), CH04-CH13 (the full chat/recommendation state machine), CH15-CH18
  (favourites, feedback, alternative recommendation), CH19/CH20 (avatar).
  CH12 (Watch Embedded Video) is a YouTube iframe-embed URL, derived from the
  catalogue item's own ID at recommend-time — see `RecommendationOut.embed_url`
  / `recommendation_service._embed_url` (this README previously and wrongly
  claimed CH12 needed no backend work at all; it did — nothing before this
  pass ever sent the child client anything watchable). CH14 (View Content
  Details) is still frontend-only once a recommendation's fields are known.
- **Content Moderator**: CM01-CM13 in full — staff login, catalogue CRUD,
  Google Books/YouTube search-and-import, the review→approve/reject→tag→live
  pipeline (with automatic embedding computation once both tagging steps are
  done), flagged-content review/resolve, catalogue browse/search.
- **System Admin**: SA01-SA09 — staff login (shared with CM), user
  search/suspend/unsuspend/password-reset, system health, integration status.
  SA10/SA11 (compliance/system settings) implemented as one generic settings
  doc. SA12-14 (edit website, billing config, escalated support) **not
  implemented** — out of scope, see Known Gaps.
- **Safety**: input moderation before every message reaches the "model" (mock
  or real), retrieval restricted to `status == "live"` catalogue items only,
  age-band filtering plus PA18 parent overrides (block/approve) and PA21
  safety settings (blocked topics, strict age filtering) on every
  recommendation.

## Known gaps (flagged, not silently skipped)

- **PA23-27 (Premium billing) is simulated, not real.** No Stripe/payment
  integration — Subscribe/Cancel just flip `subscription_tier` and log a
  `BillingRecord`; Update Payment Method stores a display-only card stub
  (brand + last 4 digits) that's never charged and the real card number is
  never persisted. Good enough to demo the use case; a real payment-provider
  account is a business decision outside this pass's scope. See
  `app/models/billing.py`.
- **PA20/22 (notifications) are in-app only** — a list the parent dashboard
  polls (`GET /notifications`), not email/SMS/push. No delivery transport is
  wired into this build. See `app/models/notification.py`.
- **UV06 (email verification) doesn't send an email**, same shape as the
  existing PA03 password-reset gap below — the request endpoint returns the
  verification token directly rather than emailing it.
- **PA30 (data deletion request) is immediate, not scheduled.** The PRD's
  normal flow implies "confirm scope and timeline, then schedule" — there's
  no deferred-deletion job queue here, it just deletes right away (same
  underlying cascade as PA09).
- **SA12-14 not implemented** (edit marketing website content, billing-system
  config, escalated support tickets) — genuinely out of scope for a backend
  API; SA12 in particular belongs to the separate `website/` deliverable.
- **CH17 feedback isn't used for anything yet.** Persisted; no
  personalization/ranking logic reads it back.
- **Password reset (PA03/SA03) doesn't send email.** Returns a link/token
  directly — wiring real delivery is a Firebase-console/SMTP config task, not
  backend code.
- **YouTube search has no channel allowlist.** CLAUDE.md §5 describes the
  video source as "restricted to a curated allowlist of vetted channel/source
  IDs" — `content_source_service.py` does an open `safeSearch=strict` search
  instead. The human-review step (CM06/CM07) is still a real gate regardless.
- **No cascade delete for staff accounts** (there's no delete-staff route at
  all yet — accounts are provisioned via `scripts/create_staff.py` and are
  otherwise permanent).
- **Mock NLP is genuinely dumb** — naive keyword matching, not real language
  understanding. It's there so the *pipeline* (state machine, retrieval,
  exclusion logic, safety gating) is testable/demoable without an OpenAI key;
  don't mistake its output for a preview of real conversation quality.

## Project layout

```
app/
  main.py            FastAPI app + router registration
  core/
    config.py         Settings (env vars), firebase_configured/openai_configured flags
    firebase.py        Firebase Admin SDK + Identity Toolkit REST helpers
    security.py         PIN/password hashing, session-token issuing/verification (parent/child/staff)
    deps.py               FastAPI auth dependencies (get_current_parent/child/staff, dual-auth, role checks)
  models/            Pydantic request/response/domain models, one file per entity
  repositories/      Typed CRUD per entity, over a swappable DocumentStore
    base.py            The DocumentStore interface
    local_store.py       JSON-file-backed implementation (no Firebase needed)
    firestore_store.py    Real Firestore implementation
    store.py                Picks one of the above based on settings
  services/          Business logic: auth_service, chat_service (state machine),
                     recommendation_service (retrieval + PA18 overrides),
                     openai_service (LLM/embeddings + mocks),
                     content_source_service (Google Books/YouTube search)
  routers/           Thin HTTP layer — one file per actor-facing feature group
                     (auth, account, children, chat, favourites, parent_dashboard,
                      moderation, admin)
scripts/
  seed_catalogue.py  Loads test-fixture catalogue items (see agent-context/CLAUDE.md §10)
  create_staff.py    Bootstraps a moderator/admin account (no public signup for staff)
tests/               pytest suite — see "Tests" above
firestore.rules      Security rules (defense-in-depth — read the file's header first)
```
