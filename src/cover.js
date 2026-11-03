// Coordinator coverage: every school visit has an RC or ARC present, or a named acting coordinator from the team's volunteers.
// Each working day the coordinators confirm who is at which school (and who is away, and who acts). Every evening the plan is compared with the records.
// Rules: (1) a school visit always has a coordinator or a named acting coordinator; (2) when the RC and the ARC are both at one school the RC leads;
// (3) the same person may visit several schools in a day only at different times (an hour apart), so each school has its own lead at its own time. Wording is for support, never blame.
// Nothing here changes a test record, a plan or a payment. Leave notes never hold medical detail.
import { kv } from './store.js';
import { STAFF, SCHOOL_BY_ID, REGIONS, FIELD_START, FIELD_END, eatToday, isWorkingDay, addWorkingDays, norm } from './config.js';
import { getPlan, leadOfVisit, clashingPeople, overloaded } from './plan.js';
import { pushTo } from './push.js';

const K_LEAVE = 'v2:cover:leave', K_ASSIGN = 'v2:cover:assign', K_CONF = 'v2:cover:conf', K_ROWS = 'v2:cover:rows', K_ALERTED = 'v2:cover:alerted';
export const COVER_LIVE_FROM = '2026-11-05'; // coordinators are asked to confirm from this day on (the first alert goes out the afternoon before)
export const ROWS_FROM = '2026-11-03'; // days gone get 2 working days to answer, counted from this day for anything older
export const DUE_DAYS = 2;
export const CONFIRM_BY = '18:00'; // East Africa Time, the working day before: coordinators use the app mostly 12:00 to 19:00 and field days end by about 14:00
export const LEAVE_KINDS = { sick: 'Sick leave', leave: 'Approved leave', duty: 'Other duty', other: 'Other' };
const clip = (s, n) => String(s || '').trim().slice(0, n);
// leave notes never hold health details: refuse the obvious words (English and Kiswahili), so nothing private is saved by accident
const HEALTH = /\b(malaria|typhoid|fever|cough|flu|covid|cancer|hiv|aids|tb|tuberculosis|surgery|operation|hospital|clinic|dispensary|doctor|injection|medicine|medication|pregnan\w*|blood|bleeding|pain|accident|injur\w*|ulcer|diabetes|pressure|headache|stomach|ugonjwa|homa|maumivu|hospitali|zahanati|daktari|ajali|dawa|damu|mimba|kifua|tumbo|kichwa)\b/i;
const noHealth = (...notes) => (notes.some((n) => HEALTH.test(String(n || ''))) ? { error: 'Please do not write health details. Just say "sick leave" and leave the note short.', status: 422 } : null);
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
const lead0 = (v, region, rc) => { const p = leadOfVisit(v, region); return p; };
const leaveOn = (ctx, staff, date) => (staff ? ctx.leaves.find((l) => String(l.staff_id) === String(staff.id) && l.from <= date && date <= l.to) || null : null);

