// Incremental multi-form sync. One KoBo page (<=1000 records) per invocation so a
// tick stays small; the once-a-minute cron advances an in-flight pass, and starts
// a new pass on a schedule. Watermarks are per form, aggregates are shared.
import { kv } from './store.js';
import { fetchKoboPage } from './kobo.js';
import { addStudents, addSampling, addTeachers, yearOf, stateYearOf } from './ingest.js';
import { buildBands, summarize, phoneDay } from './summary.js';
import { eatToday, devCode, isPracticeSchool } from './config.js';

const KINDS = {
  students: { asset: 'KOBO_ASSET_ID', add: addStudents },
  sampling: { asset: 'KOBO_ASSET_SAMPLING', add: addSampling },
  teachers: { asset: 'KOBO_ASSET_TEACHER', add: addTeachers },
};

const wmKey = (k) => `v2:wm:${k}`;
// One stored document per year, so live 2026 writes never touch archived years.
// `v2:state` is the earlier single-document layout; it is read only as a fallback.
const yKey = (y) => `v2:state:${y}`;
export async function loadYear(env, y) {
  const own = await kv(env).get(yKey(y));
  if (own) return own;
  const legacy = await kv(env).get('v2:state');
  return (legacy && legacy.yrs && legacy.yrs[y]) || null;
}
export async function saveYear(env, y, Y) {
  await kv(env).put(yKey(y), Y);
  const reg = new Set((await kv(env).get('v2:stateyears')) || []);
  if (!reg.has(y)) { reg.add(y); await kv(env).put('v2:stateyears', [...reg].sort()); }
}
export async function stateYears(env) {
  const reg = new Set((await kv(env).get('v2:stateyears')) || []);
  const legacy = await kv(env).get('v2:state');
  if (legacy && legacy.yrs) Object.keys(legacy.yrs).forEach((y) => reg.add(y));
  return [...reg].sort();
}
export async function loadState(env, years) {
  const yrs = {};
  for (const y of years || (await stateYears(env))) { const Y = await loadYear(env, y); if (Y) yrs[y] = Y; }
  return { yrs };
}

export async function recomputeSummaries(env, years, { allDays = false } = {}) {
  const state = await loadState(env);
  const today = eatToday();
  const have = new Set((await kv(env).get('v2:years')) || []);
  for (const y of years && years.length ? years : Object.keys(state.yrs)) {
    const Y = state.yrs[y];
    if (!Y) continue;
    const bands = buildBands(state.yrs, y);
    const owners = (await kv(env).get('v2:devowners')) || {};
    const sum = summarize(Y, { year: y, bands, today, owners, practice: y === 'practice' });
    await kv(env).put(`v2:sum:${y}`, sum);
    // One small document per field day for the Phones screen (the last 3 days each time, all days on a full rebuild)
    if (env.DASHBOARD_KV && Y.tl) {
      const dates = Object.keys(Y.tl).sort();
      for (const d of allDays ? dates : dates.slice(-3)) await env.DASHBOARD_KV.put(`tl:${y}:${d}`, JSON.stringify({ date: d, year: y, events: Y.tl[d].map((e) => ({ c: devCode(e[0]), s: e[1], e: e[2], sc: e[3], g: e[4], w: e[5], k: e[6] })), phones: phoneDay(Y.tl[d]) }));
      await env.DASHBOARD_KV.put(`tl:${y}:dates`, JSON.stringify(dates));
    }
    // Derived read-only copies go to Workers KV: fast at the edge, and a minute of staleness does not matter here.
    // Running totals, plans and locks stay in the Durable Object because those must be strongly consistent.
    if (env.DASHBOARD_KV) await env.DASHBOARD_KV.put(`sum:${y}`, JSON.stringify(sum));
    if (y !== 'practice') have.add(y); // practice never appears in the year list or becomes a default view
  }
  await kv(env).put('v2:years', [...have].sort());
  if (env.DASHBOARD_KV) await env.DASHBOARD_KV.put('years', JSON.stringify([...have].sort()));
}

