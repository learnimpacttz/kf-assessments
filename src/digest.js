// Scheduled email digests. Safe by default: nothing is sent unless EMAIL_ENABLED is
// "true", a verified sending domain is configured (EMAIL_FROM) and recipients exist.
// Until then everything runs as a preview HQ can read in the Admin tab.
import { kv } from './store.js';
import { staffCodes } from './auth.js';
import { STAFF, PLAN_DEADLINE, SCHOOL_BY_ID } from './config.js';
import { buildBrief } from './brief.js';
import { getPlan, withNotices, planProgress } from './plan.js';
import { REGIONS, SCHOOLS_BY_REGION, eatToday, isWorkingDay, addDays, FIELD_START, FIELD_END, workingDaysBetween } from './config.js';
import { loadQueries, flagKey } from './queries.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const title = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const RKEY = 'v2:recipients';

export const loadRecipients = async (env) => (await kv(env).get(RKEY)) || {};
export async function saveRecipients(env, rows) {
  const out = {};
  for (const r of rows || []) {
    const email = String(r.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
    out[email] = { name: String(r.name || '').slice(0, 80), role: ['hq', 'rc', 'arc'].includes(r.role) ? r.role : 'rc', region: r.region ? String(r.region).toUpperCase() : null, copy: Boolean(r.copy), backup: r.backup === 'to' || r.backup === 'cc' ? r.backup : undefined, active: r.active !== false && !r.paused, from: /^\d{4}-\d\d-\d\d$/.test(r.from || '') ? r.from : null };
  }
  await kv(env).put(RKEY, out);
  return Object.keys(out).length;
}

function layout(heading, sub, bodyHtml, footer) {
  return `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:620px;margin:0 auto;background:#fff;border:1px solid #e3e6ee;border-radius:10px;overflow:hidden;color:#354062">
<div style="background:#FFC650;color:#354062;padding:6px 20px;font-size:11.5px;font-weight:700;letter-spacing:.06em">AUTOMATED UPDATE · NO REPLY NEEDED</div>
<div style="background:#354062;color:#fff;padding:16px 20px"><div style="font-size:17px;font-weight:700">${esc(heading)}</div><div style="font-size:13px;opacity:.85">${esc(sub)}</div></div>
<div style="padding:18px 20px;font-size:14px;line-height:1.5">${bodyHtml}</div>
<div style="padding:12px 20px;font-size:12px;color:#8089a0;border-top:1px solid #eef1f6">${footer}</div></div>`;
}
const dot = (sev) => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${sev === 'bad' ? '#b8432a' : sev === 'warn' ? '#a87400' : '#2f8f5b'};margin-right:8px"></span>`;

export async function morningDigest(env, sum, region, today, siteUrl) {
  const brief = await buildBrief(env, sum, today, region);
  let todayRows = '';
  const regs = region ? [region] : REGIONS;
  const lines = [];
  for (const r of regs) {
    const plan = await getPlan(env, r);
    if (plan.status !== 'locked') continue;
    const vs = withNotices(plan, today, null).visits.filter((v) => v.date === today);
    for (const v of vs) lines.push({ r, name: v.school_name, lga: v.lga, start: v.start, team: (v.team || []).join(', ') || 'whole team' });
  }
  if (lines.length) todayRows = `<p style="margin:14px 0 4px"><b>Today's visits / Ziara za leo</b></p><table style="width:100%;border-collapse:collapse;font-size:13.5px">${lines.map((l) => `<tr><td style="padding:5px 0;border-bottom:1px solid #eef1f6">${esc(l.name)}${region ? '' : ' · ' + esc(title(l.r))}</td><td style="border-bottom:1px solid #eef1f6">${esc(title(l.lga))}</td><td style="border-bottom:1px solid #eef1f6">${esc(l.start)}</td><td style="border-bottom:1px solid #eef1f6">${esc(l.team)}</td></tr>`).join('')}</table>`;
  let chgLine = '', chgText = '';
  if (!region) {
    const since = new Date(Date.now() - 24 * 3600e3).toISOString(); const recent = [];
    for (const r of REGIONS) for (const c of (await getPlan(env, r)).changes || []) if (c.at > since) recent.push({ r, c });
    if (recent.length) {
      chgText = `Calendar changes in the last 24 hours: ${recent.length} (${recent.filter((x) => x.c.late).length} late). ` + recent.slice(0, 6).map((x) => `${title(x.r)}: ${SCHOOL_BY_ID[x.c.school]?.name?.trim() || x.c.school} ${x.c.from?.date} to ${x.c.to?.date} (${x.c.reason}${x.c.late ? ', late' : ''}, ${x.c.by})`).join('; ');
      chgLine = `<p style="margin:6px 0">${dot(recent.some((x) => x.c.late) ? 'warn' : 'info')}${esc(chgText)}</p>`;
    }
  }
  let planLine = '', planText = '';
  if (!region) {
    const pp = await planProgress(env, REGIONS);
    if (pp.missing.length) {
      const late = today > PLAN_DEADLINE, left = Math.max(0, workingDaysBetween(today, PLAN_DEADLINE));
      const when = late ? 'overdue (deadline ' + PLAN_DEADLINE + ')' : today === PLAN_DEADLINE ? 'due today' : left + ' working day(s) to the deadline of ' + PLAN_DEADLINE;
      planText = `Field plans submitted: ${pp.submitted} of ${pp.total} (${when}). Missing: ${pp.missing.map(title).join(', ')}.`;
      planLine = `<p style="margin:6px 0">${dot(late ? 'bad' : 'warn')}<b>${esc(planText)}</b></p>`;
    }
  }
  if (planText) brief.items = brief.items.filter((i) => !/have not submitted the field plan/.test(i.text)); // the deadline line above replaces it
  const items = brief.items.map((i) => `<p style="margin:6px 0">${dot(i.sev)}${esc(i.text)}</p>`).join('') || '<p>Nothing to report yet.</p>';
  const tm = Object.entries(brief.tomorrow_schools).map(([r, s]) => `<p style="margin:4px 0">${region ? '' : '<b>' + esc(title(r)) + '</b>: '}${s.map(esc).join(', ')}</p>`).join('');
  const html = layout(`KiuFunza 4 · ${region ? title(region) : 'National'} morning brief`, today, `${planLine}${chgLine}${items}${todayRows}${tm ? `<p style="margin:14px 0 4px"><b>Tomorrow / Kesho</b></p>${tm}` : ''}`, `Sent automatically by the LearnImpact KiuFunza field dashboard. Open it for live numbers: <a href="${esc(siteUrl)}" style="color:#354062">${esc(siteUrl)}</a>`);
  const text = ['AUTOMATED UPDATE - no reply needed', `KiuFunza 4 · ${region ? title(region) : 'National'} morning brief · ${today}`, ...(planText ? ['- ' + planText] : []), ...(chgText ? ['- ' + chgText] : []), ...brief.items.map((i) => '- ' + i.text), ...lines.map((l) => `Today: ${l.name} (${l.start}) ${l.team}`), siteUrl].join('\n');
  return { subject: `KiuFunza 4 · Automated field update · ${region ? title(region) : 'National'} · ${today}`, html, text };
}

export async function eveningGap(env, sum, region, today, siteUrl) {
  if (!sum) return null;
  const regs = region ? [region] : REGIONS;
  const open = [];
  for (const r of regs) for (const s of SCHOOLS_BY_REGION[r] || []) {
    const S = sum.schools[s.id];
    if (S && S.dates.includes(today) && !S.done) open.push({ r, name: S.name, g: [1, 2, 3].map((g) => `${S.g[g].av}/${S.g[g].target}`).join(' · ') });
  }
  if (!open.length) return null;
  const rows = open.map((o) => `<p style="margin:6px 0">${dot('warn')}${esc(o.name)}${region ? '' : ' · ' + esc(title(o.r))}: Gr 1/2/3 ${esc(o.g)}</p>`).join('');
  const html = layout(`KiuFunza 4 · ${region ? title(region) : 'National'} end-of-day check`, today, `<p>Schools started today and not yet complete / Shule zilizoanza leo na bado hazijakamilika:</p>${rows}<p>Please confirm with the teams before the end of the day.</p>`, `<a href="${esc(siteUrl)}" style="color:#354062">${esc(siteUrl)}</a>`);
  return { subject: `KiuFunza 4 · Automated end-of-day check · ${open.length} school(s) not complete · ${today}`, html, text: open.map((o) => `${o.name}: ${o.g}`).join('\n') };
}

const FROM_NAME = 'KiuFunza 4 Automated Updates (LearnImpact)';
// Resend (REST) when RESEND_API_KEY is set, otherwise the Cloudflare email binding.
export async function sendMail(env, to, msg) {
  if (env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: `${FROM_NAME} <${env.EMAIL_FROM}>`, to: [to], subject: msg.subject, html: msg.html, text: msg.text, ...(msg.cc && msg.cc.length ? { cc: msg.cc } : {}), ...(msg.attachments ? { attachments: msg.attachments } : {}), ...(env.EMAIL_REPLY_TO ? { reply_to: env.EMAIL_REPLY_TO } : {}) }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return;
  }
  await env.EMAIL.send({ to, from: { email: env.EMAIL_FROM, name: FROM_NAME }, ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}), subject: msg.subject, html: msg.html, text: msg.text });
}

