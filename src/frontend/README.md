# Frontend — React

Three separate app trees in one Vite/React Router SPA, per
`agent-context/CLAUDE.md` §2.2/§9's "distinct surfaces" rule:

- **`/chat`** — the child chat UI (CH01-CH20). Playful, avatar-first, no
  search-box affordance.
- **`/`, `/signup`, `/login`, `/dashboard/...`, `/account`** — parent-facing
  marketing site + dashboard (UV01-06, PA01-19/28/30). Plain, utilitarian.
- **`/staff/login`, `/moderation/...`, `/admin/...`** — Content Moderator +
  System Admin console (CM01-13, SA01-09). Same utilitarian look as the
  parent dashboard — staff-facing, not subject to the "not a search engine"
  rule (that's specifically about the child surface).

## Setup

```bash
cd src/frontend
npm install
cp .env.example .env.local   # only needed if your backend isn't at localhost:8000
npm run dev                  # http://localhost:3000
```

Run `src/backend` alongside it (see `src/backend/README.md`) — the dev server
is pre-configured to port 3000 to match the backend's default `CORS_ORIGIN`.
Seed the catalogue (`python -m scripts.seed_catalogue`) and create a staff
account (`python -m scripts.create_staff ...`) in `src/backend` first.

## Trying it out

**As a parent**: go to http://localhost:3000, "Sign up free", fill the form,
agree to consent, then "+ Add Child Profile" — no curl needed anymore, this
is all real UI now.

**As a child**: from the parent dashboard, note the child's Profile ID (or
just use the PIN you set) — on `/chat`, tap "New device?", enter the Profile
ID + PIN.

**As staff**: `/staff/login` with whatever you passed to
`scripts/create_staff.py`. Moderators land on the review queue; admins get
extra nav links to the user/system screens.

## Design rules this follows (agent-context/CLAUDE.md §2.1/§9)

- Child surface: no search box anywhere — the only text input is the chat
  message field. Avatar is prominent (chat header + every bot bubble), not a
  small icon. Recommendations render as cards *inside* the conversation, max
  a handful per turn, each with its own reason. One clarifying question at a
  time, driven entirely by the backend's dialogue state machine
  (`src/backend/app/services/chat_service.py`) — the frontend just renders
  whatever comes back turn by turn.
- Parent/staff surfaces: deliberately the opposite visual language (neutral,
  card/table-based) — see `index.css`'s "Parent-facing UI" section.

## What's not built (flagged, not silently skipped)

- **Real device-linking flow for CH01.** The PRD's actual flow ("Enter Linking
  Code to Activate Profile") implies a device already knows which profiles are
  linked to it. This build's `LoginScreen` remembers profiles locally
  (localStorage, `src/state/linkedProfiles.ts`) after their first login on a
  given browser, which mimics the real UX reasonably well, but a brand-new
  device still needs the parent to hand over the raw Profile ID once — a real
  "share a linking code" flow isn't built.
- **Voice input (CH06's "voice" option)** uses the browser's
  `webkitSpeechRecognition` where available (Chrome-family only) — no
  fallback/polyfill for other browsers.
- **Resuming an in-progress chat session** — every ChatScreen mount starts a
  fresh session (CH04); refreshing mid-conversation starts over rather than
  resuming, even though the backend *can* return history via
  `GET /sessions/{id}/messages`.
- **Billing/subscription UI** (PA20-27) — no screens for this; matches the
  backend not implementing it either (see `src/backend/README.md`).
- **Premium insights/multi-child comparison** (PA31-35) — same, backend
  doesn't have it yet either.
- **react-router-dom's one remaining `npm audit` advisory** (GHSA-qwww-vcr4-c8h2,
  "RSC Mode CSRF Bypass") — doesn't apply to this app (no React Server
  Components/data-router server actions in use, just client-side
  `<BrowserRouter>`), evaluated and accepted rather than silently ignored.

## PWA (UV07 — Install the Application)

`public/manifest.json` + `public/sw.js` (minimal — caches only the app shell,
everything else including all API calls goes straight to network) +
placeholder icons (`public/icon-*.png`, generated, not real brand art — swap
before shipping). `start_url` is `/chat`, on the assumption that the
installed icon is primarily for the child's daily use — worth revisiting once
the team has an opinion on whether parents should get their own install
target too.

## Project layout

```
src/
  App.tsx                 Top-level router — three trees, see header above
  ChildApp.tsx             Child app root (login -> avatar -> chat)
  types.ts                TS types mirroring backend response shapes
  avatars.ts               Placeholder emoji avatar set (CH19) — swap for real art later
  api/
    http.ts                  Shared fetch wrapper (ApiError, base request())
    client.ts                 Child-facing calls
    parentClient.ts            Parent-facing calls
    moderatorClient.ts          Content Moderator calls
    adminClient.ts               System Admin calls
  state/
    useChildSession.ts        Persists child token/profile (localStorage)
    useParentSession.ts        Persists parent token/profile
    useStaffSession.ts          Persists staff token/profile
    linkedProfiles.ts          Tracks which child profiles have logged in on this device
  components/              Child chat UI (LoginScreen, AvatarPicker, ChatScreen, ChatBubble, RecommendationCard)
  parent/                  Parent marketing site + dashboard (LandingPage, Signup/LoginPage,
                           ConsentPage, DashboardHome, ChildDetailPage, AccountPage, RequireParentAuth)
  staff/                   Moderator + admin console (StaffLoginPage, ReviewQueuePage,
                           SearchImportPage, CataloguePage, FlaggedContentPage,
                           AdminUsersPage, AdminSystemPage, RequireStaffAuth)
```