// ---- one region on one day: each school with its coordinator (named, planned or missing), what the records show, and the problems
export function regionDay(ctx, region, date) {
  const plan = ctx.plans[region] || { visits: [] }; const { rc, arc } = coordsOf(region); const names = new Set([rc && rc.name, arc && arc.name].filter(Boolean));
  const visits = (plan.visits || []).filter((v) => v.date === date);
  const schools = visits.map((v) => {
    const team = v.team || []; const inRc = rc && team.includes(rc.name), inArc = arc && team.includes(arc.name);
    let planLead = leadOfVisit(v, region); if (inRc && inArc) planLead = rc.name; // when both are at one school, the RC leads
    const a = ctx.assign[`${date}|${v.school}`] || null; const lead = a ? a.name : planLead; const leadStaff = [rc, arc].find((c) => c && c.name === lead) || null;
    const leave = leaveOn(ctx, leadStaff, date); const issues = [];
    const over = overloaded(visits.map((x) => ({ ...x, lead: x.lead || null })));
    if (over.some((p) => team.includes(p) || p === lead0(v, region, rc))) issues.push({ t: 'overload', text: `${over.filter((p) => team.includes(p) || p === lead0(v, region, rc)).join(', ')} would work at three schools in one day. That is too much for one person or one team. Please share the people and the coordinators between the schools.` });
    const shared = clashingPeople(v, visits);
    if (shared.length && !a) issues.push({ t: 'shared_team', text: `${shared.join(', ')} ${shared.length === 1 ? 'is' : 'are'} planned at two schools that start at almost the same time. One person cannot be in two places at once. Please start the schools at least one hour apart, or change the team.` });
    if (inRc && inArc && v.lead && v.lead !== rc.name && !a) issues.push({ t: 'rc_rule', text: 'The RC and the ARC are both at this school. When that happens, the RC leads.' });
    if (!lead) issues.push({ t: 'no_coordinator', text: 'No RC or ARC is named for this school. Please choose an acting coordinator: a volunteer from the team who will lead the visit.' });
    else if (leave && (!a || a.name === leadStaff.name)) issues.push({ t: 'lead_on_leave', text: `${lead} will be away on this day. Please choose an acting coordinator: a volunteer from the team who will lead the visit.` });
    const actual = ((ctx.sum && ctx.sum.schools && ctx.sum.schools[v.school] && ctx.sum.schools[v.school].dayAdmins) || {})[date] || [];
    const present = actual.filter((n) => names.has(n)); const past = date <= ctx.today && actual.length > 0;
    const elsewhere = lead && past && !actual.includes(lead) ? (ctx.at[lead + '|' + date] || []).filter((x) => x !== v.school).map((x) => (SCHOOL_BY_ID[x] || {}).name || x) : null;
    if (past && !present.length && !(a && !names.has(a.name) && actual.includes(a.name))) issues.push({ t: 'nocoord_actual', text: 'The test records show that no RC or ARC was at this school on this day.' });
    else if (past && lead && names.has(lead) && !actual.includes(lead)) issues.push({ t: 'lead_not_present', text: `${lead} was planned to lead this school, but the test records show ${elsewhere && elsewhere.length ? 'them at ' + elsewhere.join(', ') + ' instead' : 'no work from them that day'}.` });
    return { school: v.school, name: (SCHOOL_BY_ID[v.school] || {}).name || v.school, lga: (SCHOOL_BY_ID[v.school] || {}).lga || '', start: v.start || '', team, vols: team.filter((n) => !names.has(n)), plan_lead: planLead, assigned: a ? { name: a.name, acting: !names.has(a.name), by: a.by, at: a.at } : null, lead, issues, testers: actual, present };
  });
  const coords = [rc, arc].filter(Boolean).map((c) => { const k = `${region}|${date}|${c.id}`; const lv = leaveOn(ctx, c, date); const cf = ctx.conf[k] || null;
    return { id: c.id, name: c.name, position: c.role === 'rc' ? 'RC' : 'ARC', leave: lv ? { kind: lv.kind, approved: lv.approved } : null, confirm: cf ? { status: cf.status, reason: cf.reason || '', note: cf.note || '', by: cf.by, at: cf.at } : null,
      state: lv && lv.approved ? 'leave' : cf ? (cf.status === 'absent' ? 'absent' : 'confirmed') : 'open', schools_planned: schools.filter((s) => (s.team || []).includes(c.name) || s.lead === c.name).map((s) => s.name) }; });
  // a day is CLEAR when every school has its coordinator, both coordinators are placed, and nothing clashes: then nobody is asked anything
  const placed = new Set(); for (const s of schools) { (s.team || []).forEach((n) => placed.add(n)); if (s.lead) placed.add(s.lead); }
  const unplaced = [rc, arc].filter((c) => c && !placed.has(c.name) && !(leaveOn(ctx, c, date) && leaveOn(ctx, c, date).approved) && !(ctx.conf[`${region}|${date}|${c.id}`] || {}).status);
  const BLOCK = ['no_coordinator', 'lead_on_leave', 'shared_team', 'rc_rule', 'overload'];
  const reasons = [...new Set(schools.flatMap((s) => s.issues.filter((i) => BLOCK.includes(i.t)).map((i) => `${s.name}: ${i.text}`))), ...unplaced.map((c) => `${c.name} has no school on this day.`)];
  const clear = schools.length > 0 && reasons.length === 0;
  const unassigned = schools.filter((s) => !s.assigned && s.issues.some((i) => ['no_coordinator', 'lead_on_leave'].includes(i.t))).length; const open = coords.filter((c) => c.state === 'open').length;
  return { region, date, schools, coordinators: coords, clear, reasons, complete: clear || (schools.length > 0 && schools.every((s) => s.assigned || !s.issues.some((i) => BLOCK.includes(i.t))) && !open && !unplaced.length && !schools.some((s) => s.issues.some((i) => i.t === 'overload'))), unassigned, open, problems: schools.reduce((n, s) => n + s.issues.filter((i) => ['no_coordinator', 'lead_on_leave', 'shared_team', 'rc_rule', 'overload'].includes(i.t)).length, 0) };
}

