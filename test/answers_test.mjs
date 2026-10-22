// Answer patterns and phones in Team patterns: counts only, fair comparison, support-first wording, safe to read once
import { ok, done, env, mem } from './_kit.mjs';
import { answerScan } from '../src/answerscan.js';
import { addStudents } from '../src/ingest.js';
import { recordPattern, summarizeAnswers } from '../src/answers.js';
import { summarize } from '../src/summary.js';
import { computePatterns } from '../src/patterns.js';
import { DEFAULT_BANDS, SCHOOLS_BY_REGION, PILOT_DAY } from '../src/config.js';

// ---- a record built from block strings: C correct, W wrong, N no answer. Slots 0-3 reading, 4-7 arithmetic ----
const SLOT_ITEMS = (grade, slot) => ({ p: slot < 4 ? 'k' : 'a', lo: slot < 4 ? (grade === 1 ? [1, 6, 11, 16] : [1, 6, 16])[slot] : [1, 6, 11, 16][slot - 4] });
const items = (grade, blocks) => {
  const out = { [`s${grade}/k${grade}set`]: '1', [`s${grade}/a101_entry`]: '4', [`s${grade}/selected_a101`]: '1' }; // fields that look similar and must be ignored
  blocks.forEach((b, slot) => { if (!b) return; const { p, lo } = SLOT_ITEMS(grade, slot); [...b].forEach((ch, i) => { const q = lo + i; out[`s${grade}/grp/${p}${grade}${String(q).padStart(2, '0')}_group/${p}${grade}${String(q).padStart(2, '0')}`] = ch === 'C' ? '1' : ch === 'W' ? '0' : '-99'; }); });
  return out;
};
const FULL_UNIFORM_C = ['CCC', 'CCC', 'CCC', 'CCC', 'CCC', 'CCC', 'CCC', 'CCC'];
const FULL_MIXED = ['CWC', 'CCC', 'WWWWW', 'WCCC', 'CCC', 'WWWWW', 'CCC', 'CWCC'];

// ---- 1. one record ----
let p = recordPattern(items(1, FULL_UNIFORM_C), 1);
ok('every block all correct is a full test with no mixed block', p && p.full && p.nm === 0 && p.shape === 'allc');
p = recordPattern(items(1, ['WWWWW', 'WWWWW', 'NNNNN', 'WWWWW', 'WWWWW', 'WWWWW', 'WWWWW', 'WWWWW']), 1);
ok('every block wrong (or no answer) is the same result in every block', p.shape === 'allw' && p.nm === 0);
p = recordPattern(items(1, FULL_MIXED), 1);
ok('mixed blocks are counted and the test is not flagged as uniform', p.shape === 'mixed' && p.nm === 3, JSON.stringify([p.nm, p.shape]));
p = recordPattern(items(1, ['CCC', 'WWWWW', 'CCC', 'WWWWW', 'CCC', 'WWWWW', 'CCC', 'WWWWW']), 1);
ok('uniform blocks with different results are "each block one result"', p.shape === 'nomix');
p = recordPattern(items(2, ['CCC', 'WWWWW', 'CWC', null, 'CCC', 'CCC', 'CCC', 'CCC']), 2);
ok('grade 2 reading has three blocks; fields from another grade are ignored', p.nb === 7 && p.nm === 1 && p.asked[3] === 0);
p = recordPattern(items(1, ['CC', 'CCC', 'CCC', 'CCC', null, null, null, null]), 1);
ok('a block with fewer than 3 questions is not used and a short test is not "full"', p.nb === 3 && !p.full && p.shape === 'short');
ok('a record with no graded questions gives nothing', recordPattern({ 'id_data/school': 'x', stu_avail: '2' }, 1) === null);

