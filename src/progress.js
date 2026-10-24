// Region progress for coordinators (and HQ): where the region stands against the plan, what is pending at each school, who each pending item is
// waiting on, how active and how clean the coordinators are, and who is helping or holding up the team.
// Built only from what the system already keeps (summary, plan, queries, questions). It changes nothing and returns no pupil details.
// Volunteers get only their own standing (see standingFor), never a named list of people who are behind.
import { SCHOOL_BY_ID, SCHOOLS_BY_REGION, STAFF, staffForKoboName, workingDaysBetween, addWorkingDays, addDays, isWorkingDay, FIELD_START, FIELD_END } from './config.js';
import { withNotices } from './plan.js';
import { QUERY_REPLY_DAYS, overdueQueries } from './queries.js';

// Every threshold in one place, easy to change. They match the targets in src/own.js.
export const PROGRESS = {
  replyDays: QUERY_REPLY_DAYS, // a query needs a reply within 2 working days of the visit
  reviewDays: 1,               // a coordinator's review should not wait more than 1 working day
  sameDayGood: 90, sameDayLow: 70, qualityGood: 90, qualityLow: 75,
  minTests: 20,                // below this a person is too new to be ranked
  minSent: 10,                 // records needed before the same-day share means anything
  checksPer100: 8,             // open data checks per 100 tests that start to hold the team up
};

const eatDay = (iso) => (iso ? new Date(Date.parse(iso) + 3 * 3600e3).toISOString().slice(0, 10) : null);
const wdSince = (iso, today) => { const d = eatDay(iso) || iso; return d && d < today ? workingDaysBetween(d, today) : 0; };
const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
const first = (n) => String(n || '').split(' ')[0];
const grades = [1, 2, 3];

export const STAGE_LABEL = { open: 'waiting for the response', rework: 'sent back for rework', team: 'waiting for the team review', hq1: 'with HQ for the first review', final: 'with HQ for final approval', approved: 'approved and closed' };
const stageOf = (f) => (f.q && f.q.status === 'resolved' ? 'approved' : (f.q && f.q.wf && f.q.wf.stage) || 'open');
const coordsOf = (region) => STAFF.filter((s) => s.active && s.region === region && (s.role === 'rc' || s.role === 'arc'));

// who a flag is waiting on right now, and for how many working days
export function waitingOn(f, region, today) {
  const st = stageOf(f); if (st === 'approved') return null;
  const hist = (f.q && f.q.wf && f.q.wf.history) || [];
  const last = hist.length ? hist[hist.length - 1].at : null;
  if (st === 'open' || st === 'rework') {
    const person = f.admin ? staffForKoboName(f.admin) : null;
    const since = st === 'rework' ? last : f.date;
    const who = person ? person.name : 'RC or ARC';
    return { stage: st, who, role: person ? person.role : 'coordinators', days: wdSince(since, today), overdue: st === 'open' && overdueQueries([f], today).length > 0 };
  }
  if (st === 'team') return { stage: st, who: 'RC or ARC', role: 'coordinators', days: wdSince((f.q.wf.response && f.q.wf.response.at) || last, today), overdue: false };
  return { stage: st, who: st === 'hq1' ? 'HQ first review' : 'HQ final approval', role: 'hq', days: wdSince(last, today), overdue: false };
}

const plannedVisitOf = (visits, school) => {
  const mine = visits.filter((v) => v.school === school).sort((a, b) => (a.date < b.date ? -1 : 1));
  return mine.find((v) => v.outcome !== 'visited') || mine[mine.length - 1] || null;
};

