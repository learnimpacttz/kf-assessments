// Coordinator coverage: every school visit has an RC or ARC present, or a named acting coordinator from the team's volunteers.
// Each working day the coordinators confirm who is at which school (and who is away, and who acts). Every evening the plan is compared with the records.
// Rules: (1) a school visit always has a coordinator or a named acting coordinator; (2) when the RC and the ARC are both at one school the RC leads;
// (3) the same person is never in the team of two schools on one day, so each school has its own lead. Wording is for support, never blame.
// Nothing here changes a test record, a plan or a payment. Leave notes never hold medical detail.
import { kv } from './store.js';
import { STAFF, SCHOOL_BY_ID, REGIONS, FIELD_START, FIELD_END, eatToday, isWorkingDay, addWorkingDays, norm } from './config.js';
import { getPlan, leadOfVisit } from './plan.js';
import { pushTo } from './push.js';

const K_LEAVE = 'v2:cover:leave', K_ASSIGN = 'v2:cover:assign', K_CONF = 'v2:cover:conf', K_ROWS = 'v2:cover:rows', K_ALERTED = 'v2:cover:alerted';
export const CONFIRM_BY = '18:00'; // East Africa Time, the working day before: coordinators use the app mostly 12:00 to 19:00 and field days end by about 14:00
export const LEAVE_KINDS = { sick: 'Sick leave', leave: 'Approved leave', duty: 'Other duty', other: 'Other' };
const clip = (s, n) => String(s || '').trim().slice(0, n);
const isIso = (d) => /^\d{4}-\d\d-\d\d$/.test(d || '');
export const coordsOf = (region) => { const c = STAFF.filter((s) => s.active && s.region === region); return { rc: c.find((s) => s.role === 'rc') || null, arc: c.find((s) => s.role === 'arc') || null, vols: c.filter((s) => s.role === 'volunteer') }; };
const get = async (env, k, d) => (await kv(env).get(k)) ?? d;

// ---- reading everything the day views need
export async function loadCtx(env, sum, regions = REGIONS) {
  const plans = {}; for (const r of regions) { try { plans[r] = await getPlan(env, r); } catch { plans[r] = { visits: [] }; } }
  const at = {}; // person|date -> school ids with records that day
  for (const [sid, s] of Object.entries((sum && sum.schools) || {})) for (const [d, names] of Object.entries(s.dayAdmins || {})) for (const n of names) (at[n + '|' + d] ||= []).push(sid);
  return { plans, sum, at, leaves: await get(env, K_LEAVE, []), assign: await get(env, K_ASSIGN, {}), conf: await get(env, K_CONF, {}), rows: await get(env, K_ROWS, {}), today: eatToday() };
}
const leaveOn = (ctx, staff, date) => (staff ? ctx.leaves.find((l) => String(l.staff_id) === String(staff.id) && l.from <= date && date <= l.to) || null : null);

