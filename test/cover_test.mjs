// Coordinator coverage: every school visit has an RC or ARC (or a named acting coordinator), the RC leads when both are present, leave, confirmations, past days, alerts and the plan guard
import { ok, done, env, mem } from './_kit.mjs';
import { STAFF, SCHOOLS_BY_REGION, REASONS, eatToday, addWorkingDays, isWorkingDay } from '../src/config.js';
import { coverView, setAssign, setConfirm, leaveAction, rowAction, runCover, coverAttention, loadCtx, regionDay, pastRows } from '../src/cover.js';
import { changeVisit } from '../src/plan.js';

const good3 = [...new Set(STAFF.map((s) => s.region))].filter((r) => STAFF.filter((s) => s.active && s.region === r && s.role === 'volunteer').length >= 3 && STAFF.some((s) => s.active && s.region === r && s.role === 'rc') && STAFF.some((s) => s.active && s.region === r && s.role === 'arc') && (SCHOOLS_BY_REGION[r] || []).length >= 4);
const region = good3[0], regionB = good3[1], regionC = good3[2], regionD = good3[3], regionE = good3[4], regionF = good3[5], regionG = good3[6]; // the plan is cached for a few seconds per region, so each phase uses its own
const who3 = (r) => { const q = STAFF.filter((s) => s.active && s.region === r); return { rc: q.find((s) => s.role === 'rc'), arc: q.find((s) => s.role === 'arc'), vols: q.filter((s) => s.role === 'volunteer'), schools: SCHOOLS_BY_REGION[r] }; };
const st = STAFF.filter((s) => s.active && s.region === region); const rc = st.find((s) => s.role === 'rc'), arc = st.find((s) => s.role === 'arc'); const [v1, v2, v3] = st.filter((s) => s.role === 'volunteer'); const [A, B, C, D] = SCHOOLS_BY_REGION[region];
const put = (k, x) => mem.set(k, JSON.stringify(x));
const calls = []; const spy = async (e, pred, a) => { calls.push({ pred, a }); };
const today = eatToday(); const future = addWorkingDays(today, 2); const past = '2026-10-21';
const visit = (id, school, date, team, lead) => ({ id, school: school.id, date, start: '08:00', team, lead, notices: {}, status: 'planned' });
put('v2:plan:' + region, { region, status: 'locked', version: 1, day_notes: {}, changes: [], visits: [
  visit('a', A, future, [rc.name, v1.name], rc.name), visit('b', B, future, [rc.name, v1.name], rc.name), // same team and lead at two schools: the gap we found
  visit('c', C, past, [rc.name, v2.name], rc.name), visit('d', D, past, [arc.name, v3.name], arc.name) ] });
const sum = { schools: { [C.id]: { dayAdmins: { [past]: [v2.name] } }, [D.id]: { dayAdmins: { [past]: [arc.name, v3.name] } } } };
if (regionG) sum.schools[SCHOOLS_BY_REGION[regionG][0].id] = { dayAdmins: { '2026-10-23': [STAFF.filter((s) => s.active && s.region === regionG && s.role === 'arc')[0].name, STAFF.filter((s) => s.active && s.region === regionG && s.role === 'volunteer')[0].name] } };
if (regionF) sum.schools[SCHOOLS_BY_REGION[regionF][0].id] = { dayAdmins: { '2026-10-22': [STAFF.filter((s) => s.active && s.region === regionF && s.role === 'volunteer')[0].name] } }; // the RC planned at C was not recorded anywhere that day
const hq = { role: 'hq', name: 'HQ Tester', level: 'admin', id: 'hq:t' }; const rcW = { role: 'rc', name: rc.name, id: rc.id, region }; const arcW = { role: 'arc', name: arc.name, id: arc.id, region };

const Z = who3(regionB); put('v2:plan:' + regionB, { region: regionB, status: 'locked', version: 2, day_notes: {}, changes: [], visits: [visit('n', Z.schools[0], addWorkingDays(today, 1), [Z.rc.name, Z.vols[0].name], Z.rc.name)] });
const G = who3(regionC); const gW = { role: 'rc', name: G.rc.name, id: G.rc.id, region: regionC };
put('v2:plan:' + regionC, { region: regionC, status: 'locked', version: 3, day_notes: {}, changes: [], visits: [visit('p', G.schools[0], addWorkingDays(today, 8), [G.rc.name, G.vols[0].name], G.rc.name), visit('q', G.schools[1], addWorkingDays(today, 9), [G.arc.name, G.vols[1].name], G.arc.name)] });

