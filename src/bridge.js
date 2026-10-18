// The HQ Bridge: what HQ needs on one screen. Field progress against targets, what to act on, issues, data cleanliness from the first
// submission to payment readiness, targets and milestones, early warnings, and the weekly update for the ED.
import { kv } from './store.js';
import { SCHOOL_BY_ID, REGIONS, STAFF, FIELD_START, FIELD_END, isWorkingDay, addDays, workingDaysBetween } from './config.js';
import { decorate, overdueQueries } from './queries.js';
import { getPlan, withNotices } from './plan.js';

const MSKEY = 'v2:bridge:ms', SNAPS = 'v2:bridge:snaps';
export const MS_DEFAULT = [
  { id: 'field_close', label: 'Field work closes', date: FIELD_END, owner: 'Regional Coordinators', status: 'auto', kind: 'field' },
  { id: 'cleaning', label: 'Data cleaning closed (every check approved)', date: '2026-11-25', owner: 'HQ: Joram and Mundo', status: 'in progress', kind: 'after' },
  { id: 'payments', label: 'Payment calculations done and checked', date: '2026-12-05', owner: 'Mundo (Michael supporting)', status: 'not started', kind: 'after' },
  { id: 'reports', label: 'Reports ready: national, regional and school', date: '2026-12-15', owner: 'Michael', status: 'not started', kind: 'after' },
  { id: 'mgmt', label: 'Report to management, board and funders', date: '2026-12-15', owner: 'Michael', status: 'not started', kind: 'after' },
];
export async function getMilestones(env) { const s = await kv(env).get(MSKEY); return (s && s.list && s.list.length ? s.list : MS_DEFAULT).map((m) => ({ ...m })); }
export async function saveMilestones(env, who, list) {
  if (!(who.role === 'hq' && (who.level || 'admin') === 'admin')) return { error: 'Only an HQ Admin can change targets and milestones', status: 403 };
  const clean = (Array.isArray(list) ? list : []).slice(0, 12).map((m, i) => ({ id: String(m.id || 'm' + i).replace(/[^a-z0-9_]/gi, '').slice(0, 24) || 'm' + i, label: String(m.label || '').slice(0, 90), date: /^\d{4}-\d\d-\d\d$/.test(m.date || '') ? m.date : null, owner: String(m.owner || '').slice(0, 60), status: ['not started', 'in progress', 'done', 'auto'].includes(m.status) ? m.status : 'not started', kind: m.kind === 'field' ? 'field' : 'after' })).filter((m) => m.label && m.date);
  if (clean.length < 2) return { error: 'Keep at least two milestones' };
  await kv(env).put(MSKEY, { list: clean, by: who.name, at: new Date().toISOString() }); return { ok: true };
}
const real = (id) => Boolean(SCHOOL_BY_ID[id]);
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
export function fieldInfo(today) {
  let total = 0; for (let d = FIELD_START; d <= FIELD_END; d = addDays(d, 1)) if (isWorkingDay(d)) total++;
  const phase = today < FIELD_START ? 'before' : today > FIELD_END ? 'after' : 'during';
  const day = phase === 'before' ? 0 : phase === 'after' ? total : workingDaysBetween(FIELD_START, today) + (isWorkingDay(FIELD_START) ? 1 : 0);
  return { start: FIELD_START, end: FIELD_END, total, day: Math.min(day, total), left: Math.max(0, total - day), phase, to_start: phase === 'before' ? workingDaysBetween(today, FIELD_START) : 0 };
}
export async function computeBridge(env, who, { sum, queries, today, quota, pred }) {
  const F = fieldInfo(today); const ms = await getMilestones(env);
  const flags = decorate((sum.flags || []).filter((f) => real(f.school)), queries); const open = flags.filter((f) => !f.q || f.q.status !== 'resolved');
  const stage = (f) => (f.q && f.q.wf && f.q.wf.stage) || 'open'; const regionOf = (f) => SCHOOL_BY_ID[f.school].region;
  // ---- clean rate: records touched by an open check (once per person, day and grade), plus records inside a pending edit or delete request
  const touched = new Map(); const byType = {}; const byRegion = {};
  const reg = (r) => (byRegion[r] ||= { records: 0, not_clean: 0, open: 0, overdue: 0, late_notices: 0 });
  let records = 0; for (const sc of Object.values(sum.schools || {})) { if (!real(sc.id)) continue; const n = [1, 2, 3].reduce((a, g) => a + (sc.g[g].n || 0), 0); records += n; reg(sc.region).records += n; }
  for (const f of open) { const key = f.n ? `${f.date}|${f.school}|${f.grade}|${f.admin}|${f.type === 'dup' || f.type === 'notlist' ? f.type : ''}` : null; const r = regionOf(f); reg(r).open++; const t = (byType[f.type] ||= { type: f.type, checks: 0, records: 0 }); t.checks++; if (key && (touched.get(key) || 0) < f.n) { t.records += f.n - (touched.get(key) || 0); touched.set(key, f.n); reg(r).not_clean += f.n; } }
  const dr = (await kv(env).get('v2:delreq')) || []; const pend = dr.filter((r) => ['suggested', 'initiated', 'rework'].includes(r.stage)); const pendRecords = pend.reduce((a, r) => a + (r.ids || []).length, 0);
  const flagged = [...touched.values()].reduce((a, n) => a + n, 0); const notClean = Math.min(records, flagged + pendRecords);
  const edited = open.filter((f) => f.type === 'edited');
  // ---- queries
  const stages = { waiting: 0, team: 0, hq1: 0, final: 0 }; let oldest = 0; const ages = [0, 0, 0, 0];
  for (const f of open) { const st = stage(f); if (st === 'team') stages.team++; else if (st === 'hq1') stages.hq1++; else if (st === 'final') stages.final++; else stages.waiting++; const age = f.date ? Math.max(0, dayDiff(f.date, today)) : 0; oldest = Math.max(oldest, age); ages[age <= 1 ? 0 : age === 2 ? 1 : age <= 5 ? 2 : 3]++; }
  const overdue = overdueQueries(flags, today); for (const f of overdue) reg(regionOf(f)).overdue++;
  const med = (a) => { const v = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return v.length ? Math.round(v[Math.floor(v.length / 2)] * 10) / 10 : null; };
  const firstReply = [], toApprove = []; let closed7 = 0; const cut = addDays(today, -7);
  for (const f of flags) { const w = f.q && f.q.wf; if (!w) continue; if (w.response && f.date) firstReply.push(dayDiff(f.date, String(w.response.at).slice(0, 10))); if (w.approved_at && f.date) { toApprove.push(dayDiff(f.date, String(w.approved_at).slice(0, 10))); if (String(w.approved_at).slice(0, 10) > cut) closed7++; } }
  const funnel = { raised: flags.length, answered: flags.filter((f) => f.q && f.q.wf && f.q.wf.response).length, team: flags.filter((f) => ['hq1', 'final', 'approved'].includes(stage(f)) || (f.q && f.q.wf && (f.q.wf.history || []).some((h) => h.level === 'team'))).length, hq1: flags.filter((f) => ['final', 'approved'].includes(stage(f))).length, approved: flags.filter((f) => stage(f) === 'approved').length };
  const perDay = closed7 / 5; const backlog = open.length; let cleanBy = null; if (!backlog) cleanBy = today; else if (perDay > 0) { let d = today, left = Math.ceil(backlog / perDay); while (left > 0) { d = addDays(d, 1); if (isWorkingDay(d)) left--; } cleanBy = d; }
  // ---- schools ready for the payment calculation: complete, nothing open, nothing pending
  const pendSchools = new Set(pend.flatMap((r) => (r.items || []).map((i) => i.school))); const openSchools = new Set(open.map((f) => f.school));
  const complete = Object.values(sum.schools || {}).filter((s) => real(s.id) && s.done); const ready = complete.filter((s) => !openSchools.has(s.id) && !pendSchools.has(s.id));
  // ---- plans and notices
  const plans = await Promise.all(REGIONS.map((r) => getPlan(env, r))); let late = 0; plans.forEach((p, i) => { if (p.status === 'locked') { for (const v of withNotices(p, today, null).visits) if (v.date >= today && (v.aek_state === 'late' || v.ht_state === 'late')) { late++; reg(REGIONS[i]).late_notices++; } } });
  // ---- requests waiting, questions, mentions, people
  const lvl = who.role === 'hq' ? who.review_level || 0 : 0; const waitJoram = dr.filter((r) => r.stage === 'suggested').length, waitMundo = dr.filter((r) => r.stage === 'initiated').length;
  const ask = (await kv(env).get('v2:askq')) || []; const askOpen = ask.filter((q) => q.status === 'open' || q.status === 'escalated'); const askHq = askOpen.filter((q) => q.owner === 'hq' || q.status === 'escalated').length; const askUrgent = askOpen.filter((q) => q.urgent).length;
  const daily = (await kv(env).get('v2:usage:daily')) || {}; const usedToday = daily[today] ? Object.keys(daily[today].users).length : 0; const subs = (await kv(env).get('v2:push:subs')) || {}; const alertIds = new Set(Object.values(subs).map((s) => String(s.who && s.who.id)));
  const field = STAFF.filter((s) => s.active); const alertsOn = field.filter((s) => alertIds.has(String(s.id))).length;
  // ---- pace and projections
  const nat = pred && pred.national; const behindRegions = Object.entries((pred && pred.regions) || {}).filter(([, v]) => v.remaining && v.p_on_time < 50).map(([r, v]) => ({ region: r, p: v.p_on_time, need: v.needed_per_day, pace: v.recent_pace }));
  // ---- needs you now (ranked; each has the place to act)
  const needs = []; const mine = open.filter((f) => (stage(f) === 'hq1' && lvl >= 2 && !/mundo/i.test(who.name || '')) || (stage(f) === 'final' && lvl >= 3)).length;
  if (mine) needs.push({ sev: 'bad', title: `${mine} quer${mine === 1 ? 'y waits' : 'ies wait'} for your review`, text: 'Approve, edit and approve, or send back, in order: team, first HQ review, final approval.', act: { tab: 'allq', filter: 'mine', label: 'Open reviews' } });
  if (overdue.length) needs.push({ sev: 'bad', title: `${overdue.length} quer${overdue.length === 1 ? 'y has' : 'ies have'} no reply after 2 working days`, text: 'Remind the person, or ask the coordinator to chase.', act: { tab: 'allq', filter: 'overdue', label: 'Open overdue' } });
  if (askHq) needs.push({ sev: askUrgent ? 'bad' : 'warn', title: `${askHq} question${askHq === 1 ? '' : 's'} from the field${askUrgent ? ', ' + askUrgent + ' urgent' : ''}`, text: 'The person gets an alert when you answer.', act: { tab: 'questions', label: 'Answer' } });
  if (lvl >= 2 && waitJoram) needs.push({ sev: 'warn', title: `${waitJoram} edit or delete request${waitJoram === 1 ? '' : 's'} waiting for the first HQ review`, text: 'Data cleaning > requests.', act: { tab: 'clean', label: 'Open requests' } });
  if (lvl >= 3 && waitMundo) needs.push({ sev: 'warn', title: `${waitMundo} request${waitMundo === 1 ? '' : 's'} waiting for the final decision`, text: 'The originals are saved before anything is changed.', act: { tab: 'clean', label: 'Open requests' } });
  if (late) needs.push({ sev: 'warn', title: `${late} notice${late === 1 ? ' is' : 's are'} late for coming visits`, text: 'Ward officer 5 working days before, head teacher 3.', act: { tab: 'regions', label: 'Open plans' } });
  if (quota && quota.runs_out && quota.runs_out < FIELD_END) needs.push({ sev: 'bad', title: 'KoBo submissions will reach the monthly limit before field work ends', text: `${quota.used} of ${quota.limit} used. At about ${quota.per_day} a day the limit is reached on ${quota.runs_out}.`, act: { tab: 'admin', label: 'Open storage' } });
  const msCl = ms.find((m) => m.id === 'cleaning'); if (msCl && cleanBy && cleanBy > msCl.date && F.phase !== 'before') needs.push({ sev: 'warn', title: 'Cleaning will finish after its deadline at the current pace', text: `Backlog ${backlog}, closing about ${Math.round(perDay)} a day: clear on ${cleanBy}, deadline ${msCl.date}.`, act: { tab: 'allq', label: 'Open queries' } });
  const warnings = [];
  for (const b of behindRegions.slice(0, 4)) warnings.push({ sev: b.p < 25 ? 'bad' : 'warn', title: `${b.region[0]}${b.region.slice(1).toLowerCase()} is below the pace it needs`, text: `Needs ${b.need} schools a day${b.pace != null ? ', doing ' + b.pace : ''}. Chance of finishing by ${FIELD_END}: ${b.p}%.`, act: { region: b.region, label: 'Open region' } });
  if (pred && pred.at_risk && pred.at_risk.length) warnings.push({ sev: 'warn', title: `${pred.at_risk.length} school${pred.at_risk.length === 1 ? '' : 's'} at risk`, text: 'Planned date passed without a visit, or started and not finished.', act: { tab: 'regions', label: 'Open list' } });
  if (quota && quota.runs_out) warnings.push({ sev: quota.runs_out < FIELD_END ? 'bad' : 'good', title: 'KoBo submissions', text: `${quota.used} of ${quota.limit} used this period; at about ${quota.per_day} a day the limit is reached ${quota.runs_out}.`, act: { tab: 'admin', label: 'Open storage' } });
  if (cleanBy && msCl) warnings.push({ sev: cleanBy > msCl.date ? 'warn' : 'good', title: 'Cleaning forecast', text: `At the current closing pace the backlog clears ${cleanBy} (deadline ${msCl.date}).`, act: { tab: 'allq', label: 'Open queries' } });
  const ahead = F.phase === 'during' && msCl && msCl.date < FIELD_END; if (ahead) warnings.push({ sev: 'warn', title: 'Records sent after the cleaning deadline', text: `Field work closes ${FIELD_END}, ${dayDiff(msCl.date, FIELD_END)} days after the cleaning deadline (${msCl.date}). Plan a final cleaning sweep for the last week of records.`, act: { tab: 'allq', label: 'Open queries' } });
  return {
    as_of: new Date().toISOString(), today, field: F, milestones: ms.map((m) => ({ ...m, days_left: dayDiff(today, m.date) })),
    clean: { records, not_clean: notClean, flagged, pending_records: pendRecords, rate: records ? Math.round(1000 * (1 - notClean / records)) / 10 : 100, edited: edited.length, by_type: Object.values(byType).sort((a, b) => b.records - a.records || b.checks - a.checks), by_region: byRegion, payment_ready: ready.length, complete: complete.length, schools: Object.values(sum.schools || {}).filter((s) => real(s.id)).length },
    queries: { open: open.length, ...stages, overdue: overdue.length, oldest, ages, funnel, median_first_reply: med(firstReply), median_to_approve: med(toApprove), closed_per_day: Math.round(perDay * 10) / 10, clean_by: cleanBy, requests: { joram: waitJoram, mundo: waitMundo } },
    notices_late: late, questions: { hq: askHq, urgent: askUrgent }, people: { active_today: usedToday, total: field.length, alerts_on: alertsOn }, quota: quota || null, nat: nat || null, needs, warnings,
  };
}
// ---------------- the update text ----------------
const D = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]; };
export const AUDIENCES = { ed: 'ED (Monday one-on-one)', board: 'Board', funder: 'Funders', gov: 'Government' };
export async function buildUpdate(env, audience, br, sum) {
  const aud = AUDIENCES[audience] ? audience : 'ed'; const n = sum.national; const regs = sum.regions || {};
  const snaps = (await kv(env).get(SNAPS)) || []; const prev = snaps.find((s) => s.audience === aud && !s.draft);
  const L = []; const tested = n.tested, target = n.target;
  const planned = br.field.phase === 'during' ? Math.round(target * (br.field.day / br.field.total)) : 0;
  const status = br.field.phase === 'before' ? `Field work starts ${D(br.field.start)} (${br.field.to_start} working days).` : `Day ${br.field.day} of ${br.field.total}. ${tested.toLocaleString('en-GB')} of ${target.toLocaleString('en-GB')} pupils tested (${Math.round((100 * tested) / target)}%)${planned ? (tested >= planned ? ', ' + (tested - planned).toLocaleString('en-GB') + ' ahead of plan' : ', ' + (planned - tested).toLocaleString('en-GB') + ' behind plan') : ''}. ${br.nat && br.field.day >= 3 ? `Finish expected around ${D(br.nat.likely)} (range ${D(br.nat.earliest)} to ${D(br.nat.latest)}); field work closes ${D(br.field.end)}.` : ''}`;
  L.push(`LI Command Center · KiuFunza 4 endline · update for ${AUDIENCES[aud]} · ${D(br.today)}`, '', 'STATUS', status);
  if (aud === 'ed' || aud === 'board') L.push('', 'DATA', `${br.clean.rate}% of pupil records are clean (no open check, no pending correction). Cleaning deadline ${D(br.milestones.find((m) => m.id === 'cleaning')?.date || br.today)}; at the current closing pace the backlog clears ${br.queries.clean_by ? D(br.queries.clean_by) : 'once replies start'}.${aud === 'ed' ? ` ${br.queries.open} checks are open (${br.queries.waiting} waiting for a reply, ${br.queries.team + br.queries.hq1 + br.queries.final} in review); oldest ${br.queries.oldest} days; median ${br.queries.median_first_reply ?? 'n/a'} days to a first reply.` : ''}`);
  else L.push('', 'DATA QUALITY', 'Every test record goes through automatic checks and, where a check is raised, a written reply and two levels of review before it is cleared.');
  const upcoming = br.milestones.filter((m) => m.days_left >= 0).slice(0, 4); L.push('', 'TARGETS AND DATES', ...upcoming.map((m) => `- ${m.label}: ${D(m.date)} (${m.days_left} days)${aud === 'ed' ? ' · ' + m.owner + ' · ' + m.status : ''}`));
  if (aud === 'ed') { L.push('', 'RISKS', ...(br.warnings.length ? br.warnings.slice(0, 5).map((w) => `- ${w.title}: ${w.text}`) : ['- None above the line this week.'])); L.push('', 'DECISIONS AND ASKS', ...(br.needs.length ? br.needs.slice(0, 5).map((x) => `- ${x.title}`) : ['- None this week.'])); if (prev) L.push('', `SINCE THE LAST UPDATE (${D(prev.at.slice(0, 10))})`, `- Pupils tested: ${(tested - (prev.numbers.tested || 0)).toLocaleString('en-GB')} more · clean rate ${br.clean.rate}% (was ${prev.numbers.clean}%) · open checks ${br.queries.open} (was ${prev.numbers.open}).`); }
  if (aud !== 'ed') { const rows = Object.entries(regs).filter(([r]) => r !== 'DODOMA').map(([r, v]) => `- ${r[0]}${r.slice(1).toLowerCase()}: ${v.done} of ${v.total} schools complete`); L.push('', 'BY REGION', ...rows); }
  L.push('', 'NEXT', br.field.phase === 'after' ? 'Final cleaning, payment calculations and reports.' : 'Field teams complete their school visits and school reports; HQ clears the query backlog.');
  return { text: L.join('\n'), numbers: { tested, target, clean: br.clean.rate, open: br.queries.open } };
}
export async function saveSnapshot(env, who, { audience, text, numbers, draft }) {
  const list = (await kv(env).get(SNAPS)) || []; list.unshift({ id: Math.random().toString(36).slice(2, 9), at: new Date().toISOString(), by: who ? who.name : 'system', audience: audience || 'ed', text: String(text || '').slice(0, 6000), numbers: numbers || {}, draft: Boolean(draft) }); await kv(env).put(SNAPS, list.slice(0, 60)); return { ok: true };
}
export async function listSnapshots(env) { return ((await kv(env).get(SNAPS)) || []).slice(0, 20); }
