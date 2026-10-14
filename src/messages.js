// Messages hub: emails, phone alerts and News posts that the HQ team writes, sends now, schedules once or repeats.
// Templates are editable. The built-in automatic emails (morning brief, end-of-day check, reminders) are listed here
// too: HQ can switch them off, change the time and add a note at the top. Every send is logged.
import { kv } from './store.js';
import { loadRecipients, sendMail, hqCc } from './digest.js';
import { pushTo } from './push.js';
import { saveNews, publish, polish } from './news.js';
import { BRAND } from './hq.js';
import { REGIONS, eatToday, addDays } from './config.js';

const KEY = 'v2:msgs', BKEY = 'v2:msgs:builtin';
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tcase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const TITLE = { hq: 'HQ', rc: 'Regional Coordinator', arc: 'Assistant Regional Coordinator', volunteer: 'Test Admin' };
export const FIELDS = ['first_name', 'name', 'region', 'title', 'date'];

const SEED = [
  { seed: 'goodwill', name: 'Good wishes for a field day', subject: 'Kazi njema, {first_name}', body: 'Habari {first_name},\n\nTunakutakia kazi njema leo. Good luck today in {region}.\n\nRemember: send your records the same day and tell your Regional Coordinator early if anything changes.\n\nAsante sana.' },
  { seed: 'plan', name: 'Plan reminder', subject: 'Please submit your field plan', body: 'Habari {first_name},\n\nYour whole-field plan for {region} is not yet submitted. The notices to ward officers and head teachers depend on it.\n\nOpen Plan & calendar, check the days and press Submit plan.\n\nAsante.' },
  { seed: 'queries', name: 'Queries reminder', subject: 'Queries waiting for a response', body: 'Habari {first_name},\n\nSome queries in {region} are waiting for a response. Please open Queries, review the responses from your team, and approve or send back each one.\n\nAsante.' },
  { seed: 'weekly', name: 'Weekly update from HQ', subject: 'Weekly update, {date}', body: 'Habari {first_name},\n\nThis week:\n- \n- \n\nNext week:\n- \n\nAsante sana.' },
  { seed: 'thanks', name: 'Thank you', subject: 'Asante sana, {first_name}', body: 'Habari {first_name},\n\nThank you for the work in {region}. It is noticed and it matters.\n\nAsante sana.' },
];
const DEFAULT_B = { morning: { enabled: true, time: '07:00', note: '' }, evening: { enabled: true, time: '17:30', note: '' }, reminder: { enabled: true, time: '14:00', note: '' } };

async function load(env) {
  const d = (await kv(env).get(KEY)) || { templates: [], jobs: [], log: [] };
  if (!d.seeded) { for (const s of SEED) d.templates.push({ id: uid(), ...s, by: 'System', at: new Date().toISOString() }); d.seeded = true; await kv(env).put(KEY, d); }
  return d;
}
export const builtinCfg = async (env) => { const c = (await kv(env).get(BKEY)) || {}; return Object.fromEntries(Object.keys(DEFAULT_B).map((k) => [k, { ...DEFAULT_B[k], ...(c[k] || {}) }])); };

// ---- audience ----
function pick(job, rec, today) {
  const A = job.audience || {}; const roles = new Set(A.roles || []), regs = new Set((A.regions || []).map((r) => String(r).toUpperCase())), people = new Set((A.people || []).map((e) => e.toLowerCase()));
  const out = [];
  for (const [email, r] of Object.entries(rec)) {
    if (r.active === false) continue; if (r.from && today < r.from) continue;
    const byPerson = people.has(email);
    const byRole = roles.has(r.role) && (r.role === 'hq' || !regs.size || regs.has(r.region));
    if (byPerson || byRole) out.push({ email, name: r.name || '', role: r.role, region: r.region || '' });
  }
  return out;
}
function render(text, p, today) {
  const first = String(p.name || '').trim().split(/\s+/)[0] || 'colleague';
  const vals = { first_name: first, name: p.name || first, region: p.region ? tcase(p.region) : 'your region', title: TITLE[p.role] || '', date: today };
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
}
function html(job, p, today, siteUrl) {
  const body = render(job.body, p, today).split(/\n{2,}/).map((para) => `<p style="margin:0 0 12px">${esc(para).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`).join('');
  return `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:620px;margin:0 auto;background:#fff;border:1px solid #e3e6ee;border-radius:10px;overflow:hidden;color:#354062"><div style="background:#FFC650;color:#354062;padding:6px 20px;font-size:11.5px;font-weight:700;letter-spacing:.06em">MESSAGE FROM HQ</div><div style="background:#354062;color:#fff;padding:16px 20px"><div style="font-size:17px;font-weight:700">${esc(render(job.subject, p, today))}</div></div><div style="padding:18px 20px;font-size:14px;line-height:1.5">${body}<p style="margin:14px 0 0"><a href="${esc(siteUrl)}" style="color:#354062;font-weight:700">Open the ${esc(BRAND.platform)}</a></p></div><div style="padding:12px 20px;font-size:12px;color:#8089a0;border-top:1px solid #eef1f6">Sent by ${esc(job.by || 'HQ')} from the ${esc(BRAND.platform)} (LearnImpact).</div></div>`;
}
const sendingOn = (env) => env.EMAIL_ENABLED === 'true' && Boolean(env.EMAIL_FROM && (env.RESEND_API_KEY || env.EMAIL));
const siteOf = (env) => env.SITE_URL || 'https://kf-assessments.learnimpacttz.workers.dev';

