// Moving a record to the right school must work for records from the first days of field work, not only the newest 3000.
import { env, ok, done } from './_kit.mjs';
import { previewMove } from '../src/corrections.js';
import { kv } from '../src/store.js';
const hq = { role: 'hq', level: 'admin', review_level: 3, name: 'Test HQ' };
env.KOBO_ASSET_ID = 'aSTUDENTS'; env.KOBO_TOKEN = 'tok'; env.KOBO_SERVER = 'kobo.test';
const WRONG = 'PS2008091', RIGHT = 'PS2008069', ID = 897143819;
const rec = (id, school, grade, rn, extra = {}) => ({ _id: id, today: '2026-10-20', start: '2026-10-20T09:09:00', 'id_data/school': school, 'id_data/school_name': school === RIGHT ? 'KIMEMBE' : 'MSIMBAZI', 'id_data/grade': grade, 'id_data/region': 'TANGA', 'id_data/lga': 'KILINDI', 'stu_info/rand_nr': String(rn), rand_long: String(rn).padStart(3, '0'), stuid: `2026${school}${grade}${String(rn).padStart(3, '0')}`, ward: school === RIGHT ? 'KILWA' : 'KILWA', ...extra });
const mine = rec(ID, WRONG, 2, 3);
const neighbour = rec(ID + 5000, RIGHT, 2, 4); // a Kimembe pupil sent the same day, near in the form
let calls = [], wide = false;
globalThis.fetch = async (url) => {
  const u = decodeURIComponent(String(url)); calls.push(u);
  const j = (o) => ({ ok: true, json: async () => o });
  if (u.includes(`/data/${ID}/`)) return j(mine);
  if (u.includes('"_id":{"$gte"')) { const m = /"\$gte":(\d+),"\$lte":(\d+)/.exec(u); const lo = +m[1], hi = +m[2]; const list = [mine, neighbour].filter((r) => r._id >= lo && r._id <= hi); return j({ results: list, next: null }); }
  if (u.includes('start=')) return j({ results: Array.from({ length: 3000 }, (_, i) => rec(910000000 + i, 'PS0000000', 1, 1)), next: null }); // the newest 3000 records: none are from the two schools
  if (u.includes('limit=1')) return j({ count: 50000, results: [] });
  return j({ results: [] });
};
// the dashboard already holds 19 Kimembe Grade 2 pupils, numbers 1..20 except 3
await kv(env).put('v2:state:2026', { sg: { [`${RIGHT}|2`]: { rn: Array.from({ length: 20 }, (_, i) => i + 1).filter((n) => n !== 3).map((n) => `${n}~Hawa Hussein~2026${RIGHT}2${String(n).padStart(3, '0')}~${897143000 + n}`) } } });
const r = await previewMove(env, hq, { form: 'students', target_school: RIGHT, ids: [ID] });
ok('an October record can be moved although it is far from the newest 3000', !r.error && r.records && r.records.length === 1, r.error || '');
ok('the school fields come from a Kimembe record close by', r.reference_id === neighbour._id, String(r.reference_id));
ok('it did not have to read the newest records', !calls.some((c) => c.includes('start=')));
ok('the pupil ID changes from Msimbazi to Kimembe', JSON.stringify(r).includes(`2026${RIGHT}2003`), '');
ok('no duplicate is found: Kimembe Grade 2 has no number 3 yet', r.blocked === false);
// now Kimembe already has a pupil 3 in the dashboard's list: moving a second one would make a duplicate
await kv(env).put('v2:state:2026', { sg: { [`${RIGHT}|2`]: { rn: [`3~Hawa Hussein~2026${RIGHT}2003~897143001`] } } });
const r2 = await previewMove(env, hq, { form: 'students', target_school: RIGHT, ids: [ID] });
ok('a pupil already at the school, however far back, blocks the move', r2.blocked === true, JSON.stringify(r2.warnings));
// the reference is far away: it still finds it by looking wider
neighbour._id = ID + 900000; calls = [];
const r3 = await previewMove(env, hq, { form: 'students', target_school: RIGHT, ids: [ID] });
await kv(env).put('v2:state:2026', { sg: {} });
const r4 = await previewMove(env, hq, { form: 'students', target_school: RIGHT, ids: [ID] });
ok('it widens the search when the closest records are not from the school', !r4.error && r4.reference_id === neighbour._id, r4.error || '');
globalThis.fetch = undefined; done();
