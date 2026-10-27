// Records sent on a later day than the test: flagged from the first day after, with the clock times and the next school in plain words
import { ok, done } from './_kit.mjs';
import { addStudents } from '../src/ingest.js';
import { summarize, TIME_NOTE } from '../src/summary.js';
import { DEFAULT_BANDS, SCHOOLS_BY_REGION, STAFF } from '../src/config.js';

const who = STAFF.find((s) => s.active && s.role === 'volunteer' && s.region === 'TANGA');
const [A, B] = SCHOOLS_BY_REGION.TANGA.slice(0, 2).map((s) => s.id);
let id = 600000;
// a record tested at the phone clock `at` on `day`, sent (server time, UTC) at `sentUtc`
const rec = (school, grade, day, start, end, sentUtc, dev = 'dev-1') => ({ _id: id++, year: '2026', today: day, 'group_intro/date': day, 'id_data/school': school, 'id_data/grade': String(grade), 'id_data/enumerator': who.name, 'stu_info/rand_nr': String(id % 997), stuid: 'S' + id, start: `${day}T${start}+03:00`, end: `${day}T${end}+03:00`, 'end_note_gr/testtime_rounded': '7', stu_avail: '1', deviceid: dev, _submission_time: sentUtc });
const build = (recs) => { const state = { yrs: {} }; addStudents(state, recs); return summarize(state.yrs['2026'], { year: '2026', bands: DEFAULT_BANDS, today: '2026-10-22' }); };
const late = (sum) => sum.flags.filter((f) => f.type === 'latesub');

// Mon 19 Oct: three tests finished at school A by 14:20 (phone clock), but sent only on Tue 20 Oct at 07:58 EAT (04:58 UTC),
// 11 minutes before the first test at school B started (08:09 on the phone)
const sum = build([
  rec(A, 2, '2026-10-19', '13:50:00', '14:00:00', '2026-10-20T04:58:00'), rec(A, 2, '2026-10-19', '14:05:00', '14:12:00', '2026-10-20T04:58:00'), rec(A, 2, '2026-10-19', '14:12:00', '14:20:00', '2026-10-20T04:58:30'),
  rec(B, 1, '2026-10-20', '08:09:00', '08:16:00', '2026-10-20T05:20:00'),
]);
const f = late(sum);
ok('records sent the day after the test are flagged (before, only 2 or more days were)', f.length === 1 && f[0].admin === who.name && f[0].date === '2026-10-19', JSON.stringify(f.map((x) => x.text)));
const x = f[0];
ok('the text says when it was tested, when it finished and when it was sent', /sent on Tue 20 Oct, not on the test day Mon 19 Oct/.test(x.text) && /finished at 14:20 on the phone/.test(x.text) && /sent at 07:58/.test(x.text), x.text);
ok('the wait is given in hours and minutes', /17 hours 38 min later/.test(x.text), x.text);
ok('it says how long before the next school started', /first test that day, at .+, started at 08:09 on the phone, 11 minutes after the records were sent/.test(x.text), x.text);
ok('the question asks why they were not sent on the test day, and says poor signal is not left unexplained', /why were they not sent on Mon 19 Oct, before leaving the school/.test(x.hint) && /Poor signal is a real problem/.test(x.hint) && /only when the next school was starting/.test(x.hint), x.hint);
ok('a timing list is attached (tested, finished, sent, wait, next school)', Array.isArray(x.timing) && x.timing.map((t) => t[0]).join('|') === 'Tested|Testing finished (phone clock)|Last record sent to KoBo|Wait between finishing and sending|Next school that day', JSON.stringify(x.timing));

// sent the next day but long before the next school: still flagged, without the "held until the next school" line
const early = late(build([rec(A, 2, '2026-10-19', '13:50:00', '14:00:00', '2026-10-19T20:30:00'), rec(B, 1, '2026-10-20', '10:30:00', '10:37:00', '2026-10-20T08:00:00')]));
ok('sent at 23:30 the same evening is the same day and is not flagged', early.length === 0, JSON.stringify(early.map((y) => y.text)));
const next = late(build([rec(A, 2, '2026-10-19', '13:50:00', '14:00:00', '2026-10-20T01:30:00'), rec(B, 1, '2026-10-20', '10:30:00', '10:37:00', '2026-10-20T08:00:00')]));
ok('sent at 04:30 the next morning is flagged, and the hint does not claim it waited for the next school', next.length === 1 && !/only when the next school was starting/.test(next[0].hint), next[0] && next[0].hint.slice(0, 80));

// same day: nothing
ok('records sent the same day are not flagged', late(build([rec(A, 2, '2026-10-19', '09:00:00', '09:08:00', '2026-10-19T07:00:00')])).length === 0);

// the device checks no longer say "sent": they say these are phone times
const trav = build([rec(A, 2, '2026-10-19', '09:00:00', '09:10:00', '2026-10-19T07:00:00'), rec(B, 1, '2026-10-19', '09:15:00', '09:22:00', '2026-10-19T07:20:00')]).flags.find((y) => y.type === 'devtravel');
ok('the phone-at-two-schools check says the times are phone times, not sending times', trav && /finished at 09:10 and the next test, at .+, started at 09:15, which is 5 minutes later/.test(trav.text) && /not the time of sending/.test(trav.text) && !/sent tests from/.test(trav.text), trav && trav.text);
ok('every timing check carries the same explanation of the clocks', trav.hint.includes(TIME_NOTE) && /Started and finished are the times on the phone/.test(TIME_NOTE));
done();
