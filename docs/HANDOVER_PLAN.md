# Handover of the LI Command Center to Mundo

Starts Tuesday 20 October 2026, in stages. Each stage ends with Mundo doing the thing alone while Michael watches. Move on only when the stage is done, not by date. Field work runs 19 Oct to 4 Dec, so the early stages are about running it, and the technical stages come once the team is stable.

## Stage 1: Run it (Tue 20 to Fri 23 Oct)
Goal: Mundo can run a field day without help.
- Sign in with his own HQ code. Learn the HQ desk (left sidebar) and the Today page.
- Daily check, 10 minutes (see RUNBOOK.md): Admin > Health (data connections fresh, readiness), Queries (who is waiting), Usage (who has not opened the app), Phones.
- Do the final approval step on real queries, and the "send back" step. Use the correction/edit chain once with a test case.
- Send one News post and one phone alert (finalize reminder) from Messages.
- Done when: he has handled a day's queries and sent a message alone.

## Stage 2: Administer it (week of 26 Oct)
Goal: Mundo can look after people, access and communication.
- Roster: add, replace, rename a person; re-issue a code; map a KoBo name to the right person (Admin > People & access).
- Guests: invite, extend, revoke (Admin > People & access > Guests).
- Layouts: hide a page for a group, arrange cards (Admin > Layouts, and Arrange this page).
- Emails and schedules (Admin > Messages), settings and targets (Admin > Settings).
- KoBo storage and the 5,000 submissions per 30 days (Admin > Health, Storage). Michael keeps the plan decision.
- Done when: he has added a person, invited a guest and changed a layout on his own.

## Stage 3: Back it up (week of 2 Nov)
Goal: Mundo can protect and recover the system.
- Nightly backups are stored in Cloudflare and encrypted. A full copy is emailed on Monday.
- Learn to download a backup and open it with `tools/decrypt_backup.mjs`. The passphrase is in the restricted staff folder (BACKUP_PASSPHRASE.txt) and must also go into the LearnImpact password manager.
- Do one practice restore on a copy (never on the live system without Michael).
- Once a month, save a downloaded backup to LearnImpact's own storage as an off-site copy.
- Done when: he has opened a backup file and explained what is in it.

## Stage 4: Maintain it (after the field work, from 7 Dec)
Goal: Mundo can fix and deploy.
- Accounts needed (see ACCESS_AND_SECRETS.md): GitHub (learnimpacttz), Cloudflare (LearnImpact), KoBo token, email (Resend).
- Set up the code: clone the repo, `npm install`, run `sh test/run_all.sh` (all tests must pass), run `python3 test/live_access_check.py`.
- Read ARCHITECTURE.md. Make one small change, run the tests, `npx wrangler whoami` (must be the LearnImpact account), then `npx wrangler deploy`.
- Rule: no deploy during field hours (07:00 to 17:00 EAT) unless it fixes a live problem.
- Done when: he has shipped one small change with the tests passing.

## Stage 5: Own it (2027)
- Michael steps back to approvals only. Mundo decides changes, schedules releases and owns the secrets list.
- Review the audit (SYSTEM_AUDIT_2026-10-17.md) and the open recommendations each quarter.

## What stays with Michael
The KoBo plan decision, outside partners and guests' approval, ownership and any plans to extend the system to other programs.
