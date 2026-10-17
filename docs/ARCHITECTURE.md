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

## Tests
`sh test/run_all.sh` bundles and runs every `test/*_test.mjs`. `python3 test/live_access_check.py` checks the live system's access gates. `test/harness.mjs` runs the real Worker locally on port 8788 with synthetic data.

## Known limits
- app.js is one large file (about 2,500 lines): split it by page when time allows.
- Single Durable Object: fine for this scale; a second program should get its own.
- KoBo is the only source of truth for submissions; its plan limits apply.
