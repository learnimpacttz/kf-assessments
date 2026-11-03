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

## Deploying
Use `npm run deploy`. It checks that wrangler is logged in as the LearnImpact account (the login can drift to a personal account), runs all tests, refuses field hours (07:00 to 17:00 EAT, unless `sh tools/deploy.sh --live-fix`), then deploys. After it: `npm run check:live`, open Admin, Health, look at the logs. If it says the account is wrong: `npx wrangler logout`, `npx wrangler login --browser=false`, open the link in a private window and sign in as the LearnImpact account.

## Coverage (every school visit has an RC or ARC)
- Rules: every school visit has an RC or ARC present, or a named acting coordinator from the team's volunteers; when both coordinators are at one school the RC leads; the same person may visit several schools in a day only at different times (at least an hour apart).
- The system checks every working day's plan. A clear day asks nobody anything. For an unclear day the coordinators are alerted (14:30, 16:30 and 07:05) and confirm under Confirm days (HQ: Coverage) by 18:00 the day before. One person, team or coordinator never runs three schools in a day. The Bridge lists days nobody confirmed and schools with no coordinator named.
- Leave: a coordinator reports their own; HQ records or approves anyone's (write the name and date of the approving email in "Approved by"). Never write medical details.
- Days gone: one item per day per region where the plan and the records differ. The region answers within 2 working days (records are right, leave, or something else with a note, and who acted at any school with no coordinator). Approved leave on record plus a named acting coordinator closes the item by itself. Any other answer goes to Joram, then to Mundo (a different person); either can send it back with a reason. The Queries page and the Bridge show what is waiting.
- If an alert does not reach someone, check Admin, Health (alert devices) and ask them to turn alerts on.

## QA visits (HQ observers' Quality Assurance form)
- The page is Checks, QA visits. The Command Center reads the form every minute (Admin, Health does not list it; the page shows "Last read" and any error). If new visits do not appear, press Read new visits now. An error such as "KoBo 401" means the token needs replacing (see ACCESS_AND_SECRETS, "The KoBo token").
- Phone alert: when a new QA visit has a serious item answered No, the HQ team (not Advisors) with alerts on get one alert, sent once per visit. The first run after a release only notes the visits already there. Practice visits never alert.
- Practice visits: a comment that starts with TEST is shown as Practice and never counted or sent.
- A finding reaches a team only when an HQ Editor or Admin presses Send to team as query. It then follows the normal query chain.
- If the form changes (new questions), the page picks up the new wording within 6 hours, or at once after Read new visits now. Questions named `rand_p1` to `rand_p4` (pupil numbers) and `follow_up` are read by name; do not rename them.

## Rules
- Real data is never deleted outside the chain. Originals are saved before any change.
- Do not share the shared HQ code or the access-code list.
- Deploys: only after `npx wrangler whoami` shows the LearnImpact account; never during field hours unless fixing a live problem.
