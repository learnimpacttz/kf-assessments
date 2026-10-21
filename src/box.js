// The suggestion box (Sanduku la maoni). A message is locked on the sender's phone with the Executive Director's public key (public/boxcrypto.js).
// This file only ever sees locked text: no name, code, region, phone, minute or IP is stored with it, nothing here is written to the activity log,
// and the app does not count visits to the box page. Only the reader (the Executive Director) can list, mark or delete. Nobody, including the
// systems owner, can read a message: the private key is a file the Executive Director keeps.
import { kv } from './store.js';
import { eatToday } from './config.js';

const KEY = 'v2:box:key', ITEM = 'v2:box:i:', IDX = 'v2:box:idx:', CNT = 'v2:box:cnt:', MARK = 'v2:box:mark';
export const BOX_DAILY_CAP = 150, BOX_CT_MAX = 9000, BOX_WK_MAX = 700;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const randId = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(9))).map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 14);
export const isReader = (who, env) => Boolean(who && who.role === 'hq' && !who.viewAs && (who.level || 'admin') === 'admin' && String(who.hq_id) === String((env && env.BOX_READER) || 'h3'));
export const canWrite = (who) => Boolean(who && !who.viewAs && ['volunteer', 'rc', 'arc'].includes(who.role));
const month = (day) => String(day).slice(0, 7);

export async function boxPublic(env, who) {
  if (!canWrite(who) && !isReader(who, env)) return { error: 'Not allowed', status: 403 };
  const k = await kv(env).get(KEY); return k ? { open: true, spki: k.spki, fp: k.fp, at: k.at, reader: isReader(who, env), history: isReader(who, env) ? k.history : undefined } : { open: false, reader: isReader(who, env) };
}
export async function setBoxKey(env, who, b) {
  if (!isReader(who, env)) return { error: 'Only the Executive Director can set the box key', status: 403 };
  const spki = String(b.spki || ''); if (!B64.test(spki) || spki.length < 300 || spki.length > 1400) return { error: 'That does not look like a public key', status: 422 };
  const fp = String(b.fp || '').slice(0, 40); const cur = await kv(env).get(KEY); const history = [...((cur && cur.history) || []), { fp, at: new Date().toISOString() }].slice(-20);
  await kv(env).put(KEY, { spki, fp, at: new Date().toISOString(), history }); return { ok: true, fp };
}
export async function submitBox(env, who, b) {
  if (!canWrite(who)) return { error: 'The suggestion box is for the field team', status: 403 };
  const k = await kv(env).get(KEY); if (!k) return { error: 'The box is not open yet', status: 503 };
  if (b.v !== 1 || String(b.kfp || '') !== k.fp) return { error: 'The box key changed. Close this page and open it again, then send again.', status: 409 };
  const { iv, ct, wk } = b; if (![iv, ct, wk].every((x) => typeof x === 'string' && B64.test(x))) return { error: 'The message could not be read', status: 422 };
  if (iv.length > 24 || wk.length > BOX_WK_MAX || ct.length > BOX_CT_MAX || ct.length < 20) return { error: 'The message is too long. Shorten it and send again.', status: 413 };
  const day = eatToday(); const ck = CNT + day; const n = (await kv(env).get(ck)) || 0; if (n >= BOX_DAILY_CAP) return { error: 'The box has received many messages today. Please try again tomorrow.', status: 429 };
  await kv(env).put(ck, n + 1);
  const id = randId(); await kv(env).put(ITEM + id, { id, day, iv, ct, wk, kfp: k.fp }); // nothing about the sender
  const ik = IDX + month(day); const idx = (await kv(env).get(ik)) || []; idx.push(id); await kv(env).put(ik, idx);
  return { ok: true };
}
export async function listBox(env, who, months = 3) {
  if (!isReader(who, env)) return { error: 'Not allowed', status: 403 };
  const now = new Date(Date.now() + 3 * 3600e3); const out = []; const marks = (await kv(env).get(MARK)) || {};
  for (let i = 0; i < Math.min(12, Math.max(1, months)); i++) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); const ik = IDX + d.toISOString().slice(0, 7); for (const id of (await kv(env).get(ik)) || []) { const it = await kv(env).get(ITEM + id); if (it) out.push({ ...it, status: marks[id] || 'new' }); } }
  out.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)); return { items: out, key: (await kv(env).get(KEY))?.fp || null };
}
export async function markBox(env, who, b) {
  if (!isReader(who, env)) return { error: 'Not allowed', status: 403 };
  const id = String(b.id || ''); const st = String(b.status || ''); if (!/^[a-z0-9]{6,20}$/.test(id) || !['new', 'read', 'board', 'done'].includes(st)) return { error: 'Choose a message and a status', status: 422 };
  const m = (await kv(env).get(MARK)) || {}; if (st === 'new') delete m[id]; else m[id] = st; await kv(env).put(MARK, m); return { ok: true };
}
export async function deleteBox(env, who, b) {
  if (!isReader(who, env)) return { error: 'Not allowed', status: 403 };
  const id = String(b.id || ''); if (!/^[a-z0-9]{6,20}$/.test(id)) return { error: 'Choose a message', status: 422 };
  const it = await kv(env).get(ITEM + id); if (!it) return { ok: true };
  const ik = IDX + month(it.day); const idx = ((await kv(env).get(ik)) || []).filter((x) => x !== id); await kv(env).put(ik, idx); await kv(env).delete(ITEM + id);
  const m = (await kv(env).get(MARK)) || {}; delete m[id]; await kv(env).put(MARK, m); return { ok: true };
}