// ---- days still to come (confirmed ahead) and days gone (plan against records)
export const nextDays = (today, n = 3) => { const out = []; let d = today; if (isWorkingDay(today)) out.push(today); for (let i = 0; i < n; i++) { d = addWorkingDays(d, 1); if (d <= FIELD_END) out.push(d); } return out; };
export const deadlineOf = (date) => { let d = new Date(date + 'T00:00:00Z'); do { d = new Date(d.getTime() - 86400e3); } while (!isWorkingDay(d.toISOString().slice(0, 10))); return d.toISOString().slice(0, 10) + 'T' + CONFIRM_BY; }; // working day before, 18:00 EAT
const stageOf = (r) => r.stage || (r.ack ? 'closed' : r.response ? 'hq1' : 'open');
export const STAGE_LABEL = { open: 'Waiting for the region', rework: 'Sent back to the region', hq1: 'First HQ review (Joram)', final: 'Final confirmation (Mundo)', closed: 'Closed' };
function rowState(ctx, date, r) { const stage = stageOf(r); const due = addWorkingDays(date > ROWS_FROM ? date : ROWS_FROM, DUE_DAYS); return { stage, stage_label: STAGE_LABEL[stage], due, overdue: ['open', 'rework'].includes(stage) && ctx.today > due, auto: Boolean(r.auto), history: r.history || [], closed_at: r.closed_at || null }; }
export function pastRows(ctx, region) {
  const plan = ctx.plans[region] || { visits: [] }; const dates = [...new Set((plan.visits || []).map((v) => v.date))].filter((d) => d >= FIELD_START && d < ctx.today).sort(); const { rc, arc } = coordsOf(region); const out = [];
  for (const d of dates) {
    const day = regionDay(ctx, region, d); const bad = day.schools.filter((s) => s.issues.some((i) => ['nocoord_actual', 'lead_not_present'].includes(i.t)) || (s.issues.some((i) => i.t === 'shared_team') && !s.assigned && day.schools.some((x) => x.issues.some((i) => ['nocoord_actual', 'lead_not_present'].includes(i.t)))));
    if (!bad.length) continue;
    const r = ctx.rows[`${region}|${d}`] || {};
    out.push({ region, date: d, schools: day.schools.map((s) => ({ school: s.school, name: s.name, plan_lead: s.plan_lead, present: s.present, testers: s.testers, issues: s.issues.map((i) => i.t), note: s.issues.map((i) => i.text).join(' ') })),
      leave_on_record: [rc, arc].filter(Boolean).map((c) => ({ c, l: leaveOn(ctx, c, d) })).filter((x) => x.l).map((x) => ({ staff_id: x.c.id, name: x.c.name, kind: x.l.kind, approved: x.l.approved })),
      needs_acting: day.schools.filter((s) => s.issues.some((i) => i.t === 'nocoord_actual')).map((s) => ({ school: s.school, name: s.name, testers: s.testers })), response: r.response || null, ...rowState(ctx, d, r) });
  }
  return out;
}

