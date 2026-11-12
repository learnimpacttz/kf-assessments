// Finding records in KoBo without searching by school or by test day: on a form with this many records KoBo cannot answer those searches
// (they run for minutes and then fail). Record numbers go up with the time a record was sent, so the records sent in a time window are found
// by a short search on the sending time, read in pages, and filtered here. The searches are cached, so a second look is quick.
import { kv } from './store.js';

const enc = encodeURIComponent;
const srv = (env) => `https://${env.KOBO_SERVER || 'kf.kobotoolbox.org'}`;
const hdr = (env) => ({ Authorization: `Token ${env.KOBO_TOKEN}` });
export const sentAt = (x) => { const s = String(x._submission_time || ''); return Date.parse(s + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')); };
async function get(env, asset, path) { const r = await fetch(`${srv(env)}/api/v2/assets/${asset}/${path}`, { headers: hdr(env) }); if (!r.ok) throw new Error(`KoBo ${r.status} reading records. Try again in a minute.`); return r.json(); }
const firstAfter = async (env, asset, id) => ((await get(env, asset, `data/?format=json&limit=1&sort=${enc('{"_id":1}')}&query=${enc(JSON.stringify({ _id: { $gt: id } }))}`)).results || [])[0] || null;

// A record number just before the first record sent at or after the given time (found by halving, about 25 small requests, then remembered).
export async function idBefore(env, form, asset, tMs) {
  const hourMs = Math.floor(tMs / 3600e3) * 3600e3; const key = `v2:idbefore:${form}:${hourMs}`;
  const hit = await kv(env).get(key); if (hit != null) return hit;
  let lo = (await kv(env).get(`v2:minid:${form}:2026`)) || 0; // everything before this number belongs to earlier years
  const newest = ((await get(env, asset, `data/?format=json&limit=1&sort=${enc('{"_id":-1}')}`)).results || [])[0]; if (!newest) return lo;
  let hi = newest._id;
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); const r = await firstAfter(env, asset, mid); if (!r || sentAt(r) >= hourMs) hi = mid; else lo = mid; }
  await kv(env).put(key, lo); return lo;
}

// Every record sent between two times, one page at a time, handed to onRow (so only the records you keep stay in memory).
export async function scanSent(env, form, asset, fromMs, toMs, onRow, { maxPages = 25 } = {}) {
  const after = await idBefore(env, form, asset, fromMs);
  let url = `${srv(env)}/api/v2/assets/${asset}/data/?format=json&limit=1000&sort=${enc('{"_id":1}')}&query=${enc(JSON.stringify({ _id: { $gt: after } }))}`;
  let pages = 0, seen = 0, cut = false;
  for (; pages < maxPages && url; pages++) {
    const r = await fetch(url, { headers: hdr(env) }); if (!r.ok) throw new Error(`KoBo ${r.status} reading records. Try again in a minute.`);
    const d = await r.json(); const rows = d.results || [];
    for (const x of rows) { if (sentAt(x) > toMs) return { seen, pages: pages + 1, complete: true }; seen++; onRow(x); }
    url = d.next || null; if (!url) return { seen, pages: pages + 1, complete: true };
  }
  return { seen, pages, complete: !url && !cut }; // stopped at the page limit: the window was larger than expected
}

// The time window in which the records of one test day were sent: from the start of that day (East Africa Time) to a few days later, because some are sent late.
export const dayWindow = (day, lateDays = 4) => { const t = Date.parse(day + 'T00:00:00Z'); return [t - 3 * 3600e3, t + (lateDays + 1) * 86400e3 - 3 * 3600e3]; };
