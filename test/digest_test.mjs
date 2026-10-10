import { personalPart } from '../src/digest.js';
import { STAFF, SCHOOLS_BY_REGION } from '../src/config.js';
import { kv } from '../src/store.js';
const region = 'MARA';
const rc = STAFF.find((s) => s.region === region && s.role === 'rc');
const sch = SCHOOLS_BY_REGION[region].slice(0, 2);
const store = new Map();
const env = { STORE: { idFromName: () => 'x', get: () => ({ get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v), del: async () => {}, acquire: async () => true, release: async () => {} }) } };
await kv(env).put('v2:plan:' + region, { region, status: 'locked', version: 1, visits: [
  { id: 'a', school: sch[0].id, date: '2026-10-20', start: '08:00', team: [rc.name, 'Vol One'], lead: rc.name, notices: {}, status: 'planned' },
  { id: 'b', school: sch[1].id, date: '2026-10-22', start: '08:00', team: [rc.name], lead: rc.name, notices: {}, status: 'planned' }], changes: [] });
const sum = { schools: {}, flags: [], work: { [rc.name]: [['2026-10-19', sch[0].id, 1, 20, 8.1], ['2026-10-19', sch[0].id, 2, 20, 8.3]] }, admins: [{ name: rc.name, staff_id: rc.id, tested: 40, samp: 2, quality: 95, sub_all: { n: 40, same: 40, same_pct: 100 } }] };
for (const kind of ['morning', 'evening']) {
  const r = await personalPart(env, sum, { region, role: 'rc' }, '2026-10-20', kind, { plan: {} });
  console.log(kind.toUpperCase() + '\n' + r.text + '\n');
}
