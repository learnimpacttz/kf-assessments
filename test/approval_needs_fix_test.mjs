// An approval must come with a real change to the data (or a written reason to accept the numbers as they are); old approvals without one are brought back.
import { env, ok, done } from './_kit.mjs';
import { postQuery, flagKey, reopenUnfixed, loadQueries, DATA_FIX } from '../src/queries.js';
import { kv } from '../src/store.js';
import { STAFF, SCHOOL_BY_ID } from '../src/config.js';
const rc = STAFF.find((s) => s.active && s.role === 'rc' && s.region === 'TANGA');
const RC = { role: 'rc', id: rc.id, name: rc.name, region: 'TANGA', position: 'RC' };
const joram = { role: 'hq', level: 'admin', name: 'Joram Joas', id: 'hq:h2', hq_id: 'h2', review_level: 2 };
const mundo = { role: 'hq', level: 'admin', name: 'Chogohe Edwin Mundo', id: 'hq:h1', hq_id: 'h1', review_level: 3 };
const school = Object.values(SCHOOL_BY_ID).find((s) => s.region === 'TANGA').id;
const keyOver = flagKey({ type: 'over', school, grade: 2, date: '2026-10-20', admin: rc.name });
const keyTeam = flagKey({ type: 'team', school, grade: 0, date: '2026-10-20', admin: rc.name });
const walk = async (key, live) => { // reply by the RC, first HQ review by Joram, then the final approval by Mundo
  await postQuery(env, RC, { key, action: 'respond', text: 'One extra pupil was tested by mistake; please remove that record.' });
  await postQuery(env, joram, { key, action: 'review', decision: 'approve' });
  return (accept) => postQuery(env, mundo, { key, action: 'review', decision: 'approve', live, accept_note: accept });
};
ok('the rule covers the count and identity checks', ['over', 'short', 'dup', 'notlist', 'nosample'].every((t) => DATA_FIX.has(t)) && !DATA_FIX.has('team'));
let finalApprove = await walk(keyOver, true);
let r = await finalApprove();
ok('the last approval is refused while the data still shows the problem', r.error && r.status === 409 && r.needs_accept === true, r.error);
r = await finalApprove('ok');
ok('a one-word reason is not enough', r.error && r.needs_accept === true);
r = await finalApprove('The 21st pupil is a replacement for an absent child; the count is right.');
ok('with a written reason it can be accepted as it is, and the reason is kept', !r.error && r.q.wf.stage === 'approved' && r.q.wf.accepted && /replacement/.test(r.q.wf.accepted.note) && r.q.wf.history.some((h) => h.action === 'accepted_as_is'), r.error || '');
// a check about something that is not a data defect closes as before
const finalTeam = await walk(keyTeam, true); r = await finalTeam();
ok('other checks (explanations) still close with a plain approval', !r.error && r.q.wf.stage === 'approved');
// when the data is already right (the check no longer shows) a plain approval is fine
const keyGone = flagKey({ type: 'dup', school, grade: 1, date: '2026-10-21', admin: rc.name }); const finalGone = await walk(keyGone, false); r = await finalGone();
ok('when the check no longer shows in the data, approval closes it', !r.error && r.q.wf.stage === 'approved');
// the request can never switch the guard off
const keyHack = flagKey({ type: 'short', school, grade: 3, date: '2026-10-22', admin: rc.name });
await postQuery(env, RC, { key: keyHack, action: 'respond', text: 'One pupil is missing from the count; the team will check.' }); await postQuery(env, joram, { key: keyHack, action: 'review', decision: 'approve' });
// (the route decides `live`; a missing value means the check is not live, so the route must always pass it: tested in the route by never trusting the body)
// ---- old approvals are brought back
const keyOld = flagKey({ type: 'dup', school, grade: 2, date: '2026-10-20', admin: rc.name }); const keyFixed = flagKey({ type: 'over', school, grade: 3, date: '2026-10-20', admin: rc.name });
const Q = await loadQueries(env);
const approved = (k) => ({ status: 'resolved', thread: [], wf: { stage: 'approved', approved_at: '2026-10-26T12:00:00Z', response: { text: 'x'.repeat(20), by: rc.name, at: '2026-10-25T10:00:00Z' }, history: [{ at: '2026-10-26T12:00:00Z', by: 'Mundo', level: 'final', action: 'approved', text: '', from: 'final', to: 'approved' }] } });
Q[keyOld] = approved(keyOld); Q[keyFixed] = approved(keyFixed); Q[keyTeam + 'x'] = approved(); await kv(env).put('v2:queries', Q);
const flagsNow = [{ type: 'dup', school, grade: 2, date: '2026-10-20', admin: rc.name }, { type: 'team', school, grade: 0, date: '2026-10-20', admin: rc.name }]; // keyFixed's check no longer shows
const dry = await reopenUnfixed(env, mundo, flagsNow);
ok('the dry run lists only approved count checks whose problem is still in the data', dry.apply === false && dry.reopen.length === 1 && dry.reopen[0].key === keyOld, JSON.stringify(dry.reopen.map((x) => x.key)));
ok('the dry run changes nothing', (await loadQueries(env))[keyOld].wf.stage === 'approved');
const done1 = await reopenUnfixed(env, mundo, flagsNow, { apply: true });
const after = (await loadQueries(env))[keyOld];
ok('bringing it back puts it with the first HQ review, open, with the history kept', done1.reopen.length === 1 && after.wf.stage === 'hq1' && after.status === 'open' && after.wf.history.length === 2 && after.wf.history[1].action === 'reopened' && /still shows the problem/.test(after.wf.history[1].text), JSON.stringify(after.wf.history.map((h) => h.action)));
ok('a full copy of the queries was saved first', Boolean(done1.backup) && Boolean(await kv(env).get(done1.backup)));
ok('a check that was accepted as it is stays closed', (await reopenUnfixed(env, mundo, [{ type: 'over', school, grade: 2, date: '2026-10-20', admin: rc.name }])).left.some((x) => x.key === keyOver));
ok('doing it again brings nothing back twice', (await reopenUnfixed(env, mundo, flagsNow, { apply: true })).reopen.length === 0);
// after it is back, the final approver still cannot just approve it
await postQuery(env, joram, { key: keyOld, action: 'review', decision: 'approve' });
r = await postQuery(env, mundo, { key: keyOld, action: 'review', decision: 'approve', live: true });
ok('once it is back, a plain approval is refused again', r.error && r.needs_accept === true);
done();