export async function runDigests(env, kind, { dry = false } = {}) {
  const today = eatToday();
  const sum = await kv(env).get(`v2:sum:${(await kv(env).get('v2:years'))?.includes('2026') ? '2026' : ((await kv(env).get('v2:years')) || []).slice(-1)[0]}`);
  const recipients = await loadRecipients(env);
  const siteUrl = env.SITE_URL || 'https://kf-assessments.learnimpacttz.workers.dev';
  const sendOk = !dry && env.EMAIL_ENABLED === 'true' && env.EMAIL_FROM && (env.RESEND_API_KEY || env.EMAIL);
  const results = [];
  const cache = {};
  for (const [email, r] of Object.entries(recipients)) {
    if (r.active === false) { results.push({ email, skipped: 'paused' }); continue; }
    if (r.from && eatToday() < r.from) { results.push({ email, skipped: `starts ${r.from}` }); continue; }
    const scope = r.role === 'hq' ? null : r.region;
    const key = scope || 'ALL';
    cache[key] ||= kind === 'morning' ? await morningDigest(env, sum, scope, today, siteUrl) : await eveningGap(env, sum, scope, today, siteUrl);
    const msg0 = cache[key];
    const msg = msg0 && r.copy ? { ...msg0, html: msg0.html.replace('AUTOMATED UPDATE · NO REPLY NEEDED', 'AUTOMATED UPDATE · NO REPLY NEEDED · COPY FOR INFORMATION'), text: 'You are receiving a copy for information.\n' + msg0.text } : msg0;
    if (!msg) { results.push({ email, skipped: 'nothing to send' }); continue; }
    if (!sendOk) { results.push({ email, preview: true, subject: msg.subject }); continue; }
    try {
      await sendMail(env, email, msg);
      results.push({ email, sent: true });
    } catch (e) {
      results.push({ email, error: String(e && e.message) });
    }
  }
  return results;
}

