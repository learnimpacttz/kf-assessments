// Usage of the Command Center, kept inside the system: who opens it, which pages, at what hour, from which device,
// who has phone alerts on, and who is not using it. Only HQ sees the analysis. Nothing leaves the system.
import { kv } from './store.js';
import { STAFF, REGIONS, eatToday, staffForKoboName } from './config.js';
import { loadHq, readActivity } from './hq.js';
import { loadQueries } from './queries.js';

const USERS = 'v2:usage:users', DAILY = 'v2:usage:daily', SUBS = 'v2:push:subs'; const EVK = (d) => 'v2:usage:ev:' + d; const EV_DAYS = 90;
const keyOf = (w) => String(w.id ?? w.hq_id ?? w.name);
const eatHour = (iso) => new Date(Date.parse(iso) + 3 * 3600e3).getUTCHours();
const TABS_OK = /^[a-z]{2,14}$/;

export async function recordUsage(env, who, ev) {
  if (!who || who.viewAs) return { ok: true };
  const now = new Date().toISOString(); const day = eatToday(); const k = keyOf(who); const h = eatHour(now);
  const tab = TABS_OK.test(String(ev.tab || '')) ? ev.tab : (ev.tab === 'api' ? 'api' : 'other'); const dev = ev.dev === 'm' ? 'm' : ev.dev === 'd' ? 'd' : 'x';
  const ms = Math.max(0, Math.min(Number(ev.ms) || 0, 1800e3));
  const users = (await kv(env).get(USERS)) || {};
  const u = (users[k] ||= { n: who.name, role: who.role, region: who.region || '', first: now, sessions: 0, views: 0, ms: 0, tabs: {}, hours: new Array(24).fill(0), dev: { m: 0, d: 0, x: 0 }, days: {}, api: 0 });
  u.n = who.name; u.role = who.role; u.region = who.region || u.region; u.last = now;
  if (ev.open) u.sessions += 1;
  if (tab === 'api') u.api += 1; else { u.views += 1; u.ms += ms; u.tabs[tab] = (u.tabs[tab] || 0) + 1; u.hours[h] += 1; u.dev[dev] += 1; }
  u.days[day] = (u.days[day] || 0) + 1; const dk = Object.keys(u.days).sort(); while (dk.length > 70) delete u.days[dk.shift()];
  await kv(env).put(USERS, users);
  const dly = (await kv(env).get(DAILY)) || {}; const d = (dly[day] ||= { views: 0, sessions: 0, users: {}, tabs: {}, hours: new Array(24).fill(0), dev: { m: 0, d: 0, x: 0 } });
  d.users[k] = 1; if (ev.open) d.sessions += 1; if (tab !== 'api') { d.views += 1; d.tabs[tab] = (d.tabs[tab] || 0) + 1; d.hours[h] += 1; d.dev[dev] += 1; }
  const keys = Object.keys(dly).sort(); while (keys.length > 70) delete dly[keys.shift()];
  await kv(env).put(DAILY, dly);
  // the explorer's detail: per day, per person, per page and hour (kept 90 days)
  const evd = (await kv(env).get(EVK(day))) || {}; const e = (evd[k] ||= { t: {}, h: new Array(24).fill(0), ms: 0, s: 0, d: { m: 0, d: 0, x: 0 } });
  if (ev.open) e.s += 1; if (tab !== 'api') { e.t[tab] = (e.t[tab] || 0) + 1; e.h[h] += 1; e.ms += ms; e.d[dev] += 1; }
  await kv(env).put(EVK(day), evd);
  const old = new Date(Date.parse(day + 'T00:00:00Z') - (EV_DAYS + 1) * 864e5).toISOString().slice(0, 10); try { await kv(env).del(EVK(old)); } catch { /* nothing to remove */ }
  return { ok: true };
}
const lastApi = {};
export async function recordApi(env, who) { // AI assistants and other tools that call the system without opening the pages
  const k = keyOf(who); const t = Date.now(); if (lastApi[k] && t - lastApi[k] < 300e3) return; lastApi[k] = t;
  await recordUsage(env, who, { tab: 'api', dev: 'x' });
}

