import { attachDelete } from '../src/attachments.js';
const imgs = Array.from({ length: 100 }, (_, i) => ({ _id: i, _attachments: [{ uid: 'a' + i, mimetype: 'image/jpeg', filename: 'x.jpg', download_url: 'u' }, { uid: 'c' + i, mimetype: 'text/csv', filename: 'audit.csv', download_url: 'u' }] }));
let deletedIds = []; let calls = 0;
globalThis.fetch = async (u, i) => { calls++; u = String(u);
  if (i?.method === 'DELETE') { deletedIds.push(u.split('/attachments/')[1]); return new Response(null, { status: 204 }); }
  if (u.includes('service_usage')) return Response.json({ total_storage_bytes: 5, balances: { storage_bytes: { effective_limit: 1 } } });
  if (u.includes('/data/')) { const gone = new Set(deletedIds.map((x) => x.replace('/', ''))); return Response.json({ count: 100, next: null, results: imgs.map((r) => ({ ...r, _attachments: r._attachments.filter((a) => !gone.has(a.uid)) })) }); }
  return Response.json({ uid: 'ASSET12345', name: 'Proj' }); };
const mem = new Map(); const env = { KOBO_ASSET_ID: 'STUDENTS123', KOBO_ASSET_SAMPLING: 'SAMPLING123', KOBO_TOKEN: 't', STORE: { idFromName: () => 'x', get: () => ({ get: async (k) => mem.get(k) ?? null, put: async (k, v) => void mem.set(k, v), del: async (k) => void mem.delete(k) }) }, DASHBOARD_KV: null };
const who = { role: 'hq', level: 'admin', hq_id: 'h1', review_level: 3, name: 'Michael' };
const body = { asset: 'ASSET12345', confirm: 'Proj', copy_ok: true };
let rem = 100, rounds = 0, maxCalls = 0;
while (rem > 0 && rounds < 10) { calls = 0; const r = await attachDelete(env, who, body); maxCalls = Math.max(maxCalls, calls); rem = r.remaining; rounds++; if (r.error) { console.log('ERR', r.error); break; } }
console.log('rounds', rounds, 'remaining', rem, 'deleted', deletedIds.length, 'only images', deletedIds.every((x) => x.startsWith('a')), 'max calls per request', maxCalls);
console.log('protected', (await attachDelete(env, who, { ...body, asset: 'STUDENTS123' })).error);
console.log('no copy ok', (await attachDelete(env, who, { ...body, copy_ok: false })).error);
console.log('low rights', (await attachDelete(env, { ...who, review_level: 1 }, body)).error);