// ---- one region on one day: each school with its coordinator (named, planned or missing), what the records show, and the problems
export function regionDay(ctx, region, date) {
  const plan = ctx.plans[region] || { visits: [] }; const { rc, arc } = coordsOf(region); const names = new Set([rc && rc.name, arc && arc.name].filter(Boolean));
  const visits = (plan.visits || []).filter((v) => v.date === date); const count = {};
  for (const v of visits) for (const n of v.team || []) count[n] = (count[n] || 0) + 1;
  const schools = visits.map((v) => {
    const team = v.team || []; const inRc = rc && team.includes(rc.name), inArc = arc && team.includes(arc.name);
    let planLead = leadOfVisit(v, region); if (inRc && inArc) planLead = rc.name; // when both are at one school, the RC leads
    const a = ctx.assign[`${date}|${v.school}`] || null; const lead = a ? a.name : planLead; const leadStaff = [rc, arc].find((c) => c && c.name === lead) || null;
    const leave = leaveOn(ctx, leadStaff, date); const issues = [];
    const shared = team.filter((n) => count[n] > 1);
    if (shared.length && !a) issues.push({ t: 'shared_team', text: `${shared.join(', ')} ${shared.length === 1 ? 'is' : 'are'} in the team of more than one school on this day.` });
    if (inRc && inArc && v.lead && v.lead !== rc.name && !a) issues.push({ t: 'rc_rule', text: 'Both coordinators are in this team, so the RC leads.' });
    if (!lead) issues.push({ t: 'no_coordinator', text: 'No RC or ARC is named for this school. Name an acting coordinator from the team.' });
    else if (leave && (!a || a.name === leadStaff.name)) issues.push({ t: 'lead_on_leave', text: `${lead} is on leave this day. Name an acting coordinator from the team.` });
    const actual = ((ctx.sum && ctx.sum.schools && ctx.sum.schools[v.school] && ctx.sum.schools[v.school].dayAdmins) || {})[date] || [];
    const present = actual.filter((n) => names.has(n)); const past = date <= ctx.today && actual.length > 0;
    const elsewhere = lead && past && !actual.includes(lead) ? (ctx.at[lead + '|' + date] || []).filter((x) => x !== v.school).map((x) => (SCHOOL_BY_ID[x] || {}).name || x) : null;
    if (past && !present.length && !(a && !names.has(a.name) && actual.includes(a.name))) issues.push({ t: 'nocoord_actual', text: 'The records show no RC or ARC at this school on this day.' });
    else if (past && lead && names.has(lead) && !actual.includes(lead)) issues.push({ t: 'lead_not_present', text: `${lead} is named for this school but the records show ${elsewhere && elsewhere.length ? 'them at ' + elsewhere.join(', ') : 'no records from them that day'}.` });
    return { school: v.school, name: (SCHOOL_BY_ID[v.school] || {}).name || v.school, lga: (SCHOOL_BY_ID[v.school] || {}).lga || '', start: v.start || '', team, vols: team.filter((n) => !names.has(n)), plan_lead: planLead, assigned: a ? { name: a.name, acting: !names.has(a.name), by: a.by, at: a.at } : null, lead, issues, testers: actual, present };
  });
  const coords = [rc, arc].filter(Boolean).map((c) => { const k = `${region}|${date}|${c.id}`; const lv = leaveOn(ctx, c, date); const cf = ctx.conf[k] || null;
    return { id: c.id, name: c.name, position: c.role === 'rc' ? 'RC' : 'ARC', leave: lv ? { kind: lv.kind, approved: lv.approved } : null, confirm: cf ? { status: cf.status, reason: cf.reason || '', note: cf.note || '', by: cf.by, at: cf.at } : null,
      state: lv && lv.approved ? 'leave' : cf ? (cf.status === 'absent' ? 'absent' : 'confirmed') : 'open', schools_planned: schools.filter((s) => (s.team || []).includes(c.name) || s.lead === c.name).map((s) => s.name) }; });
  const unassigned = schools.filter((s) => !s.assigned).length; const open = coords.filter((c) => c.state === 'open').length;
  return { region, date, schools, coordinators: coords, complete: schools.length > 0 && !unassigned && !open, unassigned, open, problems: schools.reduce((n, s) => n + s.issues.filter((i) => ['no_coordinator', 'lead_on_leave', 'shared_team', 'rc_rule'].includes(i.t)).length, 0) };
}

// ---- days still to come (confirmed ahead) and days gone (plan against records)
export const nextDays = (today, n = 3) => { const out = []; let d = today; if (isWorkingDay(today)) out.push(today); for (let i = 0; i < n; i++) { d = addWorkingDays(d, 1); if (d <= FIELD_END) out.push(d); } return out; };
export const deadlineOf = (date) => { let d = new Date(date + 'T00:00:00Z'); do { d = new Date(d.getTime() - 86400e3); } while (!isWorkingDay(d.toISOString().slice(0, 10))); return d.toISOString().slice(0, 10) + 'T' + CONFIRM_BY; }; // working day before, 18:00 EAT
export function pastRows(ctx, region) {
  const plan = ctx.plans[region] || { visits: [] }; const dates = [...new Set((plan.visits || []).map((v) => v.date))].filter((d) => d >= FIELD_START && d < ctx.today).sort(); const { rc, arc } = coordsOf(region); const out = [];
  for (const d of dates) {
    const day = regionDay(ctx, region, d); const bad = day.schools.filter((s) => s.issues.some((i) => ['nocoord_actual', 'lead_not_present'].includes(i.t)) || (s.issues.some((i) => i.t === 'shared_team') && !s.assigned && day.schools.some((x) => x.issues.some((i) => ['nocoord_actual', 'lead_not_present'].includes(i.t)))));
    if (!bad.length) continue;
    const r = ctx.rows[`${region}|${d}`] || {};
    out.push({ region, date: d, schools: day.schools.map((s) => ({ school: s.school, name: s.name, plan_lead: s.plan_lead, present: s.present, testers: s.testers, issues: s.issues.map((i) => i.t), note: s.issues.map((i) => i.text).join(' ') })),
      leave_on_record: [rc, arc].filter(Boolean).map((c) => ({ c, l: leaveOn(ctx, c, d) })).filter((x) => x.l).map((x) => ({ staff_id: x.c.id, name: x.c.name, kind: x.l.kind, approved: x.l.approved })),
      needs_acting: day.schools.filter((s) => s.issues.some((i) => i.t === 'nocoord_actual')).map((s) => ({ school: s.school, name: s.name, testers: s.testers })), response: r.response || null, ack: r.ack || null });
  }
  return out;
}

