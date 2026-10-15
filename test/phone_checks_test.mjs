// The three phone patterns: same person overlapping, same phone overlapping, same phone changing hands (at any time)
import { analyseDay } from '../src/summary.js';
const S = 'PS0302089', S2 = 'PS0302005';
const t = (h, m) => h * 3600 + m * 60;
const ev = (dev, a, b, who, school = S, g = 1) => [dev, a, b, school, g, who, 't'];
const types = (events) => analyseDay('2026-10-20', events).map((f) => f.type).sort();
const cases = [
  ['same person, overlapping, same phone', [ev('d1', t(9, 0), t(9, 10), 'Amina'), ev('d1', t(9, 5), t(9, 15), 'Amina')], ['nameoverlap']],
  ['same person, overlapping, two phones', [ev('d1', t(9, 0), t(9, 10), 'Amina'), ev('d2', t(9, 5), t(9, 15), 'Amina')], ['nameoverlap']],
  ['same person, overlapping, two schools', [ev('d1', t(9, 0), t(9, 10), 'Amina', S), ev('d2', t(9, 4), t(9, 14), 'Amina', S2)], ['nameoverlap']],
  ['same phone, two people at the same time', [ev('d1', t(9, 0), t(9, 10), 'Amina'), ev('d1', t(9, 5), t(9, 15), 'Juma')], ['devoverlap', 'devpeople']],
  ['same phone, people swap hours apart', [ev('d1', t(8, 0), t(8, 10), 'Amina'), ev('d1', t(8, 20), t(8, 30), 'Amina'), ev('d1', t(11, 0), t(11, 10), 'Juma')], ['devpeople']],
  ['same phone, people swap across two schools', [ev('d1', t(8, 0), t(8, 10), 'Amina', S), ev('d1', t(13, 0), t(13, 10), 'Juma', S2)], ['devpeople']],
  ['same phone, A then B then A (keeps changing hands)', [ev('d1', t(8, 0), t(8, 10), 'Amina'), ev('d1', t(10, 0), t(10, 10), 'Juma'), ev('d1', t(12, 0), t(12, 10), 'Amina')], ['devpeople']],
  ['normal: one person, one phone, back to back', [ev('d1', t(9, 0), t(9, 10), 'Amina'), ev('d1', t(9, 10), t(9, 20), 'Amina'), ev('d1', t(9, 21), t(9, 30), 'Amina')], []],
  ['normal: two people, two phones, same time', [ev('d1', t(9, 0), t(9, 10), 'Amina'), ev('d2', t(9, 0), t(9, 10), 'Juma')], []],
];
let bad = 0;
for (const [name, events, want] of cases) { const got = types(events); const ok = JSON.stringify(got) === JSON.stringify(want.slice().sort()); if (!ok) bad++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `want ${want} got ${got}`); }
process.exit(bad ? 1 : 0);
