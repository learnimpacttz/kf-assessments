// Forecast beyond a simple run-rate. THIS YEAR'S PLAN comes first: for every region with a locked plan it simulates the
// remaining field days 1,500 times, starting from the planned visits per day and carrying forward whatever slipped.
// How reliably the region keeps its plan is learned from this year's own visits (a prior of 90% that fades as evidence comes in).
// Last round's history is only a fallback for a region with no locked plan (and for schools missing from the plan).
// Capped at the 2 to 3 schools a day the protocol allows (5 in Dodoma). It reports the chance of finishing by the close date and a likely finish range.
import { kv } from './store.js';
import { REGIONS, FIELD_START, FIELD_END, PILOT_DAY, CURRENT_YEAR, isWorkingDay, addDays, MAX_SCHOOLS_PER_DAY, DODOMA_MAX_SCHOOLS_PER_DAY } from './config.js';
import { getPlan } from './plan.js';

const SIMS = 1500;
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

export function workingDays(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkingDay(d)) out.push(d);
  return out;
}

// schools completed on each field day, zeros included between the first and last day
export function dailyCompletions(sum, region) {
  const per = {};
  for (const s of Object.values(sum.schools)) {
    if (s.done && s.last && (!region || s.region === region)) per[s.last] = (per[s.last] || 0) + 1;
  }
  const dates = Object.keys(per).sort();
  if (!dates.length) return [];
  return workingDays(dates[0], dates[dates.length - 1]).map((d) => per[d] || 0);
}

export async function baseline(env) {
  const years = ((await kv(env).get('v2:years')) || []).filter((y) => y !== CURRENT_YEAR);
  const y = years[years.length - 1];
  if (!y) return { year: null, byRegion: {}, all: [] };
  const cacheKey = `v2:pacebase:${y}`;
  const hit = await kv(env).get(cacheKey);
  if (hit) return hit;
  const sum = await kv(env).get(`v2:sum:${y}`);
  if (!sum) return { year: null, byRegion: {}, all: [] };
  const byRegion = {};
  for (const r of REGIONS) byRegion[r] = dailyCompletions(sum, r);
  const out = { year: y, byRegion, all: dailyCompletions(sum, null).length ? REGIONS.flatMap((r) => byRegion[r]) : [] };
  await kv(env).put(cacheKey, out);
  return out;
}

// Plan-led simulation: each day the planned visits (plus any backlog) are attempted up to the daily cap; each attempt succeeds with probability rel.
function simulatePlan(rand, sched, backlog0, days, cap, rel) {
  const finishes = [];
  for (let n = 0; n < SIMS; n++) {
    let backlog = backlog0, fin = null, left = backlog0 + sched.total;
    for (const d of days) {
      backlog += sched.byDate[d] || 0;
      let tries = Math.min(cap, backlog), ok = 0;
      for (let k = 0; k < tries; k++) if (rand() < rel) ok++;
      backlog -= ok; left -= ok;
      if (left <= 0) { fin = d; break; }
    }
    finishes.push(fin);
  }
  return finishes;
}
function simulateRegion(rand, remaining, days, pool, cap) {
  const finishes = [];
  for (let n = 0; n < SIMS; n++) {
    let left = remaining, fin = null;
    for (const d of days) {
      let x = pool[Math.floor(rand() * pool.length)];
      if (x > cap) x = cap;
      if (x > left) x = left;
      left -= x;
      if (left <= 0) { fin = d; break; }
    }
    finishes.push(fin);
  }
  return finishes;
}
const quantile = (arr, q) => { const v = arr.filter(Boolean).sort(); return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : null; };