// ---- the views people get
export async function coverView(env, sum, who, q = {}) {
  const ctx = await loadCtx(env, sum); const today = ctx.today;
  if (q.brief) { const regs = who.role === 'hq' ? REGIONS : ['rc', 'arc'].includes(who.role) ? [who.region] : []; let open = 0, overdue = 0, h1 = 0, fin = 0, unclear = 0; const win = nextDays(today, 2).filter((d) => d >= COVER_LIVE_FROM);
    for (const r of regs) { for (const x of pastRows(ctx, r)) { if (['open', 'rework'].includes(x.stage)) open++; if (x.overdue) overdue++; if (x.stage === 'hq1') h1++; if (x.stage === 'final') fin++; }
      if (who.role === 'hq') { const nd = win.find((d) => d > today) || win[0]; if (nd) { const dd = regionDay(ctx, r, nd); if (dd.schools.length && !dd.clear && !dd.complete) unclear++; } } else for (const d of win) { const dd = regionDay(ctx, r, d); const me = dd.coordinators.find((c) => String(c.id) === String(who.id)); if (dd.schools.length && !dd.clear && !dd.complete && me && me.state === 'open') unclear++; } }
    const lvl = who.review_level || 0; const for_me = who.role === 'hq' ? (isEditor(who) && lvl >= 2 && !isMundo(who) ? h1 : 0) + (isEditor(who) && lvl >= 3 ? fin : 0) : 0;
    return { status: 'ok', brief: true, role: who.role, open, overdue, for_me, unclear, act: who.role === 'hq' ? for_me + unclear : open + unclear }; }
  if (who.role === 'volunteer') return { status: 'ok', role: 'volunteer', today, acting: actingFor(ctx, who) };
  const hq = who.role === 'hq'; const own = ['rc', 'arc'].includes(who.role) ? who.region : null; if (!hq && !own) return { error: 'This page is for coordinators and HQ', status: 403 };
  if (hq && !q.region) { // HQ overview: every region, the next working day and the days waiting for an answer
    const next = nextDays(today, 1).filter((d) => d > today)[0] || null; const regions = REGIONS.filter((r) => ctx.plans[r] && (ctx.plans[r].visits || []).length).map((r) => { const d = next ? regionDay(ctx, r, next) : null; const rows = pastRows(ctx, r);
      return { region: r, next: d && d.schools.length ? { date: next, state: d.clear ? 'clear' : d.complete ? 'complete' : 'open', coordinators: d.coordinators.map((c) => ({ name: c.name, position: c.position, state: c.state })), unassigned: d.unassigned, problems: d.problems } : null, rows_open: rows.filter((x) => ['open', 'rework'].includes(x.stage)).length, rows_overdue: rows.filter((x) => x.overdue).length, rows_hq: rows.filter((x) => ['hq1', 'final'].includes(x.stage)).length }; });
    const rq = []; for (const r of REGIONS) for (const x of pastRows(ctx, r)) if (['hq1', 'final'].includes(x.stage)) rq.push({ region: r, date: x.date, stage: x.stage, stage_label: x.stage_label, response: x.response, history: x.history, due: x.due, schools: x.schools.map((y) => y.name) });
    const lvl = who.review_level || 0; return { status: 'ok', role: 'hq', today, live_from: COVER_LIVE_FROM, review: rq, can_review: { hq1: isEditor(who) && lvl >= 2 && !isMundo(who), final: isEditor(who) && lvl >= 3 }, next_day: next, deadline: next ? deadlineOf(next) : null, regions, coordinators: STAFF.filter((x) => x.active && ['rc', 'arc'].includes(x.role)).map((x) => ({ id: x.id, name: x.name, position: x.role === 'rc' ? 'RC' : 'ARC', region: x.region })), leave: ctx.leaves.slice().sort((a, b) => (b.from > a.from ? 1 : -1)).slice(0, 60) };
  }
  const region = (hq ? q.region : own).toUpperCase(); if (!REGIONS.includes(region)) return { error: 'Unknown region', status: 404 };
  const cs = coordsOf(region); const days = nextDays(today, 3).map((d) => ({ ...regionDay(ctx, region, d), deadline: deadlineOf(d) })).filter((d) => d.schools.length);
  return { status: 'ok', role: hq ? 'hq' : who.role, region, today, live_from: COVER_LIVE_FROM, me: !hq ? (cs[who.role] || {}).id : null, coordinators: [cs.rc, cs.arc].filter(Boolean).map((c) => ({ id: c.id, name: c.name, position: c.role === 'rc' ? 'RC' : 'ARC' })),
    days, rows: pastRows(ctx, region), leave: ctx.leaves.filter((l) => l.region === region).sort((a, b) => (b.from > a.from ? 1 : -1)), people: [cs.rc, cs.arc, ...cs.vols].filter(Boolean).map((s) => ({ id: s.id, name: s.name, position: s.role === 'volunteer' ? 'Volunteer' : s.role.toUpperCase() })), kinds: LEAVE_KINDS, confirm_by: CONFIRM_BY };
}
function actingFor(ctx, who) { const out = []; for (const [k, a] of Object.entries(ctx.assign)) { const [date, school] = k.split('|'); if (date >= ctx.today && a.name === who.name && a.acting) out.push({ date, school, school_name: (SCHOOL_BY_ID[school] || {}).name || school, by: a.by }); } return out.sort((x, y) => (x.date > y.date ? 1 : -1)); }

// ---- who may do what
const isEditor = (w) => w.role === 'hq' && !(Array.isArray(w.hide) && w.hide.length) && (w.level || 'admin') !== 'viewer';
const canAct = (w, region) => isEditor(w) || (['rc', 'arc'].includes(w.role) && w.region === region);