// ---- the views people get
export async function coverView(env, sum, who, q = {}) {
  const ctx = await loadCtx(env, sum); const today = ctx.today;
  if (who.role === 'volunteer') return { status: 'ok', role: 'volunteer', today, acting: actingFor(ctx, who) };
  const hq = who.role === 'hq'; const own = ['rc', 'arc'].includes(who.role) ? who.region : null; if (!hq && !own) return { error: 'This page is for coordinators and HQ', status: 403 };
  if (hq && !q.region) { // HQ overview: every region, the next working day and the days waiting for an answer
    const next = nextDays(today, 1).filter((d) => d > today)[0] || null; const regions = REGIONS.filter((r) => ctx.plans[r] && (ctx.plans[r].visits || []).length).map((r) => { const d = next ? regionDay(ctx, r, next) : null; const rows = pastRows(ctx, r);
      return { region: r, next: d && d.schools.length ? { date: next, state: d.complete ? 'complete' : 'open', coordinators: d.coordinators.map((c) => ({ name: c.name, position: c.position, state: c.state })), unassigned: d.unassigned, problems: d.problems } : null, rows_open: rows.filter((x) => !x.response).length, rows_to_ack: rows.filter((x) => x.response && !x.ack).length }; });
    return { status: 'ok', role: 'hq', today, next_day: next, deadline: next ? deadlineOf(next) : null, regions, coordinators: STAFF.filter((x) => x.active && ['rc', 'arc'].includes(x.role)).map((x) => ({ id: x.id, name: x.name, position: x.role === 'rc' ? 'RC' : 'ARC', region: x.region })), leave: ctx.leaves.slice().sort((a, b) => (b.from > a.from ? 1 : -1)).slice(0, 60) };
  }
  const region = (hq ? q.region : own).toUpperCase(); if (!REGIONS.includes(region)) return { error: 'Unknown region', status: 404 };
  const cs = coordsOf(region); const days = nextDays(today, 3).map((d) => ({ ...regionDay(ctx, region, d), deadline: deadlineOf(d) })).filter((d) => d.schools.length);
  return { status: 'ok', role: hq ? 'hq' : who.role, region, today, me: !hq ? (cs[who.role] || {}).id : null, coordinators: [cs.rc, cs.arc].filter(Boolean).map((c) => ({ id: c.id, name: c.name, position: c.role === 'rc' ? 'RC' : 'ARC' })),
    days, rows: pastRows(ctx, region), leave: ctx.leaves.filter((l) => l.region === region).sort((a, b) => (b.from > a.from ? 1 : -1)), people: [cs.rc, cs.arc, ...cs.vols].filter(Boolean).map((s) => ({ id: s.id, name: s.name, position: s.role === 'volunteer' ? 'Volunteer' : s.role.toUpperCase() })), kinds: LEAVE_KINDS, confirm_by: CONFIRM_BY };
}
function actingFor(ctx, who) { const out = []; for (const [k, a] of Object.entries(ctx.assign)) { const [date, school] = k.split('|'); if (date >= ctx.today && a.name === who.name && a.acting) out.push({ date, school, school_name: (SCHOOL_BY_ID[school] || {}).name || school, by: a.by }); } return out.sort((x, y) => (x.date > y.date ? 1 : -1)); }

