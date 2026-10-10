// Web push to phones. Messages carry no encrypted payload: the push only wakes the
// service worker, which then asks the server what the alert says (keyed by the
// subscription's own endpoint, which only that phone knows). That keeps this
// to a signed VAPID request, with no payload encryption to get wrong.
import { kv } from './store.js';
import { STAFF, SCHOOL_BY_ID, REGIONS, eatToday, addWorkingDays, FIELD_START, FIELD_END, isWorkingDay } from './config.js';
import { getPlan, withNotices } from './plan.js';
import { silentVisits } from './brief.js';

const enc = new TextEncoder();
const title = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha = async (s) => b64u(await crypto.subtle.digest('SHA-256', enc.encode(s))).slice(0, 22);
const SUBS = 'v2:push:subs';
const QUEUE = (h) => `v2:push:q:${h}`;
const SENT = 'v2:push:sent';

async function vapidHeaders(env, endpoint) {
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const aud = new URL(endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:mkamukulu@learnimpact.org' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`));
  return { Authorization: `vapid t=${head}.${body}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`, TTL: '86400', Urgency: 'normal', 'Content-Length': '0' };
}

export const pushReady = (env) => Boolean(env.VAPID_PRIVATE_JWK && env.VAPID_PUBLIC);

export async function subscribe(env, who, sub) {
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint)) return { error: 'Not a valid subscription' };
  const subs = (await kv(env).get(SUBS)) || {};
  const h = await sha(sub.endpoint);
  subs[h] = { endpoint: sub.endpoint, who: { id: who.id, role: who.role, name: who.name, region: who.region }, at: new Date().toISOString() };
  await kv(env).put(SUBS, subs);
  return { ok: true, id: h };
}
export async function unsubscribe(env, endpoint) {
  const subs = (await kv(env).get(SUBS)) || {};
  delete subs[await sha(endpoint)];
  await kv(env).put(SUBS, subs);
}

// what the service worker shows after a push wakes it
export async function takeAlert(env, endpointHash) {
  const q = (await kv(env).get(QUEUE(endpointHash))) || [];
  if (!q.length) return { title: 'KiuFunza 4', body: 'Open the dashboard for the latest update.', url: '/' };
  await kv(env).put(QUEUE(endpointHash), q.slice(1));
  return q[0];
}
export const hashEndpoint = sha;

async function sendOne(env, h, sub, alert) {
  const q = (await kv(env).get(QUEUE(h))) || [];
  q.push(alert);
  await kv(env).put(QUEUE(h), q.slice(-5));
  const res = await fetch(sub.endpoint, { method: 'POST', headers: await vapidHeaders(env, sub.endpoint) });
  if (res.status === 404 || res.status === 410) return 'gone';
  return res.ok ? 'sent' : `error ${res.status}`;
}

export async function pushTo(env, predicate, alert) {
  if (!pushReady(env)) return { skipped: 'push is not set up' };
  const subs = (await kv(env).get(SUBS)) || {};
  const out = { sent: 0, gone: 0, errors: [] };
  let changed = false;
  for (const [h, s] of Object.entries(subs)) {
    if (!predicate(s.who)) continue;
    try {
      const r = await sendOne(env, h, s, alert);
      if (r === 'sent') out.sent++; else if (r === 'gone') { delete subs[h]; changed = true; out.gone++; } else out.errors.push(r);
    } catch (e) { out.errors.push(String(e && e.message)); }
  }
  if (changed) await kv(env).put(SUBS, subs);
  return out;
}

export async function pushStatus(env) {
  const subs = (await kv(env).get(SUBS)) || {};
  const by = {};
  for (const s of Object.values(subs)) by[s.who.role] = (by[s.who.role] || 0) + 1;
  return { ready: pushReady(env), devices: Object.keys(subs).length, by_role: by };
}

// ----- alert rules, run on working days from the scheduler -----
async function once(env, id) {
  const sent = (await kv(env).get(SENT)) || {};
  if (sent[id]) return false;
  sent[id] = Date.now();
  const keep = Object.fromEntries(Object.entries(sent).filter(([, t]) => Date.now() - t < 14 * 86400000));
  await kv(env).put(SENT, keep);
  return true;
}

