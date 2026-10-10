// What each Regional Coordinator and Assistant Coordinator did themselves, and what the pair did together.
// Targets are suggestions in one place (TARGETS) so they can be changed without touching the screens.
import { SCHOOL_BY_ID, STAFF, REGIONS, addDays } from './config.js';
import { withNotices, leadOfVisit } from './plan.js';
import { overdueQueries } from './queries.js';

// [green at or above, amber at or above]; below the second number is red
export const TARGETS = {
  visits: { good: 100, warn: 90, text: 'every planned visit happens on its day, or is changed early with a reason' },
  notices: { good: 100, warn: 90, text: 'every notice sent on time (ward officer 5 working days before, head teacher 3)' },
  sameday: { good: 95, warn: 80, text: '95% or more of records sent the same day' },
  quality: { good: 90, warn: 75, text: '90 or more' },
};
const st = (v, t) => (v == null ? null : v >= t.good ? 'good' : v >= t.warn ? 'warn' : 'bad');
const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
const eatDay = (iso) => (iso ? new Date(Date.parse(iso) + 3 * 3600e3).toISOString().slice(0, 10) : null);

const coordsOf = (region) => STAFF.filter((s) => s.active && s.region === region && (s.role === 'rc' || s.role === 'arc'));
const regionOfKey = (key) => SCHOOL_BY_ID[String(key).split('|')[1]]?.region;

// the plan's visits with notice dates, outcomes and who leads
function visitsOf(plan, sum, today) {
  if (!plan || plan.status !== 'locked') return [];
  const dates = Object.fromEntries(Object.values(sum?.schools || {}).map((s) => [s.id, s.dates || []]));
  return withNotices(plan, today, dates).visits;
}
function noticeStats(visits, today) {
  let due = 0, onTime = 0, late = 0, missing = 0;
  for (const v of visits) {
    for (const [kind, dueDate] of [['aek', v.aek_due], ['ht', v.ht_due]]) {
      const n = v.notices?.[kind];
      if (n) { due += 1; if ((eatDay(n.at) || '') <= dueDate) onTime += 1; else late += 1; }
      else if (dueDate < today) { due += 1; missing += 1; }
    }
  }
  return { due, on_time: onTime, late, missing, pct: pct(onTime, due) };
}
function visitStats(visits, today) {
  const done = visits.filter((v) => v.outcome === 'visited').length;
  const other = visits.filter((v) => v.outcome === 'visited_other_day').length;
  const missed = visits.filter((v) => v.outcome === 'missed').length;
  const upcoming = visits.filter((v) => v.date >= today && v.outcome !== 'visited').length;
  const due = done + other + missed;
  return { planned: visits.length, done, other_day: other, missed, upcoming, pct: pct(done, due), due };
}
function attendStats(visits, sum, today) {
  let planned = 0, present = 0;
  for (const v of visits) {
    if (v.date > today) continue;
    const day = sum?.schools?.[v.school]?.dayAdmins?.[v.date] || [];
    if (!day.length && v.date === today) continue; // the day is not over and nothing was sent yet
    for (const n of v.team || []) { planned += 1; if (day.includes(n)) present += 1; }
  }
  return { planned, present, pct: pct(present, planned) };
}
function briefStats(visits, today) {
  const due = visits.filter((v) => v.date <= today || v.notices?.team);
  const done = due.filter((v) => v.notices?.team).length;
  return { due: due.length, done, pct: pct(done, due.length) };
}
function queryStats(queries, flags, names, region, today) {
  let replies = 0, closed = 0;
  for (const [key, q] of Object.entries(queries || {})) {
    if (regionOfKey(key) !== region) continue;
    for (const t of q.thread || []) if (names.includes(t.by)) { if (t.resolved) closed += 1; else replies += 1; }
  }
  const open = (flags || []).filter((f) => !(f.q && f.q.status === 'resolved'));
  const unanswered = open.filter((f) => !(f.q && f.q.thread && f.q.thread.length));
  return { replies, closed, open: open.length, unanswered: unanswered.length, overdue: overdueQueries(flags, today).length };
}
const adminOfStaff = (sum, p) => (sum?.admins || []).find((a) => a.staff_id === p.id) || (sum?.admins || []).find((a) => a.name === p.name) || null;
const mergeSub = (list) => { const t = { n: 0, same: 0 }; for (const a of list) if (a?.sub_all) { t.n += a.sub_all.n; t.same += a.sub_all.same; } return t.n ? { n: t.n, same_pct: pct(t.same, t.n) } : null; };

const row = (key, label, value, display, t, extra = {}) => ({ key, label, value, display, status: t ? st(value, t) : null, target: t ? t.text : null, ...extra });