// ---- run one job now ----
export async function runJob(env, job, { by } = {}) {
  const today = eatToday(); const rec = await loadRecipients(env); const res = { at: new Date().toISOString(), job: job.id, name: job.name, by: by || job.by, channels: [], email: null, push: null, news: null };
  const ch = job.channels || {};
  if (ch.email) {
    const to = pick(job, rec, today); const out = { people: to.length, sent: 0, errors: [] };
    if (!sendingOn(env)) out.errors.push('Email sending is switched off in this system');
    else { const ccAll = job.cc_hq === false ? [] : await hqCc(env); for (const p of to) { try { const cc = ccAll.filter((e) => e !== p.email); await sendMail(env, p.email, { subject: render(job.subject, p, today), html: html(job, p, today, siteOf(env)), text: render(job.body, p, today), ...(cc.length ? { cc } : {}) }); out.sent++; } catch (e) { out.errors.push(`${p.email}: ${String(e.message || e).slice(0, 80)}`); } } }
    res.email = out; res.channels.push('email');
  }
  const roles = new Set(job.audience?.roles || []); const regs = new Set((job.audience?.regions || []).map((r) => String(r).toUpperCase()));
  if (ch.news) {
    const co = roles.has('rc') || roles.has('arc'); const to = roles.has('volunteer') && (co || roles.has('hq')) ? 'all' : roles.has('volunteer') ? 'volunteers' : co ? 'coordinators' : 'hq';
    const saved = await saveNews(env, { name: job.by || 'HQ' }, { title: render(job.subject, { name: '', role: '', region: '' }, today).replace(/colleague/, '').trim(), body: render(job.body, { name: '', role: '', region: '' }, today), kind: 'announcement', to, regions: [...regs].filter((r) => REGIONS.includes(r)), push: Boolean(ch.push) });
    res.news = saved.error ? { error: saved.error } : await publish(env, saved.id, by || job.by || 'HQ'); res.channels.push('news');
  } else if (ch.push) {
        const byPerson = new Set((job.audience?.people || []).map((e) => (rec[e.toLowerCase()] || {}).name).filter(Boolean));
    const pred = (w) => w && ((roles.has(w.role) && (w.role === 'hq' || !regs.size || regs.has(String(w.region || '').toUpperCase()))) || byPerson.has(w.name));
    const first = render(job.body, { name: '', role: '', region: '' }, today).split('\n').find((l) => l.trim()) || '';
    res.push = await pushTo(env, pred, { title: render(job.subject, { name: '', role: '', region: '' }, today).replace(/,\s*colleague/, ''), body: first.slice(0, 140), url: '/#news' }); res.channels.push('push');
  }
  const d = await load(env); d.log.unshift(res); d.log = d.log.slice(0, 200);
  const j = d.jobs.find((x) => x.id === job.id); if (j) { j.last_at = res.at; j.last_day = today; if (job.schedule?.type !== 'repeat') j.status = 'sent'; j.sent_count = (j.sent_count || 0) + 1; }
  await kv(env).put(KEY, d); return res;
}

