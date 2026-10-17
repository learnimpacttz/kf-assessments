// Wrong access codes are counted per network address. Too many in a short time pauses sign-in from that address for a while.
import { kv } from './store.js';
const WINDOW = 15 * 60e3, LIMIT = 30;
const key = (ip) => 'v2:rl:' + String(ip || 'x').replace(/[^a-fA-F0-9:.]/g, '').slice(0, 45);
export async function isBlocked(env, ip) { const r = await kv(env).get(key(ip)); return Boolean(r && r.n >= LIMIT && Date.now() - r.t < WINDOW); }
export async function recordFail(env, ip) { const k = key(ip); const r = (await kv(env).get(k)) || { n: 0, t: Date.now() }; if (Date.now() - r.t > WINDOW) { r.n = 0; r.t = Date.now(); } r.n += 1; await kv(env).put(k, r); }