// ---- who may do what
const isEditor = (w) => w.role === 'hq' && !(Array.isArray(w.hide) && w.hide.length) && (w.level || 'admin') !== 'viewer';
const canAct = (w, region) => isEditor(w) || (['rc', 'arc'].includes(w.role) && w.region === region);

// ---- assignments by school and day (who is the coordinator at each school), and each coordinator's own confirmation
export async function setAssign(env, who, { region, date, assignments }) {
  region = String(region || '').toUpperCase(); if (!REGIONS.includes(region) || !isIso(date)) return { error: 'Choose a region and a day', status: 422 }; if (!canAct(who, region)) return { error: 'Only the coordinators of this region, or HQ editors, can do this', status: 403 };
  const ctx = await loadCtx(env, null, [region]); const visits = (ctx.plans[region].visits || []).filter((v) => v.date === date); const { rc, arc, vols } = coordsOf(region); const assign = { ...ctx.assign }; const told = [];
  for (const a of assignments || []) {
    const v = visits.find((x) => x.school === a.school); if (!v) return { error: 'That school is not planned on this day', status: 422 };
    const name = String(a.name || ''); const coord = [rc, arc].find((c) => c && c.name === name);
    if (!coord) { const vol = vols.find((s) => s.name === name); if (!vol) return { error: `${name || 'Nobody'} cannot be the coordinator here: choose the RC, the ARC or a volunteer from the region's team`, status: 422 }; if (!(v.team || []).includes(name) && !isEditor(who)) return { error: `${name} is not in the team planned for this school. Add them to the team in Plan and calendar first, or ask HQ.`, status: 422 }; }
    const lv = leaveOn(ctx, coord, date); if (lv && lv.approved) return { error: `${name} is on leave this day. Choose someone else.`, status: 422 };
    const prev = assign[`${date}|${v.school}`]; assign[`${date}|${v.school}`] = { region, date, school: v.school, name, acting: !coord, role: coord ? coord.role : 'acting', by: who.name, at: new Date().toISOString(), source: isEditor(who) ? 'hq' : 'coordinator' };
    if (!coord && (!prev || prev.name !== name)) told.push({ name, school: v.school, date });
  }
  await kv(env).put(K_ASSIGN, assign);
  for (const t of told) { const st = STAFF.find((s) => s.name === t.name); if (st) { try { await pushTo(env, (w) => String(w && w.id) === String(st.id), { title: 'You are the acting coordinator', body: `${(SCHOOL_BY_ID[t.school] || {}).name || 'A school'} on ${t.date}. Open My day for details.`, url: '/#day' }); } catch { /* the page still shows it */ } } }
  return { ok: true };
}
export async function setConfirm(env, who, { region, date, staff_id, status, reason, note }) {
  region = String(region || '').toUpperCase(); if (!REGIONS.includes(region) || !isIso(date)) return { error: 'Choose a region and a day', status: 422 };
  const cs = coordsOf(region); const c = [cs.rc, cs.arc].find((x) => x && String(x.id) === String(staff_id)); if (!c) return { error: 'Choose the RC or the ARC', status: 422 };
  if (!(isEditor(who) || (['rc', 'arc'].includes(who.role) && who.region === region && String(who.id) === String(c.id)))) return { error: 'You confirm for yourself; HQ editors can confirm for anyone', status: 403 };
  if (!['ok', 'absent'].includes(status)) return { error: 'Choose confirm or away', status: 422 };
  if (status === 'absent' && !LEAVE_KINDS[reason]) return { error: 'Say why: sick leave, approved leave, other duty or other', status: 422 };
  if (status === 'absent' && (reason === 'other' || reason === 'duty') && clip(note, 200).length < 8) return { error: 'Write a short note (at least 8 characters)', status: 422 };
  const conf = await get(env, K_CONF, {}); conf[`${region}|${date}|${c.id}`] = { status, reason: status === 'absent' ? reason : '', note: clip(note, 200), by: who.name, at: new Date().toISOString() }; await kv(env).put(K_CONF, conf);
  if (status === 'absent') { const ls = await get(env, K_LEAVE, []); if (!ls.some((l) => String(l.staff_id) === String(c.id) && l.from <= date && date <= l.to)) { ls.push({ id: Math.random().toString(36).slice(2, 9), staff_id: c.id, name: c.name, region, from: date, to: date, kind: reason, approved: isEditor(who), approved_by: isEditor(who) ? who.name : null, note: clip(note, 120), by: who.name, at: new Date().toISOString(), source: isEditor(who) ? 'hq' : 'coordinator' }); await kv(env).put(K_LEAVE, ls); } }
  return { ok: true };
}

