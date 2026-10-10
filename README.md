# KiuFunza 4 Field Command Centre

Role-based, mobile-first dashboard for the KF4 endline (19 Oct - 4 Dec 2026): progress, checks on every test, field plan and notice tracker, forecasts, daily emails and phone alerts. Cloudflare Worker + one Durable Object for state; static pages in `public/`.

- `src/config.js` field rules (targets, notice days, school list, roster) · `src/data/` school list and staff roster (names only, no contact details)
- `src/ingest.js` KoBo submissions to anonymous aggregates (never pupil names, GPS, or test items) · `src/summary.js` checks and flags
- `src/sync.js` incremental KoBo reads (student, sampling, teacher forms) · `src/store.js` strongly consistent storage
- `src/plan.js` whole-field plan, changes with reasons, notices · `src/predict.js` forecast · `src/brief.js`, `src/digest.js` briefings and emails · `src/push.js` phone alerts
- `test/` local rehearsal harness with synthetic data (`test/harness.mjs`), push signing test

Secrets (set with `npx wrangler secret put NAME`, never in the repo): `KOBO_TOKEN`, `HQ_SECRET`, `AUTH_SALT`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `VAPID_PRIVATE_JWK`.
Do not use Workers KV for running totals: it is eventually consistent and double-counted pages. State lives in the `STORE` Durable Object.
Deploy only after `npx wrangler whoami` shows the LearnImpact account.

## Calendar file and form replacement (added 10 Oct 2026)
- `src/calendar.js`: builds ref_calendar.csv from submitted plans and, when HQ switches it on in Admin, replaces it in the Students and Sampling KoBo projects about 5 minutes after a plan is submitted or changed (needs min regions submitted; keeps the last good copy).
- `src/formjob.js`: one-time scheduled replacement of the Sampling form with the embedded standard form (`src/data/sampling_standard.js`) on 2026-10-16 06:00 EAT, with checks before and after and an HQ email. Admin can cancel or run it.
- `src/koboforms.js`: KoBo import / deploy / media / inspect helper; only the three KiuFunza projects and ZZ_TEST copies; never touches submissions.
