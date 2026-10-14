// Earlier "sampling lead" volunteers must survive the new model as sampling-list members, and un-checking must stick
import { pilotView, pilotSet } from '../src/pilot.js';
import { STAFF } from '../src/config.js';
const mem = new Map(); const stub = { get: async (k) => mem.get(k) ?? null, put: async (k, v) => void mem.set(k, v), del: async (k) => void mem.delete(k) };
const env = { STORE: { idFromName: () => 'x', get: () => stub } };
const S = 'PS0302089'; const vols = STAFF.filter((s) => s.region === 'TANGA' && s.role === 'volunteer');
mem.set('v2:pilot', JSON.stringify({ grades: { [S]: { [vols[0].id]: 1, [vols[1].id]: 2 } }, lead: {}, support: {}, sampling: { [S]: { 1: vols[0].id, 2: vols[1].id } }, log: [] }));
const hq = { role: 'hq', level: 'admin', name: 'HQ', id: 'hq:h1', hq_id: 'h1', review_level: 3 };
let fail = 0; const ok = (n, c, d = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? ' · ' + d : '')); if (!c) fail++; };
let v = (await pilotView(env, hq)).schools.find((x) => x.school === S);
ok('old volunteer sampling leads appear in the sampling lists', (v.samplers['1'] || []).includes(vols[0].id) && (v.samplers['2'] || []).includes(vols[1].id), JSON.stringify(v.samplers));
ok('their grades are untouched', v.staff.TANGA.volunteers.find((x) => x.id === vols[0].id).grade === 1 && v.staff.TANGA.volunteers.find((x) => x.id === vols[1].id).grade === 2);
ok('no sampling leads are invented', Object.keys(v.sampling_lead).length === 0);
await pilotSet(env, hq, { school: S, action: 'sampler', grade: 1, staff_id: vols[0].id, on: false });
v = (await pilotView(env, hq)).schools.find((x) => x.school === S);
ok('un-checking sticks after the first save (no re-adding from old data)', !(v.samplers['1'] || []).includes(vols[0].id) && (v.samplers['2'] || []).includes(vols[1].id), JSON.stringify(v.samplers));
const saved = JSON.parse(mem.get('v2:pilot')); ok('the old sampling key is emptied once migrated', Object.keys(saved.sampling).length === 0 && saved.grades[S][vols[0].id] === 1);
console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