// ---- assignments by school and day (who is the coordinator at each school), and each coordinator's own confirmation
export async function setAssign(env, who, { region, date, assignments }) {
  region = String(region || '').toUpperCase(); if (!REGIONS.includes(region) || !isIso(date)) return { error: 'Please choose a region and a day.', status: 422 }; if (!canAct(who, region)) return { error: 'Only the RC or ARC of this region, or HQ staff who can edit, can do this.', status: 403 };
  const ctx = await loadCtx(env, null, [region]); const visits = (ctx.plans[region].visits || []).filter((v) => v.date === date); const { rc, arc, vols } = coordsOf(region); const assign = { ...ctx.assign }; const told = [];
  for (const a of assignments || []) {
    const v = visits.find((x) => x.school === a.school); if (!v) return { error: 'This school is not on the plan for this day.', status: 422 };
    const name = String(a.name || ''); const coord = [rc, arc].find((c) => c && c.name === name);
    if (!coord) { const vol = vols.find((s) => s.name === name); if (!vol) return { error: `${name || 'Nobody'} cannot lead here. Please choose the RC, the ARC, or a volunteer from this school's team.`, status: 422 }; if (!(v.team || []).includes(name) && !isEditor(who)) return { error: `${name} is not in the team for this school. Please add them to the team in Plan and calendar first, or ask HQ.`, status: 422 }; }
    const lv = leaveOn(ctx, coord, date); if (lv && lv.approved) return { error: `${name} will be away on this day. Please choose someone else.`, status: 422 };
    const prev = assign[`${date}|${v.school}`]; assign[`${date}|${v.school}`] = { region, date, school: v.school, name, acting: !coord, role: coord ? coord.role : 'acting', by: who.name, at: new Date().toISOString(), source: isEditor(who) ? 'hq' : 'coordinator' };
    if (!coord && (!prev || prev.name !== name)) told.push({ name, school: v.school, date });
  }
  await kv(env).put(K_ASSIGN, assign);
  for (const t of told) { const st = STAFF.find((s) => s.name === t.name); if (st) { try { await pushTo(env, (w) => String(w && w.id) === String(st.id), { title: 'You will lead a school visit', body: `${(SCHOOL_BY_ID[t.school] || {}).name || 'A school'} on ${t.date}. Your coordinator asked you to lead the visit. Open My day.`, url: '/#day' }); } catch { /* the page still shows it */ } } }
  return { ok: true };
}
export async function setConfirm(env, who, { region, date, staff_id, status, reason, note }) {
  region = String(region || '').toUpperCase(); if (!REGIONS.includes(region) || !isIso(date)) return { error: 'Please choose a region and a day.', status: 422 };
  const cs = coordsOf(region); const c = [cs.rc, cs.arc].find((x) => x && String(x.id) === String(staff_id)); if (!c) return { error: 'Please choose the RC or the ARC.', status: 422 };
  if (!(isEditor(who) || (['rc', 'arc'].includes(who.role) && who.region === region && String(who.id) === String(c.id)))) return { error: 'You can only confirm for yourself. HQ staff who can edit can confirm for anyone.', status: 403 };
  if (!['ok', 'absent'].includes(status)) return { error: 'Please choose to confirm, or to say you will be away.', status: 422 };
  if (status === 'absent' && !LEAVE_KINDS[reason]) return { error: 'Please say why you will be away: sick leave, approved leave, other duty, or other.', status: 422 };
  { const h = noHealth(note); if (h) return h; }
  if (status === 'absent' && (reason === 'other' || reason === 'duty') && clip(note, 200).length < 8) return { error: 'Please write a short note (at least 8 letters).', status: 422 };
  const conf = await get(env, K_CONF, {}); conf[`${region}|${date}|${c.id}`] = { status, reason: status === 'absent' ? reason : '', note: clip(note, 200), by: who.name, at: new Date().toISOString() }; await kv(env).put(K_CONF, conf);
  if (status === 'absent') { const ls = await get(env, K_LEAVE, []); if (!ls.some((l) => String(l.staff_id) === String(c.id) && l.from <= date && date <= l.to)) { ls.push({ id: Math.random().toString(36).slice(2, 9), staff_id: c.id, name: c.name, region, from: date, to: date, kind: reason, approved: isEditor(who), approved_by: isEditor(who) ? who.name : null, note: clip(note, 120), by: who.name, at: new Date().toISOString(), source: isEditor(who) ? 'hq' : 'coordinator' }); await kv(env).put(K_LEAVE, ls); } }
  return { ok: true };
}