// ---- every minute ----
export async function runDueMessages(env) {
  const d = await load(env); const now = Date.now(); const eat = new Date(now + 3 * 3600e3); const day = eat.toISOString().slice(0, 10), hm = eat.toISOString().slice(11, 16), dow = eat.getUTCDay(); const out = [];
  for (const j of d.jobs) {
    if (j.status !== 'scheduled') continue; const s = j.schedule || {};
    let due = false;
    if (s.type === 'once') due = s.at && Date.parse(s.at) <= now && !j.sent_count;
    else if (s.type === 'repeat') due = (!s.from || day >= s.from) && (!s.until || day <= s.until) && (s.days || []).includes(dow) && hm >= s.time && j.last_day !== day;
    if (s.type === 'repeat' && s.until && day > s.until) { j.status = 'ended'; continue; }
    if (due) { j.last_day = day; await kv(env).put(KEY, d); try { out.push({ job: j.name, ...(await runJob(env, j, { by: 'Schedule' })) }); } catch (e) { out.push({ job: j.name, error: String(e.message || e) }); } }
  }
  if (d.jobs.some((j) => j.status === 'ended')) { const d2 = await load(env); for (const j of d2.jobs) if (j.status === 'scheduled' && j.schedule?.type === 'repeat' && j.schedule.until && day > j.schedule.until) j.status = 'ended'; await kv(env).put(KEY, d2); }
  return out.length ? out : null;
}

