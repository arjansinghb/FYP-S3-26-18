# Frontend: Pip web app (React + Vite)

One React app that contains the child chat, the parent dashboard, and the moderator and admin
consoles, delivered as an installable PWA (`public/manifest.webmanifest`, `public/sw.js`).

## Run it

```bash
cd src/frontend
npm install
npm run dev          # http://localhost:5173
```

It expects the backend at `http://localhost:8000` (see `../backend/README.md`). To use another address,
create `.env.local`:

```
VITE_API_BASE=http://localhost:8010
```

| Variable | Purpose |
|---|---|
| `VITE_API_BASE` | Backend address (default `http://localhost:8000`). |
| `VITE_HIDE_DEMO_LOGINS` | Set to `true` to hide the demo moderator and admin sign-ins on the login screen. |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Lint with Oxlint |

## Routes

| Path | Who | What |
|---|---|---|
| `/` | Visitors | Landing page, plans and reviews (this is the project's public website) |
| `/parent` | Parents, moderators, admins | Sign up and sign in for every role, then the parent dashboard |
| `/child` | Children | PIN sign-in and the chat with Pip, Browse and My Library |
| `/moderator` | Moderators | Submissions, catalogue, AI audit, reports, search and import |
| `/admin` | Admins | System health, users, reviews, settings, support |

## Source layout

```
src/
  pages/        One file per area (ParentDashboard, ChildChat, ModeratorDashboard, AdminDashboard,
                Home, ChildLogin) and their stylesheets
  components/   Shared pieces: Avatar, recommendation cards, dialogs, level badge, select, toast
  api.js        Every call to the backend, in one place
  index.css     Design tokens and base styles
```

## Deployment

Deployed to Vercel as a separate project. `vercel.json` rewrites every path to `index.html`, so deep
links such as `/parent/child` work on refresh.