// ---- leave: coordinators report their own, HQ records or approves anyone's (no medical detail is kept)
export async function leaveAction(env, who, b) {
  const ls = await get(env, K_LEAVE, []); const now = new Date().toISOString();
  if (b.action === 'add') {
    const st = STAFF.find((s) => s.active && String(s.id) === String(b.staff_id)); if (!st || !['rc', 'arc'].includes(st.role)) return { error: 'Leave can only be saved for an RC or an ARC.', status: 422 };
    if (!(isEditor(who) || (['rc', 'arc'].includes(who.role) && String(who.id) === String(st.id)))) return { error: 'You can save leave for yourself. HQ staff who can edit can save it for anyone.', status: 403 };
    { const h = noHealth(b.note, b.approved_by); if (h) return h; }
    if (!isIso(b.from) || !isIso(b.to) || b.to < b.from) return { error: 'Please choose the first day and the last day.', status: 422 }; if (!LEAVE_KINDS[b.kind]) return { error: 'Please choose the kind of leave.', status: 422 };
    const hq = isEditor(who); ls.push({ id: Math.random().toString(36).slice(2, 9), staff_id: st.id, name: st.name, region: st.region, from: b.from, to: b.to, kind: b.kind, approved: hq, approved_by: hq ? (clip(b.approved_by, 80) || who.name) : null, note: clip(b.note, 120), by: who.name, at: now, source: hq ? 'hq' : 'coordinator' });
  } else if (b.action === 'approve') { if (!isEditor(who)) return { error: 'Only HQ staff who can edit can approve leave.', status: 403 }; const l = ls.find((x) => x.id === b.id); if (!l) return { error: 'Not found', status: 404 }; l.approved = true; l.approved_by = clip(b.approved_by, 80) || who.name; l.approved_at = now; }
  else if (b.action === 'remove') { const i = ls.findIndex((x) => x.id === b.id); if (i < 0) return { error: 'Not found', status: 404 }; const l = ls[i]; if (!(isEditor(who) || (!l.approved && String(who.id) === String(l.staff_id)))) return { error: 'You cannot remove this', status: 403 }; ls.splice(i, 1); }
  else return { error: 'Unknown action', status: 422 };
  await kv(env).put(K_LEAVE, ls); return { ok: true };
}