export async function runAlerts(env, slot, sum) {
  if (!pushReady(env)) return null;
  const today = eatToday();
  if (!isWorkingDay(today)) return null;
  const site = '/';
  const results = [];
  if (slot === 'morning') {
    // notices due today or late, to the coordinators of that region
    for (const r of REGIONS) {
      const plan = await getPlan(env, r);
      if (plan.status !== 'locked') continue;
      const due = withNotices(plan, today, null).visits.filter((v) => v.date > today && (v.aek_state === 'due' || v.aek_state === 'late' || v.ht_state === 'due' || v.ht_state === 'late'));
      if (!due.length) continue;
      if (!(await once(env, `notice:${r}:${today}`))) continue;
      const late = due.filter((v) => v.aek_state === 'late' || v.ht_state === 'late').length;
      results.push({ r, notices: due.length, ...(await pushTo(env, (w) => w.region === r && (w.role === 'rc' || w.role === 'arc'), { title: `${due.length} notice(s) to send`, body: `${late ? late + ' late. ' : ''}Ward officer and head teacher notices for ${due.slice(0, 2).map((v) => v.school_name).join(', ')}${due.length > 2 ? '…' : ''}.`, url: '/#plan' })) });
    }
    // serious flags opened since the last alert
    if (sum) for (const r of REGIONS) {
      const bad = sum.flags.filter((f) => f.sev === 'bad' && SCHOOL_BY_ID[f.school]?.region === r);
      for (const f of bad.slice(0, 5)) {
        const id = `flag:${f.type}|${f.school}|${f.grade || 0}|${f.date || ''}`;
        if (!(await once(env, id))) continue;
        results.push({ flag: id, ...(await pushTo(env, (w) => w.region === r && (w.role === 'rc' || w.role === 'arc'), { title: `Query: ${f.school_name || SCHOOL_BY_ID[f.school]?.name}`, body: f.text + (f.admin ? ` (${f.admin})` : ''), url: '/#allq' })) });
      }
    }
  }
  if (slot === 'silent') {
    const quiet = await silentVisits(env, today, null);
    for (const r of [...new Set(quiet.map((q) => q.region))]) {
      const list = quiet.filter((q) => q.region === r);
      if (!(await once(env, `silent:${r}:${today}:${list.map((x) => x.school).join(',')}`))) continue;
      results.push({ r, silent: list.length, ...(await pushTo(env, (w) => (w.region === r && (w.role === 'rc' || w.role === 'arc')) || w.role === 'hq', { title: `No tests yet: ${list.slice(0, 2).map((s) => s.name.trim()).join(', ')}${list.length > 2 ? '…' : ''}`, body: `${title(r)}: ${list.length} planned school(s) have sent nothing yet today. Please check with the team.`, url: '/' })) });
    }
  }
  if (slot === 'health') {
    // a form connection that has not been read for 40 minutes during field hours means the dashboard is going stale
    const stale = [];
    for (const kind of ['students', 'sampling', 'teachers']) { const wm = await kv(env).get(`v2:wm:${kind}`); if (wm?.last_check && Date.now() - Date.parse(wm.last_check) > 40 * 60 * 1000) stale.push(kind); }
    if (stale.length && (await once(env, `health:${today}:${stale.join(',')}:${Math.floor(Date.now() / 3600000)}`))) results.push({ stale, ...(await pushTo(env, (w) => w.role === 'hq', { title: 'Data connection stalled', body: `No fresh read of the ${stale.join(', ')} form(s) for over 40 minutes. Open Admin and press Sync now.`, url: '/#admin' })) });
  }
  if (slot === 'evening') {
    // tomorrow's schools to the team that is planned for them
    const tomorrow = addWorkingDays(today, 1);
    if (tomorrow >= FIELD_START && tomorrow <= FIELD_END) for (const r of REGIONS) {
      const plan = await getPlan(env, r);
      if (plan.status !== 'locked') continue;
      const vs = plan.visits.filter((v) => v.date === tomorrow);
      if (!vs.length) continue;
      if (!(await once(env, `tomorrow:${r}:${tomorrow}`))) continue;
      results.push({ r, tomorrow: vs.length, ...(await pushTo(env, (w) => w.region === r, { title: 'Kesho · Tomorrow', body: vs.map((v) => `${SCHOOL_BY_ID[v.school]?.name} ${v.start}`).join(' · '), url: site })) });
    }
  }
  return results;
}
