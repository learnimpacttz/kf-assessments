# Runbook: running the Command Center day to day

## Every field morning (about 10 minutes, before 08:00 EAT)
1. Admin > Health: are the three data connections fresh (minutes, not hours)? Any red items in readiness?
2. Today page: queries waiting for you, regions without a plan, serious checks.
3. Queries: anything waiting for review (first HQ review is Joram, final approval is Mundo).
4. Usage: staff who have not opened the app today or have alerts off.
5. Phones: any "look at this" phone checks for yesterday.

## Talking to people (inside the Command Center)
- **Message a person, team or school:** open their detail view (click a name or school) > Send a message. They get a phone alert and see it under News; "Got it" shows you who has read it. Sent messages are listed in Messages > Log.
- **Questions from the field:** the Questions page (HQ) and Ask a question (field). Volunteers ask their coordinator first; unanswered or escalated ones reach HQ. Answering sends the asker an alert. Aim to answer within one working day.
- **HQ-only notes:** every person, school, region, query and data-cleaning request has private HQ notes. Tag a colleague to alert them. Field staff never see notes.

## Every evening
- End-of-day check email arrives automatically. Chase schools started but not complete.

## Every week
- Monday: the weekly full backup email arrives (encrypted). Save it to LearnImpact storage monthly.
- Review the Usage page and the finish-date range chart (HQ page). Ask RCs of slow regions what they need.
- Check KoBo submissions used this period (Admin > Health > Storage) against the 5,000 limit.

## When something goes wrong
| Problem | What to do |
|---|---|
| Numbers stopped moving | Admin > Health: is a connection stale? Press "Sync now". If still stale, check the KoBo token and KoBo status. |
| A person cannot sign in | Admin > People & access: re-issue their code and send it. Too many wrong codes pause that network for 15 minutes. |
| A record is under the wrong school/grade/tester | Data cleaning > Edit records. Never edit in KoBo's web editor. |
| A duplicate or test record | Data cleaning > Delete records (chain: suggest, Joram, Mundo). |
| Someone lost their phone | Re-issue the code; the old one stops working. |
| A guest should lose access | Admin > People & access > Guests > Revoke. |
| Queries were raised in error and people already replied | Admin only: `GET /api/admin/queries-withdraw` is a dry run (lists what it would do); `POST` with `{"apply":true}` moves the queries to a `withdrawn|` record with who, when and why, saves a full copy first (`v2:queries:backup:<time>`) and adds a note to replies on real checks. Nothing is deleted. `?list=1` shows the withdrawn replies. Used on 20 Oct 2026 (25 withdrawn, 9 noted). |
| Many "pupil tested twice" queries that KoBo does not confirm | Check KoBo first (Admin > the records for that school and grade). If KoBo has no repeats, the stored pupil-number list is doubled. The dashboard now ignores repeated records and shows "Repeated records were ignored" on the Bridge. Run one Students rebuild (Admin > rebuild, students, 2026) to clear the stored repeats, then check that the warning is gone. |
| The dashboard looks wrong after a correction | Corrections rebuild only the affected forms and years: wait a few minutes. Admin > Health shows it syncing. |
| An alert or email was sent by mistake | Say so in News straight away. Alerts cannot be recalled. |

## Rules
- Real data is never deleted outside the chain. Originals are saved before any change.
- Do not share the shared HQ code or the access-code list.
- Deploys: only after `npx wrangler whoami` shows the LearnImpact account; never during field hours unless fixing a live problem.
