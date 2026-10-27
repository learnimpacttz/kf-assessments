// Reports: tables built from the live numbers (never typed in), then edited (title, columns, headline, notes) and downloaded.
// Pupil names, teacher names, phone numbers and bank details are never part of any report.
import { REGIONS, SCHOOL_BY_ID, PARTNERS, workingDaysBetween } from './config.js';
import { withNotices } from './plan.js';
import { decorate, overdueQueries, STAGES } from './queries.js';
import { ownWork } from './own.js';
import { STAFF } from './config.js';
import { kv } from './store.js';

const title = (s) => String(s || '').toLowerCase().replace(/(^|[\s(-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const CHECKS = { edited: 'Record changed after it was sent', fast: 'Test too fast', slow: 'Test too slow', window: 'Outside school hours', gps: 'Far from school', skilltime: 'Skills skipped', dup: 'Pupil tested twice', notlist: 'Not on sampling list', team: 'Team size', over: 'Over the sample', short: 'Short of the sample', nosample: 'No sampling record', offcal: 'Visited off the calendar', headcount: 'Fewer phones than people', devshare: 'One phone, several names', devowner: "Someone else's phone", devoverlap: 'Tests overlap on one phone', devtravel: 'Phone at two schools too fast', devswitch: 'Phone jumping between grades', devnames: 'Names changing on one phone', namedevs: 'One person, several phones', latesub: 'Sent after the test day', assign: 'Assigned and who did the work' };
const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
const groupOf = (s) => `${s.arm || ''}${s.mne === 'M&E' ? ' · M&E' : ''}`;

export const TEMPLATES = [
  { id: 'region_progress', title: 'Progress by region', desc: 'Schools complete, pupils tested against the sample, pace and plan status for each region.', who: 'hq', params: ['region'] },
  { rc: true, id: 'lga_summary', title: 'Summary for the district (local government)', desc: 'For sharing with the District Education Office or council: each school, the dates of the visit, pupils tested by grade against the sample and whether the school is complete. No staff names, no query details.', who: 'both', params: ['region'] },
  { rc: true, id: 'school_progress', title: 'School progress', desc: 'Every school: visit dates, pupils tested by grade against the sample, and status.', who: 'both', params: ['region'] },
  { id: 'people_quality', title: 'Test admins: speed and quality', desc: 'Pupils tested, average test time, quality score and the checks counted against each person.', who: 'both', params: ['region'] },
  { id: 'submission_timing', title: 'Who sends records early', desc: 'For each person: how many records were sent the same day, one, two and three or more days after the visit, the usual delay and the longest wait.', who: 'both', params: ['region'] },
  { rc: true, id: 'queries', title: 'Queries and replies', desc: 'Every check raised, who it is about, its age, whether it was answered, and whether it is overdue (no reply within 2 working days).', who: 'both', params: ['region', 'period'] },
  { rc: true, id: 'notices_plan', title: 'Notices and plan compliance', desc: 'Each planned visit: who leads, notice due dates and state for the ward officer and head teacher, team told, and what happened.', who: 'both', params: ['region', 'period'] },
  { id: 'coordinators_work', title: "Coordinators' own work", desc: 'For each RC and ARC: their own tests, schools led, notices on time, plan changes, same-day sends and overdue queries.', who: 'both', params: ['region'] },
  { rc: true, id: 'daily_summary', title: 'Daily field summary', desc: 'For one day: each school visited, who tested, and pupils tested by grade.', who: 'both', params: ['region', 'date'] },
  { id: 'phones', title: 'Phones', desc: 'Each phone by its short code: records, days, schools, names used and owner.', who: 'hq', params: [] },
];

function regionsFor(scope, params) { return scope ? [scope] : params.region && REGIONS.includes(String(params.region).toUpperCase()) ? [String(params.region).toUpperCase()] : REGIONS; }
const adminRegionOk = (a, regs) => (a.region ? regs.includes(a.region) : regs.length === REGIONS.length);

export function buildReport(id, ctx, params = {}, scope = null) {
  const { sum, plans, queries, today } = ctx;
  const regs = regionsFor(scope, params);
  const t = TEMPLATES.find((x) => x.id === id); if (!t) return { error: 'Unknown report' };
  if (!sum) return { template: id, title: t.title, columns: [], rows: [], kpis: [], note: 'No data yet.' };
  const C = (k, label, type = 'text') => ({ k, label, type });
  let columns = [], rows = [], kpis = [];

  if (id === 'region_progress') {
    columns = [C('region', 'Region'), C('partner', 'Partner'), C('schools', 'Schools', 'num'), C('done', 'Complete', 'num'), C('pct_done', 'Complete %', 'pct'), C('tested', 'Pupils tested', 'num'), C('target', 'Sample', 'num'), C('pct_tested', 'Tested %', 'pct'), C('pace', 'Schools per day', 'num'), C('projected', 'Projected finish'), C('plan', 'Field plan'), C('changes', 'Plan changes', 'num')];
    for (const r of regs) {
      const R = sum.regions[r]; if (!R) continue; const plan = plans[r] || {};
      rows.push({ region: title(r), partner: Object.entries(PARTNERS).find(([, l]) => l.includes(r))?.[0] || '', schools: R.total, done: R.done, pct_done: pct(R.done, R.total), tested: R.tested, target: R.target, pct_tested: pct(R.tested, R.target), pace: R.pace ?? null, projected: R.projected === 'done' ? 'Done' : R.projected || '', plan: plan.status === 'locked' ? 'Submitted' : 'Not submitted', changes: (plan.changes || []).length });
    }
    const T = (k) => rows.reduce((n, x) => n + (x[k] || 0), 0);
    kpis = [{ label: 'Schools complete', value: `${T('done')} of ${T('schools')}` }, { label: 'Pupils tested', value: `${T('tested')} of ${T('target')}` }, { label: 'Plans submitted', value: `${rows.filter((x) => x.plan === 'Submitted').length} of ${rows.length}` }];
  } else if (id === 'school_progress') {
    columns = [C('region', 'Region'), C('lga', 'LGA'), C('ward', 'Ward'), C('school', 'School'), C('group', 'Group'), C('first', 'First visit'), C('last', 'Last visit'), C('g1', 'Grade 1'), C('g2', 'Grade 2'), C('g3', 'Grade 3'), C('tested', 'Tested', 'num'), C('target', 'Sample', 'num'), C('pct', 'Tested %', 'pct'), C('status', 'Status')];
    for (const s of Object.values(sum.schools)) {
      if (!regs.includes(s.region)) continue; const g = s.g; const tested = g[1].av + g[2].av + g[3].av, target = (g[1].target || 0) + (g[2].target || 0) + (g[3].target || 0);
      rows.push({ _sid: s.id, region: title(s.region), lga: title(s.lga), ward: title(s.ward || ''), school: String(s.name).trim(), group: groupOf(s), first: s.first || '', last: s.last || '', g1: `${g[1].av}/${g[1].target}`, g2: `${g[2].av}/${g[2].target}`, g3: `${g[3].av}/${g[3].target}`, tested, target, pct: pct(tested, target), status: s.done ? 'Complete' : s.started ? 'Started' : 'Not started' });
    }
    kpis = [{ label: 'Schools', value: rows.length }, { label: 'Complete', value: rows.filter((x) => x.status === 'Complete').length }, { label: 'Started', value: rows.filter((x) => x.status === 'Started').length }, { label: 'Not started', value: rows.filter((x) => x.status === 'Not started').length }];
  } else if (id === 'lga_summary') {
    columns = [C('lga', 'District (LGA)'), C('ward', 'Ward'), C('school', 'School'), C('visit', 'Visit date'), C('g1', 'Grade 1 tested / sample'), C('g2', 'Grade 2 tested / sample'), C('g3', 'Grade 3 tested / sample'), C('tested', 'Tested', 'num'), C('target', 'Sample', 'num'), C('status', 'Status')];
    for (const s of Object.values(sum.schools)) {
      if (!regs.includes(s.region)) continue; const g = s.g; const tested = g[1].av + g[2].av + g[3].av, target = (g[1].target || 0) + (g[2].target || 0) + (g[3].target || 0);
      rows.push({ _sid: s.id, lga: title(s.lga), ward: title(s.ward || ''), school: String(s.name).trim(), visit: s.first ? (s.last && s.last !== s.first ? `${s.first} to ${s.last}` : s.first) : '', g1: `${g[1].av}/${g[1].target}`, g2: `${g[2].av}/${g[2].target}`, g3: `${g[3].av}/${g[3].target}`, tested, target, status: s.done ? 'Complete' : s.started ? 'Started' : 'Not started' });
    }
    rows.sort((x, y) => (x.lga + x.ward + x.school).localeCompare(y.lga + y.ward + y.school));
    kpis = [{ label: 'Schools', value: rows.length }, { label: 'Complete', value: rows.filter((x) => x.status === 'Complete').length }, { label: 'Pupils tested', value: rows.reduce((n, x) => n + x.tested, 0) }];
  } else if (id === 'people_quality') {
    columns = [C('name', 'Name'), C('role', 'Role'), C('region', 'Region'), C('tested', 'Pupils tested', 'num'), C('avg', 'Average test minutes', 'num'), C('quality', 'Quality score', 'num'), C('fast', 'Too fast %', 'pct'), C('slow', 'Too slow', 'num'), C('late', 'After hours', 'num'), C('notlist', 'Not on list', 'num'), C('samp', 'Sampling forms', 'num'), C('schools', 'Schools', 'num'), C('days', 'Days', 'num')];
    for (const a of sum.admins) { if (!adminRegionOk(a, regs)) continue; rows.push({ _pn: a.name, name: a.name, role: a.position || (a.role === 'unlisted' ? 'Not in roster' : a.role), region: a.region ? title(a.region) : '', tested: a.tested, avg: a.avg_min, quality: a.quality, fast: a.fast_share, slow: a.slow, late: a.late, notlist: a.not_list, samp: a.samp || 0, schools: a.schools, days: a.days }); }
    rows.sort((x, y) => (y.quality ?? -1) - (x.quality ?? -1)); const q = rows.filter((r) => r.quality != null);
    kpis = [{ label: 'People', value: rows.length }, { label: 'Pupils tested', value: rows.reduce((n, x) => n + x.tested, 0) }, { label: 'Average quality', value: q.length ? Math.round(q.reduce((n, x) => n + x.quality, 0) / q.length) : '–' }];
  } else if (id === 'submission_timing') {
    columns = [C('name', 'Name'), C('role', 'Role'), C('region', 'Region'), C('n', 'Records', 'num'), C('same', 'Same day', 'num'), C('d1', '1 day later', 'num'), C('d2', '2 days later', 'num'), C('d3', '3+ days later', 'num'), C('same_pct', 'Same-day %', 'pct'), C('avg', 'Usual delay (hours)', 'num'), C('max', 'Longest wait (hours)', 'num')];
    for (const a of sum.admins) { const s = a.sub_all; if (!s || !adminRegionOk(a, regs)) continue; rows.push({ name: a.name, role: a.position || a.role, region: a.region ? title(a.region) : '', n: s.n, same: s.same, d1: s.d1, d2: s.d2, d3: s.d3, same_pct: s.same_pct, avg: s.avg_h, max: s.max_h }); }
    rows.sort((x, y) => (y.same_pct - x.same_pct) || ((x.avg ?? 1e9) - (y.avg ?? 1e9)));
    const n = rows.reduce((a, x) => a + x.n, 0), same = rows.reduce((a, x) => a + x.same, 0);
    kpis = [{ label: 'Records', value: n }, { label: 'Sent the same day', value: n ? Math.round((100 * same) / n) + '%' : '–' }];
  } else if (id === 'queries') {
    columns = [C('region', 'Region'), C('school', 'School'), C('grade', 'Grade'), C('person', 'Person'), C('check', 'Check'), C('severity', 'Severity'), C('date', 'Visit day'), C('detail', 'What was found'), C('status', 'Status'), C('response', 'Response'), C('replies', 'Responses submitted', 'num'), C('age', 'Working days old', 'num'), C('overdue', 'Overdue')];
    const flags = decorate(sum.flags.filter((f) => regs.includes(SCHOOL_BY_ID[f.school]?.region)), queries);
    const od = new Set(overdueQueries(flags, today).map((f) => f.qk));
    for (const f of flags) {
      if (params.from && (f.date || '') < params.from) continue; if (params.to && (f.date || '') > params.to) continue;
      const q = f.q; const stage = q && q.wf ? q.wf.stage : null; const status = stage ? STAGES[stage] : q && q.status === 'resolved' ? 'Closed' : q && q.thread && q.thread.length ? 'Commented' : 'Waiting for the response';
      rows.push({ region: title(SCHOOL_BY_ID[f.school]?.region), school: String(SCHOOL_BY_ID[f.school]?.name || f.school).trim(), grade: f.grade || '', person: f.admin || '', check: CHECKS[f.type] || f.type, severity: f.sev === 'bad' ? 'Serious' : 'Look', date: f.date || '', detail: f.text || '', status, response: q && q.wf && q.wf.response ? q.wf.response.text : '', replies: q && q.wf && q.wf.history ? q.wf.history.filter((h) => h.action === 'submitted' || h.action === 'resubmitted').length : 0, age: f.date ? Math.max(0, workingDaysBetween(f.date, today)) : null, overdue: od.has(f.qk) ? 'Yes' : 'No' });
    }
    rows.sort((x, y) => (y.overdue === 'Yes') - (x.overdue === 'Yes') || (y.age ?? 0) - (x.age ?? 0));
    kpis = [{ label: 'Checks raised', value: rows.length }, { label: 'Approved', value: rows.filter((x) => x.status === STAGES.approved).length }, { label: 'Overdue', value: rows.filter((x) => x.overdue === 'Yes').length }];
  } else if (id === 'notices_plan') {
    columns = [C('region', 'Region'), C('school', 'School'), C('date', 'Visit day'), C('start', 'Start'), C('lead', 'Lead'), C('aek_due', 'Ward officer due'), C('aek', 'Ward officer'), C('ht_due', 'Head teacher due'), C('ht', 'Head teacher'), C('team', 'Team told'), C('outcome', 'What happened'), C('changed', 'Changed')];
    const dates = Object.fromEntries(Object.values(sum.schools).map((s) => [s.id, s.dates || []]));
    const OUT = { visited: 'Visited on the day', visited_other_day: 'Visited another day', missed: 'Missed', today: 'Today' };
    for (const r of regs) { const plan = plans[r]; if (!plan || plan.status !== 'locked') continue;
      for (const v of withNotices(plan, today, dates).visits) { if (params.from && v.date < params.from) continue; if (params.to && v.date > params.to) continue;
        rows.push({ region: title(r), school: String(v.school_name).trim(), date: v.date, start: v.start, lead: v.lead_name || '', aek_due: v.aek_due, aek: { sent: 'Sent', late: 'Late', due: 'Due', upcoming: 'Upcoming' }[v.aek_state], ht_due: v.ht_due, ht: { sent: 'Sent', late: 'Late', due: 'Due', upcoming: 'Upcoming' }[v.ht_state], team: { sent: 'Yes', late: 'No (late)', due: 'Due', upcoming: 'Upcoming' }[v.team_state], outcome: OUT[v.outcome] || 'Upcoming', changed: (plan.changes || []).some((c) => c.visit_id === v.id) ? 'Yes' : 'No' }); } }
    rows.sort((x, y) => (x.date < y.date ? -1 : 1));
    kpis = [{ label: 'Planned visits', value: rows.length }, { label: 'Visited on the day', value: rows.filter((x) => x.outcome === 'Visited on the day').length }, { label: 'Late notices', value: rows.filter((x) => x.aek === 'Late' || x.ht === 'Late').length }];
  } else if (id === 'coordinators_work') {
    columns = [C('name', 'Name'), C('role', 'Role'), C('region', 'Region'), C('tested', 'Pupils tested', 'num'), C('samp', 'Sampling forms', 'num'), C('led', 'Schools led (planned)', 'num'), C('led_done', 'Led and done on the day', 'num'), C('notices', 'Notices on time %', 'pct'), C('late_changes', 'Late plan changes', 'num'), C('same', 'Same-day sends %', 'pct'), C('quality', 'Quality score', 'num'), C('overdue', 'Queries overdue', 'num'), C('forms', 'Teacher forms', 'num')];
    for (const r of regs) for (const p of STAFF.filter((s) => s.active && s.region === r && (s.role === 'rc' || s.role === 'arc'))) {
      const flags = decorate(sum.flags.filter((f) => SCHOOL_BY_ID[f.school]?.region === r), queries);
      const o = ownWork({ sum, plan: plans[r], queries, flags, today }, p); const g = (k) => o.rows.find((x) => x.key === k) || {};
      rows.push({ name: p.name, role: p.position, region: title(r), tested: o.assessment.tested, samp: o.assessment.sampling, led: o.led.planned, led_done: o.led.done, notices: o.notices.pct, late_changes: o.plan.late_changes, same: o.sub ? o.sub.same_pct : null, quality: o.assessment.quality, overdue: o.queries.overdue, forms: o.baseline.forms });
    }
    kpis = [{ label: 'Coordinators', value: rows.length }, { label: 'Pupils tested by them', value: rows.reduce((n, x) => n + x.tested, 0) }];
  } else if (id === 'daily_summary') {
    const days = new Set(); for (const w of Object.values(sum.work || {})) for (const r of w) days.add(r[0]);
    const date = /^\d{4}-\d\d-\d\d$/.test(params.date || '') ? params.date : [...days].sort().pop() || today;
    columns = [C('region', 'Region'), C('school', 'School'), C('people', 'Tested by'), C('g1', 'Grade 1 tested', 'num'), C('g2', 'Grade 2 tested', 'num'), C('g3', 'Grade 3 tested', 'num'), C('total', 'Total', 'num')];
    const bySchool = {};
    for (const [name, list] of Object.entries(sum.work || {})) for (const r of list) { if (r[0] !== date) continue; const s = sum.schools[r[1]]; if (!s || !regs.includes(s.region)) continue; const e = (bySchool[r[1]] ||= { region: title(s.region), school: String(s.name).trim(), ppl: new Set(), g1: 0, g2: 0, g3: 0 }); e.ppl.add(name); e['g' + r[2]] += r[3]; }
    for (const e of Object.values(bySchool)) rows.push({ region: e.region, school: e.school, people: [...e.ppl].join(', '), g1: e.g1, g2: e.g2, g3: e.g3, total: e.g1 + e.g2 + e.g3 });
    rows.sort((x, y) => x.region.localeCompare(y.region) || x.school.localeCompare(y.school));
    params = { ...params, date }; kpis = [{ label: 'Day', value: date }, { label: 'Schools with tests', value: rows.length }, { label: 'Pupils tested', value: rows.reduce((n, x) => n + x.total, 0) }];
  } else if (id === 'phones') {
    columns = [C('code', 'Phone'), C('records', 'Records', 'num'), C('days', 'Days', 'num'), C('schools', 'Schools', 'num'), C('names', 'Names used on it'), C('several', 'Several names'), C('owner', 'Owner')];
    for (const d of sum.devices || []) { const ow = d.owner != null ? STAFF.find((s) => s.id === d.owner)?.name : ''; rows.push({ code: d.code, records: d.tests, days: d.days, schools: d.schools, names: (d.names || []).map(([n, c]) => `${n} (${c})`).join(', '), several: d.mixed ? 'Yes' : 'No', owner: ow || '' }); }
    rows.sort((x, y) => y.records - x.records); kpis = [{ label: 'Phones', value: rows.length }, { label: 'With several names', value: rows.filter((x) => x.several === 'Yes').length }];
  }
  return { template: id, title: t.title, params: { ...params, region: scope || params.region || '' }, columns, rows, kpis, data_as_of: sum.as_of, year: ctx.year, rehearsal: Boolean(ctx.rehearsal), generated_at: new Date().toISOString() };
}

// ---- saved reports ----
const KEY = 'v2:reports';
const load = async (env) => (await kv(env).get(KEY)) || { items: [] };
export async function listReports(env, who) {
  const d = await load(env);
  const mine = d.items.filter((i) => who.role === 'hq' || i.region === who.region);
  return mine.map((i) => ({ id: i.id, title: i.title, template: i.template, region: i.region, owner: i.owner, updated_at: i.updated_at, rows: i.snapshot?.rows?.length ?? 0, status: i.status })).sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
}
export async function getReport(env, who, id) { const d = await load(env); const i = d.items.find((x) => x.id === id); if (!i || (who.role !== 'hq' && i.region !== who.region)) return null; return i; }
export async function saveReport(env, who, b, built) {
  const d = await load(env); let i = b.id ? d.items.find((x) => x.id === b.id) : null;
  if (i && who.role !== 'hq' && i.region !== who.region) return { error: 'Not your report', status: 403 };
  const now = new Date().toISOString();
  if (!i) { i = { id: Math.random().toString(36).slice(2, 9), created_at: now, owner: who.name, region: who.role === 'hq' ? (b.params?.region || null) : who.region }; d.items.push(i); }
  Object.assign(i, { title: String(b.title || built.title).slice(0, 120), template: b.template, params: b.params || {}, headline: String(b.headline || '').slice(0, 1500), notes: String(b.notes || '').slice(0, 4000), columns: Array.isArray(b.columns) ? b.columns.slice(0, 40) : null, filter: String(b.filter || '').slice(0, 80), sort: b.sort || null, snapshot: { columns: built.columns, rows: built.rows, kpis: built.kpis, generated_at: built.generated_at, data_as_of: built.data_as_of }, updated_at: now, status: 'saved' });
  d.items = d.items.slice(-300); await kv(env).put(KEY, d); return { ok: true, id: i.id };
}
export async function deleteReport(env, who, id) {
  const d = await load(env); const i = d.items.find((x) => x.id === id); if (!i) return { error: 'Not found', status: 404 };
  if (who.role !== 'hq' && i.region !== who.region) return { error: 'Not your report', status: 403 };
  d.items = d.items.filter((x) => x.id !== id); await kv(env).put(KEY, d); return { ok: true };
}
