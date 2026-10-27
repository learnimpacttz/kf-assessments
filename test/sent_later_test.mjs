// Records sent on a later day than the test: flagged from the first day after, with the clock times and the next school in plain words
import { ok, done } from './_kit.mjs';
import { addStudents } from '../src/ingest.js';
import { summarize, TIME_NOTE } from '../src/summary.js';
import { overdueQueries } from '../src/queries.js';
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
ok('the question asks why they were not sent on the test day, and says poor signal is not left unexplained', /why were these records not sent on Mon 19 Oct, the day of the test\?/.test(x.hint) && /Where was the phone when they were sent on Tue 20 Oct\?/.test(x.hint) && !/leaving the school|while at school/.test(x.hint) && /Poor signal is a real problem/.test(x.hint) && /only about when the next school was starting/.test(x.hint), x.hint);
ok('a timing list is attached (tested, finished, sent, wait, next school)', Array.isArray(x.timing) && x.timing.map((t) => t[0]).join('|') === 'Tested|Testing finished (phone clock)|Last record sent to KoBo|Wait between finishing and sending|Next school that day', JSON.stringify(x.timing));

// sent the next day but long before the next school: still flagged, without the "held until the next school" line
const early = late(build([rec(A, 2, '2026-10-19', '13:50:00', '14:00:00', '2026-10-19T20:30:00'), rec(B, 1, '2026-10-20', '10:30:00', '10:37:00', '2026-10-20T08:00:00')]));
ok('sent at 23:30 the same evening is the same day and is not flagged', early.length === 0, JSON.stringify(early.map((y) => y.text)));
const next = late(build([rec(A, 2, '2026-10-19', '13:50:00', '14:00:00', '2026-10-20T01:30:00'), rec(B, 1, '2026-10-20', '10:30:00', '10:37:00', '2026-10-20T08:00:00')]));
ok('sent at 04:30 the next morning is flagged, and the hint does not claim it waited for the next school', next.length === 1 && !/only about when the next school was starting/.test(next[0].hint), next[0] && next[0].hint.slice(0, 80));

// same day: nothing
ok('records sent the same day are not flagged', late(build([rec(A, 2, '2026-10-19', '09:00:00', '09:08:00', '2026-10-19T07:00:00')])).length === 0);

// the device checks no longer say "sent": they say these are phone times
const trav = build([rec(A, 2, '2026-10-19', '09:00:00', '09:10:00', '2026-10-19T07:00:00'), rec(B, 1, '2026-10-19', '09:15:00', '09:22:00', '2026-10-19T07:20:00')]).flags.find((y) => y.type === 'devtravel');
ok('the phone-at-two-schools check says the times are phone times, not sending times', trav && /finished at 09:10 and the next test, at .+, started at 09:15, which is 5 minutes later/.test(trav.text) && /not the time of sending/.test(trav.text) && !/sent tests from/.test(trav.text), trav && trav.text);
ok('every timing check carries the same explanation of the clocks', trav.hint.includes(TIME_NOTE) && /Started and finished are the times on the phone/.test(TIME_NOTE));

// sent after midnight: finished 17:40, sent 00:20 EAT the next day. Flagged, said plainly as after midnight, and no claim about the next school
const mid = late(build([rec(A, 2, '2026-10-19', '17:30:00', '17:40:00', '2026-10-19T21:20:00'), rec(B, 1, '2026-10-20', '08:30:00', '08:37:00', '2026-10-20T05:50:00')]));
ok('sent at 00:20 the next morning is flagged, with a 6 hours 40 min wait and the after-midnight line', mid.length === 1 && /6 hours 40 min later/.test(mid[0].text) && /sent after midnight, so they count as the next day/.test(mid[0].hint) && !/only about when the next school/.test(mid[0].hint), mid[0] && mid[0].text + ' || ' + mid[0].hint.slice(0, 90));

// records arriving in any order give the same answer (the last sending time is the latest, not the last one read)
const inOrder = [rec(A, 2, '2026-10-19', '13:50:00', '14:00:00', '2026-10-19T09:00:00'), rec(A, 2, '2026-10-19', '14:05:00', '14:12:00', '2026-10-20T04:58:00')];
const fwd = late(build(inOrder)), rev = late(build([...inOrder].reverse()));
ok('the same text whichever record is read first, and it names the latest sending time', fwd.length === 1 && rev.length === 1 && fwd[0].text === rev[0].text && /last record was sent at 07:58/.test(rev[0].text) && /1 of 2 test records at .+ was sent/.test(rev[0].text), rev[0] && rev[0].text);

// the reply clock: a query from this check cannot be overdue before it could have existed (starts on the sending day, never before 27 Oct)
const old = late(build([rec(A, 2, '2026-10-19', '13:50:00', '14:00:00', '2026-10-20T04:58:00')]))[0];
ok('the clock starts on 27 Oct for an older record, not on the test day', old.since === '2026-10-27', old.since);
ok('so it is not overdue on 29 Oct, and is overdue on 30 Oct if nobody has replied', overdueQueries([old], '2026-10-29').length === 0 && overdueQueries([old], '2026-10-30').length === 1);
ok('other checks still count from the test day', overdueQueries([{ date: '2026-10-19', school: A, type: 'fast' }], '2026-10-27').length === 1);
done();
