# Architecture in one page

**What it is:** a Cloudflare Worker (`src/index.js`) that serves a single-page app (`public/app.js`, `public/style.css`, `public/index.html`) and a JSON API. One Durable Object (`src/store.js`, class `Store`) holds all state. A cron runs every minute (`wrangler.toml`).

**Data flow:** KoBo forms (Students, Sampling, Teachers) -> `src/sync.js` reads one page per minute by record id -> `src/ingest.js` folds records into anonymous per-day aggregates (no pupil names, no GPS) -> `src/summary.js` computes everything shown (progress, checks, flags) -> API -> app. Raw records are never stored here except the saved originals before a correction or deletion.

**Who sees what:** `src/auth.js` turns an access code into a person (staff code, HQ code, or guest code). Every API route checks the role in `src/index.js`. Guests are limited to public endpoints. Never trust the screen to hide data: the server decides.

## Main modules
| Area | Files |
|---|---|
| Field rules, school list, roster | `config.js`, `roster.js`, `src/data/` |
| Plans, notices, calendar file | `plan.js`, `calendar.js`, `pilot.js` |
| Checks and flags | `summary.js` (analyseDay: phone checks), `assign.js` (assigned vs who did the work) |
| Queries and approval chain | `queries.js` |
| Deleting, editing, moving records | `deletions.js`, `edits.js`, `corrections.js` |
| Reports and narratives | `reports.js`, `narratives.js` |
| People and access | `hq.js`, `guests.js`, `auth.js`, `layouts.js`, `ratelimit.js` |
| Messages | `messages.js`, `news.js`, `push.js`, `digest.js` |
| Forecast and brief | `predict.js`, `brief.js` |
| Usage analytics | `usage.js` |
| Backups | `backup.js` (nightly, encrypted) |
| KoBo form tools | `koboforms.js`, `formjob.js`, `formsadmin.js` |

## Storage keys (all start with `v2:`)
`queries`, `plan:<REGION>`, `roster`, `pilot`, `narr`, `layouts`, `guests`, `hq`, `settings`, `news`, `delreq`, `delog`, `corrections`, `approvededits`, `usage:users`, `usage:daily`, `push:subs`, `state:<year>` (aggregates), `sum:<year>` (computed summary), `rebuild` (queue of years to rebuild). Backups carry all of these except the push subscriptions and computed summaries (these rebuild themselves).

## Coordinator coverage (every school visit has an RC or ARC)
`src/cover.js` holds the rules and the stores: `v2:cover:assign` (who is the coordinator at each school on each day, with acting volunteers), `v2:cover:conf` (each coordinator's confirmation or away for a day), `v2:cover:leave` (leave records, approved by HQ; no medical detail), `v2:cover:rows` (the region's answer for a past day where the plan and the records differ, its stage open, rework, first review, final or closed, due date and history; it closes by itself when the region confirms the records are right and every school had a coordinator in the records, or when approved leave is on record plus a named acting coordinator; otherwise the first reviewer (review level 2, not the final approver) then the final approver (level 3, a different person) confirm), `v2:cover:alerted` (so an alert is sent once). `regionDay` compares the plan with the assignments, leave and the records (`sum.schools[id].dayAdmins`): no coordinator named, coordinator on leave, the same person at two schools starting within an hour of each other, RC not leading when both are in the team, and past days with no RC or ARC in the records or the named lead absent. `runCover` (cron, UTC 11:30, 13:30 and 04:05 = 14:30, 16:30 and 07:05 EAT, working days only) sends one phone alert per coordinator, only when the next working day's plan is unclear (a `clear` day asks nobody anything), through `pushTo`, and one alert per region when past days need an answer. `coverAttention` feeds the Bridge. Routes: `GET /api/cover` (volunteer: where they act; coordinator: own region; HQ: all or `?region=`), `POST /api/cover/assign|confirm|leave|row`. Editors and Admins (not Advisors) write for anyone; a coordinator writes for their own region and confirms only for themselves. `changeVisit` in `src/plan.js` now refuses a move that puts the same person at two schools starting within an hour of each other and enforces that the RC leads when both coordinators are in a team and that no person, team or coordinator is at or leads three schools in one day. It reads results only through the summary and changes no record.

## QA visits (HQ observers' quality-assurance form)
The observers' checklist is its own KoBo project (`KOBO_ASSET_QA` in `wrangler.toml`; the form link shown in the app is `QA_FORM_URL`). It belongs to the same KoBo account as the KiuFunza projects, so the Worker's existing KoBo token reads it and no new secret exists. `src/qa.js` reads all its records every 4 minutes from the cron (and on demand from the page), keeps one compact row per KoBo record id under `v2:qa:visits` (safe to read twice), and keeps the question wording and name lists under `v2:qa:form`. Only the distance of the QA form from the school is kept, never the location. At view time each visit is scored (Yes over answered items, Not applicable left out; the serious items are the `CRITICAL` set, proposed and awaiting approval) and compared with the plan, the school location, the day's tests and sampling, and the attendance entered by the team. `/api/qa` and `/api/qa/refresh` are for the HQ team only (same guard as Team patterns, not Advisors). It reads KoBo only; it never writes to KoBo, queries or payments. A new visit with a serious item answered No sends one phone alert to the HQ team (not Advisors) through `pushTo`; `v2:qa:alerted` remembers which visits were alerted, so a visit never alerts twice and the first run after a release alerts nothing.

## Team patterns: answers and phones
`src/answers.js` turns each test record into counts (blocks asked, blocks mixed) at ingest (`c.ap` per cell, plus up to 4 exemplar record ids in `c.ex.ap`). No answers and no pupil details are stored. `summarize` compares each person's mixed blocks with the other testers at the same school and grade and builds a per-person phone profile (pilot day excluded). Both go into `sum.extra`, kept apart from `sum.admins` and `sum.days` so field staff never receive them; only `src/patterns.js` (HQ only) reads `sum.extra`. Records read before this was added carry no counts until the Students data is rebuilt (needs the Executive Director's or systems owner's approval; see the rebuild rules in CLAUDE.md). The rule for the answers signal (at least 30 full tests, mixed blocks at 65% or less of the comparison, no-mixed tests at 40% or more, z of -4 or lower) was calibrated on the 2025 season; change it only with `test/answers_test.mjs` passing.

## Tests
`sh test/run_all.sh` bundles and runs every `test/*_test.mjs`. `python3 test/live_access_check.py` checks the live system's access gates. `test/harness.mjs` runs the real Worker locally on port 8788 with synthetic data.

## Known limits
- app.js is one large file (about 2,500 lines): split it by page when time allows.
- Single Durable Object: fine for this scale; a second program should get its own.
- KoBo is the only source of truth for submissions; its plan limits apply.