// After records are deleted in KoBo the stored totals still count them. Clear that kind's part of each affected year and read it again from KoBo.
// A faster rebuild: re-read only the records after a given id (everything from 2026 and practice sits at the end of the form),
// and recompute just those years. The old way started from record 0 and read the whole form (about 40 minutes).
export async function restartRebuildFrom(env, kind, years, fromId) {
  for (const y of years) {
    const Y = await loadYear(env, y); if (!Y) continue;
    if (kind === 'students') { Y.cells = {}; Y.n = 0; for (const d of Object.keys(Y.tl || {})) Y.tl[d] = Y.tl[d].filter((e) => e[6] !== 't'); }
    else if (kind === 'sampling') { Y.sg = {}; Y.nsamp = 0; for (const d of Object.keys(Y.tl || {})) Y.tl[d] = Y.tl[d].filter((e) => e[6] !== 's'); }
    await saveYear(env, y, Y);
  }
  await kv(env).put(wmKey(kind), { max_id: Number(fromId) || 0, pages: 0, cursor: null, years: [], last_check: null, records: 0, only: years });
  await kv(env).put('v2:rebuild', ((await kv(env).get('v2:rebuild')) || []).filter((x) => x.kind !== kind));
}
// where a rebuild of these years can start: just before the first record of the earliest year (0 = from the very start when unknown)
export async function firstIdFor(env, kind, years) {
  let lo = null; for (const y of years) { const id = await kv(env).get(`v2:minid:${kind}:${y}`); if (id == null) return 0; if (lo === null || id < lo) lo = id; }
  return lo === null ? 0 : Math.max(0, lo - 1);
}
async function startRebuild(env) {
  const rb = (await kv(env).get('v2:rebuild')) || []; if (!rb.length) return;
  const kind = rb[0].kind; const wm0 = await kv(env).get(wmKey(kind)); if (wm0?.cursor || wm0?.only) return; // one at a time
  const years = rb.filter((x) => x.kind === kind).map((x) => x.year);
  for (const y of years) {
    const Y = await loadYear(env, y); if (!Y) continue;
    if (kind === 'students') { Y.cells = {}; Y.n = 0; for (const d of Object.keys(Y.tl || {})) Y.tl[d] = Y.tl[d].filter((e) => e[6] !== 't'); }
    else if (kind === 'sampling') { Y.sg = {}; Y.nsamp = 0; for (const d of Object.keys(Y.tl || {})) Y.tl[d] = Y.tl[d].filter((e) => e[6] !== 's'); }
    await saveYear(env, y, Y);
  }
  await kv(env).put(wmKey(kind), { max_id: await firstIdFor(env, kind, years), pages: 0, cursor: null, years: [], last_check: null, records: 0, only: years });
  await kv(env).put('v2:rebuild', rb.filter((x) => x.kind !== kind));
}