// ---- days gone: the region answers once for the whole item, HQ acknowledges
const isMundo = (w) => Boolean(w && w.role === 'hq' && (w.hq_id === 'h1' || /mundo/i.test(w.name || '')));
const hist = (r, who, level, action, note) => { (r.history ||= []).push({ at: new Date().toISOString(), by: who.name, by_id: who.hq_id || who.id, level, action, note: clip(note, 300) }); };
const alertHq = async (env, send, title, body, pred) => { try { await send(env, (w) => Boolean(w) && w.role === 'hq' && pred(w), { title, body, url: '/#cover' }); } catch { /* the page still shows it */ } };
const alertRegion = async (env, send, region, title, body) => { const cs = coordsOf(region); for (const c of [cs.rc, cs.arc].filter(Boolean)) { try { await send(env, (w) => Boolean(w) && String(w.id) === String(c.id), { title, body, url: '/#cover' }); } catch { /* the page still shows it */ } } };
// days gone: the region answers; an answer that is approved leave plus a named acting coordinator closes by itself; any other answer goes to Joram, then to Mundo (a different person)
export async function rowAction(env, who, b, sum = null, send = pushTo) {
  const region = String(b.region || '').toUpperCase(); if (!REGIONS.includes(region) || !isIso(b.date)) return { error: 'Please choose a region and a day.', status: 422 };
  const rows = await get(env, K_ROWS, {}); const key = `${region}|${b.date}`; const r = (rows[key] ||= {}); const stage = stageOf(r);
  if (b.action === 'review') {
    if (!['hq1', 'final'].includes(stage)) return { error: 'There is nothing to check right now.', status: 409 }; if (!isEditor(who)) return { error: 'Only HQ staff who can edit can check this.', status: 403 };
    const lvl = who.review_level || 0; const me = who.hq_id || who.id;
    if (stage === 'hq1' && (lvl < 2 || isMundo(who))) return { error: 'This is waiting for the first check by Joram. Mundo makes the last check.', status: 403 };
    if (stage === 'final' && (lvl < 3 || (r.history || []).some((h) => h.level === 'hq1' && h.action !== 'sent back' && h.by_id === me))) return { error: 'This is waiting for the last check. It must be a different person from the one who did the first check.', status: 403 };
    if (b.decision === 'reject') { { const h = noHealth(b.note); if (h) return h; } const n = clip(b.note, 300); if (n.length < 8) return { error: 'Please write why you are sending it back. One short sentence is enough.', status: 422 }; hist(r, who, stage, 'sent back', n); r.stage = 'rework'; r.rework_note = n; await kv(env).put(K_ROWS, rows); await alertRegion(env, send, region, 'A day was sent back to you', `${b.date}: ${n.slice(0, 90)}. Please answer again.`); return { ok: true }; }
    if (b.decision !== 'approve') return { error: 'Please choose Approve or Send back.', status: 422 };
    hist(r, who, stage, 'approved', b.note); if (stage === 'hq1') { r.stage = 'final'; await kv(env).put(K_ROWS, rows); await alertHq(env, send, 'A day is waiting for your last check', `${region.charAt(0) + region.slice(1).toLowerCase()}, ${b.date}. Joram has checked it. Please make the last check.`, (w) => (w.review_level || 0) >= 3); }
    else { r.stage = 'closed'; r.closed_at = new Date().toISOString(); await kv(env).put(K_ROWS, rows); }
    return { ok: true };
  }
  if (!canAct(who, region)) return { error: 'Only the RC or ARC of this region, or HQ staff who can edit, can answer.', status: 403 };
  if (!['open', 'rework'].includes(stage)) return { error: 'This day is already with HQ, or it is finished.', status: 409 };
  const ctx = await loadCtx(env, sum, [region]); ctx.rows = rows; const row = pastRows(ctx, region).find((x) => x.date === b.date);
  const choice = String(b.choice || ''); if (!['records_right', 'leave', 'other'].includes(choice)) return { error: 'Please choose what happened.', status: 422 };
  { const h = noHealth(b.note, ...Object.values(b.acting || {})); if (h) return h; }
  if (choice === 'other' && clip(b.note, 300).length < 8) return { error: 'Please write a short explanation (at least 8 letters).', status: 422 };
  const acting = {}; for (const sc of (row && row.needs_acting) || []) { const n = clip((b.acting || {})[sc.school], 80); if (!n) return { error: `Please say who led the visit at ${sc.name}. If nobody did, choose "Nobody" and explain in the note.`, status: 422 }; if (n.toLowerCase() === 'nobody' && clip(b.note, 300).length < 8) return { error: `You chose "Nobody" at ${sc.name}. Please write a short note to say why.`, status: 422 }; acting[sc.school] = n; }
  let leaveStaff = null; if (choice === 'leave') { const cs = coordsOf(region); leaveStaff = [cs.rc, cs.arc].find((c) => c && String(c.id) === String(b.staff_id)); if (!leaveStaff) return { error: 'Please choose which coordinator was away.', status: 422 }; }
  const re = stage === 'rework'; r.response = { choice, note: clip(b.note, 300), acting, staff_id: leaveStaff ? leaveStaff.id : null, by: who.name, at: new Date().toISOString() }; delete r.rework_note;
  let ls = await get(env, K_LEAVE, []);
  if (leaveStaff && !ls.some((l) => String(l.staff_id) === String(leaveStaff.id) && l.from <= b.date && b.date <= l.to)) { ls.push({ id: Math.random().toString(36).slice(2, 9), staff_id: leaveStaff.id, name: leaveStaff.name, region, from: b.date, to: b.date, kind: 'other', approved: false, approved_by: null, note: clip(b.note, 120), by: who.name, at: new Date().toISOString(), source: 'coordinator' }); await kv(env).put(K_LEAVE, ls); }
  hist(r, who, 'region', re ? 'answered again' : 'answered', `${choice}${b.note ? ': ' + b.note : ''}`);
  const approvedLeave = leaveStaff && ls.some((l) => String(l.staff_id) === String(leaveStaff.id) && l.from <= b.date && b.date <= l.to && l.approved);
  const actedFine = Object.values(acting).every((n) => n.toLowerCase() !== 'nobody');
  const planOnly = choice === 'records_right' && !((row && row.needs_acting) || []).length; // every school that day had a coordinator in the records: only the plan was out of date, nothing to judge
  if ((choice === 'leave' && approvedLeave && actedFine) || planOnly) { r.stage = 'closed'; r.auto = true; r.closed_at = new Date().toISOString(); (r.history ||= []).push({ at: r.closed_at, by: 'Command Center', by_id: 'system', level: 'auto', action: 'closed by itself', note: planOnly ? 'The region said the records are right. Every school had a coordinator in the records, so only the plan was out of date.' : 'Approved leave is on record and an acting coordinator is named where needed.' }); await kv(env).put(K_ROWS, rows); return { ok: true, closed: true }; }
  r.stage = 'hq1'; await kv(env).put(K_ROWS, rows);
  await alertHq(env, send, 'A day is waiting for your check', `${region.charAt(0) + region.slice(1).toLowerCase()}, ${b.date}. The region has answered. Please check it.`, (w) => (w.review_level || 0) >= 2 && !isMundo(w));
  return { ok: true };
}