// Emails go out Monday to Friday only, until field work is over and every query is settled.
// The evening check only makes sense while schools are being visited.
export async function sendingWindow(env, today, kind) {
  if (!isWorkingDay(today)) return { ok: false, why: 'weekend' };
  if (kind === 'evening' && (today < FIELD_START || today > FIELD_END)) return { ok: false, why: 'outside field dates' };
  if (today > FIELD_END) {
    if (today > addDays(FIELD_END, 45)) return { ok: false, why: 'past the final cut-off' };
    const years = (await kv(env).get('v2:years')) || [];
    const sum = years.includes('2026') ? await kv(env).get('v2:sum:2026') : null;
    const queries = await loadQueries(env);
    const open = (sum?.flags || []).filter((f) => (queries[flagKey(f)]?.status) !== 'resolved').length;
    if (open === 0) return { ok: false, why: 'field work done and all queries settled' };
  }
  return { ok: true };
}

// Called every minute from the cron; fires each digest once per day at its time (EAT).
export async function maybeRunScheduledDigests(env) {
  const now = new Date();
  const hhmm = now.toISOString().slice(11, 16); // UTC
  const slots = { '04:00': 'morning', '14:30': 'evening', '11:00': 'reminder' }; // 07:00, 17:30 and 14:00 EAT
  const kind = slots[hhmm];
  const today0 = eatToday();
  if (hhmm >= '04:00' && hhmm < '12:00' && today0 === ONBOARD_DATE) { // any minute from 07:00 to 15:00 EAT, so a missed tick cannot skip it
    const done = (await kv(env).get('v2:onboard:sent')) || null;
    if (!done) {
      await kv(env).put('v2:onboard:sent', { at: new Date().toISOString() });
      return { kind: 'onboarding', results: await runOnboarding(env, { dry: false }) };
    }
  }
  if (!kind) return null;
  const today = eatToday();
  const gate = kind === 'reminder' ? (isWorkingDay(today) && today <= FIELD_END ? { ok: true } : { ok: false, why: 'outside reminder dates' }) : await sendingWindow(env, today, kind);
  if (!gate.ok) return { kind, skipped: gate.why };
  const last = (await kv(env).get('v2:digest:last')) || {};
  if (last[kind] === today) return null;
  last[kind] = today;
  await kv(env).put('v2:digest:last', last);
  if (kind === 'reminder') return { kind, results: await runReminders(env, { dry: false }) };
  return { kind, results: await runDigests(env, kind) };
}