async function processPage(env, kind) {
  const cfg = KINDS[kind];
  const assetId = env[cfg.asset];
  const server = env.KOBO_SERVER || 'kf.kobotoolbox.org';
  const wm = (await kv(env).get(wmKey(kind))) || { max_id: 0, pages: 0, cursor: null, years: [], last_check: null, records: 0 };
  if (!wm.cursor) wm.from0 = (wm.max_id_pass ?? wm.max_id ?? 0) === 0; // a pass that starts at record 0 reads everything
  const page = await fetchKoboPage(server, assetId, env.KOBO_TOKEN, wm.cursor, wm.max_id_pass ?? wm.max_id);
  const yOf = (r) => (kind === 'sampling' ? (isPracticeSchool(r['id_data/school'] || r.school || r['att_gr/school']) ? 'practice' : yearOf(r)) : stateYearOf(r));
  const yOfRow = yOf;
  const rows = wm.only ? page.results.filter((r) => wm.only.includes(yOf(r))) : page.results; // a rebuild after deletions reads only the affected years
  if (rows.length) {
    const touched = [...new Set(rows.map((r) => (kind === 'sampling' ? (isPracticeSchool(r['id_data/school'] || r.school || r['att_gr/school']) ? 'practice' : yearOf(r)) : stateYearOf(r))).filter(Boolean))];
    const state = await loadState(env, touched);
    const approved = new Set(((await kv(env).get('v2:approvededits')) || []).map(Number)); // records HQ corrected on purpose: not flagged as "changed after sent"
    cfg.add(state, rows, { approved });
    // remember the first record of each year in this form, so a later rebuild can start there instead of at record 0 (only from a pass that began at record 0, so the answer is the true first)
    const low = {}; for (const r of rows) { const y = yOfRow(r); if (y && typeof r._id === 'number' && (low[y] === undefined || r._id < low[y])) low[y] = r._id; }
    for (const [y, id] of Object.entries(wm.from0 ? low : {})) { const k = `v2:minid:${kind}:${y}`; const cur = await kv(env).get(k); if (cur == null || id < cur) await kv(env).put(k, id); }
    for (const y of touched) if (state.yrs[y]) await saveYear(env, y, state.yrs[y]);
    for (const r of rows) {
      const y = kind === 'sampling' ? (isPracticeSchool(r['id_data/school'] || r.school || r['att_gr/school']) ? 'practice' : yearOf(r)) : stateYearOf(r);
      if (y && !wm.years.includes(y)) wm.years.push(y);
      if (typeof r._id === 'number' && r._id > (wm.max_id_pass ?? 0)) wm.max_id_pass = r._id;
    }
    wm.records += rows.length;
  }
  wm.pages += 1;
  wm.last_check = new Date().toISOString();
  if (page.next) {
    wm.cursor = page.next;
    await kv(env).put(wmKey(kind), wm);
    return { kind, done: false, pages: wm.pages };
  }
  // pass finished
  if (wm.max_id_pass) wm.max_id = wm.max_id_pass;
  const years = wm.only ? [...new Set([...wm.years, ...wm.only])] : wm.years;
  wm.only = undefined;
  wm.cursor = null; wm.max_id_pass = undefined; wm.pages = 0; wm.years = []; wm.done_at = new Date().toISOString();
  await kv(env).put(wmKey(kind), wm);
  if (years.length) {
    await kv(env).put('v2:dirty', years); // retried every tick until the summaries are rebuilt
    await recomputeSummaries(env, years);
    await kv(env).delete('v2:dirty');
  }
  return { kind, done: true, years };
}

const configured = (env, kind) => Boolean(env[KINDS[kind].asset] && env.KOBO_TOKEN);

export async function tick(env, { force = false } = {}) {
  const lock = kv(env);
  if (!(await lock.acquire('tick', 55000))) return [{ skipped: 'another sync is running' }];
  try {
    return await tickInner(env, { force });
  } finally {
    await lock.release('tick');
  }
}

async function tickInner(env, { force }) {
  await startRebuild(env);
  const dirty = await kv(env).get('v2:dirty');
  if (dirty && dirty.length) {
    await recomputeSummaries(env, dirty);
    await kv(env).delete('v2:dirty');
    return [{ recomputed: dirty }];
  }
  const now = Date.now();
  const hourUtc = new Date().getUTCHours();
  const fieldHours = hourUtc >= 4 && hourUtc <= 15; // 07:00-18:00 EAT
  const out = [];
  for (const kind of Object.keys(KINDS)) {
    if (!configured(env, kind)) continue;
    const wm = await kv(env).get(wmKey(kind));
    if (wm?.cursor) { if (force) return [{ kind, skipped: 'pass in progress', pages: wm.pages }]; const t0 = Date.now(); let r = await processPage(env, kind); out.push(r); while (wm.only && !r.done && Date.now() - t0 < 15000 && out.length < 6) { r = await processPage(env, kind); out.push(r); } return out; } // the cron carries a pass forward, one page per tick
    const age = wm?.last_check ? now - Date.parse(wm.last_check) : Infinity;
    const every = fieldHours ? 5 * 60 * 1000 : 60 * 60 * 1000;
    if (force || age >= every) { out.push(await processPage(env, kind)); return out; }
  }
  return out;
}

