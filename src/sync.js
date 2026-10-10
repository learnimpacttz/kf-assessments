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

async function processPage(env, kind) {
  const cfg = KINDS[kind];
  const assetId = env[cfg.asset];
  const server = env.KOBO_SERVER || 'kf.kobotoolbox.org';
  const wm = (await kv(env).get(wmKey(kind))) || { max_id: 0, pages: 0, cursor: null, years: [], last_check: null, records: 0 };
  const page = await fetchKoboPage(server, assetId, env.KOBO_TOKEN, wm.cursor, wm.max_id_pass ?? wm.max_id);
  if (page.results.length) {
    const touched = [...new Set(page.results.map((r) => (kind === 'sampling' ? (isPracticeSchool(r['id_data/school'] || r.school || r['att_gr/school']) ? 'practice' : yearOf(r)) : stateYearOf(r))).filter(Boolean))];
    const state = await loadState(env, touched);
    cfg.add(state, page.results);
    for (const y of touched) if (state.yrs[y]) await saveYear(env, y, state.yrs[y]);
    for (const r of page.results) {
      const y = kind === 'sampling' ? (isPracticeSchool(r['id_data/school'] || r.school || r['att_gr/school']) ? 'practice' : yearOf(r)) : stateYearOf(r);
      if (y && !wm.years.includes(y)) wm.years.push(y);
      if (typeof r._id === 'number' && r._id > (wm.max_id_pass ?? 0)) wm.max_id_pass = r._id;
    }
    wm.records += page.results.length;
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
  const years = wm.years;
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
    if (wm?.cursor) { if (force) return [{ kind, skipped: 'pass in progress', pages: wm.pages }]; out.push(await processPage(env, kind)); return out; } // the cron carries a pass forward, one page per tick
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