// Before counting started there are no page views, but the system did save what people DID (plans, replies, reviews, changes,
// alerts turned on). Those saved actions show who was active and when, from the first day we have them.
const SINCE = '2026-10-13';
async function backfill(env) {
  const hq = (await loadHq(env)).users; const byHq = new Map(hq.map((u) => [String(u.name).toLowerCase(), u]));
  const keyFor = (name) => { const st = staffForKoboName(name); if (st) return { k: String(st.id), n: st.name, role: st.role, region: st.region }; const u = byHq.get(String(name).toLowerCase()); if (u) return { k: 'hq:' + u.id, n: u.name, role: 'hq', region: '' }; return null; };
  const ev = [];
  for (const e of await readActivity(env)) ev.push([e.who, e.at]);
  const qs = await loadQueries(env); for (const q of Object.values(qs)) { for (const t of q.thread || []) ev.push([t.by, t.at]); for (const h of q.wf?.history || []) ev.push([h.by, h.at]); }
  const subs = (await kv(env).get(SUBS)) || {}; for (const sub of Object.values(subs)) if (sub.who?.name) ev.push([sub.who.name, sub.at]);
  const out = {};
  for (const [name, at] of ev) { if (!name || !at) continue; const day = new Date(Date.parse(at) + 3 * 3600e3).toISOString().slice(0, 10); if (day < SINCE) continue; const w = keyFor(name); if (!w) continue; const u = (out[w.k] ||= { n: w.n, role: w.role, region: w.region, days: {}, hours: new Array(24).fill(0), acts: 0 }); u.days[day] = (u.days[day] || 0) + 1; u.hours[eatHour(at)] += 1; u.acts += 1; }
  return out;
}
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
export async function usageReport(env, who) {
  if (who.role !== 'hq') return { error: 'HQ only', status: 403 };
  const users = (await kv(env).get(USERS)) || {}; const dly = (await kv(env).get(DAILY)) || {}; const subs = (await kv(env).get(SUBS)) || {};
  const back = await backfill(env).catch(() => ({})); const liveFirst = Object.keys(dly).sort()[0] || eatToday();
  for (const [k, b] of Object.entries(back)) { // fill days before counting started with saved actions, never on top of real page views
    const u = (users[k] ||= { n: b.n, role: b.role, region: b.region, first: null, sessions: 0, views: 0, ms: 0, tabs: {}, hours: new Array(24).fill(0), dev: { m: 0, d: 0, x: 0 }, days: {}, api: 0, backOnly: true });
    u.acts = b.acts; for (const [d, n] of Object.entries(b.days)) if (d < liveFirst) { u.days[d] = n; const x = (dly[d] ||= { views: 0, sessions: 0, users: {}, tabs: {}, hours: new Array(24).fill(0), dev: { m: 0, d: 0, x: 0 }, fromActions: true }); x.users[k] = 1; x.actions = (x.actions || 0) + n; }
    if (!u.last) { const ds = Object.keys(b.days).sort(); u.last = ds.length ? ds[ds.length - 1] + 'T12:00:00.000Z' : null; }
  }
  const today = eatToday(); const days = []; for (let i = 13; i >= 0; i--) { const d = new Date(Date.parse(today + 'T00:00:00Z') - i * 864e5).toISOString().slice(0, 10); const x = dly[d]; days.push({ date: d, views: x?.views || 0, users: x ? Object.keys(x.users).length : 0, sessions: x?.sessions || 0, from_actions: Boolean(x?.fromActions) }); }
  const hq = (await loadHq(env)).users.filter((u) => u.active !== false);
  const alertsFor = {}; for (const s of Object.values(subs)) { const id = String(s.who?.id); (alertsFor[id] ||= new Set()).add(s.at); }
  const people = [
    ...STAFF.filter((s) => s.active).map((s) => ({ key: String(s.id), name: s.name, role: s.role, position: s.position, region: s.region })),
    ...hq.map((u) => ({ key: 'hq:' + u.id, name: u.name, role: 'hq', position: 'HQ', region: '' })),
  ];
  const known = new Set(people.map((p) => p.key));
  for (const [k, u] of Object.entries(users)) if (!known.has(k)) people.push({ key: k, name: u.n, role: u.role, position: /claude|assistant/i.test(u.n) ? 'AI assistant' : u.role, region: u.region || '' });
  const daysAgo = (iso) => (iso ? Math.floor((Date.parse(today + 'T12:00:00Z') - Date.parse(String(iso).slice(0, 10) + 'T12:00:00Z')) / 864e5) : null);
  const rows = people.map((p) => { const u = users[p.key]; const topTab = u ? Object.entries(u.tabs).sort((a, b) => b[1] - a[1])[0] : null;
    return { ...p, seen: Boolean(u), last: u?.last || null, ago: u ? daysAgo(new Date(Date.parse(u.last) + 3 * 3600e3).toISOString()) : null, sessions: u?.sessions || 0, views: u?.views || 0, minutes: u ? Math.round(u.ms / 60000) : 0, api: u?.api || 0, acts: u?.acts || 0, top: topTab ? topTab[0] : '', device: u ? (u.dev.m >= u.dev.d ? 'phone' : 'computer') : '', alerts: Boolean(alertsFor[p.key]), active7: u ? Object.keys(u.days).filter((d) => d > new Date(Date.parse(today + 'T00:00:00Z') - 7 * 864e5).toISOString().slice(0, 10)).length : 0 }; });
  const field = rows.filter((r) => r.role !== 'hq' && r.position !== 'AI assistant');
  const active7 = field.filter((r) => r.seen && r.ago !== null && r.ago <= 6), activeToday = field.filter((r) => r.ago === 0);
  const hoursAct = new Array(24).fill(0); for (const b of Object.values(back)) b.hours.forEach((n, i) => (hoursAct[i] += n));
  const hours = new Array(24).fill(0), tabs = {}, dev = { m: 0, d: 0, x: 0 };
  for (const d of Object.values(dly)) { if (d.fromActions) continue; d.hours.forEach((n, i) => (hours[i] += n)); for (const [t, n] of Object.entries(d.tabs)) tabs[t] = (tabs[t] || 0) + n; dev.m += d.dev.m; dev.d += d.dev.d; dev.x += d.dev.x; }
  const byRegion = REGIONS.map((r) => { const f = field.filter((x) => x.region === r); return { region: r, people: f.length, active7: f.filter((x) => x.ago !== null && x.ago <= 6).length, alerts: f.filter((x) => x.alerts).length, never: f.filter((x) => !x.seen).length }; });
  const insights = [];
  const peak = hours.map((n, i) => [i, n]).sort((a, b) => b[1] - a[1]).slice(0, 2).filter((x) => x[1] > 0);
  if (peak.length) insights.push(`Most use is around ${peak.map((x) => String(x[0]).padStart(2, '0') + ':00').join(' and ')} East Africa Time. Send the morning brief and key alerts just before this.`);
  const lowRegions = byRegion.filter((r) => r.people && pct(r.active7, r.people) < 50);
  if (lowRegions.length) insights.push(`${lowRegions.length} region(s) have fewer than half of their team opening the app in the last 7 days: ${lowRegions.map((r) => r.region.charAt(0) + r.region.slice(1).toLowerCase()).join(', ')}. Ask the RC to run a 10-minute walk-through.`);
  const noAlert = field.filter((r) => r.seen && !r.alerts).length; if (field.some((r) => r.seen) && pct(noAlert, field.filter((r) => r.seen).length) > 30) insights.push(`${noAlert} people who use the app have phone alerts off. Alerts are the fastest way to reach the field, so remind them to turn them on.`);
  const never = field.filter((r) => !r.seen).length; if (never) insights.push(`${never} field staff have never opened the app. Check that each has their code and a working phone.`);
  const allTabs = ['day', 'work', 'queries', 'news', 'pilot', 'plan', 'allq', 'phones', 'reports', 'narr', 'clean', 'explore', 'compare']; const unused = allTabs.filter((t) => !tabs[t]);
  if (Object.keys(tabs).length && unused.length) insights.push(`Pages nobody has opened yet: ${unused.join(', ')}. Either they are not needed, or people do not know about them.`);
  const mp = pct(dev.m, dev.m + dev.d); if (dev.m + dev.d) insights.push(`${mp}% of page views are on phones. Design every new page for the phone first.`);
  const slow = field.filter((r) => r.seen && r.ago !== null && r.ago >= 3 && r.active7 >= 1); if (slow.length) insights.push(`${slow.length} people used the app earlier this week but not in the last 3 days. Check whether they are still in the field.`);
  const trackedDays = Object.values(dly).filter((x) => !x.fromActions).length; if (trackedDays < 3) insights.splice(0, insights.length, `Page views are counted from ${liveFirst}. Before that, activity comes from what people saved in the system (plans, replies, reviews, changes, alerts), starting ${SINCE}. Patterns and the "never opened" list become reliable after a few days of use. Phone alerts are already known: ${field.filter((r) => r.alerts).length} of ${field.length} field staff have them on.`);
  return { as_of: new Date().toISOString(), live_since: liveFirst, actions_since: SINCE, today, kpis: { people: field.length, active_today: activeToday.length, active_7d: active7.length, never: never, alerts_on: field.filter((r) => r.alerts).length, hq_active_7d: rows.filter((r) => r.role === 'hq' && r.ago !== null && r.ago <= 6).length, hq_total: rows.filter((r) => r.role === 'hq').length }, days, hours, hours_actions: hoursAct, tabs: Object.entries(tabs).sort((a, b) => b[1] - a[1]), device: dev, by_region: byRegion, rows: rows.sort((a, b) => (b.ago === null ? -1 : 0) - (a.ago === null ? -1 : 0) || (a.ago ?? 999) - (b.ago ?? 999)), insights };
}