// ---- leave: coordinators report their own, HQ records or approves anyone's (no medical detail is kept)
export async function leaveAction(env, who, b) {
  const ls = await get(env, K_LEAVE, []); const now = new Date().toISOString();
  if (b.action === 'add') {
    const st = STAFF.find((s) => s.active && String(s.id) === String(b.staff_id)); if (!st || !['rc', 'arc'].includes(st.role)) return { error: 'Leave is recorded for an RC or an ARC', status: 422 };
    if (!(isEditor(who) || (['rc', 'arc'].includes(who.role) && String(who.id) === String(st.id)))) return { error: 'You can record leave for yourself; HQ editors can record it for anyone', status: 403 };
    if (!isIso(b.from) || !isIso(b.to) || b.to < b.from) return { error: 'Choose the first and last day', status: 422 }; if (!LEAVE_KINDS[b.kind]) return { error: 'Choose the kind of leave', status: 422 };
    const hq = isEditor(who); ls.push({ id: Math.random().toString(36).slice(2, 9), staff_id: st.id, name: st.name, region: st.region, from: b.from, to: b.to, kind: b.kind, approved: hq, approved_by: hq ? (clip(b.approved_by, 80) || who.name) : null, note: clip(b.note, 120), by: who.name, at: now, source: hq ? 'hq' : 'coordinator' });
  } else if (b.action === 'approve') { if (!isEditor(who)) return { error: 'Only HQ editors approve leave', status: 403 }; const l = ls.find((x) => x.id === b.id); if (!l) return { error: 'Not found', status: 404 }; l.approved = true; l.approved_by = clip(b.approved_by, 80) || who.name; l.approved_at = now; }
  else if (b.action === 'remove') { const i = ls.findIndex((x) => x.id === b.id); if (i < 0) return { error: 'Not found', status: 404 }; const l = ls[i]; if (!(isEditor(who) || (!l.approved && String(who.id) === String(l.staff_id)))) return { error: 'You cannot remove this', status: 403 }; ls.splice(i, 1); }
  else return { error: 'Unknown action', status: 422 };
  await kv(env).put(K_LEAVE, ls); return { ok: true };
}

// ---- days gone: the region answers once for the whole item, HQ acknowledges
export async function rowAction(env, who, b, sum = null) {
  const region = String(b.region || '').toUpperCase(); if (!REGIONS.includes(region) || !isIso(b.date)) return { error: 'Choose a region and a day', status: 422 };
  const rows = await get(env, K_ROWS, {}); const key = `${region}|${b.date}`; const r = (rows[key] ||= {});
  if (b.action === 'ack') { if (!isEditor(who)) return { error: 'Only HQ editors acknowledge', status: 403 }; if (!r.response) return { error: 'There is no answer to acknowledge yet', status: 409 }; r.ack = { by: who.name, at: new Date().toISOString(), note: clip(b.note, 200) }; await kv(env).put(K_ROWS, rows); return { ok: true }; }
  if (!canAct(who, region)) return { error: 'Only the coordinators of this region, or HQ editors, can answer', status: 403 };
  const ctx = await loadCtx(env, sum, [region]); ctx.rows = rows; const row = pastRows(ctx, region).find((x) => x.date === b.date);
  const choice = String(b.choice || ''); if (!['records_right', 'leave', 'other'].includes(choice)) return { error: 'Choose what happened', status: 422 };
  if (choice === 'other' && clip(b.note, 300).length < 8) return { error: 'Write a short explanation (at least 8 characters)', status: 422 };
  const acting = {}; for (const s of (row && row.needs_acting) || []) { const n = clip((b.acting || {})[s.school], 80); if (!n) return { error: `Name who acted as coordinator at ${s.name}, or write "nobody" and explain`, status: 422 }; if (n.toLowerCase() === 'nobody' && clip(b.note, 300).length < 8) return { error: `At ${s.name}, write a short note about why nobody acted as coordinator`, status: 422 }; acting[s.school] = n; }
  let leaveStaff = null; if (choice === 'leave') { const cs = coordsOf(region); leaveStaff = [cs.rc, cs.arc].find((c) => c && String(c.id) === String(b.staff_id)); if (!leaveStaff) return { error: 'Choose which coordinator was on leave', status: 422 }; }
  r.response = { choice, note: clip(b.note, 300), acting, staff_id: leaveStaff ? leaveStaff.id : null, by: who.name, at: new Date().toISOString() }; delete r.ack; await kv(env).put(K_ROWS, rows);
  if (leaveStaff) { const ls = await get(env, K_LEAVE, []); if (!ls.some((l) => String(l.staff_id) === String(leaveStaff.id) && l.from <= b.date && b.date <= l.to)) { ls.push({ id: Math.random().toString(36).slice(2, 9), staff_id: leaveStaff.id, name: leaveStaff.name, region, from: b.date, to: b.date, kind: 'other', approved: false, approved_by: null, note: clip(b.note, 120), by: who.name, at: new Date().toISOString(), source: 'coordinator' }); await kv(env).put(K_LEAVE, ls); } }
  return { ok: true };
}