const nd = addWorkingDays(today, 1);
const Dd = who3(regionD); put('v2:plan:' + regionD, { region: regionD, status: 'locked', version: 1, day_notes: {}, changes: [], visits: [visit('c1', Dd.schools[0], nd, [Dd.rc.name, Dd.vols[0].name], Dd.rc.name), visit('c2', Dd.schools[1], nd, [Dd.arc.name, Dd.vols[1].name], Dd.arc.name)] }); // clear: both coordinators placed, own team each
const past2 = '2026-10-22'; const Fz = regionF ? who3(regionF) : null; if (regionF) put('v2:plan:' + regionF, { region: regionF, status: 'locked', version: 1, day_notes: {}, changes: [], visits: [visit('f1', Fz.schools[0], past2, [Fz.rc.name, Fz.vols[0].name], Fz.rc.name)] });
const past3 = '2026-10-23'; const Gz = regionG ? who3(regionG) : null; if (regionG) put('v2:plan:' + regionG, { region: regionG, status: 'locked', version: 1, day_notes: {}, changes: [], visits: [visit('g1', Gz.schools[0], past3, [Gz.rc.name, Gz.vols[0].name], Gz.rc.name)] }); // plan says the RC, the records show the ARC: only the plan was out of date
const Ee = who3(regionE); put('v2:plan:' + regionE, { region: regionE, status: 'locked', version: 1, day_notes: {}, changes: [], visits: [{ ...visit('o1', Ee.schools[0], nd, [Ee.rc.name, Ee.vols[0].name], Ee.rc.name), start: '08:00' }, { ...visit('o2', Ee.schools[1], nd, [Ee.arc.name, Ee.vols[0].name], Ee.arc.name), start: '10:00' }, { ...visit('o3', Ee.schools[2], nd, [Ee.rc.name, Ee.vols[0].name], Ee.rc.name), start: '12:00' }] }); // one volunteer at three schools
let ctx = await loadCtx(env, sum, [region]); let day = regionDay(ctx, region, future);
ok('the same team at two schools on one day is flagged', day.schools.every((s) => s.issues.some((i) => i.t === 'shared_team')));
ok('both coordinators in one team: the RC leads', (() => { const c2 = { ...ctx, plans: { [region]: { visits: [visit('x', A, future, [rc.name, arc.name, v1.name], arc.name)] } } }; const d = regionDay(c2, region, future); return d.schools[0].plan_lead === rc.name && d.schools[0].issues.some((i) => i.t === 'rc_rule'); })());
ok('a school with no RC or ARC and nobody named is flagged', (() => { const c2 = { ...ctx, plans: { [region]: { visits: [visit('x', A, future, [v1.name, v2.name], null)] } } }; return regionDay(c2, region, future).schools[0].issues.some((i) => i.t === 'no_coordinator'); })());
ok('nobody has confirmed yet', day.coordinators.every((c) => c.state === 'open') && !day.complete);

// assignments by school: each school gets its own coordinator, an acting volunteer must be in the team
const r1 = await setAssign(env, rcW, { region, date: future, assignments: [{ school: A.id, name: rc.name }, { school: B.id, name: arc.name }] });
ok('the RC can name the RC at one school and the ARC at the other', r1.ok === true, JSON.stringify(r1));
ok('a volunteer who is not in the planned team cannot be named by a coordinator', (await setAssign(env, rcW, { region, date: future, assignments: [{ school: A.id, name: v3.name }] })).status === 422);
ok('a volunteer from the team can be named as acting', (await setAssign(env, rcW, { region, date: future, assignments: [{ school: A.id, name: v1.name }] })).ok === true);
ok('another region\'s coordinator cannot change this region', (await setAssign(env, { role: 'rc', name: 'X', id: 99999, region: 'OTHER' }, { region, date: future, assignments: [{ school: A.id, name: rc.name }] })).status === 403);
ctx = await loadCtx(env, sum, [region]); day = regionDay(ctx, region, future);
ok('once assigned the shared team is no longer a problem and the acting volunteer shows', day.unassigned === 0 && day.schools.find((s) => s.school === A.id).assigned.acting === true);