export async function forecast(env, sum, today) {
  const base = await baseline(env);
  const first = today < FIELD_START ? FIELD_START : addDays(today, 1);
  const window = workingDays(first, addDays(FIELD_END, 56));
  const left = workingDays(first, FIELD_END);
  const regions = {};
  const sims = {};
  const plans = {}; await Promise.all(REGIONS.map(async (r) => { try { plans[r] = await getPlan(env, r); } catch { plans[r] = null; } }));
  for (const r of REGIONS) {
    const R = sum?.regions?.[r]; if (!R) continue;
    const remaining = Math.max(0, R.total - R.done);
    const cap = r === 'DODOMA' ? DODOMA_MAX_SCHOOLS_PER_DAY : MAX_SCHOOLS_PER_DAY;
    const recent = sum ? dailyCompletions(sum, r).slice(-7) : [];
    const hist = (base.byRegion[r] && base.byRegion[r].length >= 3 ? base.byRegion[r] : base.all) || [];
    let pool = [];
    if (recent.length >= 3) { for (let i = 0; i < 3; i++) pool.push(...recent); pool.push(...hist); }
    else pool = hist.length ? hist.slice() : [2, 2, 3, 2, 1, 3, 0];
    if (r === 'DODOMA' && remaining > 0 && today <= PILOT_DAY) {
      // the 5 pilot schools are all visited on the pilot day, so no simulation is needed until that day passes
      regions[r] = { remaining, days_left: 1, needed_per_day: remaining, recent_pace: null, basis: 'pilot day ' + PILOT_DAY, p_on_time: 100, earliest: PILOT_DAY, likely: PILOT_DAY, latest: PILOT_DAY, level: 'good' };
      sims[r] = new Array(SIMS).fill(PILOT_DAY);
      continue;
    }
    const rand = rng(hash(`${r}|${today}|${R.done}`));
    // this year's plan: planned visits of schools not yet done
    const P = plans[r]; let planInfo = null;
    if (P && P.status === 'locked' && Array.isArray(P.visits) && P.visits.length) {
      const byDate = {}; let total = 0, backlog0 = 0, due = 0, hit = 0, planEnd = null, planned = new Set();
      for (const v of P.visits) {
        const sc = sum.schools[v.school]; if (!sc) continue; planned.add(v.school);
        if (v.date < today) { due++; if (sc.done) hit++; }
        if (sc.done) continue;
        if (v.date >= first) { byDate[v.date] = (byDate[v.date] || 0) + 1; total++; if (!planEnd || v.date > planEnd) planEnd = v.date; } else backlog0++;
      }
      const unplanned = Math.max(0, remaining - backlog0 - total - 0); // not-done schools the plan does not list
      backlog0 += unplanned;
      const rel = Math.min(1, Math.max(0.3, (hit + 0.9 * 5) / (due + 5)));
      planInfo = { byDate, total, backlog0, rel, planEnd };
    }
    const fin = remaining === 0 ? new Array(SIMS).fill(today) : planInfo ? simulatePlan(rand, planInfo, planInfo.backlog0, window, cap, planInfo.rel) : simulateRegion(rand, remaining, window, pool, cap);
    sims[r] = fin;
    const onTime = fin.filter((d) => d && d <= FIELD_END).length / SIMS;
    const p50 = quantile(fin, 0.5), p10 = quantile(fin, 0.1), p90 = quantile(fin, 0.9);
    const needed = left.length ? remaining / left.length : remaining;
    regions[r] = {
      remaining, days_left: left.length, needed_per_day: Math.round(needed * 10) / 10, recent_pace: recent.length ? Math.round((recent.reduce((a, b) => a + b, 0) / recent.length) * 10) / 10 : null,
      basis: planInfo ? `this year's plan (keeps ${Math.round(planInfo.rel * 100)}% of planned visits)` : recent.length >= 3 ? 'recent days and last round' : base.year ? `last round (${base.year}), no locked plan yet` : 'default pattern',
      plan_finish: planInfo ? planInfo.planEnd : null, plan_reliability: planInfo ? Math.round(planInfo.rel * 100) : null,
      p_on_time: Math.round(onTime * 100), earliest: p10, likely: p50, latest: p90,
      level: remaining === 0 ? 'good' : onTime >= 0.85 ? 'good' : onTime >= 0.5 ? 'warn' : 'bad',
    };
  }
  // all regions together: the program finishes when the last region does
  const nat = [];
  for (let n = 0; n < SIMS; n++) { let m = ''; let any = true; for (const r of Object.keys(sims)) { const d = sims[r][n]; if (!d) { any = false; break; } if (d > m) m = d; } nat.push(any ? m : null); }
  const natOn = nat.filter((d) => d && d <= FIELD_END).length / SIMS;
  return {
    today, close: FIELD_END, baseline_year: base.year, pre_field: today < FIELD_START, regions,
    national: { plan_finish: Object.values(regions).reduce((m, x) => (x.plan_finish && x.plan_finish > m ? x.plan_finish : m), '') || null, p_on_time: Math.round(natOn * 100), earliest: quantile(nat, 0.1), likely: quantile(nat, 0.5), latest: quantile(nat, 0.9), level: natOn >= 0.85 ? 'good' : natOn >= 0.5 ? 'warn' : 'bad' },
  };
}

// Schools that need attention: planned date has passed without a visit, or the visit is today/tomorrow and the region is behind.
export async function atRiskSchools(env, sum, today, regionFilter) {
  const out = [];
  const regs = REGIONS.filter((r) => !regionFilter || r === regionFilter);
  const plans = await Promise.all(regs.map((r) => getPlan(env, r)));
  for (const [pi, r] of regs.entries()) {
    const plan = plans[pi];
    if (plan.status !== 'locked') continue;
    for (const v of plan.visits) {
      const s = sum?.schools?.[v.school]; if (!s) continue;
      if (v.date < today && !s.started) out.push({ school: v.school, name: s.name, region: r, lga: s.lga, planned: v.date, kind: 'missed', days_overdue: Math.max(1, Math.round((Date.parse(today) - Date.parse(v.date)) / 86400000)) });
      else if (v.date < today && s.started && !s.done) out.push({ school: v.school, name: s.name, region: r, lga: s.lga, planned: v.date, kind: 'unfinished', days_overdue: Math.round((Date.parse(today) - Date.parse(v.date)) / 86400000) });
    }
  }
  return out.sort((a, b) => b.days_overdue - a.days_overdue).slice(0, 40);
}
