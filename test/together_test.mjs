// The page every team shares: regions with their plan and reply speed, and every person's queries and how fast they reply
import { ok, done } from './_kit.mjs';
import { addStudents } from '../src/ingest.js';
import { summarize } from '../src/summary.js';
import { togetherBoard, replyDays, TOGETHER } from '../src/together.js';
import { DEFAULT_BANDS, SCHOOLS_BY_REGION, STAFF } from '../src/config.js';

const TODAY = '2026-10-22';
const staff = (r) => STAFF.filter((s) => s.active && s.region === r); const T = staff('TANGA'), M = staff('MARA');
const tv = T.filter((s) => s.role === 'volunteer'), mv = M.filter((s) => s.role === 'volunteer');
const sT = SCHOOLS_BY_REGION.TANGA.slice(0, 2).map((s) => s.id), sM = SCHOOLS_BY_REGION.MARA.slice(0, 2).map((s) => s.id);
let id = 500000;
const rec = (who, school, grade, day, n) => Array.from({ length: n }, () => ({ _id: id++, year: '2026', today: day, 'group_intro/date': day, 'id_data/school': school, 'id_data/grade': String(grade), 'id_data/enumerator': who.name, 'stu_info/rand_nr': String(id % 997), stuid: 'S' + id, start: day + 'T09:10:00+03:00', end: day + 'T09:17:00+03:00', 'end_note_gr/testtime_rounded': '7', stu_avail: '1', deviceid: 'dev-' + who.id, _submission_time: day + 'T12:00:00' }));
const state = { yrs: {} };
addStudents(state, [...rec(tv[0], sT[0], 1, '2026-10-19', 30), ...rec(tv[1], sT[0], 2, '2026-10-19', 30), ...rec(mv[0], sM[0], 1, '2026-10-19', 30), ...rec(mv[1], sM[0], 2, '2026-10-20', 30)]);
const sum = summarize(state.yrs['2026'], { year: '2026', bands: DEFAULT_BANDS, today: TODAY });
const mk = (school, admin, date, o = {}) => ({ type: o.type || 'fast', sev: 'warn', n: 4, text: 'check', school, grade: 1, date, admin: admin.name, ...o.f });
const resp = (day) => ({ status: 'open', thread: [], wf: { stage: 'team', response: { text: 'ok', by: 'x', at: day + 'T10:00:00Z' }, history: [] } });
// Tanga: v0 replies the same day (twice), v1 never replies (overdue); Mara: v0 replies after 3 working days, v1 has one approved
const fl = [mk(sT[0], tv[0], '2026-10-19', { type: 'fast' }), mk(sT[0], tv[0], '2026-10-19', { type: 'slow' }), mk(sT[0], tv[1], '2026-10-19', { type: 'dup' }), mk(sT[0], tv[1], '2026-10-19', { type: 'window' }), mk(sM[0], mv[0], '2026-10-19', { type: 'fast' }), mk(sM[0], mv[0], '2026-10-19', { type: 'slow' }), mk(sM[0], mv[1], '2026-10-20', { type: 'notlist' })];
const qs = { ['fast|' + sT[0] + '|1|2026-10-19|' + tv[0].name]: resp('2026-10-19'), ['slow|' + sT[0] + '|1|2026-10-19|' + tv[0].name]: resp('2026-10-19'), ['fast|' + sM[0] + '|1|2026-10-19|' + mv[0].name]: resp('2026-10-22'), ['slow|' + sM[0] + '|1|2026-10-19|' + mv[0].name]: resp('2026-10-22'), ['notlist|' + sM[0] + '|1|2026-10-20|' + mv[1].name]: { status: 'resolved', thread: [], wf: { stage: 'approved', response: { text: 'ok', by: 'x', at: '2026-10-20T15:00:00Z' }, history: [] } } };
sum.flags = fl;
const plans = { TANGA: { status: 'locked', visits: [{ school: sT[0], date: '2026-10-19' }, { school: sT[1], date: '2026-10-21' }] }, MARA: { status: 'draft', visits: [] } };
const B = togetherBoard({ sum, queries: qs, plans, today: TODAY });
const reg = Object.fromEntries(B.regions.map((r) => [r.region, r])); const ppl = Object.fromEntries(B.people.map((p) => [p.name, p]));

ok('reply speed counts working days from the visit to the first response; the same day is 0', replyDays({ date: '2026-10-19', q: { wf: { response: { at: '2026-10-19T10:00:00Z' } } } }) === 0 && replyDays({ date: '2026-10-19', q: { wf: { response: { at: '2026-10-22T10:00:00Z' } } } }) === 3 && replyDays({ date: '2026-10-19', q: null }) === null);
ok('every region with data is listed, with schools, pupils and the plan', Object.keys(reg).length >= 2 && reg.TANGA.schools.total === SCHOOLS_BY_REGION.TANGA.length && reg.TANGA.pupils.pct >= 0 && reg.TANGA.plan.submitted && reg.TANGA.plan.due === 2 && reg.TANGA.plan.behind === (reg.TANGA.plan.due - reg.TANGA.plan.complete) && !reg.MARA.plan.submitted, JSON.stringify([reg.TANGA.plan, reg.MARA.plan]));
ok('a region shows its queries: open, overdue, answered and how fast they are answered', reg.TANGA.queries.total === 4 && reg.TANGA.queries.open === 4 && reg.TANGA.queries.answered === 2 && reg.TANGA.queries.reply_days === 0 && reg.MARA.queries.reply_days === 2 && reg.TANGA.queries.overdue === 2, JSON.stringify([reg.TANGA.queries, reg.MARA.queries]));
ok('every person across the regions is there with their queries and reply speed', ppl[tv[0].name].queries === 2 && ppl[tv[0].name].answered === 2 && ppl[tv[0].name].reply_days === 0 && ppl[mv[0].name].reply_days === 3 && ppl[tv[1].name].open === 2 && ppl[tv[1].name].overdue === 2 && ppl[tv[1].name].reply_days === null);
ok('queries per 100 tests are only worked out once someone has enough tests', ppl[tv[0].name].per100 === Math.round((1000 * 2) / ppl[tv[0].name].tested) / 10 && B.people.filter((p) => p.tested < TOGETHER.minTests).every((p) => p.per100 === null));
ok('the highlights show both ends: fastest and slowest repliers, most queries open and fewest', B.highlights.fastest[0].name === tv[0].name && B.highlights.slowest[0].name === mv[0].name && B.highlights.most_open[0].open >= B.highlights.most_open[B.highlights.most_open.length - 1].open && B.highlights.fewest.every((p) => p.per100 != null), JSON.stringify(B.highlights.fastest.map((p) => p.name)));
ok('nobody is on both the fastest and the slowest list', B.highlights.fastest.every((f) => !B.highlights.slowest.some((x) => x.id === f.id)));
ok('people who have not replied twice are not ranked on speed', B.highlights.fastest.every((p) => p.answered >= TOGETHER.minReplies) && B.highlights.slowest.every((p) => p.answered >= TOGETHER.minReplies));
ok('only field staff are listed, not HQ, and there are no pupil details or coordinates', B.people.every((p) => ['volunteer', 'rc', 'arc'].includes(p.role)) && !/"S\d{4,}"/.test(JSON.stringify(B)) && !/-?\d{1,2}\.\d{5,}/.test(JSON.stringify(B)));
ok('the national line adds up', B.national.queries === 7 && B.national.open === 6 && B.national.people === B.people.length);
done();