// ---- 2. ingest keeps only counts ----
const sch = SCHOOLS_BY_REGION.TANGA.slice(0, 3).map((s) => s.id);
let id = 9000;
const test = (who, day, school, blocks, o = {}) => ({ _id: id++, year: '2026', today: day, 'group_intro/date': day, 'id_data/school': school, 'id_data/grade': '1', 'id_data/enumerator': who, 'stu_info/rand_nr': String(id % 97), stuid: 'S' + id, start: day + 'T09:10:00+03:00', end: day + 'T09:16:00+03:00', 'end_note_gr/testtime_rounded': '6', stu_avail: '1', deviceid: 'dev-' + who, _submission_time: day + 'T10:00:00', ...items(1, blocks), ...o });
// honest testers get a mixture by chance; the copier gives one result per block, the same as the first question
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const honest = () => { const b = []; for (let s = 0; s < 8; s++) { const r = rnd(); b.push(r < 0.35 ? 'CCC' : r < 0.55 ? 'WWWWW' : r < 0.75 ? 'CWC' : r < 0.9 ? 'WCW' + (rnd() < 0.5 ? 'CC' : 'WW') : 'CWWCC'); } return b; };
const copier = () => { const b = []; const r0 = rnd() < 0.5; for (let s = 0; s < 8; s++) b.push(r0 ? 'CCC' : 'WWWWW'); return b; };
const days = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'];
const names = ['Tester A', 'Tester B', 'Tester C', 'Tester D', 'Tester E', 'Tester F', 'Tester G', 'Tester H', 'Tester I', 'Tester J'];
const recs = [];
for (const d of days) names.forEach((n, i) => { const school = sch[(i + days.indexOf(d)) % 3]; for (let k = 0; k < 12; k++) recs.push(test(n, d, school, n === 'Tester J' ? copier() : honest())); });
const state = { yrs: {} }; addStudents(state, recs);
const Y = state.yrs['2026'];
const text = JSON.stringify(Y.cells);
ok('the aggregates hold counts only: no answer strings and no pupil ids in the pattern counters', Object.values(Y.cells).every((c) => c.ap && c.ap.length === 21 && c.ap.every((x) => Number.isInteger(x))));
ok('exemplar tests are kept, at most 4 per cell, once per record', Object.values(Y.cells).every((c) => (c.ex.ap || []).length <= 4 && new Set((c.ex.ap || []).map((e) => e[5])).size === (c.ex.ap || []).length));
const res = summarizeAnswers(Y.cells);
const rate = Object.fromEntries(Object.entries(res).map(([n, o]) => [n, o.ratio]));
ok('the copier has far fewer mixed blocks than the other testers at the same schools', rate['Tester J'] < 0.35 && names.slice(0, 9).every((n) => rate[n] > 0.7), JSON.stringify(rate));
ok('the comparison used the other testers at the same school', res['Tester J'].team_share >= 90, String(res['Tester J'].team_share));
ok('everyone else has far fewer tests with no mixed block', res['Tester J'].nomix_pct === 100 && names.slice(0, 9).every((n) => res[n].nomix_pct < 25), JSON.stringify(Object.values(res).map((o) => o.nomix_pct)));

// ---- 3. through the summary and the patterns page ----
const sum = summarize(Y, { year: '2026', bands: DEFAULT_BANDS, today: '2026-10-22' });
const pat = computePatterns(sum, '2026-10-22'); const by = Object.fromEntries(pat.people.map((x) => [x.name, x]));
ok('the copier is flagged for the answer pattern, with the size of the gap', by['Tester J'] && by['Tester J'].signals.some((s) => s.key === 'answers' && /no mixed answer block/.test(s.detail)), by['Tester J'] && JSON.stringify(by['Tester J'].signals));
ok('a very large gap goes straight to needs attention', by['Tester J'].level === 'attention');
ok('nobody else is flagged for it', names.slice(0, 9).every((n) => !by[n].signals.some((s) => s.key === 'answers')), names.map((n) => by[n].level).join());
ok('possible reasons are offered as things to check, not as a conclusion', by['Tester J'].causes.some((c) => /first question/.test(c)) && !by['Tester J'].causes.some((c) => /cheat|fraud|lying|dishonest/i.test(c)));
ok('the exact submissions are listed without pupil names or numbers', by['Tester J'].ans.ex.length > 0 && by['Tester J'].ans.ex.every((e) => e.length === 7 && typeof e[5] === 'number') && !/"S\d+"/.test(JSON.stringify(pat)));
ok('the per-day full-test and no-mixed counts are kept apart from the day rows', Object.values(sum.extra['Tester J'].ad).length === 4 && Object.values(sum.extra['Tester J'].ad).every((r) => r[0] > 0 && r[1] === r[0]) && Object.values(sum.days['Tester J']).every((r) => r.length === 14));
ok('field staff cannot see the patterns: admin rows and day rows carry nothing new', !/"(ans|ph|nomix|extra)"/.test(JSON.stringify([sum.admins, sum.days, sum.schools, sum.flags])), 'keys in admins: ' + Object.keys(sum.admins[0]).join());
ok('the pattern signal and note appear on the day level', by['Tester J'].patterns.some((x) => /uniform answers/.test(x.text)), JSON.stringify(by['Tester J'].patterns));