// the school's own row: status, plan, pupils, what is pending
function schoolRow(sc, visits, flags, asks, today, locked) {
  const g = grades.map((k) => ({ g: k, att: sc.g[k].att, target: sc.g[k].target, av: sc.g[k].av, n: sc.g[k].n, done: Boolean(sc.g[k].done) }));
  const v = plannedVisitOf(visits, sc.id);
  const status = sc.done ? 'done' : sc.started ? 'started' : 'waiting';
  const mine = flags.filter((f) => f.school === sc.id && !(f.q && f.q.status === 'resolved'));
  const waits = mine.map((f) => ({ f, w: waitingOn(f, SCHOOL_BY_ID[sc.id]?.region, today) })).filter((x) => x.w);
  const tested = g.reduce((t, x) => t + x.av, 0), target = g.reduce((t, x) => t + (x.target || 0), 0);
  const opens = asks.filter((a) => a.school === sc.id && (a.status === 'open' || a.status === 'escalated'));
  const pend = [];
  if (v && v.outcome === 'missed' && !sc.done) pend.push({ kind: 'visit', sev: 'bad', text: `Planned for ${v.date}, not visited yet`, days: wdSince(v.date, today) });
  else if (v && v.outcome === 'visited_other_day' && !sc.done) pend.push({ kind: 'visit', sev: 'warn', text: `Visited on another day than planned (${v.date}); still to finish` });
  if (sc.started && !sc.done) pend.push({ kind: 'visit', sev: 'warn', text: 'In progress: ' + g.filter((x) => !x.done).map((x) => 'Grade ' + x.g).join(', ') + ' still to finish' });
  if (!v && locked && !sc.done && !sc.started) pend.push({ kind: 'plan', sev: 'warn', text: 'No visit in the plan yet' });
  if (v && v.date >= today && v.outcome !== 'visited') for (const [k, st, due, lab] of [['aek', v.aek_state, v.aek_due, 'ward officer'], ['ht', v.ht_state, v.ht_due, 'head teacher']]) if (st === 'late') pend.push({ kind: 'notice', sev: 'bad', text: `Notice to the ${lab} was due ${due} and is not sent`, days: wdSince(due, today) }); else if (st === 'due') pend.push({ kind: 'notice', sev: 'warn', text: `Notice to the ${lab} is due today` });
  for (const x of g) if (x.n > 0 && x.att == null) pend.push({ kind: 'sampling', sev: 'warn', text: `Sampling attendance missing for Grade ${x.g}` });
  for (const { f, w } of waits) pend.push({ kind: 'query', sev: w.overdue ? 'bad' : 'warn', text: `${f.text || f.type}: ${STAGE_LABEL[w.stage]}${w.role !== 'hq' ? ' (' + w.who + ')' : ''}`, days: w.days, key: f.qk });
  for (const a of opens) pend.push({ kind: 'question', sev: 'warn', text: `Question open: ${String(a.text).slice(0, 80)}`, days: wdSince(a.at, today) });
  const tone = pend.some((p) => p.sev === 'bad') ? 'bad' : pend.length ? 'warn' : sc.done ? 'good' : 'mute';
  const touched = mine.reduce((t, f) => t + (f.n || 0), 0), recs = g.reduce((t, x) => t + x.n, 0);
  return {
    id: sc.id, name: sc.name, lga: sc.lga, ward: sc.ward, arm: sc.arm, mne: sc.mne, status, tone, g, tested, target, first: sc.first, last: sc.last,
    plan: v ? { date: v.date, start: v.start, lead: v.lead_name || null, team: v.team || [], outcome: v.outcome, aek: v.aek_state, ht: v.ht_state, aek_due: v.aek_due, ht_due: v.ht_due } : null,
    q: { open: mine.length, waiting_reply: waits.filter((x) => x.w.stage === 'open' || x.w.stage === 'rework').length, in_review: waits.filter((x) => x.w.stage === 'team').length, at_hq: waits.filter((x) => x.w.role === 'hq').length, overdue: waits.filter((x) => x.w.overdue).length, oldest: waits.reduce((m, x) => Math.max(m, x.w.days), 0) },
    asks: opens.length, checks_open: mine.length, clean_pct: recs ? Math.max(0, 100 - pct(Math.min(recs, touched), recs)) : null, pending: pend,
  };
}

// cumulative schools due by the plan against schools complete, one point per working day
function planSeries(visits, schools, today) {
  const planned = visits.map((v) => v.date).sort(); const start = FIELD_START, end = planned.length ? (planned[planned.length - 1] > today ? planned[planned.length - 1] : today) : today;
  const doneDate = schools.filter((s) => s.done).map((s) => (s.dates || []).slice().sort().pop()).filter(Boolean).sort();
  const out = []; let d = start, guard = 0;
  while (d <= end && guard++ < 90) {
    if (isWorkingDay(d)) out.push({ date: d, plan: new Set(visits.filter((v) => v.date <= d).map((v) => v.school)).size, done: doneDate.filter((x) => x <= d).length, future: d > today });
    d = addDays(d, 1);
  }
  return out;
}

