// Region progress: school counter against the plan, what is pending at each school, who it waits on, the people board, school detail, and what a volunteer may see
import { ok, done } from './_kit.mjs';
import { addStudents, addSampling } from '../src/ingest.js';
import { summarize } from '../src/summary.js';
import { regionProgress, schoolDetail, standingFor, waitingOn, PROGRESS } from '../src/progress.js';
import { DEFAULT_BANDS, SCHOOLS_BY_REGION, STAFF } from '../src/config.js';

const R = 'TANGA'; const S = SCHOOLS_BY_REGION[R].slice(0, 6).map((s) => s.id); const [A, B, C, D, E, F] = S;
const team = STAFF.filter((s) => s.active && s.region === R);
const rc = team.find((s) => s.role === 'rc'), arc = team.find((s) => s.role === 'arc'); const vols = team.filter((s) => s.role === 'volunteer');
const [v1, v2, v3] = vols;
const TODAY = '2026-10-22';
let id = 100000;
const rec = (who, school, grade, day, n, o = {}) => Array.from({ length: n }, () => ({ _id: id++, year: '2026', today: day, 'group_intro/date': day, 'id_data/school': school, 'id_data/grade': String(grade), 'id_data/enumerator': who.name, 'stu_info/rand_nr': String(id % 997), stuid: 'S' + id, start: day + 'T09:10:00+03:00', end: day + 'T09:17:00+03:00', 'end_note_gr/testtime_rounded': '7', stu_avail: '1', deviceid: 'dev-' + who.id, _submission_time: day + 'T12:00:00', ...o }));
const samp = (who, school, grade, att, day) => ({ _id: id++, year: '2026', 'id_data/school': school, 'id_data/grade': String(grade), 'id_data/enumerator': who.name, 'att_gr/att': String(att), date: day, today: day, deviceid: 'dev-' + who.id, start: day + 'T08:00:00+03:00', _submission_time: day + 'T09:00:00' });
const state = { yrs: {} };
// school A: complete (three grades, 20 each) on 19 Oct by v1 and v2; school B: started (grade 1 only) on 20 Oct by v3; school C planned 20 Oct, never visited; D planned today; E and F later
addSampling(state, [1, 2, 3].map((g) => samp(v1, A, g, 40, '2026-10-19')));
addStudents(state, [...rec(v1, A, 1, '2026-10-19', 20), ...rec(v2, A, 2, '2026-10-19', 20), ...rec(v1, A, 3, '2026-10-19', 20), ...rec(v3, B, 1, '2026-10-20', 12)]);
const sum = summarize(state.yrs['2026'], { year: '2026', bands: DEFAULT_BANDS, today: TODAY });
const plan = { region: R, status: 'locked', changes: [{ at: '2026-10-19T08:00:00Z', by: rc.name, school: C, from: { date: '2026-10-20' }, to: { date: '2026-10-21' }, reason: 'transport', note: 'road closed', late: true }], visits: [
  { id: 'a', school: A, date: '2026-10-19', start: '08:00', team: [rc.name, v1.name, v2.name], lead: rc.name, notices: { aek: { at: '2026-10-09T08:00:00Z', by: rc.name }, ht: { at: '2026-10-14T08:00:00Z', by: rc.name } } },
  { id: 'b', school: B, date: '2026-10-20', start: '08:00', team: [arc.name, v3.name], lead: arc.name, notices: { aek: { at: '2026-10-10T08:00:00Z', by: arc.name }, ht: { at: '2026-10-15T08:00:00Z', by: arc.name } } },
  { id: 'c', school: C, date: '2026-10-20', start: '08:00', team: [rc.name, v1.name], lead: rc.name, notices: {} },
  { id: 'd', school: D, date: TODAY, start: '08:00', team: [rc.name, v2.name], lead: rc.name, notices: { aek: { at: '2026-10-14T08:00:00Z', by: rc.name } } },
  { id: 'e', school: E, date: '2026-10-26', start: '08:00', team: [arc.name, v3.name], lead: arc.name, notices: {} },
  { id: 'f', school: F, date: '2026-10-27', start: '08:00', team: [rc.name, v1.name], lead: rc.name, notices: { aek: { at: '2026-10-19T08:00:00Z', by: rc.name } } },
] };
// queries: v2 owes a response at school A (visit 19 Oct, nothing written: overdue); v3's response is with the team review; one waiting at HQ; one approved
const flag = (o) => ({ sev: 'warn', n: 5, text: 'check', ...o, qk: [o.type, o.school, o.grade || 0, o.date, o.admin].join('|') });
const flags = [
  flag({ type: 'notlist', school: A, grade: 2, date: '2026-10-19', admin: v2.name, text: '5 pupils not on the sampling list', q: null }),
  flag({ type: 'fast', school: B, grade: 1, date: '2026-10-20', admin: v3.name, text: 'Many fast tests', q: { status: 'open', thread: [], wf: { stage: 'team', response: { text: 'Pupils were very quick', by: v3.name, at: '2026-10-21T10:00:00Z' }, history: [{ at: '2026-10-21T10:00:00Z', by: v3.name, level: 'responder', action: 'submitted' }] } } }),
  flag({ type: 'dup', school: B, grade: 1, date: '2026-10-20', admin: v3.name, text: 'A pupil tested twice', q: { status: 'open', thread: [], wf: { stage: 'hq1', response: { text: 'Pupil came back', by: v3.name, at: '2026-10-20T11:00:00Z' }, history: [{ at: '2026-10-20T11:00:00Z', by: v3.name, level: 'responder', action: 'submitted' }, { at: '2026-10-21T08:00:00Z', by: rc.name, by_id: rc.id, level: 'team', action: 'approved' }] } } }),
  flag({ type: 'late', school: A, grade: 1, date: '2026-10-19', admin: v1.name, text: 'Tests outside field hours', n: 3, q: { status: 'resolved', thread: [], wf: { stage: 'approved', response: { text: 'Late start', by: v1.name, at: '2026-10-19T15:00:00Z' }, history: [] } } }),
];
const queries = { ...Object.fromEntries(flags.filter((f) => f.q).map((f) => [f.qk, f.q])), ['closed|dup|' + A + '|1|2026-10-19|' + v1.name]: { status: 'resolved', thread: [], wf: { stage: 'approved', response: { text: 'Fixed', by: v1.name }, history: [] }, closed: { at: 'x', reason: 'An approved change put the numbers right.' } } };
const asks = [
  { id: 'q1', at: '2026-10-21T09:00:00Z', by: { id: String(v3.id), name: v3.name, region: R, position: v3.position, role: 'volunteer' }, cat: 'plan', school: B, text: 'Can we finish grade 2 tomorrow?', urgent: false, status: 'open', owner: 'rc', events: [{ at: '2026-10-21T09:00:00Z', by: v3.name, kind: 'asked', text: 'x' }] },
  { id: 'q2', at: '2026-10-20T09:00:00Z', by: { id: String(v1.id), name: v1.name, region: R, position: v1.position, role: 'volunteer' }, cat: 'phone', school: '', text: 'My phone lost the form', urgent: false, status: 'answered', owner: 'rc', events: [{ at: '2026-10-20T09:00:00Z', by: v1.name, kind: 'asked', text: 'x' }, { at: '2026-10-20T10:00:00Z', by: rc.name, kind: 'answered', text: 'Reinstall' }] },
];
const P = regionProgress({ region: R, sum, plan, queries, flags, asks, today: TODAY });
const by = Object.fromEntries(P.schools.map((s) => [s.id, s]));

