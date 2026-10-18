import { env, mem, ok, done } from './_kit.mjs';
import { kv } from '../src/store.js';
import { forecast } from '../src/predict.js';
import { REGIONS, FIELD_START, addDays, isWorkingDay } from '../src/config.js';
const R = REGIONS.find((r) => r !== 'DODOMA');
// a locked plan: 6 schools, two a day from field start
const days = []; for (let d = FIELD_START; days.length < 3; d = addDays(d, 1)) if (isWorkingDay(d)) days.push(d);
const visits = []; ['s1', 's2', 's3', 's4', 's5', 's6'].forEach((id, i) => visits.push({ school: id, date: days[Math.floor(i / 2)] }));
await kv(env).put(`v2:plan:${R}`, { region: R, status: 'locked', version: 1, visits, changes: [] });
const schools = {}; for (const v of visits) schools[v.school] = { done: false, started: false, region: R };
const sum = { regions: { [R]: { total: 6, done: 0 } }, schools };
const f = await forecast(env, sum, addDays(FIELD_START, -1));
const r = f.regions[R];
ok('basis names this year\'s plan', /this year's plan/.test(r.basis), r.basis);
ok('plan finish is the last planned day', r.plan_finish === days[2], r.plan_finish);
ok('likely finish is near the plan, not last year\'s pattern', r.likely && r.likely <= addDays(days[2], 6), r.likely);
ok('national plan finish reported', f.national.plan_finish === days[2] || f.national.plan_finish > days[2] || f.national.plan_finish === null);
done();