// confirmation and leave
ok('away needs a reason', (await setConfirm(env, rcW, { region, date: future, staff_id: rc.id, status: 'absent' })).status === 422);
ok('a coordinator confirms for themselves, not for the other', (await setConfirm(env, rcW, { region, date: future, staff_id: arc.id, status: 'ok' })).status === 403);
ok('the RC confirms', (await setConfirm(env, rcW, { region, date: future, staff_id: rc.id, status: 'ok' })).ok === true);
const lv = await leaveAction(env, arcW, { action: 'add', staff_id: arc.id, from: future, to: future, kind: 'sick', note: 'unwell' });
ok('a coordinator reports their own leave; it waits for HQ', lv.ok === true && JSON.parse(mem.get('v2:cover:leave'))[0].approved === false);
ok('a coordinator cannot record leave for someone else', (await leaveAction(env, arcW, { action: 'add', staff_id: rc.id, from: future, to: future, kind: 'sick' })).status === 403);
const id = JSON.parse(mem.get('v2:cover:leave'))[0].id; ok('HQ approves it', (await leaveAction(env, hq, { action: 'approve', id, approved_by: 'Programme lead, email' })).ok === true);
ctx = await loadCtx(env, sum, [region]); day = regionDay(ctx, region, future);
ok('the coordinator on approved leave shows as such and their school needs an acting coordinator', day.coordinators.find((c) => c.id === arc.id).state === 'leave' && day.schools.find((s) => s.school === B.id).issues.some((i) => i.t === 'lead_on_leave'));
ok('a coordinator on leave cannot be named at a school', (await setAssign(env, hq, { region, date: future, assignments: [{ school: B.id, name: arc.name }] })).status === 422);
ok('HQ names the acting volunteer, who must be in the team', (await setAssign(env, hq, { region, date: future, assignments: [{ school: B.id, name: v1.name }] })).ok === true);