function reviewTimes(queries, region, names) {
  const times = [];
  for (const [key, q] of Object.entries(queries || {})) {
    if (key.startsWith('withdrawn|') || key.startsWith('closed|') || SCHOOL_BY_ID[key.split('|')[1]]?.region !== region) continue;
    const h = (q.wf && q.wf.history) || [];
    h.forEach((e, i) => { if (e.level === 'team' && (e.action === 'approved' || e.action === 'rejected') && (names.length === 0 || names.includes(e.by))) { const prev = h.slice(0, i).reverse().find((x) => x.level === 'responder'); if (prev) times.push((Date.parse(e.at) - Date.parse(prev.at)) / 3600e3); } });
  }
  return times;
}

// everything for one region
export function regionProgress({ region, sum, plan, queries, flags, asks, today }) {
  const ids = (SCHOOLS_BY_REGION[region] || []).map((s) => s.id);
  const locked = plan && plan.status === 'locked';
  const dates = Object.fromEntries(ids.map((id) => [id, (sum.schools[id] && sum.schools[id].dates) || []]));
  const visits = locked ? withNotices(plan, today, dates).visits : [];
  const schools = ids.map((id) => sum.schools[id]).filter(Boolean).map((sc) => schoolRow(sc, visits, flags, asks, today, locked));
  const done = schools.filter((s) => s.status === 'done').length, started = schools.filter((s) => s.status === 'started').length;
  const dueSchools = new Set(visits.filter((v) => v.date < today).map((v) => v.school)); // visits planned before today: yesterday and earlier
  const missed = schools.filter((s) => s.plan && s.plan.outcome === 'missed' && s.status !== 'done');
  const open = flags.filter((f) => !(f.q && f.q.status === 'resolved')); const waits = open.map((f) => ({ f, w: waitingOn(f, region, today) })).filter((x) => x.w);
  const stageCount = (fn) => waits.filter((x) => fn(x.w)).length;
  const records = schools.reduce((t, s) => t + s.g.reduce((a, x) => a + x.n, 0), 0), touched = open.reduce((t, f) => t + (f.n || 0), 0);
  const counters = {
    schools: { total: schools.length, done, started, waiting: schools.length - done - started, due_today: visits.filter((v) => v.date === today && !(sum.schools[v.school] || {}).done).length, behind: missed.length, upcoming: visits.filter((v) => v.date > today && !(sum.schools[v.school] || {}).done).length },
    plan: { submitted: Boolean(locked), due_before_today: dueSchools.size, complete_of_due: [...dueSchools].filter((id) => (sum.schools[id] || {}).done).length, series: locked ? planSeries(visits, ids.map((id) => sum.schools[id]).filter(Boolean), today) : [] },
    queries: { open: open.length, waiting_reply: stageCount((w) => w.stage === 'open' || w.stage === 'rework'), in_review: stageCount((w) => w.stage === 'team'), at_hq: stageCount((w) => w.role === 'hq'), overdue: stageCount((w) => w.overdue), oldest: waits.reduce((m, x) => Math.max(m, x.w.days), 0) },
    questions: { open: asks.filter((a) => a.status === 'open' || a.status === 'escalated').length, with_rc: asks.filter((a) => a.status === 'open' && a.owner === 'rc').length, with_hq: asks.filter((a) => (a.status === 'open' && a.owner === 'hq') || a.status === 'escalated').length, answered: asks.filter((a) => a.status === 'answered').length },
    clean: { pct: records ? 100 - pct(Math.min(records, touched), records) : null, checks_open: open.length, records },
  };
  return { region, today, counters, schools, waiting: waitingBoard({ region, waits, asks, plan, visits, today }), team: teamBoard({ region, sum, flags, waits, queries, today }), coordinators: coordinatorBoard({ region, sum, flags, waits, queries, asks, visits, schools, today }) };
}