export async function syncStatus(env) {
  const out = {};
  for (const kind of Object.keys(KINDS)) {
    const wm = await kv(env).get(wmKey(kind));
    out[kind] = { configured: configured(env, kind), in_progress: Boolean(wm?.cursor), pages: wm?.pages || 0, records_last_pass: wm?.records || 0, last_check: wm?.last_check || null, last_done: wm?.done_at || null, watermark: wm?.max_id || 0 };
  }
  return out;
}

export async function resetKind(env, kind) {
  await kv(env).delete(wmKey(kind));
}
export async function resetAll(env) {
  for (const k of Object.keys(KINDS)) await kv(env).delete(wmKey(k));
  await kv(env).delete('v2:state');
  for (const y of await stateYears(env)) await kv(env).delete(yKey(y));
  await kv(env).delete('v2:stateyears');
}

// Removes every practice record from the dashboard (the practice submissions stay in KoBo, where they are easy to filter out by school code TRAIN*).
export async function clearPractice(env) {
  await kv(env).delete('v2:state:practice');
  await kv(env).delete('v2:sum:practice');
  const reg = ((await kv(env).get('v2:stateyears')) || []).filter((x) => x !== 'practice');
  await kv(env).put('v2:stateyears', reg);
  if (env.DASHBOARD_KV) {
    await env.DASHBOARD_KV.delete('sum:practice');
    const l = await env.DASHBOARD_KV.list({ prefix: 'tl:practice:' });
    for (const k of l.keys) await env.DASHBOARD_KV.delete(k.name);
  }
}

// Work out, once, the first record of 2026 and of the practice data, so later rebuilds start there instead of at record 0.
// Record ids grow with time, so a binary search over "the first record after id N" finds it in about 25 small requests.
export async function seedFirstIds(env) {
  const out = {};
  for (const kind of Object.keys(KINDS)) {
    if (!configured(env, kind)) continue;
    const server = env.KOBO_SERVER || 'kf.kobotoolbox.org'; const asset = env[KINDS[kind].asset];
    const yOf = (r) => (kind === 'sampling' ? (isPracticeSchool(r['id_data/school'] || r.school || r['att_gr/school']) ? 'practice' : yearOf(r)) : stateYearOf(r));
    const isNew = (r) => ['2026', 'practice'].includes(yOf(r));
    const firstAfter = async (id) => { const url = `https://${server}/api/v2/assets/${asset}/data/?format=json&limit=1&sort=${encodeURIComponent('{"_id":1}')}&query=${encodeURIComponent(JSON.stringify({ _id: { $gt: id } }))}`; const r = await fetch(url, { headers: { Authorization: `Token ${env.KOBO_TOKEN}` } }); if (!r.ok) throw new Error('KoBo ' + r.status); const d = await r.json(); return (d.results || [])[0] || null; };
    const f = async (id) => { const r = await firstAfter(id); return Boolean(r) && isNew(r); }; // is the first record after this id from 2026 or practice? false for old ids, then true
    const newest = await (async () => { const r = await fetch(`https://${server}/api/v2/assets/${asset}/data/?format=json&limit=1&sort=${encodeURIComponent('{"_id":-1}')}`, { headers: { Authorization: `Token ${env.KOBO_TOKEN}` } }); const d = await r.json(); return (d.results || [])[0] || null; })();
    if (!newest || !isNew(newest)) continue;
    let lo = 0, hi = newest._id - 1; let first = null;
    if (await f(0)) first = await firstAfter(0);
    else { while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (await f(mid)) hi = mid; else lo = mid; } first = await firstAfter(hi); }
    if (first && isNew(first)) for (const y of ['2026', 'practice']) { await kv(env).put(`v2:minid:${kind}:${y}`, first._id - 1); (out[kind] ||= {})[y] = first._id - 1; }
  }
  return out;
}