// ---- the school counter against the plan ----
ok('schools are counted complete, in progress and not started', P.counters.schools.done === 1 && P.counters.schools.started === 1 && P.counters.schools.waiting === P.counters.schools.total - 2 && P.counters.schools.total === P.schools.length, JSON.stringify(P.counters.schools));
ok('the plan says three schools were due before today and one is complete; one missed; one is today; two are coming', P.counters.plan.due_before_today === 3 && P.counters.plan.complete_of_due === 1 && P.counters.schools.behind === 1 && P.counters.schools.due_today === 1 && P.counters.schools.upcoming === 2, JSON.stringify([P.counters.plan, P.counters.schools]));
ok('the plan against actual series runs by working day and ends today or later', P.counters.plan.series.length > 5 && P.counters.plan.series.every((p, i, a) => !i || p.plan >= a[i - 1].plan) && P.counters.plan.series.find((p) => p.date === '2026-10-19').done === 1);
ok('a draft plan gives no plan line and no false "behind"', (() => { const d = regionProgress({ region: R, sum, plan: { ...plan, status: 'draft' }, queries, flags, asks, today: TODAY }); return d.counters.plan.series.length === 0 && d.counters.schools.behind === 0 && !d.counters.plan.submitted; })());

// ---- pending at each school ----
ok('a complete school with a query still waiting is not green, and says what it waits for', by[A].status === 'done' && by[A].tone !== 'good' && by[A].pending.some((p) => p.kind === 'query' && /waiting for the response \(/.test(p.text)), JSON.stringify(by[A].pending.map((p) => p.text)));
ok('the school that was planned and never visited is red and says so', by[C].tone === 'bad' && by[C].pending.some((p) => p.kind === 'visit' && /not visited/.test(p.text)), JSON.stringify(by[C].pending));
ok('a started school lists what is still to finish', by[B].pending.some((p) => /Grade 2, Grade 3 still to finish/.test(p.text)));
ok('an overdue notice for an upcoming or current visit is red; a notice due today is amber', by[E].pending.some((p) => p.kind === 'notice' && p.sev === 'bad' && /ward officer/.test(p.text)) && by[D].pending.some((p) => p.kind === 'notice' && p.sev === 'bad' && /head teacher/.test(p.text)) && by[F].plan.ht === 'due' && by[F].pending.some((p) => p.kind === 'notice' && p.sev === 'warn' && /due today/.test(p.text)), JSON.stringify([by[E].pending, by[F].plan]));
ok('missing sampling attendance is pending for a grade that has tests', by[B].pending.some((p) => p.kind === 'sampling'));
ok('an open question at a school is pending there', by[B].asks === 1 && by[B].pending.some((p) => p.kind === 'question'));
ok('each pending query says who it is waiting on', by[B].pending.some((p) => /waiting for the team review \(RC or ARC\)/.test(p.text)) && by[B].pending.some((p) => /with HQ for the first review/.test(p.text)));
ok('the school shows how many of its checks are open', by[B].q.open === 2 && by[B].q.in_review === 1 && by[B].q.at_hq === 1 && by[A].q.waiting_reply === 1);

// ---- who it is waiting on ----
const wo = waitingOn(flags[0], R, TODAY);
ok('a query nobody has answered after the reply days is overdue and belongs to the person', wo.who === v2.name && wo.overdue && wo.days > PROGRESS.replyDays && wo.stage === 'open', JSON.stringify(wo));
ok('a response with the team goes to the RC or ARC; one at HQ goes to HQ', waitingOn(flags[1], R, TODAY).who === 'RC or ARC' && waitingOn(flags[2], R, TODAY).role === 'hq');
ok('an approved query waits on nobody', waitingOn(flags[3], R, TODAY) === null);
const wb = Object.fromEntries(P.waiting.map((w) => [w.who, w]));
ok('the waiting board groups by who owes the next step, overdue first', P.waiting[0].overdue >= 1 && wb[v2.name] && wb[v2.name].items[0].overdue && wb['RC or ARC'] && wb['HQ first review'], P.waiting.map((w) => w.who).join());
ok('open questions and late notices are on the board for the coordinators', wb['RC or ARC'].items.some((i) => i.kind === 'question') && wb['RC or ARC'].items.some((i) => i.kind === 'notice'));

// ---- the people ----
const tm = Object.fromEntries(P.team.map((t) => [t.name, t]));
ok('a person with an overdue query is "needs a hand" with the reason and the age', tm[v2.name].tag === 'waiting' && tm[v2.name].costs.some((c) => /waiting for a response beyond 2 working days/.test(c)), JSON.stringify(tm[v2.name].costs));
ok('a person who sends the same day with high quality and nothing owed is carrying', tm[v1.name].queries.overdue === 0 && tm[v1.name].helps.length >= 1 && tm[v1.name].tag !== 'waiting', JSON.stringify([tm[v1.name].tag, tm[v1.name].helps]));
ok('ranks are separate measures, not one mixed score', Object.keys(tm[v1.name].ranks).join() === 'tested,quality,sent');
ok('the board lists the coordinators too, with their own measures', P.team.some((t) => t.role === 'rc') && tm[rc.name].queries.reviewed >= 1, JSON.stringify(tm[rc.name].queries));

// ---- coordinators: how active and how clean ----
const co = Object.fromEntries(P.coordinators.map((c) => [c.name, c]));
ok('each coordinator has activity: reviews done, waiting, and questions', co[rc.name].active.reviewed >= 1 && co[rc.name].active.review_waiting === 1 && co[rc.name].active.questions_waiting === 1 && co[rc.name].active.questions_answered === 1, JSON.stringify(co[rc.name].active));
ok('cleanliness is counted per school each coordinator leads', co[rc.name].clean.schools === 4 && co[arc.name].clean.schools === 2 && co[rc.name].clean.led.every((l) => l.clean_pct == null || (l.clean_pct >= 0 && l.clean_pct <= 100)), JSON.stringify(co[rc.name].clean));

// ---- one school, everything ----
const det = schoolDetail({ id: B, sum, plan, queries, flags, asks, today: TODAY });
ok('the school detail lists the visit with its notices and the team', det.visits.length === 1 && det.visits[0].aek.state === 'sent' && det.visits[0].team.includes(v3.name) && det.visits[0].lead === arc.name);
ok('every query at the school is there with its stage, response and history', det.queries.length === 2 && det.queries.every((q) => q.response && q.stage_label) && det.queries.find((q) => q.type === 'dup').history.length === 2);
ok('questions about the school come with their events', det.asks.length === 1 && det.asks[0].events.length === 1);
const detA = schoolDetail({ id: A, sum, plan, queries, flags, asks, today: TODAY });
ok('resolved and closed queries stay visible, after the open ones', detA.queries.map((q) => q.status).join() === 'open,resolved,closed' && detA.counts.closed === 1 && /numbers right/.test(detA.queries[2].note), detA.queries.map((q) => q.status).join());
ok('plan changes at the school are listed with the reason and whether they were late', schoolDetail({ id: C, sum, plan, queries, flags, asks, today: TODAY }).plan_changes[0].late === true);
ok('a school outside the data gives nothing', schoolDetail({ id: 'nope', sum, plan, queries, flags, asks, today: TODAY }) === null);

// ---- a volunteer sees their own standing and who carries the team, and only counts of the rest ----
const st = standingFor(P, { id: v2.id });
ok('the volunteer sees their own row, with what waits on them', st.me && st.me.name === v2.name && st.queries_waiting === 1 && st.me.costs.length >= 1);
ok('the team behind is only counted, never named', typeof st.team.overdue_queries === 'number' && !JSON.stringify(st).includes(v1.name) === true || st.carrying.every((c) => c.helps.length >= 1));
ok('nobody sees themselves among those carrying the team', !st.carrying.some((c) => c.name === v2.name));
const flat = JSON.stringify(st);
ok('the volunteer payload has no other person with a cost, no region waiting board and no pupil details', !/costs/.test(JSON.stringify({ ...st, me: null })) && !('waiting' in st) && !/"S\d{4,}"/.test(flat));
ok('no coordinates anywhere', !/-?\d{1,2}\.\d{5,}/.test(JSON.stringify(P)));
done();
