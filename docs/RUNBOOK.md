# Runbook: running the Command Center day to day

## Every field morning (about 10 minutes, before 08:00 EAT)
1. Admin > Health: are the three data connections fresh (minutes, not hours)? Any red items in readiness?
2. Today page: queries waiting for you, regions without a plan, serious checks.
3. Queries: anything waiting for review (first HQ review is Joram, final approval is Mundo).
4. Usage: staff who have not opened the app today or have alerts off.
5. Phones: any "look at this" phone checks for yesterday.

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
| The dashboard looks wrong after a correction | Corrections rebuild only the affected forms and years: wait a few minutes. Admin > Health shows it syncing. |
| An alert or email was sent by mistake | Say so in News straight away. Alerts cannot be recalled. |

## Rules
- Real data is never deleted outside the chain. Originals are saved before any change.
- Do not share the shared HQ code or the access-code list.
- Deploys: only after `npx wrangler whoami` shows the LearnImpact account; never during field hours unless fixing a live problem.
