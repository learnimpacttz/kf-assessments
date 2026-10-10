// The calendar file the phones check visits against (ref_calendar.csv), kept in step with the submitted plans.
// HQ switches the automatic update on in Admin. Nothing is uploaded until then, or until enough regions have submitted.
import { kv } from './store.js';
import { REGIONS, SCHOOL_BY_ID } from './config.js';
import { getPlan } from './plan.js';
import { koboForm } from './koboforms.js';

const KEY = 'v2:calsync';
const DEFAULT = { enabled: false, min_regions: 8, pending: false, dirty_at: null, retry_at: null, last: null, history: [] };
export const loadCalSync = async (env) => ({ ...DEFAULT, ...((await kv(env).get(KEY)) || {}) });
const saveCalSync = (env, st) => kv(env).put(KEY, st);

const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

// One row per planned school from every submitted plan, with a first _CALENDAR row that switches the check on
export async function buildCalendar(env) {
  const plans = await Promise.all(REGIONS.map((r) => getPlan(env, r)));
  const stamp = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
  const version = plans.reduce((a, p) => a + (p.version || 0), 0);
  const rows = [['school', 'planned_date', 'school_name', 'region', 'lga', 'start', 'team']];
  rows.push(['_CALENDAR', `v${version} ${stamp}`, 'calendar switch and version', '', '', '', '']);
  let n = 0, submitted = 0;
  plans.forEach((p, k) => { if (p.status !== 'locked') return; submitted++; for (const v of p.visits) { const s = SCHOOL_BY_ID[v.school]; rows.push([v.school, v.date, s?.name?.trim() || '', REGIONS[k], s?.lga || '', v.start || '', (v.team || []).join('; ')]); n++; } });
  return { csv: rows.map((r) => r.map(q).join(',')).join('\n') + '\n', rows: n, version: `v${version}`, regions_submitted: submitted, regions_total: REGIONS.length };
}

// called whenever a plan is submitted or changed
export async function markCalendarDirty(env) {
  const st = await loadCalSync(env); st.pending = true; st.dirty_at = new Date().toISOString(); await saveCalSync(env, st);
}

// Pushes the calendar to the Students and Sampling projects. `assets` is only given for tests on throwaway copies.
export async function syncCalendar(env, { force = false, assets = null } = {}) {
  const st = await loadCalSync(env);
  const now = Date.now();
  if (!force) {
    if (!st.enabled || !st.pending) return null;
    if (st.dirty_at && now - Date.parse(st.dirty_at) < 5 * 60e3) return null; // wait for the RC to finish editing
    if (st.retry_at && now < Date.parse(st.retry_at)) return null;
  }
  const built = await buildCalendar(env);
  const test = Boolean(assets);
  if (built.rows === 0) { st.last = { at: new Date().toISOString(), skipped: 'no submitted plans yet' }; await saveCalSync(env, st); return st.last; }
  if (!test && built.regions_submitted < st.min_regions) { st.last = { at: new Date().toISOString(), skipped: `waiting: ${built.regions_submitted} of ${st.min_regions} regions needed have submitted` }; await saveCalSync(env, st); return st.last; }
  const targets = assets || [env.KOBO_ASSET_ID, env.KOBO_ASSET_SAMPLING].filter(Boolean);
  const prev = (await kv(env).get('v2:calsync:csv')) || 'school,planned_date\n';
  const results = {};
  for (const asset of targets) {
    try { await koboForm(env, { op: 'media', asset, filename: 'ref_calendar.csv', text: built.csv }); results[asset] = 'ok'; }
    catch (e) {
      results[asset] = 'error: ' + String(e.message || e).slice(0, 160);
      try { await koboForm(env, { op: 'media', asset, filename: 'ref_calendar.csv', text: prev }); results[asset] += ' (previous file restored)'; } catch { results[asset] += ' (RESTORE FAILED: upload ref_calendar.csv by hand)'; }
    }
  }
  const ok = Object.values(results).every((r) => r === 'ok');
  const entry = { test: test || undefined, at: new Date().toISOString(), version: built.version, rows: built.rows, regions: built.regions_submitted, results, ok };
  if (!test) { st.last = entry; st.history = [entry, ...(st.history || [])].slice(0, 20); }
  if (ok) { if (!test) await kv(env).put('v2:calsync:csv', built.csv); if (!test && st.dirty_at && Date.parse(st.dirty_at) <= now) st.pending = false; st.retry_at = null; }
  else if (!test) st.retry_at = new Date(now + 10 * 60e3).toISOString();
  await saveCalSync(env, st);
  return entry;
}

export async function calendarStatus(env) {
  const st = await loadCalSync(env); const b = await buildCalendar(env);
  return { ...st, current: { rows: b.rows, version: b.version, regions_submitted: b.regions_submitted, regions_total: b.regions_total } };
}
export async function setCalSync(env, patch) {
  const st = await loadCalSync(env);
  if (typeof patch.enabled === 'boolean') { st.enabled = patch.enabled; if (patch.enabled) { st.pending = true; st.dirty_at = new Date(Date.now() - 6 * 60e3).toISOString(); } }
  if (Number.isInteger(patch.min_regions) && patch.min_regions >= 1 && patch.min_regions <= REGIONS.length) st.min_regions = patch.min_regions;
  await saveCalSync(env, st); return st;
}
