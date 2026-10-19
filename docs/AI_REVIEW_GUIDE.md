# Reviewing a change with AI help

For the approver and the technical reviewer. AI helps you read; **you decide**. An AI review never counts as the second reviewer on its own.

## Before you start
- The change is a pull request on GitHub (or a branch). It has a template filled in: risk level, checks, how to go back.
- You need the link to the pull request, or the output of `git diff main` for that branch.

## Step 1: ask the AI to explain and check it
Open Claude (the organization plan) or Claude Code in the repository and paste the prompt below with the link or the diff. Do not paste secrets or personal data.

> You are an independent reviewer of a change to the LearnImpact Command Center, a live system used by about 60 field staff during an assessment. The approver is not a programmer, so write for them in plain words.
>
> For the change below, give me:
> 1. **What changes for users**, in two or three sentences.
> 2. **Risk level** (Low, Medium or High) and why, using this list: High means access and sign-in, the review chain, deleting or correcting data, payments, backups, alerts or scheduled jobs, deployment, secrets, or anything touching live data.
> 3. **Protected files touched:** list any change in src/auth.js, src/hq.js, src/guests.js, src/queries.js, src/deletions.js, src/edits.js, src/corrections.js, src/payments.js, src/paymentdata.js, src/backup.js, src/push.js, src/digest.js, src/index.js, wrangler.toml, package.json, .github, .claude or CLAUDE.md.
> 4. **What could go wrong,** and who would notice first.
> 5. **Security and privacy checks:** any secret, key, name, email or personal data added; any new network call; any new dependency; any weaker access check; any delete.
> 6. **Tests:** did `npm test` pass? What important behavior has no test?
> 7. **How to go back** if it breaks after release.
> 8. **Your recommendation:** approve, approve with conditions, or do not approve, plus any questions for the builder.
> Do not approve anything yourself. Quote the exact lines you are worried about.

## Step 2: check it yourself
1. Read the AI's summary against the pull request description. Do they match?
2. Open the changed files that the AI listed as protected or risky and read those lines.
3. Confirm `npm test` passed (the test check on the pull request is green).
4. Ask the builder every question the AI raised.
5. Check the release timing: not between 07:00 and 17:00 East Africa Time during field work, unless it fixes a live problem.

## Step 3: decide and record
Write one line on the pull request: **Approved**, **Approved with conditions (list them)**, or **Not approved (why)**. Medium and High changes also need the approver's name from the standard (currently the Senior Finance and Operations Officer for the plan and the Executive Director for the technical review of High changes).

## Claude Code shortcut
In Claude Code, running `/code-review` on a branch reviews the current change. Use it as a second opinion, then follow Steps 2 and 3.

## What AI cannot do
It cannot know what the field teams need today, whether a deadline makes a risk worth taking, or whether a rule in the policy applies. Ask the builder when in doubt.