// the lag, grouped by who the next step belongs to
function waitingBoard({ region, waits, asks, plan, visits, today }) {
  const by = {}; const add = (who, role, item) => { const b = (by[who] ||= { who, role, items: [], oldest: 0, overdue: 0 }); b.items.push(item); b.oldest = Math.max(b.oldest, item.days || 0); if (item.overdue) b.overdue += 1; };
  for (const { f, w } of waits) add(w.who, w.role, { kind: 'query', text: `${f.text || f.type}`, school: f.school, school_name: SCHOOL_BY_ID[f.school]?.name, stage: w.stage, days: w.days, overdue: w.overdue, key: f.qk });
  for (const a of asks) if (a.status === 'open' || a.status === 'escalated') { const hq = a.owner === 'hq' || a.status === 'escalated'; add(hq ? 'HQ (questions)' : 'RC or ARC', hq ? 'hq' : 'coordinators', { kind: 'question', text: String(a.text).slice(0, 100), school: a.school || null, school_name: a.school ? SCHOOL_BY_ID[a.school]?.name : null, days: wdSince(a.at, today), overdue: false }); }
  if (plan && plan.status !== 'locked') add('RC or ARC', 'coordinators', { kind: 'plan', text: 'The whole-field plan is not submitted', days: 0, overdue: true });
  for (const v of visits) for (const [st, due, lab] of [[v.aek_state, v.aek_due, 'ward officer'], [v.ht_state, v.ht_due, 'head teacher']]) if (st === 'late' && v.date >= today && v.outcome !== 'visited') add('RC or ARC', 'coordinators', { kind: 'notice', text: `Notice to the ${lab} for ${v.school_name} was due ${due}`, school: v.school, school_name: v.school_name, days: wdSince(due, today), overdue: true });
  return Object.values(by).sort((a, b) => b.overdue - a.overdue || b.items.length - a.items.length).map((b) => ({ ...b, items: b.items.sort((x, y) => (y.days || 0) - (x.days || 0)).slice(0, 12), count: b.items.length }));
}

