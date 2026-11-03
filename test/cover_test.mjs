// Coordinator coverage: every school visit has an RC or ARC (or a named acting coordinator), the RC leads when both are present, leave, confirmations, past days, alerts and the plan guard
import { ok, done, env, mem } from './_kit.mjs';
import { STAFF, SCHOOLS_BY_REGION, REASONS, eatToday, addWorkingDays, isWorkingDay } from '../src/config.js';
import { coverView, setAssign, setConfirm, leaveAction, rowAction, runCover, coverAttention, loadCtx, regionDay, pastRows } from '../src/cover.js';
import { changeVisit } from '../src/plan.js';

const good3 = [...new Set(STAFF.map((s) => s.region))].filter((r) => STAFF.filter((s) => s.active && s.region === r && s.role === 'volunteer').length >= 3 && STAFF.some((s) => s.active && s.region === r && s.role === 'rc') && STAFF.some((s) => s.active && s.region === r && s.role === 'arc') && (SCHOOLS_BY_REGION[r] || []).length >= 4);
const region = good3[0], regionB = good3[1], regionC = good3[2]; // the plan is cached for a few seconds per region, so each phase uses its own
const who3 = (r) => { const q = STAFF.filter((s) => s.active && s.region === r); return { rc: q.find((s) => s.role === 'rc'), arc: q.find((s) => s.role === 'arc'), vols: q.filter((s) => s.role === 'volunteer'), schools: SCHOOLS_BY_REGION[r] }; };
const st = STAFF.filter((s) => s.active && s.region === region); const rc = st.find((s) => s.role === 'rc'), arc = st.find((s) => s.role === 'arc'); const [v1, v2, v3] = st.filter((s) => s.role === 'volunteer'); const [A, B, C, D] = SCHOOLS_BY_REGION[region];
const put = (k, x) => mem.set(k, JSON.stringify(x));
const today = eatToday(); const future = addWorkingDays(today, 2); const past = '2026-10-21';
const visit = (id, school, date, team, lead) => ({ id, school: school.id, date, start: '08:00', team, lead, notices: {}, status: 'planned' });
put('v2:plan:' + region, { region, status: 'locked', version: 1, day_notes: {}, changes: [], visits: [
  visit('a', A, future, [rc.name, v1.name], rc.name), visit('b', B, future, [rc.name, v1.name], rc.name), // same team and lead at two schools: the gap we found
  visit('c', C, past, [rc.name, v2.name], rc.name), visit('d', D, past, [arc.name, v3.name], arc.name) ] });
const sum = { schools: { [C.id]: { dayAdmins: { [past]: [v2.name] } }, [D.id]: { dayAdmins: { [past]: [arc.name, v3.name] } } } }; // the RC planned at C was not recorded anywhere that day
const hq = { role: 'hq', name: 'HQ Tester', level: 'admin', id: 'hq:t' }; const rcW = { role: 'rc', name: rc.name, id: rc.id, region }; const arcW = { role: 'arc', name: arc.name, id: arc.id, region };

const Z = who3(regionB); put('v2:plan:' + regionB, { region: regionB, status: 'locked', version: 2, day_notes: {}, changes: [], visits: [visit('n', Z.schools[0], addWorkingDays(today, 1), [Z.rc.name, Z.vols[0].name], Z.rc.name)] });
const G = who3(regionC); const gW = { role: 'rc', name: G.rc.name, id: G.rc.id, region: regionC };
put('v2:plan:' + regionC, { region: regionC, status: 'locked', version: 3, day_notes: {}, changes: [], visits: [visit('p', G.schools[0], addWorkingDays(today, 8), [G.rc.name, G.vols[0].name], G.rc.name), visit('q', G.schools[1], addWorkingDays(today, 9), [G.arc.name, G.vols[1].name], G.arc.name)] });

let ctx = await loadCtx(env, sum, [region]); let day = regionDay(ctx, region, future);
ok('the same team at two schools on one day is flagged', day.schools.every((s) => s.issues.some((i) => i.t === 'shared_team')));
ok('both coordinators in one team: the RC leads', (() => { const c2 = { ...ctx, plans: { [region]: { visits: [visit('x', A, future, [rc.name, arc.name, v1.name], arc.name)] } } }; const d = regionDay(c2, region, future); return d.schools[0].plan_lead === rc.name && d.schools[0].issues.some((i) => i.t === 'rc_rule'); })());
ok('a school with no RC or ARC and nobody named is flagged', (() => { const c2 = { ...ctx, plans: { [region]: { visits: [visit('x', A, future, [v1.name, v2.name], null)] } } }; return regionDay(c2, region, future).schools[0].issues.some((i) => i.t === 'no_coordinator'); })());
ok('nobody has confirmed yet', day.coordinators.every((c) => c.state === 'open') && !day.complete);

