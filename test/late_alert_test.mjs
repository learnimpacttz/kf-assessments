// The late-notices phone alert: once a day per region, only to its RC and ARC, only while a notice is late.
import { env, ok, done } from './_kit.mjs';
import { runLateNotices } from '../src/cover.js';
import { kv } from '../src/store.js';
import { SCHOOLS_BY_REGION, STAFF, addWorkingDays } from '../src/config.js';
const today = '2026-11-05'; const R = 'TANGA', R2 = 'MARA';
const sch = SCHOOLS_BY_REGION[R].slice(0, 2), sch2 = SCHOOLS_BY_REGION[R2].slice(0, 1);
const later = addWorkingDays(today, 2); // its notices were due before today and are not sent: late
await kv(env).put(`v2:plan:${R}`, { region: R, status: 'locked', version: 1, visits: [{ id: 'a', school: sch[0].id, date: later, start: '08:00', team: [], notices: {} }, { id: 'b', school: sch[1].id, date: later, start: '08:00', team: [], notices: { aek: { at: 'x', by: 'y' }, ht: { at: 'x', by: 'y' } } }], changes: [] });
await kv(env).put(`v2:plan:${R2}`, { region: R2, status: 'locked', version: 1, visits: [{ id: 'c', school: sch2[0].id, date: later, start: '08:00', team: [], notices: { aek: { at: 'x', by: 'y' }, ht: { at: 'x', by: 'y' } } }], changes: [] });
const calls = []; const spy = async (e, pred, alert) => { calls.push({ ids: STAFF.filter((s) => pred({ id: s.id, role: s.role, region: s.region })).map((s) => s.role + ':' + s.region), alert }); };
const r1 = await runLateNotices(env, '04:05', spy, today);
ok('one alert, for the region with a late notice only', r1.sent === 1 && r1.regions.join() === R, JSON.stringify(r1));
ok('it goes to that region\'s RC and ARC only', calls.length === 1 && calls[0].ids.sort().join() === `arc:${R},rc:${R}`, JSON.stringify(calls[0] && calls[0].ids));
ok('it counts the late notice and says what to do', /1 notice is late/.test(calls[0].alert.title) && /ward officer and the head teacher/.test(calls[0].alert.body) && calls[0].alert.url === '/#plan');
const r2 = await runLateNotices(env, '04:05', spy, today);
ok('only once a day per region', r2.sent === 0 && calls.length === 1);
const r3 = await runLateNotices(env, '04:05', spy, addWorkingDays(today, 1));
ok('it comes again the next working morning while the notice is still late', r3.sent === 1 && calls.length === 2);
ok('no alert at other times, on a weekend, or after schools close', (await runLateNotices(env, '11:30', spy, '2026-11-09')).skipped && (await runLateNotices(env, '04:05', spy, '2026-11-07')).skipped && (await runLateNotices(env, '04:05', spy, '2026-11-16')).skipped);
done();