// the people: what each one gives the team and what is waiting on them
function teamBoard({ region, sum, flags, waits, queries, today }) {
  const members = STAFF.filter((s) => s.active && s.region === region);
  const open = flags.filter((f) => !(f.q && f.q.status === 'resolved'));
  const rows = members.map((s) => {
    const a = (sum.admins || []).find((x) => x.staff_id === s.id) || (sum.admins || []).find((x) => x.name === s.name) || null;
    const sub = a && a.sub_all; const mine = open.filter((f) => f.admin && staffForKoboName(f.admin)?.id === s.id);
    const owed = waits.filter((x) => (x.w.stage === 'open' || x.w.stage === 'rework') && x.w.who === s.name);
    let answered = 0, sentBack = 0, reviewed = 0;
    for (const [key, q] of Object.entries(queries || {})) {
      if (key.startsWith('withdrawn|') || key.startsWith('closed|') || SCHOOL_BY_ID[key.split('|')[1]]?.region !== region) continue;
      const h = (q.wf && q.wf.history) || [];
      if (q.wf && q.wf.response && (q.wf.response.by_id === s.id || q.wf.response.by === s.name)) answered += 1;
      if ((q.wf && q.wf.responder && q.wf.responder.name === s.name)) sentBack += h.filter((e) => e.action === 'rejected').length;
      reviewed += h.filter((e) => e.level === 'team' && (e.action === 'approved' || e.action === 'rejected') && (e.by === s.name || String(e.by_id) === String(s.id))).length;
    }
    const tests = a ? a.tested : 0, touched = mine.reduce((t, f) => t + (f.n || 0), 0);
    const reviewWait = s.role === 'volunteer' ? [] : waits.filter((x) => x.w.stage === 'team');
    return { id: s.id, name: s.name, position: s.position, role: s.role, tested: tests, quality: a ? a.quality : null, days: a ? a.days : 0, same_pct: sub && sub.n >= PROGRESS.minSent ? sub.same_pct : null, sent: sub ? sub.n : 0, late_sent: sub ? sub.d1 + sub.d2 + sub.d3 : 0, avg_delay_h: sub ? sub.avg_h : null,
      queries: { answered, owed: owed.length, overdue: owed.filter((x) => x.w.overdue).length, oldest: owed.reduce((m, x) => Math.max(m, x.w.days), 0), sent_back: sentBack, reviewed, review_waiting: reviewWait.length, review_oldest: reviewWait.reduce((m, x) => Math.max(m, x.w.days), 0) },
      checks_open: mine.length, checks_per_100: tests ? Math.round((1000 * mine.length) / tests) / 10 : null, touched };
  });
  const vols = rows.filter((r) => r.role === 'volunteer' && r.tested >= PROGRESS.minTests).sort((a, b) => b.tested - a.tested);
  const topQ = vols.length >= 4 ? vols[Math.floor(vols.length / 4)].tested : Infinity;
  for (const r of rows) {
    const helps = [], costs = [];
    if (r.tested >= PROGRESS.minTests && r.tested >= topQ) helps.push('Among the most pupils tested in the team');
    if (r.same_pct != null && r.same_pct >= PROGRESS.sameDayGood) helps.push(`Sends records the same day (${r.same_pct}%)`);
    if (r.quality != null && r.tested >= PROGRESS.minTests && r.quality >= PROGRESS.qualityGood) helps.push(`High test quality (${r.quality})`);
    if (r.queries.answered >= 2 && r.queries.overdue === 0) helps.push(`Answers queries on time (${r.queries.answered} answered)`);
    if (r.role !== 'volunteer' && r.queries.reviewed >= 2 && r.queries.review_waiting === 0) helps.push(`Reviews on time (${r.queries.reviewed} reviewed)`);
    if (r.queries.overdue > 0) costs.push(`${r.queries.overdue} ${r.queries.overdue === 1 ? 'query' : 'queries'} waiting for a response beyond ${PROGRESS.replyDays} working days (oldest ${r.queries.oldest})`);
    else if (r.queries.owed > 0) costs.push(`${r.queries.owed} ${r.queries.owed === 1 ? 'query' : 'queries'} waiting for a response`);
    if (r.queries.sent_back > 0) costs.push(`${r.queries.sent_back} ${r.queries.sent_back === 1 ? 'response' : 'responses'} sent back for rework`);
    if (r.same_pct != null && r.same_pct < PROGRESS.sameDayLow) costs.push(`Records sent late (${r.same_pct}% the same day)`);
    if (r.checks_per_100 != null && r.tested >= PROGRESS.minTests && r.checks_per_100 >= PROGRESS.checksPer100) costs.push(`${r.checks_open} open data checks on ${r.tested} tests`);
    if (r.quality != null && r.tested >= PROGRESS.minTests && r.quality < PROGRESS.qualityLow) costs.push(`Test quality score ${r.quality}`);
    if (r.role !== 'volunteer' && r.queries.review_waiting > 0 && r.queries.review_oldest > PROGRESS.reviewDays) costs.push(`${r.queries.review_waiting} responses waiting for review (oldest ${r.queries.review_oldest} days)`);
    r.helps = helps; r.costs = costs; r.tag = costs.length ? 'waiting' : helps.length >= 2 ? 'carrying' : 'steady';
  }
  // ranks among volunteers who have enough tests, on four separate measures (no mixed score)
  const rank = (arr, key, desc = true) => { const ok = arr.filter((r) => r[key] != null); const s = ok.slice().sort((a, b) => (desc ? b[key] - a[key] : a[key] - b[key]) || b.tested - a.tested); const m = {}; s.forEach((r, i) => { m[r.id] = { rank: i + 1, of: s.length }; }); return m; };
  const pool = rows.filter((r) => r.role === 'volunteer' && r.tested >= PROGRESS.minTests);
  const rk = { tested: rank(pool, 'tested'), quality: rank(pool, 'quality'), sent: rank(pool, 'same_pct') };
  for (const r of rows) r.ranks = { tested: rk.tested[r.id] || null, quality: rk.quality[r.id] || null, sent: rk.sent[r.id] || null };
  const order = { waiting: 0, carrying: 1, steady: 2 };
  return rows.sort((a, b) => order[a.tag] - order[b.tag] || b.tested - a.tested);
}