// days gone: plan against records
ctx = await loadCtx(env, sum, [region]); const rows = pastRows(ctx, region);
ok('a past day with no coordinator in the records becomes one item for the region', rows.length === 1 && rows[0].date === past && rows[0].needs_acting.length >= 1 && rows[0].needs_acting[0].school === C.id, JSON.stringify(rows.map((r) => r.date)));
ok('the item asks who acted, and a name is required', (await rowAction(env, rcW, { region, date: past, choice: 'records_right' }, sum, spy)).status === 422);
ok('"something else" needs a note', (await rowAction(env, rcW, { region, date: past, choice: 'other', acting: { [C.id]: v2.name } }, sum, spy)).status === 422);
ok('the region answers: the answer goes to the first HQ review', (await rowAction(env, rcW, { region, date: past, choice: 'records_right', acting: { [C.id]: v2.name } }, sum, spy)).ok === true && pastRows(await loadCtx(env, sum, [region]), region)[0].stage === 'hq1');
ok('Joram is alerted, not the coordinator', calls.some((c) => /waiting for your check/.test(c.a.title) && c.pred({ role: 'hq', review_level: 2, name: 'Joram T' }) && !c.pred({ role: 'hq', review_level: 3, hq_id: 'h1', name: 'Mundo T' }) && !c.pred({ role: 'rc', id: rc.id })));
ok('an answer already with HQ cannot be changed', (await rowAction(env, rcW, { region, date: past, choice: 'other', note: 'a different story here' }, sum, spy)).status === 409);
const joram = { role: 'hq', name: 'Joram T', level: 'editor', review_level: 2, hq_id: 'h2', id: 'hq:2' }, mundo = { role: 'hq', name: 'Mundo T', level: 'admin', review_level: 3, hq_id: 'h1', id: 'hq:1' };
ok('a coordinator cannot review', (await rowAction(env, rcW, { action: 'review', decision: 'approve', region, date: past }, sum, spy)).status === 403);
ok('Mundo cannot do the first review', (await rowAction(env, mundo, { action: 'review', decision: 'approve', region, date: past }, sum, spy)).status === 403);
ok('Joram sends it back only with a reason', (await rowAction(env, joram, { action: 'review', decision: 'reject', region, date: past }, sum, spy)).status === 422);
ok('Joram sends it back with a reason: the region is told and answers again', (await rowAction(env, joram, { action: 'review', decision: 'reject', note: 'Please say which coordinator was away', region, date: past }, sum, spy)).ok === true && calls.some((c) => /sent back/.test(c.a.title) && c.pred({ id: rc.id })) && pastRows(await loadCtx(env, sum, [region]), region)[0].stage === 'rework');
ok('the region answers again', (await rowAction(env, rcW, { region, date: past, choice: 'records_right', acting: { [C.id]: v2.name } }, sum, spy)).ok === true);
ok('Joram approves: it goes to Mundo', (await rowAction(env, joram, { action: 'review', decision: 'approve', region, date: past }, sum, spy)).ok === true && pastRows(await loadCtx(env, sum, [region]), region)[0].stage === 'final');
ok('Joram cannot give the final confirmation, Mundo can, and it closes', (await rowAction(env, joram, { action: 'review', decision: 'approve', region, date: past }, sum, spy)).status === 403 && (await rowAction(env, mundo, { action: 'review', decision: 'approve', region, date: past }, sum, spy)).ok === true && pastRows(await loadCtx(env, sum, [region]), region)[0].stage === 'closed');
ok('the history keeps every step', pastRows(await loadCtx(env, sum, [region]), region)[0].history.map((h) => h.action).join() === 'answered,sent back,answered again,approved,approved');
ok('the answer is due 2 working days after the rollout day', pastRows(await loadCtx(env, sum, [region]), region)[0].due === addWorkingDays('2026-11-03', 2));
if (regionF) { // approved leave on record plus a named acting coordinator closes by itself
  ok('leave recorded by HQ and approved', (await leaveAction(env, hq, { action: 'add', staff_id: Fz.rc.id, from: past2, to: past2, kind: 'sick', approved_by: 'Joram T, email' })).ok === true);
  const auto = await rowAction(env, { role: 'rc', name: Fz.arc.name, id: Fz.arc.id, region: regionF }, { region: regionF, date: past2, choice: 'leave', staff_id: Fz.rc.id, acting: { [Fz.schools[0].id]: Fz.vols[0].name } }, sum, spy);
  const fr = pastRows(await loadCtx(env, sum, [regionF]), regionF).find((x) => x.date === past2);
  ok('leave plus an acting coordinator closes by itself, nobody at HQ has to read it', auto.closed === true && fr.stage === 'closed' && fr.auto === true && fr.history.some((h) => h.level === 'auto')); }

if (regionG) { const pr = pastRows(await loadCtx(env, sum, [regionG]), regionG).find((x) => x.date === past3); ok('a plan-only day: every school had a coordinator in the records', pr && pr.needs_acting.length === 0, JSON.stringify(pr && pr.needs_acting));
  const r3 = await rowAction(env, { role: 'rc', name: Gz.rc.name, id: Gz.rc.id, region: regionG }, { region: regionG, date: past3, choice: 'records_right' }, sum, spy);
  const after = pastRows(await loadCtx(env, sum, [regionG]), regionG).find((x) => x.date === past3);
  ok('confirming the records are right closes a plan-only day by itself', r3.closed === true && after.stage === 'closed' && after.auto === true); }
// privacy: health details are refused everywhere a note can be written
ok('a leave note with health words is refused', (await leaveAction(env, hq, { action: 'add', staff_id: arc.id, from: future, to: future, kind: 'sick', note: 'she has malaria and went to hospital' })).status === 422 && (await setConfirm(env, rcW, { region, date: future, staff_id: rc.id, status: 'absent', reason: 'sick', note: 'stomach pain' })).status === 422);
ok('a plain note is accepted', (await leaveAction(env, hq, { action: 'add', staff_id: arc.id, from: addWorkingDays(future, 3), to: addWorkingDays(future, 3), kind: 'sick', note: 'away' })).ok === true);
// views
const cv = await coverView(env, sum, rcW, {}); ok('a coordinator sees their region: days to come and the leave', cv.region === region && cv.days.length >= 1 && cv.me === rc.id && cv.leave.length >= 1);
ok('HQ sees every region', (await coverView(env, sum, hq, {})).regions.length >= 1);
ok('a volunteer sees only where they are acting', (await coverView(env, sum, { role: 'volunteer', name: v1.name, id: v1.id }, {})).acting.some((a) => a.school === A.id && a.date === future));
ok('the Bridge hears of nothing waiting for the region once it has answered', (await coverAttention(env, sum)).rows_open === 0);

