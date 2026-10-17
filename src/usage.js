// Usage of the Command Center, kept inside the system: who opens it, which pages, at what hour, from which device,
// who has phone alerts on, and who is not using it. Only HQ sees the analysis. Nothing leaves the system.
import { kv } from './store.js';
import { STAFF, REGIONS, eatToday } from './config.js';
import { loadHq } from './hq.js';

const USERS = 'v2:usage:users', DAILY = 'v2:usage:daily', SUBS = 'v2:push:subs';
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
  return { ok: true };
}
const lastApi = {};
export async function recordApi(env, who) { // AI assistants and other tools that call the system without opening the pages
  const k = keyOf(who); const t = Date.now(); if (lastApi[k] && t - lastApi[k] < 300e3) return; lastApi[k] = t;
  await recordUsage(env, who, { tab: 'api', dev: 'x' });
}

const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
export async function usageReport(env, who) {
  if (who.role !== 'hq') return { error: 'HQ only', status: 403 };
  const users = (await kv(env).get(USERS)) || {}; const dly = (await kv(env).get(DAILY)) || {}; const subs = (await kv(env).get(SUBS)) || {};
  const today = eatToday(); const days = []; for (let i = 13; i >= 0; i--) { const d = new Date(Date.parse(today + 'T00:00:00Z') - i * 864e5).toISOString().slice(0, 10); const x = dly[d]; days.push({ date: d, views: x?.views || 0, users: x ? Object.keys(x.users).length : 0, sessions: x?.sessions || 0 }); }
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
    return { ...p, seen: Boolean(u), last: u?.last || null, ago: u ? daysAgo(new Date(Date.parse(u.last) + 3 * 3600e3).toISOString()) : null, sessions: u?.sessions || 0, views: u?.views || 0, minutes: u ? Math.round(u.ms / 60000) : 0, api: u?.api || 0, top: topTab ? topTab[0] : '', device: u ? (u.dev.m >= u.dev.d ? 'phone' : 'computer') : '', alerts: Boolean(alertsFor[p.key]), active7: u ? Object.keys(u.days).filter((d) => d > new Date(Date.parse(today + 'T00:00:00Z') - 7 * 864e5).toISOString().slice(0, 10)).length : 0 }; });
  const field = rows.filter((r) => r.role !== 'hq' && r.position !== 'AI assistant');
  const active7 = field.filter((r) => r.seen && r.ago !== null && r.ago <= 6), activeToday = field.filter((r) => r.ago === 0);
  const hours = new Array(24).fill(0), tabs = {}, dev = { m: 0, d: 0, x: 0 };
  for (const d of Object.values(dly)) { d.hours.forEach((n, i) => (hours[i] += n)); for (const [t, n] of Object.entries(d.tabs)) tabs[t] = (tabs[t] || 0) + n; dev.m += d.dev.m; dev.d += d.dev.d; dev.x += d.dev.x; }
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
  const trackedDays = Object.keys(dly).length; if (trackedDays < 2) insights.splice(0, insights.length, `Counting started ${Object.keys(dly)[0] || today}. Patterns and the "never opened" list become reliable after a few days of use. Phone alerts are already known: ${field.filter((r) => r.alerts).length} of ${field.length} field staff have them on.`);
  return { as_of: new Date().toISOString(), today, kpis: { people: field.length, active_today: activeToday.length, active_7d: active7.length, never: never, alerts_on: field.filter((r) => r.alerts).length, hq_active_7d: rows.filter((r) => r.role === 'hq' && r.ago !== null && r.ago <= 6).length, hq_total: rows.filter((r) => r.role === 'hq').length }, days, hours, tabs: Object.entries(tabs).sort((a, b) => b[1] - a[1]), device: dev, by_region: byRegion, rows: rows.sort((a, b) => (b.ago === null ? -1 : 0) - (a.ago === null ? -1 : 0) || (a.ago ?? 999) - (b.ago ?? 999)), insights };
}