// ---------- one-off onboarding email: access code and how to start ----------
export const ONBOARD_DATE = '2026-10-13';
async function codeFor(env, staff) {
  const map = await staffCodes(env);
  return Object.entries(map || {}).find(([, s]) => s.id === staff.id)?.[0] || null;
}
export async function onboardingEmail(env, recipient, siteUrl) {
  const staff = STAFF.find((s) => s.active && s.region === recipient.region && s.role === recipient.role);
  if (!staff) return null;
  const code = await codeFor(env, staff);
  const team = recipient.role === 'rc' ? STAFF.filter((s) => s.active && s.region === staff.region && s.id !== staff.id) : [];
  const teamRows = [];
  for (const m of team) teamRows.push({ name: m.name, position: m.position, code: await codeFor(env, m) });
  const first = staff.name.split(' ')[0];
  const body = `<p>Dear ${esc(first)},</p>
<p>The KiuFunza 4 endline field dashboard is ready for ${esc(title(staff.region))}. It shows progress, the checks on every test, your team, and the field calendar.</p>
<p style="margin:14px 0 4px"><b>Your personal access code</b></p>
<p style="font-size:24px;letter-spacing:4px;font-weight:700;margin:4px 0 10px;font-family:ui-monospace,Menlo,monospace">${esc(code)}</p>
<p style="font-size:13px;color:#5A6478">Personal to you, please do not share it. Enter it once on the dashboard and your phone will remember it.</p>
<p style="margin:14px 0 4px"><b>How to start</b></p>
<ol style="margin:4px 0 10px;padding-left:20px"><li>Open <a href="${esc(siteUrl)}" style="color:#354062">${esc(siteUrl)}</a> on your phone.</li><li>Enter your code.</li><li>Add the page to your home screen so it opens like an app.</li><li>Open <b>Plan &amp; calendar</b> and plan every school in ${esc(title(staff.region))} for the whole field period, then submit. Please submit before field work starts on 19 October. After you submit, any change needs a reason.</li></ol>
${teamRows.length ? `<p style="margin:14px 0 4px"><b>Codes for your team</b> (please give each person only their own)</p><table style="width:100%;border-collapse:collapse;font-size:13.5px">${teamRows.map((t) => `<tr><td style="padding:5px 0;border-bottom:1px solid #eef1f6">${esc(t.name)}</td><td style="border-bottom:1px solid #eef1f6">${esc(t.position)}</td><td style="border-bottom:1px solid #eef1f6;font-family:ui-monospace,Menlo,monospace"><b>${esc(t.code)}</b></td></tr>`).join('')}</table>` : ''}
<p style="margin-top:14px">From Friday 16 October you will also receive a short daily update by email on working days.</p>`;
  const html = layout('KiuFunza 4 · Your dashboard access', staff.region ? title(staff.region) : '', body, `Sent automatically by the LearnImpact KiuFunza field dashboard. Keep this email private because it contains access codes.`);
  const text = `AUTOMATED UPDATE - no reply needed\nKiuFunza 4 dashboard access for ${title(staff.region)}\nYour code: ${code}\n${siteUrl}\n` + (teamRows.length ? 'Team codes:\n' + teamRows.map((t) => `${t.name} (${t.position}): ${t.code}`).join('\n') : '');
  return { subject: 'KiuFunza 4 · Automated update · Your dashboard access code', html, text };
}