// ---- scheduled: alerts to the individual, and what the Bridge shows
const seen = async (env, key, set) => { const l = await get(env, K_ALERTED, {}); if (l[key]) return true; if (set) { l[key] = Date.now(); await kv(env).put(K_ALERTED, l); } return false; };
export async function runCover(env, hhmm, sum, send = pushTo) {
  const today = eatToday(); const slot = { '11:30': 'ask', '13:30': 'remind', '04:05': 'morning' }[hhmm]; if (!slot || !isWorkingDay(today)) return { skipped: true };
  const ctx = await loadCtx(env, sum); const next = slot === 'morning' ? today : addWorkingDays(today, 1); if (next > FIELD_END) return { skipped: true }; const out = { sent: 0 };
  const to = async (c, title, body, url) => { await send(env, (w) => Boolean(w) && String(w.id) === String(c.id), { title, body, url }); out.sent++; };
  for (const region of REGIONS) {
    const day = regionDay(ctx, region, next); if (!day.schools.length) continue;
    for (const c of day.coordinators) if (c.state === 'open' && !(await seen(env, `${slot}|${next}|${c.id}`, true))) await to(c, slot === 'remind' ? 'Please confirm tomorrow before 18:00' : slot === 'morning' ? 'Confirm today\'s assignment' : 'Confirm tomorrow\'s assignment', `${day.schools.length} school${day.schools.length === 1 ? '' : 's'} on ${next}. Say who is at each school, or that you will be away.`, '/#cover');
    if (slot === 'ask') { const rows = pastRows(ctx, region).filter((r) => !r.response); const al = await get(env, K_ALERTED, {}); const fresh = rows.filter((r) => !al[`row|${region}|${r.date}`]);
      if (fresh.length) { for (const r of fresh) al[`row|${region}|${r.date}`] = Date.now(); await kv(env).put(K_ALERTED, al); for (const c of day.coordinators.length ? day.coordinators : [coordsOf(region).rc, coordsOf(region).arc].filter(Boolean)) await to(c, 'Days to confirm', `${fresh.length} past day${fresh.length === 1 ? '' : 's'} where the plan and the records differ. Please confirm what happened.`, '/#cover'); } }
  }
  return out;
}
export async function coverAttention(env, sum) {
  const ctx = await loadCtx(env, sum); const today = ctx.today; const next = nextDays(today, 1).filter((d) => d > today)[0]; const nowEat = new Date(Date.now() + 3 * 3600e3).toISOString(); let unconf = 0, unassigned = 0, rows = 0, rowsAck = 0; const regs = new Set();
  for (const region of REGIONS) {
    if (next) { const d = regionDay(ctx, region, next); if (d.schools.length) { const late = nowEat >= deadlineOf(next); unassigned += d.unassigned; if (late) { const o = d.coordinators.filter((c) => c.state === 'open').length; unconf += o; if (o) regs.add(region); } } }
    const pr = pastRows(ctx, region); rows += pr.filter((r) => !r.response).length; rowsAck += pr.filter((r) => r.response && !r.ack).length; if (pr.some((r) => !r.response)) regs.add(region);
  }
  return { unconfirmed: unconf, unassigned, rows_open: rows, rows_to_ack: rowsAck, regions: [...regs], next };
}
export const _norm = norm;
