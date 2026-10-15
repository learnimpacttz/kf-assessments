// Target per grade = the smaller of the cap and the number of pupils present on the sampling day (cap 40 at the Dodoma pilot, 20 elsewhere).
import { addStudents, addSampling } from '../src/ingest.js';
import { summarize } from '../src/summary.js';
import { DEFAULT_BANDS, SCHOOLS_BY_REGION } from '../src/config.js';
const pilot = 'PS0302089', regular = SCHOOLS_BY_REGION.TANGA[0].id;
const state = { yrs: {} }; let id = 1;
const samp = (school, grade, att) => ({ year: '2026', 'id_data/school': school, 'id_data/grade': String(grade), 'id_data/enumerator': 'X Y', deviceid: 'd', 'att_gr/att': String(att), date: '2026-10-20', today: '2026-10-20' });
const stu = (school, grade, n) => Array.from({ length: n }, (_, i) => ({ _id: id++, year: '2026', today: '2026-10-20', 'group_intro/date': '2026-10-20', 'id_data/school': school, 'id_data/grade': String(grade), 'id_data/enumerator': 'X Y', 'stu_info/rand_nr': String(i + 1), stu_avail: '1', deviceid: 'd', start: '2026-10-20T09:00:00+03:00', end: '2026-10-20T09:08:00+03:00', 'end_note_gr/testtime_rounded': '8' }));
addSampling(state, [samp(pilot, 1, 94), samp(pilot, 2, 25), samp(regular, 1, 30), samp(regular, 2, 15)]); // pilot 3 and regular 3 have no sampling yet
addStudents(state, [...stu(pilot, 1, 40), ...stu(pilot, 2, 25), ...stu(regular, 1, 20), ...stu(regular, 2, 15)]);
const sum = summarize(state.yrs['2026'], { year: '2026', bands: DEFAULT_BANDS, today: '2026-10-21' });
let bad = 0; const chk = (name, got, want) => { const ok = got === want; if (!ok) bad++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `want ${want}, got ${got}`); };
const T = (s, g) => sum.schools[s].g[g]; 
chk('pilot, 94 present: target 40', T(pilot, 1).target, 40); chk('pilot, 40 tested: done', T(pilot, 1).done, true);
chk('pilot, 25 present: target 25', T(pilot, 2).target, 25); chk('pilot, 25 tested: done', T(pilot, 2).done, true);
chk('pilot, no sampling yet: provisional 40', T(pilot, 3).target, 40);
chk('regular, 30 present: target 20', T(regular, 1).target, 20); chk('regular, 20 tested: done', T(regular, 1).done, true);
chk('regular, 15 present: target 15', T(regular, 2).target, 15); chk('regular, 15 tested: done', T(regular, 2).done, true);
chk('regular, no sampling yet: provisional 20', T(regular, 3).target, 20);
process.exit(bad ? 1 : 0);
