// Team patterns: peers, repeated evidence, minimum sample, weekday clustering, and no locations in the output
import { ok, done } from './_kit.mjs';
import { computePatterns, zScores } from '../src/patterns.js';
const mk = (i, over = {}) => ({ name: 'Person ' + i, staff_id: i, role: 'volunteer', region: 'TANGA', position: 'Volunteer', tested: 120, records: 130, avg_min: 7, by_grade: { 1: 5, 2: 7, 3: 9 }, by_grade_n: { 1: 40, 2: 40, 3: 40 }, days: 6, schools: 6, fast: 4, slow: 3, late: 2, far: 0, quality: 95, gp: 60, gk: 60, gn: 55, gv: 0, ...over });
const dates = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27', '2026-11-03'];
const day = (d, o = {}) => [d, 1, 20, 8, 13, 20, 140, 1, 0, 0, 10, 10, 9, 0, ...[]].map((v, i) => (o[i] !== undefined ? o[i] : v));
const admins = [], days = {};
for (let i = 1; i <= 12; i++) { admins.push(mk(i, { avg_min: 6.8 + (i % 4) * 0.2, fast: 3 + (i % 3), slow: 2 + (i % 2), late: i % 3, gp: 55 + i, gn: 50 + i })); days['Person ' + i] = dates.slice(0, 6).map((d) => day(d)); }
// the outlier: very fast, on Tuesdays, late first test, location mostly missing
admins.push(mk(13, { avg_min: 3.2, by_grade: { 1: 2.5, 2: 3.2, 3: 4 }, fast: 70, late: 20, gp: 10, gk: 10, gn: 3, gv: 4 }));
days['Person 13'] = dates.map((d, i) => day(d, new Date(d + 'T00:00:00Z').getUTCDay() === 2 ? { 7: 12, 3: 11 } : { 3: 11 }));
admins.push(mk(14, { tested: 8, records: 8, avg_min: 2 })); days['Person 14'] = [day(dates[0])];
const sum = { as_of: 'x', admins, days, flags: [{ type: 'dup', admin: 'Person 13' }, { type: 'dup', admin: 'Person 13' }, { type: 'notlist', admin: 'Person 13' }] };
const p = computePatterns(sum, '2026-10-27'); const by = Object.fromEntries(p.people.map((x) => [x.name, x]));
ok('robust z-scores need at least 5 peers', zScores([1, 2, 3], 1).every((v) => v === null) && zScores([1, 2, 3, 4, 5, 20], 1)[5] > 3);
ok('the outlier is flagged for attention', by['Person 13'].level === 'attention', by['Person 13'].level + ' ' + by['Person 13'].signals.map((s) => s.key));
ok('normal people are not flagged', ['Person 1', 'Person 2', 'Person 5', 'Person 9'].every((n) => by[n].level === 'ok'), p.people.filter((x) => x.level !== 'ok' && x.level !== 'early').map((x) => x.name).join());
ok('too little evidence says "too early", not a flag', by['Person 14'].level === 'early' && by['Person 14'].signals.length === 0);
ok('fast tests are named among the signals with a size', by['Person 13'].signals.some((s) => s.key === 'fast' && /%/.test(s.detail)));
ok('the weekday cluster is found', by['Person 13'].patterns.some((x) => /Tuesdays/.test(x.text)), JSON.stringify(by['Person 13'].patterns));
ok('possible causes are offered, as things to check', by['Person 13'].causes.length >= 2 && !by['Person 13'].causes.some((c) => /cheat|fraud|suspicious/i.test(c)));
ok('the attention list comes first', p.people[0].name === 'Person 13');
ok('counts add up', p.counts.people === 14 && p.counts.attention + p.counts.watch + p.counts.ok + p.counts.early === 14);
ok('weekday picture covers Monday to Friday', Object.keys(p.weekdays).join() === 'Mon,Tue,Wed,Thu,Fri' && p.weekdays.Tue.fast > p.weekdays.Mon.fast);
ok('no coordinates anywhere in the output', !/-?\d{1,2}\.\d{5,}/.test(JSON.stringify(p)));
done();
