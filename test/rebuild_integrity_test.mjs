// Reading the same KoBo records again (a rebuild, an overlapping sync, a retry) must never change the answers, and never invent duplicates.
import { ok, done } from './_kit.mjs';
import { addStudents, addSampling, clearForRebuild, uniqueRn } from '../src/ingest.js';
import { summarize } from '../src/summary.js';
import { DEFAULT_BANDS, SCHOOLS_BY_REGION } from '../src/config.js';
const school = SCHOOLS_BY_REGION.TANGA[2].id;
const samp = (grade) => ({ year: '2026', 'id_data/school': school, 'id_data/grade': String(grade), 'id_data/enumerator': 'Nuru G. Masawika', deviceid: 'd1', 'att_gr/att': '20', date: '2026-10-19', today: '2026-10-19' });
let id = 5000;
const stu = (grade, who, nums) => nums.map((n) => ({ _id: id++, year: '2026', today: '2026-10-19', 'group_intro/date': '2026-10-19', 'id_data/school': school, 'id_data/grade': String(grade), 'id_data/enumerator': who, 'stu_info/rand_nr': String(n), stuid: `S${grade}${n}`, start: '2026-10-19T09:10:00+03:00', 'end_note_gr/testtime_rounded': '6', stu_avail: '1', deviceid: 'p' + who.length, _submission_time: '2026-10-19T10:00:00' }));
const recs = [...stu(2, 'Nuru G. Masawika', [3, 10, 13, 15, 20, 25, 28, 34, 52, 65]), ...stu(2, 'Salimu Rajabu Nyaki', [76, 75, 78, 89, 91, 92, 93, 101, 109, 71])];
const run = (state) => summarize(state.yrs['2026'], { year: '2026', bands: DEFAULT_BANDS, today: '2026-10-20' });
const dups = (s) => s.flags.filter((f) => f.type === 'dup').length;
const rnLen = (state) => Object.values(state.yrs['2026'].sg).reduce((a, g) => a + g.rn.length, 0);

// 1. reading the same records again changes nothing
let st = { yrs: {} }; addSampling(st, [samp(2)]); addStudents(st, recs); const first = run(st);
addStudents(st, recs); addStudents(st, recs);
const again = run(st);
ok('no duplicate flags for two testers with different pupil numbers', dups(first) === 0 && dups(again) === 0);
ok('reading the same records three times keeps one entry per record', rnLen(st) === recs.length);
const rebuilt = { yrs: { 2026: JSON.parse(JSON.stringify(st.yrs['2026'])) } }; for (let k = 0; k < 3; k++) { clearForRebuild(rebuilt.yrs['2026'], 'students'); addStudents(rebuilt, recs); }
const afterRebuilds = run(rebuilt);
ok('after several rebuilds the answers equal a single clean read', JSON.stringify(first.flags.map((f) => f.type)) === JSON.stringify(afterRebuilds.flags.map((f) => f.type)) && first.national.tested === afterRebuilds.national.tested && afterRebuilds.integrity.repeated_entries === 0, `${first.national.tested} vs ${afterRebuilds.national.tested}`);

// 2. a real duplicate (the same number tested by two records) is still found
const real = { yrs: {} }; addSampling(real, [samp(2)]); addStudents(real, [...stu(2, 'Nuru G. Masawika', [3, 10]), ...stu(2, 'Salimu Rajabu Nyaki', [3, 11])]);
ok('a pupil number really tested twice is still flagged', dups(run(real)) >= 1);

// 3. older stored data that already holds repeats cannot invent duplicates
const old = { yrs: { 2026: JSON.parse(JSON.stringify(st.yrs['2026'])) } }; for (const g of Object.values(old.yrs['2026'].sg)) g.rn = [...g.rn, ...g.rn, ...g.rn];
const healed = run(old);
ok('repeats already stored are ignored when reading', dups(healed) === 0 && healed.integrity.repeated_entries === recs.length * 2, JSON.stringify(healed.integrity));
ok('uniqueRn keeps the last entry for each record', uniqueRn(['5~a~s~1', '6~a~s~1', '7~b~s~2']).join() === '6~a~s~1,7~b~s~2');

// 4. a rebuild clears what its form wrote, and only that
const rb = { yrs: { 2026: JSON.parse(JSON.stringify(st.yrs['2026'])) } }; const Y = rb.yrs['2026'];
clearForRebuild(Y, 'students');
ok('a Students rebuild clears the tests and the pupil numbers', Y.n === 0 && Object.keys(Y.cells).length === 0 && Object.values(Y.sg).every((g) => g.rn.length === 0));
ok('a Students rebuild keeps the sampling forms (class size and draws)', Object.values(Y.sg).every((g) => g.att === 20));
for (let k = 0; k < 4; k++) { clearForRebuild(Y, 'students'); addStudents(rb, recs); }
ok('four rebuilds in a row give the same pupil-number list as one read', rnLen(rb) === recs.length && dups(run(rb)) === 0);
const Y2 = JSON.parse(JSON.stringify(rb.yrs['2026'])); clearForRebuild(Y2, 'sampling');
ok('a Sampling rebuild keeps the pupil numbers from the tests', Object.values(Y2.sg).reduce((a, g) => a + g.rn.length, 0) === recs.length && Object.values(Y2.sg).every((g) => g.att === null && g.list === null));
const full = { yrs: { 2026: Y2 } }; addSampling(full, [samp(2)]);
ok('re-reading the sampling forms after that restores them without duplicates', Object.values(full.yrs['2026'].sg).every((g) => g.att === 20) && dups(run(full)) === 0);
done();