// one coordinator's own work
export function ownWork({ sum, plan, queries, flags, today }, person) {
  const region = person.region; const a = adminOfStaff(sum, person);
  const all = visitsOf(plan, sum, today);
  const led = all.filter((v) => v.lead_name === person.name);
  const vs = visitStats(led, today), ns = noticeStats(led, today), at = attendStats(led, sum, today), bf = briefStats(led, today);
  const qs = queryStats(queries, flags, [person.name], region, today);
  const mine = (plan?.changes || []).filter((c) => c.by === person.name);
  const sub = a?.sub_all || null;
  const rc = coordsOf(region).find((s) => s.role === 'rc');
  const lateMine = mine.filter((c) => c.late).length;
  const rows = [
    row('visits', 'Schools you led, done on the planned day', vs.pct, vs.due ? `${vs.done} of ${vs.due}` : 'none due yet', TARGETS.visits),
    row('notices', 'Notices sent on time', ns.pct, ns.due ? `${ns.on_time} of ${ns.due}` : 'none due yet', TARGETS.notices),
    row('changes', 'Plan changes made early enough', null, `${mine.length} changes, ${lateMine} late`, null, { status: lateMine === 0 ? 'good' : 'bad', target: 'none made inside the notice period' }),
    row('sameday', 'Your records sent the same day', sub?.same_pct ?? null, sub ? `${sub.same} of ${sub.n}` : 'no records yet', TARGETS.sameday),
    row('quality', 'Your test quality score', a?.quality ?? null, a?.quality != null ? String(a.quality) : 'not enough tests yet', TARGETS.quality),
    row('queries', 'Queries answered within 2 working days', null, qs.overdue ? `${qs.overdue} overdue` : 'none overdue', null, { status: qs.overdue === 0 ? 'good' : 'bad', target: 'a reply within 2 working days of the visit' }),
  ];
  const todays = led.filter((v) => v.date === today).map((v) => ({ school: v.school, name: v.school_name, start: v.start, team: v.team || [], present: sum?.schools?.[v.school]?.dayAdmins?.[today] || [] }));
  return {
    person: { id: person.id, name: person.name, position: person.position, role: person.role, region },
    reports_to: person.role === 'arc' ? (rc?.name || null) : null,
    responsible_for_arc: person.role === 'rc' ? (coordsOf(region).find((s) => s.role === 'arc')?.name || null) : null,
    assessment: { tested: a?.tested ?? 0, sampling: a?.samp ?? 0, schools: a?.schools ?? 0, days: a?.days ?? 0, avg_min: a?.avg_min ?? null, quality: a?.quality ?? null },
    led: vs, notices: ns, briefing: bf, attendance: at, queries: qs, today: todays,
    plan: { status: plan?.status || 'draft', submitted_at: plan?.submitted_at || null, changes: mine.length, late_changes: mine.filter((c) => c.late).length },
    baseline: { forms: a?.tf ?? 0 },
    sub: sub ? { same_pct: sub.same_pct, n: sub.n, avg_h: sub.avg_h, max_h: sub.max_h } : null,
    rows,
  };
}

// what the RC and the ARC did together for the region
export function teamBlock({ sum, plan, queries, flags, today }, region) {
  const coords = coordsOf(region);
  const admins = coords.map((p) => adminOfStaff(sum, p));
  const all = visitsOf(plan, sum, today);
  const vs = visitStats(all, today), ns = noticeStats(all, today), at = attendStats(all, sum, today), bf = briefStats(all, today);
  const qs = queryStats(queries, flags, coords.map((p) => p.name), region, today);
  const sub = mergeSub(admins);
  const tested = admins.reduce((n, a) => n + (a?.tested || 0), 0), samp = admins.reduce((n, a) => n + (a?.samp || 0), 0);
  const changes = plan?.changes || [];
  const lateAll = changes.filter((c) => c.late).length;
  const rows = [
    row('plan', 'Whole-field plan', plan?.status === 'locked' ? 100 : 0, plan?.status === 'locked' ? 'submitted' : 'not submitted', { good: 100, warn: 100, text: 'submitted by the deadline' }),
    row('visits', 'Visits done on the planned day', vs.pct, vs.due ? `${vs.done} of ${vs.due}` : 'none due yet', TARGETS.visits),
    row('notices', 'Notices sent on time', ns.pct, ns.due ? `${ns.on_time} of ${ns.due}` : 'none due yet', TARGETS.notices),
    row('changes', 'Plan changes made early enough', null, `${changes.length} changes, ${lateAll} late`, null, { status: lateAll === 0 ? 'good' : 'bad', target: 'none made inside the notice period' }),
    row('sameday', 'Coordinators\' records sent the same day', sub?.same_pct ?? null, sub ? `${sub.same_pct}% of ${sub.n}` : 'no records yet', TARGETS.sameday),
    row('queries', 'Queries answered within 2 working days', null, qs.overdue ? `${qs.overdue} overdue` : 'none overdue', null, { status: qs.overdue === 0 ? 'good' : 'bad', target: 'a reply within 2 working days of the visit' }),
  ];
  return {
    region, people: coords.map((p) => ({ name: p.name, position: p.position, role: p.role })),
    tested, sampling: samp, visits: vs, notices: ns, briefing: bf, attendance: at, queries: qs,
    plan: { status: plan?.status || 'draft', changes: changes.length, late_changes: changes.filter((c) => c.late).length },
    baseline_forms: admins.reduce((n, a) => n + (a?.tf || 0), 0), rows,
  };
}

// HQ: every coordinator's own work and every region's coordinating team
export function coordinatorOverview(ctx) {
  const people = [], blocks = {};
  for (const r of REGIONS) {
    const c = { ...ctx, plan: ctx.plans[r], flags: ctx.flagsByRegion[r] || [] };
    blocks[r] = teamBlock(c, r);
    for (const p of coordsOf(r)) people.push(ownWork(c, p));
  }
  return { coordinators: people, team_blocks: blocks };
}
export { leadOfVisit };