// ---- scheduled: alerts to the individual, and what the Bridge shows
const seen = async (env, key, set) => { const l = await get(env, K_ALERTED, {}); if (l[key]) return true; if (set) { l[key] = Date.now(); await kv(env).put(K_ALERTED, l); } return false; };
export async function runCover(env, hhmm, sum, send = pushTo, liveFrom = COVER_LIVE_FROM) {
  const today = eatToday(); const slot = { '11:30': 'ask', '13:30': 'remind', '04:05': 'morning' }[hhmm]; if (!slot || !isWorkingDay(today)) return { skipped: true };
  const ctx = await loadCtx(env, sum); const next = slot === 'morning' ? today : addWorkingDays(today, 1); if (next > FIELD_END || next < liveFrom) return { skipped: true }; const out = { sent: 0 };
  const to = async (c, title, body, url) => { await send(env, (w) => Boolean(w) && String(w.id) === String(c.id), { title, body, url }); out.sent++; };
  for (const region of REGIONS) {
    const day = regionDay(ctx, region, next); if (!day.schools.length) continue;
    if (!day.clear && !day.complete) for (const c of day.coordinators) if (c.state === 'open' && !(await seen(env, `${slot}|${next}|${c.id}`, true))) await to(c, slot === 'remind' ? 'Please fix tomorrow\'s plan before 6 pm' : slot === 'morning' ? 'Today\'s plan needs your help' : 'Tomorrow\'s plan needs your help', `${(day.reasons[0] || 'It is not clear who leads each school').slice(0, 100)}${day.reasons.length > 1 ? ` (and ${day.reasons.length - 1} more)` : ''}. Open Confirm days.`, '/#cover');
    if (slot === 'ask') { const rows = pastRows(ctx, region).filter((r) => ['open', 'rework'].includes(r.stage)); const al = await get(env, K_ALERTED, {}); const fresh = rows.filter((r) => !al[`row|${region}|${r.date}`]);
      if (fresh.length) { for (const r of fresh) al[`row|${region}|${r.date}`] = Date.now(); await kv(env).put(K_ALERTED, al); for (const c of day.coordinators.length ? day.coordinators : [coordsOf(region).rc, coordsOf(region).arc].filter(Boolean)) await to(c, 'Please answer some past days', `${fresh.length} past day${fresh.length === 1 ? '' : 's'} need${fresh.length === 1 ? 's' : ''} your answer. The plan and the test records do not match. Please answer by ${fresh[0].due}. Open Confirm days.`, '/#cover'); } }
  }
  for (const region of REGIONS) { const od = pastRows(ctx, region).filter((r) => r.overdue && !(false)); const al = await get(env, K_ALERTED, {}); const fresh = od.filter((r) => !al[`due|${region}|${r.date}`]); if (slot === 'ask' && fresh.length) { for (const r of fresh) al[`due|${region}|${r.date}`] = Date.now(); await kv(env).put(K_ALERTED, al); const cs = coordsOf(region); for (const c of [cs.rc, cs.arc].filter(Boolean)) await to(c, 'Past days are late', `${fresh.length} past day${fresh.length === 1 ? ' is' : 's are'} late. Please answer under Confirm days.`, '/#cover'); } }
  return out;
}
export async function coverAttention(env, sum, liveFrom = COVER_LIVE_FROM) {
  const ctx = await loadCtx(env, sum); const today = ctx.today; const next = nextDays(today, 1).filter((d) => d > today)[0]; const nowEat = new Date(Date.now() + 3 * 3600e3).toISOString(); let unconf = 0, unassigned = 0, rows = 0, overdue = 0, h1 = 0, fin = 0; const regs = new Set();
  for (const region of REGIONS) {
    if (next) { const d = regionDay(ctx, region, next); if (d.schools.length) { const late = nowEat >= deadlineOf(next) && next >= liveFrom && !d.clear && !d.complete; if (next >= liveFrom && !d.clear) unassigned += d.unassigned; if (late) { const o = d.coordinators.filter((c) => c.state === 'open').length; unconf += o; if (o) regs.add(region); } } }
    const pr = pastRows(ctx, region); rows += pr.filter((r) => ['open', 'rework'].includes(r.stage)).length; overdue += pr.filter((r) => r.overdue).length; h1 += pr.filter((r) => r.stage === 'hq1').length; fin += pr.filter((r) => r.stage === 'final').length; if (pr.some((r) => ['open', 'rework'].includes(r.stage))) regs.add(region);
  }
  return { unconfirmed: unconf, unassigned, rows_open: rows, rows_overdue: overdue, hq_first: h1, hq_final: fin, regions: [...regs], next };
}
export const _norm = norm;