function nextRun(j, now = Date.now()) {
  const s = j.schedule || {}; if (j.status !== 'scheduled') return null;
  if (s.type === 'once') return s.at && !j.sent_count ? new Date(Date.parse(s.at) + 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : null;
  if (s.type !== 'repeat') return null;
  const eat = new Date(now + 3 * 3600e3); let day = eat.toISOString().slice(0, 10); const hm = eat.toISOString().slice(11, 16);
  for (let i = 0; i < 400; i++) { const dw = new Date(day + 'T12:00:00Z').getUTCDay(); if ((s.days || []).includes(dw) && (!s.from || day >= s.from) && (!s.until || day <= s.until) && (day > eatToday() || hm < s.time) && j.last_day !== day) return `${day} ${s.time}`; day = addDays(day, 1); }
  return null;
}
const cleanJob = (b, who, old = {}) => {
  const s = b.schedule || {}; const type = ['now', 'once', 'repeat'].includes(s.type) ? s.type : 'now';
  const A = b.audience || {}; const ch = b.channels || {};
  return { name: String(b.name || b.subject || 'Message').slice(0, 80), subject: String(b.subject || '').slice(0, 140), body: String(b.body || '').slice(0, 5000),
    channels: { email: Boolean(ch.email), push: Boolean(ch.push), news: Boolean(ch.news) }, cc_hq: b.cc_hq !== false,
    audience: { roles: (A.roles || []).filter((r) => ['hq', 'rc', 'arc', 'volunteer'].includes(r)), regions: (A.regions || []).filter((r) => REGIONS.includes(String(r).toUpperCase())).map((r) => String(r).toUpperCase()), people: (A.people || []).map((e) => String(e).toLowerCase()).slice(0, 100) },
    schedule: { type, at: type === 'once' && s.at ? new Date(Date.parse(s.at)).toISOString() : null, time: /^\d\d:\d\d$/.test(s.time || '') ? s.time : '08:00', days: (s.days || [1, 2, 3, 4, 5]).map(Number).filter((x) => x >= 0 && x <= 6), from: /^\d{4}-\d\d-\d\d$/.test(s.from || '') ? s.from : null, until: /^\d{4}-\d\d-\d\d$/.test(s.until || '') ? s.until : null } };
};
const needsOk = (c) => (!c.channels.email && !c.channels.push && !c.channels.news ? 'Choose at least one way to send (email, phone alert or News).' : !c.subject.trim() || !c.body.trim() ? 'Write a subject and a message.' : !c.audience.roles.length && !c.audience.people.length ? 'Choose who gets it.' : c.channels.email && c.audience.roles.length === 1 && c.audience.roles[0] === 'volunteer' && !c.audience.people.length ? 'Volunteers have no email addresses here. Use a phone alert or News for them.' : null);

export async function messagesApi(env, who, b) {
  const d = await load(env); const today = eatToday(); const admin = (who.level || 'admin') === 'admin'; const a = b.action || 'view';
  const stamp = { by: who.name || 'HQ' };
  if (a === 'view') {
    const rec = await loadRecipients(env);
    return { templates: d.templates, jobs: d.jobs.map((j) => ({ ...j, next: nextRun(j) })), log: d.log.slice(0, 40), builtin: await builtinCfg(env), people: Object.entries(rec).filter(([, r]) => r.active !== false).map(([email, r]) => ({ email, name: r.name, role: r.role, region: r.region })), regions: REGIONS, fields: FIELDS, sending_on: sendingOn(env), admin };
  }
  if (a === 'count') { const c = cleanJob(b, who); return { email: pick(c, await loadRecipients(env), today).length }; }
  if (a === 'preview') { const c = cleanJob(b, who); const p = pick(c, await loadRecipients(env), today)[0] || { name: 'Test Person', role: 'rc', region: 'TANGA' }; return { subject: render(c.subject, p, today), html: html({ ...c, ...stamp }, p, today, siteOf(env)), sample: p.name }; }
  if (a === 'test') { const c = cleanJob(b, who); const to = String(b.to || '').trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { error: 'Type a valid email address for the test' }; if (!sendingOn(env)) return { error: 'Email sending is switched off in this system' }; const p = { name: who.name || 'Test Person', role: 'rc', region: 'TANGA' }; await sendMail(env, to, { subject: '[TEST] ' + render(c.subject, p, today), html: html({ ...c, ...stamp }, p, today, siteOf(env)), text: render(c.body, p, today) }); return { ok: true, sent_to: to }; }
  if (a === 'polish') return polish(env, { title: b.subject, body: b.body, kind: 'announcement', add_swahili: Boolean(b.sw) });
  if (a === 'template_save') { const t = { name: String(b.name || '').slice(0, 80), subject: String(b.subject || '').slice(0, 140), body: String(b.body || '').slice(0, 5000) }; if (!t.name || !t.subject || !t.body) return { error: 'A template needs a name, a subject and a message.' }; const old = b.id && d.templates.find((x) => x.id === b.id); if (old) Object.assign(old, t, { by: who.name, at: new Date().toISOString() }); else d.templates.push({ id: uid(), ...t, by: who.name, at: new Date().toISOString() }); await kv(env).put(KEY, d); return { ok: true }; }
  if (a === 'template_delete') { d.templates = d.templates.filter((x) => x.id !== b.id); await kv(env).put(KEY, d); return { ok: true }; }
  if (a === 'job_save' || a === 'job_send') {
    const c = cleanJob(b, who); const err = needsOk(c); if (err) return { error: err };
    let job = b.id ? d.jobs.find((x) => x.id === b.id) : null;
    if (job && job.status === 'sent') return { error: 'A message that was sent cannot be edited. Copy it into a new one.' };
    if (!job) { job = { id: uid(), created_at: new Date().toISOString(), ...stamp }; d.jobs.push(job); }
    Object.assign(job, c);
    if (c.schedule.type === 'once' && (!c.schedule.at || Date.parse(c.schedule.at) <= Date.now())) return { error: 'Choose a time in the future.' };
    if (c.schedule.type === 'repeat' && !c.schedule.days.length) return { error: 'Choose at least one day of the week.' };
    if (a === 'job_send' || c.schedule.type === 'now') { job.schedule = { ...job.schedule, type: 'now' }; job.status = 'draft'; await kv(env).put(KEY, d); const r = await runJob(env, job, { by: who.name }); return { ok: true, sent: r }; }
    job.status = c.schedule.type === 'repeat' && !admin ? 'pending' : 'scheduled'; delete job.last_day; await kv(env).put(KEY, d);
    return { ok: true, status: job.status, id: job.id };
  }
  const job = d.jobs.find((x) => x.id === b.id);
  if (!job) return { error: 'Not found', status: 404 };
  if (a === 'job_pause') { job.status = 'paused'; }
  else if (a === 'job_resume') { job.status = job.schedule.type === 'repeat' && !admin ? 'pending' : 'scheduled'; }
  else if (a === 'job_approve') { if (!admin) return { error: 'An Admin approves repeating messages.' }; if (job.status !== 'pending') return { error: 'Nothing to approve.' }; job.status = 'scheduled'; job.approved_by = who.name; }
  else if (a === 'job_delete') { d.jobs = d.jobs.filter((x) => x.id !== b.id); }
  else if (a === 'job_run') { const r = await runJob(env, job, { by: who.name }); return { ok: true, sent: r }; }
  else if (a === 'builtin_save') return { error: 'wrong action' };
  else return { error: 'Unknown action' };
  await kv(env).put(KEY, d); return { ok: true };
}

export async function builtinSave(env, who, b) {
  if ((who.level || 'admin') !== 'admin') return { error: 'An Admin changes the built-in emails.' };
  const cur = await builtinCfg(env); const k = b.id; if (!cur[k]) return { error: 'Unknown email' };
  const t = /^\d\d:\d\d$/.test(b.time || '') ? b.time : cur[k].time;
  if (t < '05:00' || t > '20:00') return { error: 'Choose a time between 05:00 and 20:00 (East Africa time).' };
  cur[k] = { enabled: b.enabled !== false, time: t, note: String(b.note || '').slice(0, 600) }; await kv(env).put(BKEY, cur); return { ok: true };
}