// how active and how clean the RC and the ARC are, and the cleanliness of each school they lead
function coordinatorBoard({ region, sum, flags, waits, queries, asks, visits, schools, today }) {
  return coordsOf(region).map((c) => {
    const a = (sum.admins || []).find((x) => x.staff_id === c.id) || (sum.admins || []).find((x) => x.name === c.name) || null;
    const led = visits.filter((v) => v.lead_name === c.name).map((v) => v.school); const ledSet = new Set(led);
    const ledRows = schools.filter((s) => ledSet.has(s.id)).map((s) => ({ id: s.id, name: s.name, status: s.status, tested: s.g.reduce((t, x) => t + x.n, 0), checks_open: s.checks_open, clean_pct: s.clean_pct }));
    const tests = ledRows.reduce((t, r) => t + r.tested, 0), checks = ledRows.reduce((t, r) => t + r.checks_open, 0);
    const times = reviewTimes(queries, region, [c.name]);
    let replies = 0, reviewed = 0; for (const [key, q] of Object.entries(queries || {})) { if (key.startsWith('withdrawn|') || key.startsWith('closed|') || SCHOOL_BY_ID[key.split('|')[1]]?.region !== region) continue; const w = q.wf; if (w && w.response && w.response.by === c.name) replies += 1; reviewed += ((w && w.history) || []).filter((e) => e.level === 'team' && (e.by === c.name) && (e.action === 'approved' || e.action === 'rejected')).length; }
    let qAnswered = 0; for (const x of asks) if ((x.events || []).some((e) => e.by === c.name && e.kind !== 'asked')) qAnswered += 1;
    const reviewsWaiting = waits.filter((x) => x.w.stage === 'team'), waitingAsks = asks.filter((x) => x.status === 'open' && x.owner === 'rc');
    return { id: c.id, name: c.name, role: c.role, position: c.position, tested: a ? a.tested : 0, quality: a ? a.quality : null,
      active: { replies, reviewed, avg_review_h: times.length ? Math.round((times.reduce((t, x) => t + x, 0) / times.length) * 10) / 10 : null, review_waiting: reviewsWaiting.length, review_oldest: reviewsWaiting.reduce((m, x) => Math.max(m, x.w.days), 0), questions_answered: qAnswered, questions_waiting: waitingAsks.length },
      clean: { schools: ledRows.length, tests, checks_open: checks, pct: tests ? 100 - pct(Math.min(tests, flags.filter((f) => ledSet.has(f.school) && !(f.q && f.q.status === 'resolved')).reduce((t, f) => t + (f.n || 0), 0)), tests) : null, led: ledRows.sort((x, y) => (x.clean_pct ?? 101) - (y.clean_pct ?? 101)) } };
  });
}

// one person's own standing for a volunteer's page: their row, their ranks, what waits on them, and who is carrying the team (named); the people behind are only counted
export function standingFor(prog, who) {
  const me = prog.team.find((r) => r.id === who.id) || null;
  const carrying = prog.team.filter((r) => r.tag === 'carrying' && r.id !== who.id).slice(0, 4).map((r) => ({ name: r.name, position: r.position, tested: r.tested, helps: r.helps.slice(0, 2) }));
  const vols = prog.team.filter((r) => r.role === 'volunteer');
  return { region: prog.region, today: prog.today, me, carrying, team: { members: vols.length, waiting: vols.filter((r) => r.queries.overdue > 0).length, overdue_queries: vols.reduce((t, r) => t + r.queries.overdue, 0), same_day: pct(vols.filter((r) => r.same_pct != null && r.same_pct >= PROGRESS.sameDayGood).length, vols.filter((r) => r.same_pct != null).length) },
    schools: { total: prog.counters.schools.total, done: prog.counters.schools.done }, queries_waiting: me ? me.queries.owed : 0 };
}