// ---------- Usage Explorer: filterable detail (HQ only) ----------
import { PARTNERS } from './config.js';
const PART_OF = Object.fromEntries(Object.entries(PARTNERS).flatMap(([p, rs]) => rs.map((r) => [r, p])));
const addDay = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const dayList = (a, b) => { const out = []; for (let d = a; d <= b && out.length < 120; d = addDay(d, 1)) out.push(d); return out; };
export async function usageExplore(env, who, q) {
  if (who.role !== 'hq') return { error: 'HQ only', status: 403 };
  const today = eatToday(); const ok = (d) => /^\d{4}-\d\d-\d\d$/.test(d || '');
  let to = ok(q.to) ? q.to : today; if (to > today) to = today; let from = ok(q.from) ? q.from : addDay(to, -13); if (from > to) from = to;
  if (dayList(from, to).length >= 90) from = addDay(to, -89);
  const span = dayList(from, to).length; const pTo = addDay(from, -1), pFrom = addDay(pTo, -(span - 1));
  const users = (await kv(env).get(USERS)) || {}; const subs = (await kv(env).get(SUBS)) || {}; const hq = (await loadHq(env)).users.filter((u) => u.active !== false);
  const alerts = new Set(Object.values(subs).map((x) => String(x.who?.id)));
  const people = [...STAFF.filter((s) => s.active).map((s) => ({ key: String(s.id), name: s.name, role: s.role, position: s.position, region: s.region })), ...hq.map((u) => ({ key: 'hq:' + u.id, name: u.name, role: 'hq', position: 'HQ', region: '' }))];
  const known = new Set(people.map((p) => p.key)); for (const [k, u] of Object.entries(users)) if (!known.has(k)) people.push({ key: k, name: u.n, role: u.role, position: /claude|assistant/i.test(u.n) ? 'AI assistant' : u.role, region: u.region || '' });
  const nm = String(q.q || '').toLowerCase();
  const roster = people.filter((p) => p.position !== 'AI assistant' && (!q.role || p.role === q.role) && (!q.region || p.region === q.region) && (!q.partner || PART_OF[p.region] === q.partner) && (!nm || p.name.toLowerCase().includes(nm)));
  const keys = new Set(roster.map((p) => p.key)); const tabF = /^[a-z]{2,14}$/.test(q.tab || '') ? q.tab : ''; const devF = ['m', 'd', 'x'].includes(q.dev) ? q.dev : '';
  const load = async (a, b) => { const days = dayList(a, b); const recs = await Promise.all(days.map((d) => kv(env).get(EVK(d)).catch(() => null))); return days.map((d, i) => ({ date: d, rec: recs[i] })); };
  const agg = (loaded) => {
    const per = {}, days = [], heat = Array.from({ length: 7 }, () => new Array(24).fill(0)), tabs = {};
    for (const { date, rec } of loaded) {
      const dow = (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7; const day = { date, views: 0, users: 0, sessions: 0, minutes: 0, approx: false }; const seen = new Set();
      if (rec) { for (const [k, e] of Object.entries(rec)) { if (!keys.has(k)) continue; const v = tabF ? (e.t[tabF] || 0) : Object.values(e.t).reduce((a2, b2) => a2 + b2, 0); const dv = devF ? (e.d[devF] || 0) : 1; if (!v || !dv) continue; const share = devF ? dv / Math.max(1, e.d.m + e.d.d + e.d.x) : 1; const vv = Math.round(v * share);
          const p = (per[k] ||= { views: 0, days: new Set(), sessions: 0, ms: 0, tabs: {}, dev: { m: 0, d: 0, x: 0 }, last: null }); p.views += vv; p.days.add(date); p.sessions += e.s || 0; p.ms += e.ms || 0; p.last = date; for (const [t, n] of Object.entries(e.t)) { p.tabs[t] = (p.tabs[t] || 0) + n; if (!tabF || t === tabF) { const r = (tabs[t] ||= { views: 0, users: new Set(), byRole: {} }); r.views += n; r.users.add(k); const role = roster.find((x) => x.key === k)?.role || '?'; r.byRole[role] = (r.byRole[role] || 0) + n; } } p.dev.m += e.d.m; p.dev.d += e.d.d; p.dev.x += e.d.x;
          e.h.forEach((n, i) => { heat[dow][i] += tabF ? 0 : n; }); day.views += vv; day.sessions += e.s || 0; day.minutes += Math.round((e.ms || 0) / 60000); seen.add(k); } }
      else if (!tabF && !devF) { for (const [k, u] of Object.entries(users)) { if (!keys.has(k) || !u.days || !u.days[date]) continue; const p = (per[k] ||= { views: 0, days: new Set(), sessions: 0, ms: 0, tabs: {}, dev: { m: 0, d: 0, x: 0 }, last: null }); p.views += u.days[date]; p.days.add(date); p.last = date; day.views += u.days[date]; seen.add(k); day.approx = true; } }
      day.users = seen.size; days.push(day);
    }
    return { per, days, heat, tabs };
  };
  const curL = await load(from, to); const cur = agg(curL); const prev = agg(await load(pFrom, pTo)); const detailSince = (curL.find((x) => x.rec) || {}).date || null;
  const sum = (a) => { const v = Object.values(a.per); return { views: v.reduce((x, p) => x + p.views, 0), people: v.length, sessions: v.reduce((x, p) => x + p.sessions, 0), minutes: Math.round(v.reduce((x, p) => x + p.ms, 0) / 60000), mobile: (() => { const m = v.reduce((x, p) => x + p.dev.m, 0), d = v.reduce((x, p) => x + p.dev.d, 0); return m + d ? Math.round((100 * m) / (m + d)) : null; })() }; };
  const rows = roster.map((p) => { const c = cur.per[p.key], pv = prev.per[p.key], u = users[p.key]; const top = c ? Object.entries(c.tabs).sort((a, b) => b[1] - a[1])[0] : null; const views = c ? c.views : 0, pviews = pv ? pv.views : 0;
    const ever = Boolean(u && (u.views || u.sessions || Object.keys(u.days || {}).length)); const lastIso = u?.last ? new Date(Date.parse(u.last) + 3 * 3600e3).toISOString().slice(0, 10) : null; const ago = lastIso ? Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(lastIso + 'T00:00:00Z')) / 864e5) : null;
    const status = !ever ? 'never' : !views ? 'quiet' : pviews && views > pviews * 1.25 ? 'rising' : pviews && views < pviews * 0.75 ? 'falling' : 'steady';
    return { key: p.key, name: p.name, role: p.role, position: p.position, region: p.region, partner: PART_OF[p.region] || '', views, prev_views: pviews, days: c ? c.days.size : 0, sessions: c ? c.sessions : 0, minutes: c ? Math.round(c.ms / 60000) : 0, top_tab: top ? top[0] : null, mobile: c && c.dev.m + c.dev.d ? Math.round((100 * c.dev.m) / (c.dev.m + c.dev.d)) : null, last: lastIso, ago, alerts: alerts.has(p.key), status, messageable: /^\d+$/.test(p.key) };
  });
  const f = rows.filter((r) => r.role !== 'hq');
  const funnel = [['On the roster', f.length], ['Opened it ever', f.filter((r) => r.status !== 'never').length], ['Opened in this period', f.filter((r) => r.views > 0).length], ['On 3 or more days', f.filter((r) => r.days >= 3).length], ['Phone alerts on', f.filter((r) => r.alerts).length]];
  const group = (fn) => { const g = {}; for (const r of f) { const k = fn(r) || '–'; const x = (g[k] ||= { name: k, people: 0, active: 0, views: 0 }); x.people++; if (r.views) x.active++; x.views += r.views; } return Object.values(g).sort((a, b) => b.views - a.views); };
  const first = Object.keys((await kv(env).get('v2:usage:daily')) || {}).sort()[0] || today;
  return { range: { from, to, prev_from: pFrom, prev_to: pTo, days: span }, live_since: first, detail_since: detailSince, filters_applied: { tab: tabF, dev: devF },
    totals: sum(cur), prev_totals: sum(prev), days: cur.days, prev_days: prev.days.map((d) => ({ date: d.date, views: d.views, users: d.users })), heat: cur.heat,
    tabs: Object.entries(cur.tabs).map(([t, v]) => ({ tab: t, views: v.views, users: v.users.size, byRole: v.byRole })).sort((a, b) => b.views - a.views), people: rows.sort((a, b) => b.views - a.views), funnel, by_region: group((r) => r.region), by_partner: group((r) => r.partner), by_role: group((r) => r.role) };
}