// assignments by school: each school gets its own coordinator, an acting volunteer must be in the team
const r1 = await setAssign(env, rcW, { region, date: future, assignments: [{ school: A.id, name: rc.name }, { school: B.id, name: arc.name }] });
ok('the RC can name the RC at one school and the ARC at the other', r1.ok === true, JSON.stringify(r1));
ok('a volunteer who is not in the planned team cannot be named by a coordinator', (await setAssign(env, rcW, { region, date: future, assignments: [{ school: A.id, name: v3.name }] })).status === 422);
const calls = []; const spy = async (e, pred, a) => { calls.push({ pred, a }); };
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
ok('the item asks who acted, and a name is required', (await rowAction(env, rcW, { region, date: past, choice: 'records_right' }, sum)).status === 422);
ok('"something else" needs a note', (await rowAction(env, rcW, { region, date: past, choice: 'other', acting: { [C.id]: v2.name } }, sum)).status === 422);
ok('the region answers', (await rowAction(env, rcW, { region, date: past, choice: 'records_right', acting: { [C.id]: v2.name } }, sum)).ok === true);
ok('a coordinator cannot acknowledge, HQ can', (await rowAction(env, rcW, { action: 'ack', region, date: past }, sum)).status === 403 && (await rowAction(env, hq, { action: 'ack', region, date: past }, sum)).ok === true);
ok('the item shows as answered and acknowledged', (() => { const r = JSON.parse(mem.get('v2:cover:rows'))[`${region}|${past}`]; return r.response.choice === 'records_right' && r.ack.by === 'HQ Tester'; })());

// views
const cv = await coverView(env, sum, rcW, {}); ok('a coordinator sees their region: days to come and the leave', cv.region === region && cv.days.length >= 1 && cv.me === rc.id && cv.leave.length === 1);
ok('HQ sees every region', (await coverView(env, sum, hq, {})).regions.length >= 1);
ok('a volunteer sees only where they are acting', (await coverView(env, sum, { role: 'volunteer', name: v1.name, id: v1.id }, {})).acting.some((a) => a.school === A.id && a.date === future));
ok('the Bridge hears of nothing outstanding when all is answered', (await coverAttention(env, sum)).rows_open === 0);

// alerts: individual, once
if (isWorkingDay(today)) {
  mem.delete('v2:cover:conf'); mem.delete('v2:cover:leave'); mem.delete('v2:cover:alerted'); mem.delete('v2:cover:assign');
  const out = await runCover(env, '11:30', sum, spy);
  ok('the afternoon alert goes to each coordinator who has not confirmed, one by one', out.sent === 2 && calls.length === 2 && calls.some((c) => c.pred({ id: Z.rc.id })) && calls.every((c) => !c.pred({ id: Z.vols[0].id })) && /Confirm tomorrow/.test(calls[0].a.title), JSON.stringify(out));
  ok('the same alert is never sent twice', (await runCover(env, '11:30', sum, spy)).sent === 0);
} else console.log('PASS (weekend: alert checks skipped)');

// the plan guard: one team, one school, one day
const bad = await changeVisit(env, gW, regionC, { visit_id: 'q', new_date: addWorkingDays(today, 8), new_team: [G.arc.name, G.vols[0].name], reason_code: Object.keys(REASONS)[0] }, today);
ok('moving a school onto a day must not put the same person at two schools', bad.status === 422 && /already in the team/.test(bad.error), JSON.stringify(bad).slice(0, 160));
const good = await changeVisit(env, gW, regionC, { visit_id: 'q', new_date: addWorkingDays(today, 8), new_team: [G.arc.name, G.vols[1].name], reason_code: Object.keys(REASONS)[0] }, today);
ok('with its own team the move is accepted', !good.error, JSON.stringify(good).slice(0, 120));
ok('the wording is for support', !/cheat|fraud|blame|fault of/i.test(JSON.stringify(await coverView(env, sum, hq, { region }))));
done();
