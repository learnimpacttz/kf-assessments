# Accounts, access and secrets (no values here)

## Accounts
| What | Where | Who has it now |
|---|---|---|
| Cloudflare (the Worker, Durable Object, KV) | LearnImpact account (mkamukulu@learnimpact.org) | Michael |
| Code | GitHub, organization learnimpacttz, repo kf-assessments | Michael |
| KoBo projects (Students, Sampling, Teachers) | kf.kobotoolbox.org | Michael |
| Email sending | Resend (domain apshot.michaelkamukulu.com for now) | Michael |
| AI assistant | Anthropic API key | Michael |

Mundo needs: a Cloudflare member invite (Workers and Durable Objects access), GitHub write access, a KoBo user with access to the three projects, and his own HQ code (level Admin, review level 3, already in the HQ list).

## Secrets (set with `npx wrangler secret put NAME`; never in the repo)
`KOBO_TOKEN`, `HQ_SECRET` (shared HQ code), `AUTH_SALT` (derives every staff and guest code: changing it invalidates all codes), `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `VAPID_PRIVATE_JWK` (phone alerts), `BACKUP_PASSPHRASE` (encrypts backups).
Where values live: a LearnImpact password manager (to be set up) and the restricted staff folder (HQ_ACCESS_CODE.txt, BACKUP_PASSPHRASE.txt).

## The KoBo token (one token, four projects)
One KoBo account holds the three KiuFunza projects and the QA project, and `KOBO_TOKEN` reads all four. A token that was ever sent by email or chat counts as exposed. Replace it like this, in one sitting, so the Command Center is never without a working token:
1. Someone signed in to the KoBo account opens Account settings, Security, and creates or shows a new API token (the old one stops working when KoBo replaces it, so do step 2 straight away).
2. In the repo folder, run `npx wrangler whoami` (must show LearnImpact), then `npx wrangler secret put KOBO_TOKEN` and paste the new value when asked. Never type it into a file, a chat or an email.
3. Wait one minute, then open Admin, Health: all data connections should be fresh. Open QA visits and press Read new visits now: it should show a recent read time and no error.
4. Store the new value in the password manager and delete any other copy.
Do it outside the field day (before 07:00 or after 17:00 EAT). The QA form's own link does not use this token.

## Rotation after the field work (by 11 Dec 2026)
1. HQ_SECRET and the two assistant codes. 2. KOBO_TOKEN (create a new one in KoBo, then `wrangler secret put`). 3. BACKUP_PASSPHRASE only together with a new full backup, and keep the old passphrase for old backups. Do not change AUTH_SALT during field work.

## Safe practice
- Never paste a secret into chat, email or a ticket. Use the password manager.
- `npx wrangler whoami` before every deploy: it must show the LearnImpact account.
- Remove a person's access the day they leave: Cloudflare, GitHub, KoBo, then their Command Center code.