export async function runOnboarding(env, { dry = true, only = null } = {}) {
  const siteUrl = env.SITE_URL || 'https://kf-assessments.learnimpacttz.workers.dev';
  const recipients = await loadRecipients(env);
  const sendOk = !dry && env.EMAIL_ENABLED === 'true' && env.EMAIL_FROM && (env.RESEND_API_KEY || env.EMAIL);
  const results = [];
  for (const [email, r] of Object.entries(recipients)) {
    if (!['rc', 'arc'].includes(r.role) || r.active === false) continue;
    if (only && email !== only) continue;
    const msg = await onboardingEmail(env, r, siteUrl);
    if (!msg) { results.push({ email, skipped: 'no matching person in the roster' }); continue; }
    if (!sendOk) { results.push({ email, preview: true }); continue; }
    try { await sendMail(env, email, msg); results.push({ email, sent: true }); } catch (e) { results.push({ email, error: String(e && e.message) }); }
  }
  // after the deadline, HQ is told by name which regions are still missing
  if (today > PLAN_DEADLINE) {
    const pp = await planProgress(env, REGIONS);
    if (pp.missing.length) {
      const text = `Field plans overdue (deadline ${PLAN_DEADLINE}): ${pp.missing.map(title).join(', ')}. Submitted: ${pp.submitted} of ${pp.total}.`;
      const msg = { subject: `KiuFunza 4 · Automated reminder · ${pp.missing.length} field plan(s) overdue`, html: layout('KiuFunza 4 · Field plans overdue', today, `<p>${esc(text)}</p><p><a href="${esc(siteUrl)}/#regions" style="color:#354062">Open Regions &amp; plans</a></p>`, 'Sent automatically by the LearnImpact KiuFunza field dashboard.'), text: 'AUTOMATED REMINDER\n' + text };
      for (const [email, r] of Object.entries(recipients)) {
        if (r.role !== 'hq' || r.active === false || (r.from && today < r.from)) continue;
        if (!sendOk) { results.push({ email, preview: true, subject: msg.subject }); continue; }
        try { await sendMail(env, email, msg); results.push({ email, sent: true }); } catch (e) { results.push({ email, error: String(e && e.message) }); }
      }
    }
  }
  return results;
}