// alerts: individual, once
if (isWorkingDay(today)) {
  mem.delete('v2:cover:conf'); mem.delete('v2:cover:leave'); mem.delete('v2:cover:alerted'); mem.delete('v2:cover:assign');
  const out = await runCover(env, '11:30', sum, spy, '2000-01-01');
  ok('the afternoon alert goes to each coordinator who has not confirmed, one by one', calls.filter((c) => c.pred({ id: Z.rc.id }) || c.pred({ id: Z.arc.id })).length === 2 && calls.every((c) => !c.pred({ id: Z.vols[0].id })) && /needs your help/.test((calls.find((c) => c.pred({ id: Z.rc.id })) || { a: { title: '' } }).a.title), JSON.stringify(out));
  ok('the same alert is never sent twice', (await runCover(env, '11:30', sum, spy, '2000-01-01')).sent === 0);
} else console.log('PASS (weekend: alert checks skipped)');

// clear days ask nobody anything; three schools for one person is a no-go
{ const c = await loadCtx(env, sum, [regionD, regionE]); const dd = regionDay(c, regionD, nd), ee = regionDay(c, regionE, nd);
  ok('a clear day: every school has a coordinator, both are placed, nothing clashes', dd.clear === true && dd.reasons.length === 0 && dd.complete === true, JSON.stringify(dd.reasons));
  ok('one person at three schools in a day is flagged and the day is not clear', ee.clear === false && ee.schools.some((s) => s.issues.some((i) => i.t === 'overload')) && ee.complete === false, JSON.stringify(ee.reasons.slice(0, 2)));
  ok('the same coordinator leading three schools is also flagged', ee.schools.filter((s) => s.lead === Ee.rc.name).length === 2 && ee.reasons.length >= 1); }
if (isWorkingDay(today)) { const to = calls.filter((c) => c.pred({ id: Dd.rc.id }) || c.pred({ id: Dd.arc.id })); ok('no alert for a clear day', to.length === 0);
  const eeAlerts = calls.filter((c) => c.pred({ id: Ee.rc.id })); ok('an unclear day alerts its coordinators with the reason', eeAlerts.length >= 1 && /three schools/.test(eeAlerts[0].a.body), eeAlerts[0] && eeAlerts[0].a.body); }
// the plan guard: one team, one school, one day
const bad = await changeVisit(env, gW, regionC, { visit_id: 'q', new_date: addWorkingDays(today, 8), new_team: [G.arc.name, G.vols[0].name], reason_code: Object.keys(REASONS)[0] }, today);
ok('moving a school must not put the same person at two schools at the same time', bad.status === 422 && /already planned at/.test(bad.error), JSON.stringify(bad).slice(0, 160));
const good = await changeVisit(env, gW, regionC, { visit_id: 'q', new_date: addWorkingDays(today, 8), new_team: [G.arc.name, G.vols[1].name], reason_code: Object.keys(REASONS)[0] }, today);
ok('with its own team the move is accepted', !good.error, JSON.stringify(good).slice(0, 120));
// the same person may visit several schools in a day at different times (the 1 or 3 school days)
const seq = await changeVisit(env, gW, regionC, { visit_id: 'q', new_date: addWorkingDays(today, 8), new_start: '10:30', new_team: [G.arc.name, G.vols[0].name], reason_code: Object.keys(REASONS)[0] }, today);
const third = await changeVisit(env, gW, regionC, { visit_id: 'p', new_date: addWorkingDays(today, 8), new_start: '13:00', new_team: [G.rc.name, G.vols[0].name], new_lead: G.rc.name, reason_code: Object.keys(REASONS)[0] }, today);
ok('the same person can be at two schools on one day at different times', !seq.error, JSON.stringify(seq).slice(0, 160));
ok('before the go-live day nobody is asked to confirm', (await runCover(env, '11:30', sum, spy)).skipped === true);
ok('the wording is for support', !/cheat|fraud|blame|fault of/i.test(JSON.stringify(await coverView(env, sum, hq, { region }))));
done();