// ---- 4. phones ----
const two = (who, day, school, dev, n = 6) => Array.from({ length: n }, () => test(who, day, school, honest(), { deviceid: dev }));
const prec = [];
// Tester P: two phones at two different schools on the same day (twice), plus ordinary days
for (const d of days) { prec.push(...two('Tester P', d, sch[0], 'ph-p1', 10)); }
prec.push(...two('Tester P', days[1], sch[1], 'ph-p2', 4), ...two('Tester P', days[2], sch[2], 'ph-p2', 4));
// Tester Q: one phone at one school on the pilot day, another on field days: no flag, the pilot day is a training day
prec.push(...two('Tester Q', PILOT_DAY, sch[0], 'ph-q-spare', 8), ...days.flatMap((d) => two('Tester Q', d, sch[1], 'ph-q', 8)));
// Tester R and S share one phone, 60% / 40% of its tests
for (const d of days) prec.push(...two('Tester R', d, sch[2], 'ph-rs', 9), ...two('Tester S', d, sch[2], 'ph-rs', 6));
// Tester T uses a different phone every day at the same school (a spare phone each time), Tester U one steady phone
days.forEach((d, i) => prec.push(...two('Tester T', d, sch[0], 'ph-t' + i, 8)));
for (const d of days) prec.push(...two('Tester U', d, sch[1], 'ph-u', 8));
const state2 = { yrs: {} }; addStudents(state2, [...recs, ...prec]);
const sum2 = summarize(state2.yrs['2026'], { year: '2026', bands: DEFAULT_BANDS, today: '2026-10-22' });
const A = Object.fromEntries(Object.entries(sum2.extra));
ok('two phones at different schools on one day are counted for the person', A['Tester P'].ph.split === 2 && A['Tester P'].ph.multi === 2 && A['Tester P'].ph.n === 2, JSON.stringify(A['Tester P'].ph));
ok('the pilot day is not counted as a second phone', A['Tester Q'].ph.n === 1 && A['Tester Q'].ph.multi === 0, JSON.stringify(A['Tester Q'].ph));
ok('a shared phone is seen from both people, with the other name', A['Tester R'].ph.shared_pct === 100 && A['Tester R'].ph.with.includes('Tester S') && A['Tester S'].ph.with.includes('Tester R'));
ok('the main phone changing every day is counted', A['Tester T'].ph.changes === 3 && A['Tester U'].ph.changes === 0);
const pat2 = computePatterns(sum2, '2026-10-22'); const by2 = Object.fromEntries(pat2.people.map((x) => [x.name, x]));
const key = (n) => by2[n].signals.filter((s) => s.key === 'phones').length;
ok('two phones at different schools on one day is flagged, with the days', key('Tester P') === 1 && /different schools/.test(by2['Tester P'].signals.find((s) => s.key === 'phones').detail) && by2['Tester P'].level !== 'ok', JSON.stringify(by2['Tester P'].signals.map((s) => s.detail)));
ok('a shared phone and a phone that changes every day are flagged; a steady phone and the pilot day are not', key('Tester R') === 1 && key('Tester S') === 1 && key('Tester T') === 1 && key('Tester U') === 0 && key('Tester Q') === 0, ['P', 'Q', 'R', 'S', 'T', 'U'].map((x) => x + key('Tester ' + x)).join());
// too little evidence for peer comparison, but two phones at different schools on one day still shows
const early = { as_of: 'x', admins: [{ name: 'New Person', role: 'volunteer', region: 'TANGA', tested: 9, records: 9, avg_min: 6, by_grade: {}, by_grade_n: {}, days: 1 }], extra: { 'New Person': { ph: { n: 2, tests: 9, top: [['D-1', 5, 1, 1], ['D-2', 4, 1, 1]], multi: 1, split: 1, split_days: ['2026-10-20'], changes: 0, shared_pct: 0, with: [] } } }, days: {}, flags: [] };
const pe = computePatterns(early, '2026-10-22').people[0];
ok('a clear phone conflict shows even before the minimum days and tests', pe.level === 'watch' && pe.signals[0].key === 'phones' && pe.causes.length >= 2);
ok('no coordinates in the output', !/-?\d{1,2}\.\d{5,}/.test(JSON.stringify(pat2)));
// ---- 5. arithmetic grades that disagree with the typed answer ----
const arith = (grade, rows) => { const o = {}; rows.forEach(([q, entry, ans, g]) => { const n = `a${grade}${String(q).padStart(2, '0')}`; o[`s${grade}/grp/${n}_group/${n}_entry`] = String(entry); o[`s${grade}/grp/${n}_ans`] = String(ans); o[`s${grade}/grp/${n}_group/${n}`] = String(g); }); return o; };
p = recordPattern({ ...arith(1, [[1, 4, 4, 1], [2, 5, 7, 1], [3, 7, 7, 0], [4, 2, 2, 1]]) }, 1);
ok('a grade that disagrees with the typed answer is counted, both ways', p && p.chk === 4 && p.mm === 2, JSON.stringify([p && p.chk, p && p.mm]));
p = recordPattern({ ...arith(1, [[1, 4, 4, 1], [2, 5, 5, 1], [3, 9, 9, 1]]) }, 1);
ok('grades that agree are not counted', p && p.chk === 3 && p.mm === 0);
let id2 = 3000000; const mmRecs = [];
for (const d of days) for (let k = 0; k < 14; k++) mmRecs.push({ ...test('Tester M', d, sch[0], honest()), _id: id2++, ...arith(1, k % 2 ? [[1, 4, 4, 1], [2, 5, 7, 1], [3, 8, 8, 1]] : [[1, 4, 4, 1], [2, 6, 6, 1], [3, 8, 8, 1]]) });
const state3 = { yrs: {} }; addStudents(state3, [...recs, ...mmRecs]);
const sum3 = summarize(state3.yrs['2026'], { year: '2026', bands: DEFAULT_BANDS, today: '2026-10-22' });
const pat3 = computePatterns(sum3, '2026-10-22'); const m3 = pat3.people.find((x) => x.name === 'Tester M');
ok('many grades that disagree flag the person on their own, with the exact submissions and no pupil ids', m3 && m3.signals.some((s) => s.key === 'answers' && /Grades often disagree/.test(s.label) && /disagree with the typed answer/.test(s.detail)) && m3.ans.mmx.length > 0 && m3.ans.mmx.every((e) => typeof e[3] === 'number') && !/"S\d+"/.test(JSON.stringify(m3.ans)), m3 && JSON.stringify(m3.signals.map((s) => s.label)));
ok('people with no disagreeing grades are not flagged for it', pat3.people.filter((x) => x.name !== 'Tester M' && x.name.startsWith('Tester')).every((x) => !x.signals.some((s) => /Grades often/.test(s.label))));
// ---- 6. the read-only scan: same counts as the sync, nothing written, admin only ----
const page = [...recs, ...mmRecs].slice(0, 400); const urls = [];
globalThis.fetch = async (u) => { urls.push(String(u)); return new Response(JSON.stringify({ results: page, next: null, count: page.length }), { status: 200 }); };
const e2 = { ...env, KOBO_ASSET_ID: 'A1', KOBO_TOKEN: 'tok' }; const before = mem.size;
const sc = await answerScan(e2, { role: 'hq', level: 'admin' }, { year: '2026', after: '12' });
const direct = { yrs: {} }; addStudents(direct, page);
const sameAp = Object.entries(direct.yrs['2026'].cells).every(([k, c]) => JSON.stringify(sc.cells[k]?.ap) === JSON.stringify(c.ap));
ok('the scan reads one page after the given id and says when it is done', sc.records === 400 && sc.done === true && sc.from === 12 && sc.last_id === Math.max(...page.map((r) => r._id)) && /%22%24gt%22%3A12/.test(urls[0]) && /2026-01-01/.test(decodeURIComponent(urls[0])), JSON.stringify([sc.records, sc.done, sc.last_id]));
ok('the scan gives exactly the counts the sync would keep', sameAp && Object.keys(sc.cells).length === Object.keys(direct.yrs['2026'].cells).length);
ok('the scan writes nothing to the store', mem.size === before);
ok('the scan returns no pupil ids or numbers and no answers', !/"S\d{4,}"/.test(JSON.stringify(sc)) && Object.values(sc.cells).some((c) => c.ex.length) && Object.values(sc.cells).every((c) => c.ex.every((e) => e.length === 7 && e[0] === '' && e[1] === '')));
ok('the scan is for HQ Admin only', (await answerScan(e2, { role: 'hq', level: 'viewer' }, {})).status === 403 && (await answerScan(e2, { role: 'rc' }, {})).status === 403 && (await answerScan(e2, { role: 'volunteer' }, {})).status === 403);
done();