// ---------- one-off HQ onboarding (code comes from the Worker's own secret) ----------
export async function hqOnboardingEmail(env, name, siteUrl, isCopy) {
  const first = name.split(' ')[0];
  const li = (t) => `<li style="margin:4px 0">${t}</li>`;
  const body = `<p>Dear ${esc(first)},</p>
<p>The KiuFunza 4 endline field dashboard is ready for you to look at. It brings the field calendar, progress by region, the checks on every test, test admins and coordinators, and daily updates into one place that works on a phone.</p>
<p style="margin:14px 0 4px"><b>Your HQ access code</b></p>
<p style="font-size:24px;letter-spacing:4px;font-weight:700;margin:4px 0 10px;font-family:ui-monospace,Menlo,monospace">${esc(env.HQ_SECRET)}</p>
<p style="font-size:13px;color:#5A6478">This is the shared HQ code. Please keep it within the HQ team. Coordinators and volunteers each get their own code with fewer permissions.</p>
<p style="margin:14px 0 4px"><b>How to start</b></p>
<ol style="margin:4px 0 10px;padding-left:20px">${li(`Open <a href="${esc(siteUrl)}" style="color:#354062">${esc(siteUrl)}</a>.`)}${li('Enter the code once. The device remembers it.')}${li('On a phone, add the page to the home screen so it opens like an app (the icon is navy with a gold "KF4 ENDLINE").')}</ol>
<p style="margin:14px 0 4px"><b>What you will find</b></p>
<ul style="margin:4px 0 10px;padding-left:20px">${li('<b>HQ</b>: national progress, regions as coloured tiles, the day\'s briefing and the checks running.')}${li('<b>Regions &amp; plans</b>: pace and projected finish for each region, and whether each coordinator has submitted the whole field calendar.')}${li('<b>Plan &amp; calendar</b>: each region\'s calendar. After a coordinator submits, every change needs a reason, and the notices to ward officers (5 working days) and head teachers (3 working days) are tracked.')}${li('<b>People</b>: every coordinator and volunteer, with test speed, checks and a quality score. Click any name for a full card, and use search, filters and column sorting.')}${li('<b>Queries</b>: automatic flags with the region, LGA, school, grade, test admin, date and the pupil IDs and times, so the person involved can find the records and reply.')}${li('<b>Data explorer</b> and <b>Compare</b>: every school with attendance and pupils tested by grade, and how regions and people compare.')}${li('<b>Admin</b>: data connections, email recipients and every person\'s access code. Please keep that list private.')}</ul>
<p style="margin:14px 0 4px"><b>Good to know</b></p>
<ul style="margin:4px 0 10px;padding-left:20px">${li('Until the first 2026 endline test arrives, the dashboard shows 2025 data in a clearly marked <b>Rehearsal</b> mode so you can practise. 2024 and 2025 stay available as archive years.')}${li('Pupil names are never stored or shown. Only pupil IDs.')}${li('You receive a short update on every working day (Monday to Friday) at 07:00, plus an end-of-day check at 17:30 during field dates, until field work is complete and queries are settled. Coordinators get their codes on Tuesday 13 October and start receiving updates on Friday 16 October.')}</ul>
<p>Please send Michael anything that looks wrong or unclear.</p>`;
  const html = layout('KiuFunza 4 · Welcome to the field dashboard', isCopy ? 'Copy for information' : 'HQ access', body, 'Sent automatically by the LearnImpact KiuFunza field dashboard. Keep this email private because it contains an access code.');
  const text = `AUTOMATED UPDATE - no reply needed\nKiuFunza 4 field dashboard: ${siteUrl}\nHQ access code: ${env.HQ_SECRET}\nKeep this within the HQ team.`;
  return { subject: `KiuFunza 4 · Automated update · Welcome to the field dashboard${isCopy ? ' (copy)' : ''}`, html, text };
}

