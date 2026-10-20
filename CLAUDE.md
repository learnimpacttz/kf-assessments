# LearnImpact Command Center: rules for anyone working on this code (people and AI assistants)

This is the live system the field teams use during KiuFunza 4 Endline (19 Oct to 4 Dec 2026). Treat every change as if the field teams will use it in the next hour.

## What this is
A Cloudflare Worker (`src/index.js`) that serves a single-page app (`public/app.js`, `public/style.css`) and a JSON API, with one Durable Object (`src/store.js`) holding all state. KoBo is the source of records. Read `docs/ARCHITECTURE.md` first and `docs/RUNBOOK.md` for operations.

## Always
1. **Run the tests before any change is released:** `npm test`. All suites must pass.
2. **Check the account before any deploy:** `npx wrangler whoami` must show the LearnImpact account. Never deploy under a personal account.
3. **No deploys during field hours** (07:00 to 17:00 East Africa Time) unless the change fixes a live problem. Prefer early morning or evening.
4. **After a deploy:** run `npm run check:live` (needs `KF_HQ_CODE` set; it must report 0 open gates), open the app as an HQ user and as a field user, and look at Admin, Health.
5. **Keep changes small** and explain each one in plain words in the commit message.
6. **Update the documents** (user guide, manual, quick start, in-app Help) when users can see the change, and keep the change log.
7. **American spelling** in everything users see and in documents.
8. **Review the diff yourself** before accepting any AI-written change. Read what changed, not only the summary.

## Data that is built up from KoBo must be safe to read twice
Anything added to the stored aggregates (`src/ingest.js`, `src/sync.js`, `src/summary.js`) has to give the same answer after a rebuild, and must not invent a repeat when a record is read more than once. Counts are reset by a rebuild (`clearForRebuild`) and normal syncs read each record once (watermark); lists are written once per record id. On 20 Oct 2026 a Students rebuild left the pupil-number list in place and re-added to it, which produced about 200 false "pupil tested twice" queries. So: add to a list only once per KoBo record id (`addRn`), clear only what a form wrote (`clearForRebuild`), read lists through `uniqueRn`, and keep `test/rebuild_integrity_test.mjs` passing. If the Bridge warns "Repeated records were ignored", tell the systems owner.

## Never
- Never print, paste, commit or send a secret (access codes, tokens, keys, passphrases). Secrets live in Cloudflare and in the vault. If one is exposed, tell the systems owner at once.
- Never change `AUTH_SALT`. Every staff, HQ and guest code is derived from it, so changing it stops everyone's sign-in.
- Never delete or edit real records outside the query chain. Originals are saved first, and nothing is deleted without the chain (suggest, first HQ review, final approval).
- Never edit records in the KoBo web editor.
- Never remove a safety check on sign-in, access levels or the Advisor settings without the Executive Director's agreement.
- Never put staff names, personal emails, bank details or pupil names into code, tests or documents in this repository.
- Never add a dependency without a reason and without running the tests.

## Where things are
- `src/index.js` routes and scheduled jobs · `src/auth.js` sign-in · `src/hq.js` HQ people, levels, desks, Advisor access · `src/queries.js` the review chain · `src/summary.js` and `src/ingest.js` checks and aggregates · `src/predict.js` forecast · `src/bridge.js` HQ Bridge.
- `public/app.js` the whole app (one large file) · `public/style.css` · `public/sw.js` service worker.
- `test/` one file per area; `test/run_all.mjs` runs them all.
- `tools/` backup decryption and document publishing helpers.

## Before touching these areas, ask the systems owner
Sign-in and access levels, the query review chain, deletion and correction of records, payments, backups, scheduled emails and phone alerts, anything that sends a message to field staff.

## Useful commands
- `npm install` once, to get the tools. `npm test` all tests. `npm run check:live` live access check.
- `npx wrangler whoami` which account · `npx wrangler deployments list` recent deploys · `npx wrangler rollback` go back to the previous deploy · `npx wrangler tail` live logs (stop with Ctrl+C) · `npx wrangler secret list` secret names only.