// ---------- one school, everything ----------
const entryOf = (f, region, today) => {
  const w = waitingOn(f, region, today); const q = f.q || {}; const wf = q.wf || {};
  return {
    key: f.qk, source: 'live', type: f.type, text: f.text, grade: f.grade || null, date: f.date || null, person: f.admin || null, sev: f.sev,
    status: q.status === 'resolved' ? 'resolved' : 'open', stage: stageOf(f), stage_label: STAGE_LABEL[stageOf(f)], waiting: w,
    response: wf.response ? { text: wf.response.text, by: wf.response.by, at: wf.response.at, on_behalf_of: wf.response.on_behalf_of || null } : null,
    history: (wf.history || []).map((h) => ({ at: h.at, by: h.by, role: h.role, level: h.level, action: h.action, text: h.text })),
    rework_note: wf.rework_note || null, thread: (q.thread || []).map((m) => ({ by: m.by, at: m.at, text: m.text })),
  };
};
const archiveOf = (k, q) => {
  const source = k.startsWith('closed|') ? 'closed' : 'withdrawn'; const real = k.slice(source.length + 1); const [type, school, grade, date, admin] = real.split('|'); const wf = q.wf || {};
  return { key: real, source, type, text: null, grade: Number(grade) || null, date: date || null, person: admin || null, status: source, stage: (wf.stage) || 'open', stage_label: source === 'closed' ? 'closed: the check no longer applies' : 'withdrawn: raised in error', waiting: null,
    response: wf.response ? { text: wf.response.text, by: wf.response.by, at: wf.response.at, on_behalf_of: wf.response.on_behalf_of || null } : null,
    history: (wf.history || []).map((h) => ({ at: h.at, by: h.by, role: h.role, level: h.level, action: h.action, text: h.text })), rework_note: wf.rework_note || null,
    thread: (q.thread || []).map((m) => ({ by: m.by, at: m.at, text: m.text })), note: (source === 'closed' ? q.closed : q.withdrawn)?.reason || null };
};

export function schoolDetail({ id, sum, plan, queries, flags, asks, today }) {
  const sc = sum.schools[id]; if (!sc) return null;
  const region = SCHOOL_BY_ID[id]?.region; const locked = plan && plan.status === 'locked';
  const visits = locked ? withNotices(plan, today, { [id]: sc.dates || [] }).visits.filter((v) => v.school === id) : [];
  const row = schoolRow(sc, visits, flags, asks.filter((a) => a.school === id), today, locked);
  const mine = flags.filter((f) => f.school === id).map((f) => entryOf(f, region, today));
  const arch = Object.entries(queries || {}).filter(([k]) => (k.startsWith('closed|') || k.startsWith('withdrawn|')) && k.split('|')[2] === id).map(([k, q]) => archiveOf(k, q));
  const order = { open: 0, resolved: 1, closed: 2, withdrawn: 3 };
  const q = [...mine, ...arch].sort((a, b) => (order[a.status] - order[b.status]) || ((b.date || '') < (a.date || '') ? -1 : 1));
  const changes = ((plan && plan.changes) || []).filter((c) => c.school === id).map((c) => ({ at: c.at, by: c.by, from: c.from?.date || null, to: c.to?.date || null, reason: c.reason, note: c.note, late: Boolean(c.late) }));
  return {
    id, name: sc.name, region, lga: sc.lga, ward: sc.ward, arm: sc.arm, mne: sc.mne, row,
    visits: visits.map((v) => ({ date: v.date, start: v.start, lead: v.lead_name || null, team: v.team || [], outcome: v.outcome, aek: { state: v.aek_state, due: v.aek_due, at: v.notices?.aek?.at || null, by: v.notices?.aek?.by || null }, ht: { state: v.ht_state, due: v.ht_due, at: v.notices?.ht?.at || null, by: v.notices?.ht?.by || null }, brief: { state: v.team_state, at: v.notices?.team?.at || null } })),
    plan_changes: changes, plan_submitted: Boolean(locked), teacher_forms: sc.tf || 0, who_tested: sc.admins || [], people: sc.people || null,
    queries: q, counts: { open: q.filter((x) => x.status === 'open').length, resolved: q.filter((x) => x.status === 'resolved').length, closed: q.filter((x) => x.source === 'closed').length, withdrawn: q.filter((x) => x.source === 'withdrawn').length },
    asks: asks.filter((a) => a.school === id).map((a) => ({ id: a.id, cat: a.cat, text: a.text, by: a.by && { name: a.by.name, position: a.by.position }, at: a.at, status: a.status, urgent: Boolean(a.urgent), owner: a.owner, events: (a.events || []).map((e) => ({ at: e.at, by: e.by, kind: e.kind, text: e.text })) })),
  };
}