// ---------- notice and plan reminders to coordinators (14:00 EAT, Mon-Fri) ----------
export async function reminderEmail(env, region, today, siteUrl) {
  const plan = await getPlan(env, region);
  const link = `<a href="${esc(siteUrl)}/#plan" style="color:#354062">Open Plan &amp; calendar</a>`;
  if (plan.status !== 'locked') {
    if (today < '2026-10-16') return null;
    const dueTxt = today > PLAN_DEADLINE ? `It was due on ${PLAN_DEADLINE} and is now overdue.` : today === PLAN_DEADLINE ? 'It is due today.' : `Please submit it by ${PLAN_DEADLINE}.`;
    const html = layout(`KiuFunza 4 · ${title(region)} plan reminder`, today, `<p>The whole-field calendar for ${esc(title(region))} has not been submitted yet. ${dueTxt} Field work starts on 19 October, and the notices to ward officers (5 working days) and head teachers (3 working days) depend on it.</p><p>${link}</p>`, `Sent automatically by the LearnImpact KiuFunza field dashboard.`);
    return { subject: `KiuFunza 4 · Automated reminder · ${title(region)} field plan not submitted`, html, text: `AUTOMATED REMINDER\n${title(region)} field plan is not submitted. ${dueTxt} ${siteUrl}/#plan` };
  }
  const dec = withNotices(plan, today, null).visits.filter((v) => v.date > today);
  const items = [];
  for (const v of dec) {
    if (v.aek_state === 'late' || v.aek_state === 'due') items.push({ v, who: 'Ward officer (AEK)', state: v.aek_state, by: v.aek_due });
    if (v.ht_state === 'late' || v.ht_state === 'due') items.push({ v, who: 'Head teacher', state: v.ht_state, by: v.ht_due });
  }
  if (!items.length) return null;
  const rows = items.sort((a, b) => (a.state === 'late' ? 0 : 1) - (b.state === 'late' ? 0 : 1)).map((i) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eef1f6">${esc(i.v.school_name)}</td><td style="border-bottom:1px solid #eef1f6">${esc(i.who)}</td><td style="border-bottom:1px solid #eef1f6">${esc(i.v.date)}</td><td style="border-bottom:1px solid #eef1f6;color:${i.state === 'late' ? '#b8432a' : '#a87400'}"><b>${i.state === 'late' ? 'late' : 'due today'}</b></td></tr>`).join('');
  const html = layout(`KiuFunza 4 · ${title(region)} notices to send`, today, `<p>These notices are due or late. Once each is sent, please tap "Mark sent" in the dashboard so the reminder stops.</p><table style="width:100%;border-collapse:collapse;font-size:13.5px"><tr><th align="left">School</th><th align="left">Notify</th><th align="left">Visit</th><th align="left">Status</th></tr>${rows}</table><p style="margin-top:12px">${link}</p>`, `Sent automatically by the LearnImpact KiuFunza field dashboard.`);
  return { subject: `KiuFunza 4 · Automated reminder · ${items.length} notice(s) to send · ${title(region)}`, html, text: `AUTOMATED REMINDER\n${items.map((i) => `${i.v.school_name}: ${i.who} ${i.state} (visit ${i.v.date})`).join('\n')}\n${siteUrl}/#plan` };
}

export async function runReminders(env, { dry = true } = {}) {
  const today = eatToday();
  const siteUrl = env.SITE_URL || 'https://kf-assessments.learnimpacttz.workers.dev';
  const recipients = await loadRecipients(env);
  const sendOk = !dry && env.EMAIL_ENABLED === 'true' && env.EMAIL_FROM && (env.RESEND_API_KEY || env.EMAIL);
  const cache = {}, results = [];
  for (const [email, r] of Object.entries(recipients)) {
    if (!['rc', 'arc'].includes(r.role) || !r.region || r.active === false) continue;
    if (r.from && today < r.from) { results.push({ email, skipped: `starts ${r.from}` }); continue; }
    cache[r.region] = cache[r.region] === undefined ? await reminderEmail(env, r.region, today, siteUrl) : cache[r.region];
    const msg = cache[r.region];
    if (!msg) { results.push({ email, skipped: 'nothing to remind' }); continue; }
    if (!sendOk) { results.push({ email, preview: true, subject: msg.subject }); continue; }
    try { await sendMail(env, email, msg); results.push({ email, sent: true }); } catch (e) { results.push({ email, error: String(e && e.message) }); }
  }
  return results;
}
