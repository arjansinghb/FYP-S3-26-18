# FYP-26-S3-18 — Chatbot App for Book and Video Recommendations for Kids

CSIT321 Final Year Project (UOW / SIM), Session 3, 2026.
Project ID: **CSIT-26-S3-18**

## Project Description

A chatbot application that helps **parents and kids discover age-appropriate
books and videos** through natural, conversational interaction — rather than
static browsing/search.

How it works (per our PRD draft, `docs/01-requirements/FYP-26-S3-18_PRD.docx`):
a parent creates an account, sets up one or more linked **child profiles**
each assigned an age band (**5–8** or **9–12**), and the child talks to the
chatbot directly, describing what they're in the mood for. The system asks
clarifying follow-ups where useful, then returns a small set of
recommendations pulled from a **pre-vetted, curated content database**
(never open/unfiltered sources), each with a short, age-appropriate,
plain-language explanation of *why* it was recommended. Parents get a
dashboard to review chat/recommendation history, flag content, and adjust
settings — any link that leaves the app's controlled environment is a
parent-facing action, never exposed directly to the child.

The core gap this fills: existing tools force a tradeoff between a **safe**
experience and a **personalized** one (curated libraries with no real
personalization vs. engagement-optimized algorithms with little safety
visibility). Comparison set from our research: Epic!, YouTube Kids, Common
Sense Media, and others — see `docs/02-research/`.

Required key features:

- **NLP** to understand child queries and hold a clarifying dialogue.
- A **curated content database** of books and videos, pre-screened for
  age-appropriateness (not pulled live from unfiltered sources).
- A **recommendation engine** combining NLP output + profile/age-band with
  the database, producing explained, personalized recommendations.
- **Parent dashboard**: linked child profiles, activity/recommendation
  history, content flagging, age-band settings.
- Target platforms: mobile **and** web.
- Out of scope (this phase): full multi-language support, in-app purchases
  beyond subscription, image-recognition features.

## Team

| Name | Role |
|---|---|
| Arjan Singh Bhasin | Project Manager |
| Desmond Won Thiang Feng | Technical Writing |
| Lee Jihyeon | Research |
| Kiefer Russell Sulijanto | Programming |
| Tan Kian Hong | Testing |

(Roles per `docs/00-project-charter/Project-Roles.xlsx` — everyone still
contributes across research/code/docs/testing per FYP requirements; these
are lead/owner assignments, not exclusive lanes.)

Group ID: `FYP-26-S3-18` — use this to prefix all deliverables sent to the
supervisor/assessor, e.g. `FYP-26-S3-18-PRD.pdf`.

Supervisor: **Terence Chew** (referenced in meeting minutes — please confirm
and update this line).
Assessor: _TBD — confirm and fill in_.

## Repo Structure

```
docs/
  00-project-charter/     Project brief, team info, roles, supervisor/assessor contact
  01-requirements/        Project Requirement Documentation (PRD) + early drafts
  02-research/            Consolidated + per-person research, business model, use cases
  03-design/              SRS, Technical Design Manual (TDM), wireframes, architecture
  04-user-manual/         Preliminary + final user manuals
  05-testing/             Test plans, test cases, test logs
  06-presentations/       Slides for each assessed milestone
  07-project-management/  WBS, To-Do list, meeting minutes, peer assessment forms
  _reference/             Supervisor-provided material: subject outline, lecture
                          slides, topic list, sample PRD/URS/TDM/diary/peer-assessment
                          docs, and other groups' example PRDs. Reference only — not
                          our own deliverables, don't edit in place.
src/                      Source code (frontend, backend — stack TBD, see src/README.md)
website/                  Marketing website for the project (required deliverable)
```

## Assessment Timeline (Session 1, this session)

| Deliverable | Weight | Due |
|---|---|---|
| Project Requirements Documentation (PRD) | 10% | Week 5 — **2 Aug 2026** |
| Project Progress Report (Preliminary Technical Doc + User Manual + slides) | 15% | Week 10 — **12 Sept 2026** |
| Project Progress Presentation (prototype demo, ~20 min) | 10% | Week 11 — **19 Sept 2026** |
| Final Product & Documentation (source code, final tech doc, user manual, peer assessment, video, slides) | 45% | Week 19 — **14 Nov 2026** |
| Reflective diary (weekly, individual) | 5% | Ongoing, final submission **14 Nov 2026** |
| Final Presentation (~30 min) | 15% | Week 20 — **21 Nov 2026** |
| Final online submission to SIM | — | **25 Nov 2026** |

Session 2 (design/build/integration/testing) continues after Session 1
Assessment through **21 Nov 2026**.

## Working Conventions

- All deliverables and documents are named with the Group ID prefix:
  `FYP-26-S3-18-<DocName>`.
- Reflective diaries are **individual**, submitted separately by each
  person to Moodle, and must be updated **weekly** — they are not a team
  deliverable and don't belong in this shared repo. Each teammate keeps
  their own diary locally on their own machine.
- Meeting agendas/minutes (group + supervisor meetings) go in
  `docs/07-project-management/meeting-minutes/`.
- This repository is now the single source of truth for research,
  documentation, and code — nothing new should be added to Google Drive.
- `docs/_reference/` holds supervisor-provided templates and examples only;
  our actual submissions live in the numbered `docs/` folders alongside it.
