import { koboForm } from './koboforms.js';
import { listNews, manageNews, react as reactNews, markSeen, saveNews, deleteNews, pinNews, publish as publishNews, runDueNews, checkMilestones, polish as polishNews } from './news.js';
import { ownWork, teamBlock, coordinatorOverview } from './own.js';
import { buildCalendar, markCalendarDirty, syncCalendar, calendarStatus, setCalSync, loadCalSync } from './calendar.js';
import { pupilRecords, workFiles } from './pupils.js';
import { pilotView, pilotSet, PILOT_ALLOC } from './pilot.js';
import { findRecords as findToMove, previewMove, applyMove, correctionsView, correctionCopy } from './corrections.js';
import { qrPng } from './qr.js';
import { codFromYear } from './paymentdata.js';
import { INFRA_WINNERS } from './data/infra_winners.js';
import { attachList, attachFetch, attachDelete, storageView } from './attachments.js';
import { findRecords, listRequests, actOnRequest, copyOf } from './deletions.js';
import { messagesApi, builtinSave, runDueMessages } from './messages.js';
import { formsView, formsRehearse, formsDeploy, formsRollback } from './formsadmin.js';
import { loadFormJob, saveFormJob, runFormJob, maybeRunFormJob } from './formjob.js';
import { kv } from './store.js';
import { buildBrief, aiBrief } from './brief.js';
import { ask as askAssistant, draftReportText } from './assistant.js';
import { computeBridge, buildUpdate, saveSnapshot, listSnapshots, getMilestones, saveMilestones, AUDIENCES } from './bridge.js';
import { sendDm, dmInbox, dmAck, dmSent, askCreate, askList, askAct, askCounts, notesList, notesAct } from './talk.js';
import { layoutsFor, saveLayout } from './layouts.js';
const GUEST_REPORTS = ['region_progress']; // aggregate only: no names, no school results
import { listGuests, guestAction, touchGuest } from './guests.js';
import { recordUsage, recordApi, usageReport } from './usage.js';
import { assignFlags } from './assign.js';
import { isBlocked, recordFail } from './ratelimit.js';
import { listNarr, getNarr, saveNarr, compiledHtml } from './narratives.js';
import { TEMPLATES, buildReport, listReports, getReport, saveReport, deleteReport } from './reports.js';
import { loadHq, hqChange, hqList, hqByCode, codeFor, levelGate, applySettings, settingsView, saveSettings, logActivity, readActivity, activityLabel, BRAND, assistantName } from './hq.js';
import { emailSchedule, hqPersonalCodeEmail, morningDigest, eveningGap, loadRecipients, saveRecipients, runDigests, maybeRunScheduledDigests, sendMail, onboardingEmail, runOnboarding, followupEmail, runFollowup, hqCc, hqOnboardingEmail, reminderEmail, runReminders } from './digest.js';
import { loadQueries, decorate, postQuery, flagKey } from './queries.js';
import { identify, staffCodes, canSeeRegion } from './auth.js';
import { forecast, atRiskSchools } from './predict.js';
import { ensureRoster, changeRoster, rosterOptions } from './roster.js';
import { sealBuf, gzip, runBackup, buildBackup, restoreBackup, maybeRunScheduledBackup, listBackups, readStoredBackup, rawStoredBackup, emailLatestFull } from './backup.js';
import { setValidation, koboWho, getValidation, clearValidation } from './kobo.js';
import { fetchKoboPage } from './kobo.js';
import { subscribe, unsubscribe, takeAlert, hashEndpoint, pushTo, pushStatus, pushReady, runAlerts } from './push.js';
import { tick, syncStatus, recomputeSummaries, resetAll, resetKind, loadState, loadYear, saveYear, stateYears, clearPractice, restartRebuildFrom, seedFirstIds } from './sync.js';
import { getPlan, submitPlan, saveDraft, changeVisit, markNotice, withNotices } from './plan.js';
import {
  devCode as devCodeOf, REGIONS, PARTNERS, REASONS, DAY_REASONS, PRACTICE_BY_ID, PRACTICE_REGION, PLAN_DEADLINE, FIELD_START, FIELD_END, PILOT_DAY, TRAINING_START, CURRENT_YEAR, STAFF, rosterState, addDays, isWorkingDay, staffForKoboName, SCHOOLS_BY_REGION, SCHOOL_BY_ID, eatToday,
  TARGET_PER_GRADE, DODOMA_TARGET_PER_GRADE, NOTICE_AEK_WORKING_DAYS, NOTICE_HT_WORKING_DAYS,
} from './config.js';

const dayCounts = (p) => { const per = {}; for (const v of p.visits || []) per[v.date] = (per[v.date] || 0) + 1; const n = Object.values(per); return { one: n.filter((x) => x === 1).length, two: n.filter((x) => x === 2).length, three: n.filter((x) => x === 3).length }; };
const PRACTICE_SCHOOLS_UI = () => Object.values(PRACTICE_BY_ID).map((s) => ({ id: s.id, name: s.name, lga: s.lga, mne: s.mne }));
const json = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
const err = (message, status = 400, extra = {}) => json({ error: message, ...extra }, status);

// Summaries are read from Workers KV (fast, edge-cached) with a short in-memory copy, and fall back to the
// Durable Object if KV has not been filled yet. Never use this for anything that must be exactly current.
const memo = new Map();
async function readSummary(env, y) {
  const hit = memo.get(y);
  if (hit && Date.now() - hit.t < 20000) return hit.v;
  let v = env.DASHBOARD_KV ? await env.DASHBOARD_KV.get(`sum:${y}`, { type: 'json', cacheTtl: 30 }) : null;
  if (!v) v = await kv(env).get(`v2:sum:${y}`);
  if (v) memo.set(y, { v, t: Date.now() });
  return v;
}
async function readYears(env) {
  const y = env.DASHBOARD_KV ? await env.DASHBOARD_KV.get('years', { type: 'json', cacheTtl: 30 }) : null;
  return y && y.length ? y : (await kv(env).get('v2:years')) || [];
}
let AS_CACHE = { k: '', t: 0, v: null };
async function loadSummary(env, wanted) {
  const years = await readYears(env);
  let year = wanted && years.includes(wanted) ? wanted : years.includes(CURRENT_YEAR) ? CURRENT_YEAR : years[years.length - 1];
  if (!year) return { years, sum: null, year: null, rehearsal: false };
  let sum = await readSummary(env, year);
  // Until the first 2026 test arrives the live year is empty (the teacher baseline alone creates it),
  // so open on the latest earlier year as a clearly marked rehearsal. A person can still pick 2026 directly.
  if (!wanted && year === CURRENT_YEAR && sum && !sum.national.records) {
    const earlier = years.filter((y) => y !== CURRENT_YEAR).pop();
    if (earlier) { year = earlier; sum = await readSummary(env, year); }
  }
  if (sum && year === CURRENT_YEAR) { try { const ck = String(sum.as_of) + eatToday(); const as = (AS_CACHE.k === ck && Date.now() - AS_CACHE.t < 60e3) ? AS_CACHE.v : await assignFlags(env, sum, eatToday()); AS_CACHE = { k: ck, t: Date.now(), v: as }; sum = { ...sum, flags: [...(sum.flags || []), ...as.flags], info: as.info }; } catch { /* the other checks still show */ } }
  return { years, sum, year, rehearsal: year !== CURRENT_YEAR };
}

// Region-level numbers anyone may see (no names, no pupil data).
function publicView(sum) {
  const regions = Object.values(sum.regions).map((r) => ({
    region: r.region, total: r.total, done: r.done, started: r.started, tested: r.tested, target: r.target,
    pace: r.pace, projected: r.projected, behind: Boolean(r.behind), series: r.series,
    partner: Object.entries(PARTNERS).find(([, rs]) => rs.includes(r.region))?.[0] || null,
  }));
  const n = sum.national;
  return { national: { schools: n.schools, done: n.done, started: n.started, tested: n.tested, target: n.target, pace: n.pace, projected: n.projected, series: n.series }, regions };
}

const schoolRow = (s) => ({
  id: s.id, name: s.name, lga: s.lga, ward: s.ward, arm: s.arm, mne: s.mne, g: s.g, started: s.started, done: s.done,
  first: s.first, last: s.last, dates: s.dates, admins: s.admins, max_team: s.maxTeam, max_devices: s.people ? Math.max(0, ...Object.values(s.people).map((p) => p[1])) : 0, people: s.people || null, teacher_forms: s.tf,
});

function rankAdmins(admins) {
  return admins.filter((a) => a.quality !== null).sort((a, b) => b.quality - a.quality || b.tested - a.tested);
}

function regionBundle(sum, region, who, queries = {}) {
  const schools = (SCHOOLS_BY_REGION[region] || []).map((s) => schoolRow(sum.schools[s.id]));
  const admins = sum.admins.filter((a) => a.region === region);
  const flags = decorate(sum.flags.filter((f) => SCHOOL_BY_ID[f.school]?.region === region).map((f) => ({ ...f, school_name: SCHOOL_BY_ID[f.school]?.name, region, lga: SCHOOL_BY_ID[f.school]?.lga, ward: SCHOOL_BY_ID[f.school]?.ward })), queries);
  const staff = STAFF.filter((s) => s.active && s.region === region).map((s) => ({ id: s.id, name: s.name, position: s.position, role: s.role }));
  const work = Object.fromEntries(admins.map((a) => [a.name, sum.work[a.name] || []]));
  return { region: sum.regions[region], schools, admins, flags: [...flags, ...pilotFlags(sum, queries, region)], staff, work_all: work };
}

// pilot-day flags (real 2026 data at the five Dodoma schools) belong to the regional team of the person they are about
function pilotFlags(sum, queries, region) {
  const names = new Set(sum.admins.filter((a) => a.region === region).map((a) => a.name));
  return decorate(sum.flags.filter((f) => PILOT_ALLOC[f.school] && String(f.admin || '').split(' and ').some((n) => names.has(n))).map((f) => ({ ...f, school_name: SCHOOL_BY_ID[f.school]?.name, region: SCHOOL_BY_ID[f.school]?.region, lga: SCHOOL_BY_ID[f.school]?.lga, ward: SCHOOL_BY_ID[f.school]?.ward, pilot: true })), queries);
}
export { Store } from './store.js';

// phone alerts for the next person in the chain
async function notifyQuery(env, n) {
  const hq = (await loadHq(env)).users.filter((u) => u.active !== false && u.level !== 'viewer');
  const ids = (min) => new Set(hq.filter((u) => (u.review_level || 0) >= min).map((u) => 'hq:' + u.id));
  const coord = (w) => (w.role === 'rc' || w.role === 'arc') && w.region === n.region;
  const reg = n.region ? n.region[0] + n.region.slice(1).toLowerCase() : '';
  if (n.to_stage === 'approved') { const ppl = new Set((n.people || []).map(String)); await pushTo(env, (w) => ppl.has(String(w.id)) || ppl.has(String(w.id).replace(/^hq:/, '')), { title: 'Query cleared', body: `The query you were part of${n.school ? ' (' + (SCHOOL_BY_ID[n.school]?.name || n.school) + ')' : ''} is approved and moved to history. You can read the whole journey there.`, url: '/#allq' }); return; }
  if (n.to_stage === 'remind') await pushTo(env, (w) => w.id === n.responder_id, { title: 'A query needs your response', body: `${n.reviewer || 'Your coordinator'} asks you to open the query and write what happened. Your coordinator will then review it.`, url: '/#allq' });
  else if (n.to_stage === 'team') await pushTo(env, (w) => coord(w) && w.id !== n.author_id, { title: 'A response is waiting for your review', body: `A team member answered a query in ${reg}. Approve, edit or send it back.`, url: '/#allq' });
  else if (n.to_stage === 'hq1') { const s = ids(2); await pushTo(env, (w) => w.role === 'hq' && s.has(w.id), { title: 'First HQ review waiting', body: `A query response from ${reg} is ready for your review.`, url: '/#allq' }); }
  else if (n.to_stage === 'final') { const s = ids(3); await pushTo(env, (w) => w.role === 'hq' && s.has(w.id), { title: 'Final approval waiting', body: `A query response from ${reg} is ready for final approval.`, url: '/#allq' }); }
  else if (n.to_stage === 'rework') await pushTo(env, (w) => w.id === n.responder_id || coord(w), { title: 'Response sent back', body: `${n.reviewer || 'A reviewer'} sent a query response back for rework. Open it to see why.`, url: '/#queries' });
  else if (n.to_stage === 'approved') await pushTo(env, (w) => w.id === n.responder_id || coord(w), { title: 'Response approved', body: 'A query response went through every review and is approved.', url: '/#queries' });
}

// ---- the HQ Bridge ----
const BR = new Map();
async function bridgeFor(env, who, force = false) {
  const key = String(who.id) + ':' + (who.review_level || 0); const hit = BR.get(key); if (!force && hit && Date.now() - hit.t < 30000) return hit.v;
  const { sum } = await loadSummary(env, CURRENT_YEAR); if (!sum) return null; const today = eatToday();
  let quota = null; try { const st = await storageView(env); const ser = ((sum.national && sum.national.series) || []).filter((x) => x[0] >= FIELD_START).slice(-5); const per = ser.length >= 3 ? Math.round((ser.reduce((a, x) => a + x[1], 0) / ser.length) * 1.1) : 0; /* real field days only: the pilot day is one big spike */ if (st && st.submissions_limit != null) { quota = { used: st.submissions_period, limit: st.submissions_limit, per_day: per, runs_out: null }; if (per > 0) { let left = Math.max(0, st.submissions_limit - st.submissions_period), d = today; while (left > 0 && d < '2027-03-01') { d = addDays(d, 1); if (isWorkingDay(d)) left -= per; } if (left <= 0) quota.runs_out = d; } } } catch { /* the Bridge works without it */ }
  let pred = null; try { pred = { ...(await forecast(env, sum, today)), at_risk: await atRiskSchools(env, sum, today, null) }; } catch { /* optional */ }
  const v = { br: await computeBridge(env, who, { sum, queries: await loadQueries(env), today, quota, pred }), sum }; BR.set(key, { t: Date.now(), v }); return v;
}
async function mondayDraft(env) {
  const day = eatToday(); const ran = (await kv(env).get('v2:bridge:ran')) || {}; if (ran.monday === day) return null; ran.monday = day; await kv(env).put('v2:bridge:ran', ran);
  const sys = { role: 'hq', level: 'admin', review_level: 3, name: 'Command Center', id: 'system' }; const v = await bridgeFor(env, sys, true); if (!v) return null;
  const u = await buildUpdate(env, 'ed', v.br, v.sum.national ? v.sum : v.sum); await saveSnapshot(env, sys, { audience: 'ed', text: u.text, numbers: u.numbers, draft: true });
  const bs = (await kv(env).get('v2:bridge:settings')) || { ed_email: true }; const hq = (await loadHq(env)).users.find((x) => x.id === 'h3'); let emailed = false;
  if (bs.ed_email !== false && hq && hq.email && env.EMAIL_ENABLED === 'true') { await sendMail(env, hq.email, { subject: `Your Monday update draft · ${day}`, html: `<pre style="font:14px/1.5 system-ui,sans-serif;white-space:pre-wrap">${u.text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre><p>Edit and save it in the Command Center: Bridge, Management update.</p>`, text: u.text + '\n\nEdit and save it in the Command Center: Bridge, Management update.' }).catch(() => {}); emailed = true; }
  return { drafted: true, emailed };
}
// headers every response carries
function secure(res) {
  try { const r = new Response(res.body, res); const h = r.headers; h.set('X-Content-Type-Options', 'nosniff'); h.set('X-Frame-Options', 'DENY'); h.set('Referrer-Policy', 'no-referrer'); h.set('Strict-Transport-Security', 'max-age=31536000'); h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()'); h.set('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'"); return r; } catch { return res; }
}
export default {
  // every write is noted in the activity log (who, what, when) after it succeeds
  async fetch(request, env, ctx) {
    const url0 = new URL(request.url); const mut = request.method === 'POST' && url0.pathname.startsWith('/api/');
    let bodyText = ''; if (mut) { try { bodyText = await request.clone().text(); } catch { /* the handler reports a bad body */ } }
    const res = await this.handle(request, env, ctx);
    if (mut && res.status < 300) {
      const job = (async () => { try { let body = {}; try { body = JSON.parse(bodyText || '{}'); } catch { /* not json */ } const lab = activityLabel(url0.pathname, body); if (lab) { const who = await identify(request, env); if (who && !who.viewAs) await logActivity(env, who, lab.action, lab.detail); } } catch { /* logging never blocks the work */ } })();
      if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
    }
    return secure(res);
  },

  async handle(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    await ensureRoster(env);
    await applySettings(env);

    try {
      if (path === '/api/qr.png') { const png = await qrPng(env.SITE_URL || 'https://kf-assessments.learnimpacttz.workers.dev'); return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } }); }
      if (path === '/api/config') {
        return json({
          brand: { ...BRAND, assistant: assistantName() },
          year: CURRENT_YEAR, field: { start: FIELD_START, end: FIELD_END }, pilot_day: PILOT_DAY, training_start: TRAINING_START, regions: REGIONS, partners: PARTNERS, reasons: REASONS, day_reasons: DAY_REASONS,
          targets: { per_grade: TARGET_PER_GRADE, dodoma_per_grade: DODOMA_TARGET_PER_GRADE },
          notice: { aek_working_days: NOTICE_AEK_WORKING_DAYS, head_teacher_working_days: NOTICE_HT_WORKING_DAYS },
          today: eatToday(),
        });
      }

      if (path === '/api/public') {
        const { years, sum, year, rehearsal } = await loadSummary(env, url.searchParams.get('year'));
        if (!sum) return json({ status: 'waiting', years });
        return json({ status: 'ok', year, years, rehearsal, as_of: sum.as_of, ...publicView(sum) });
      }

      if (path === '/api/push/config') return json({ public_key: env.VAPID_PUBLIC || null, ready: pushReady(env) });
      if (path === '/api/push/alert') return json(await takeAlert(env, (url.searchParams.get('h') || '').slice(0, 40)));

      const ip = request.headers.get('cf-connecting-ip') || '';
      if (request.headers.get('x-access-code') && (await isBlocked(env, ip))) return err('Too many wrong codes from this network. Please wait 15 minutes and try again.', 429);
      const who = await identify(request, env);
      if (!who && request.headers.get('x-access-code')) ctx?.waitUntil?.(recordFail(env, ip).catch(() => {}));

      if (path === '/api/login') {
        if (!who) return err('That code was not recognized', 401);
        return json({ who });
      }
      if (who && who.expired) return err('This invitation has ended. Please ask LearnImpact for a new one.', 401);
      if (!who) return err('Sign in with your access code', 401);
      if (who.role === 'guest') { // guests see public-facing pages only and change nothing
        if (!who.viewAs) ctx?.waitUntil?.(touchGuest(env, who.id).catch(() => {}));
        const okPath = path === '/api/login' || path === '/api/public' || path === '/api/layouts' || path.startsWith('/api/guest/') || (path === '/api/usage' && method === 'POST');
        if (!okPath || (method !== 'GET' && path !== '/api/usage')) return err('This page is not part of your guest access', 403);
        if (path === '/api/public') { /* falls through to the shared public handler below */ }
      }
      { const gate = levelGate(who, method, path); if (gate) return err(gate, 403); }
      if (path.startsWith('/api/') && who.role === 'hq' && /claude|assistant/i.test(who.name || '') && path !== '/api/usage') ctx?.waitUntil?.(recordApi(env, who).catch(() => {})); // tools and AI assistants are tracked too
      if (who.viewAs && method !== 'GET') return err('You are previewing as ' + who.name + '. Previews are read-only, so nothing was changed.', 403);

      // ---------- role-aware overview ----------
      if (path === '/api/overview') {
        const { years, sum, year, rehearsal } = await loadSummary(env, url.searchParams.get('year'));
        const planDue = (who.role === 'rc' || who.role === 'arc') && who.region ? { deadline: PLAN_DEADLINE, locked: (await getPlan(env, who.region)).status === 'locked' } : null;
        if (!sum) return json({ status: 'waiting', who, years, plan_due: planDue });
        const queries = await loadQueries(env);
        const base = { status: 'ok', who, year, years, rehearsal, as_of: sum.as_of, today: eatToday(), bands: sum.bands, plan_due: planDue, ...publicView(sum) };
        if (who.role === 'hq') {
          const feed = []; const allPlans = await Promise.all(REGIONS.map((r) => getPlan(env, r))); // read each plan once
          allPlans.forEach((p, k) => { for (const c of p.changes || []) feed.push({ at: c.at, region: REGIONS[k], by: c.by, school: c.school, school_name: SCHOOL_BY_ID[c.school]?.name, from: c.from?.date, to: c.to?.date, reason: c.reason, note: c.note, late: c.late }); });
          base.calendar_changes = feed.sort((x, y) => (y.at > x.at ? 1 : -1)).slice(0, 40);
          const plans = {};
          allPlans.forEach((p, k) => { plans[REGIONS[k]] = { status: p.status, visits: p.visits.length, changes: p.changes.length, late_changes: p.changes.filter((c) => c.late).length, submitted_at: p.submitted_at, days_one: dayCounts(p).one, days_three: dayCounts(p).three }; });
          const plansAll = Object.fromEntries(REGIONS.map((rg, i) => [rg, allPlans[i]]));
          const flagsByRegion = {}; for (const rg of REGIONS) flagsByRegion[rg] = decorate(sum.flags.filter((f) => SCHOOL_BY_ID[f.school]?.region === rg), queries);
          const coord = coordinatorOverview({ sum, queries, today: eatToday(), plans: plansAll, flagsByRegion });
          return json({ ...base, ...coord, staff: STAFF.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, position: s.position, region: s.region, role: s.role })), admins: sum.admins, flags: decorate(sum.flags.map((f) => ({ ...f, school_name: SCHOOL_BY_ID[f.school]?.name, region: SCHOOL_BY_ID[f.school]?.region, lga: SCHOOL_BY_ID[f.school]?.lga, ward: SCHOOL_BY_ID[f.school]?.ward })), queries).slice(0, 600), plans, unlisted: sum.admins.filter((a) => a.role === 'unlisted').map((a) => a.name) });
        }
        if (who.role === 'rc' || who.role === 'arc') {
          const bundle = regionBundle(sum, who.region, who, queries);
          const plan = await getPlan(env, who.region);
          const ctx = { sum, plan, queries, flags: bundle.flags, today: eatToday() };
          const me = STAFF.find((s) => s.id === who.id);
          return json({ ...base, mine: { ...bundle, own: me ? ownWork(ctx, me) : null, team_block: teamBlock(ctx, who.region), arc_own: who.role === 'rc' ? (() => { const a = STAFF.find((s) => s.active && s.region === who.region && s.role === 'arc'); return a ? ownWork(ctx, a) : null; })() : null } });
        }
        // volunteer: own numbers, own queries, own work, and region ranks
        const me = sum.admins.find((a) => a.staff_id === who.id) || null;
        const bundle = regionBundle(sum, who.region, who, queries);
        const myName = me?.name || who.name;
        // where this person stands on sending records early, among people in the region (earliest first)
        const peers = sum.admins.filter((a) => a.region === who.region && a.sub_all && a.sub_all.n >= 3).sort((x, y) => (y.sub_all.same_pct - x.sub_all.same_pct) || ((x.sub_all.avg_h ?? 1e9) - (y.sub_all.avg_h ?? 1e9)));
        const pos = peers.findIndex((a) => a.staff_id === who.id);
        const mine = {
          sub_rank: pos >= 0 ? { pos: pos + 1, of: peers.length } : null,
          region: bundle.region, me, schools: bundle.schools,
          work: sum.work[myName] || [],
          flags: bundle.flags.filter((f) => f.admin === myName),
          staff: bundle.staff,
        };
        return json({ ...base, mine });
      }

      if (path === '/api/region') {
        const region = (url.searchParams.get('region') || who.region || '').toUpperCase();
        if (!REGIONS.includes(region) || !canSeeRegion(who, region)) return err('Not your region', 403);
        const { sum } = await loadSummary(env, url.searchParams.get('year'));
        if (!sum) return json({ schools: [] });
        return json({ schools: (SCHOOLS_BY_REGION[region] || []).map((s) => ({ ...schoolRow(sum.schools[s.id]), region })) });
      }

      if (path === '/api/kobo/status' && method === 'POST') {
        if (who.role === 'volunteer') return err('Only coordinators and HQ can do this', 403);
        const b = await request.json();
        const ids = [...new Set((b.ids || []).map(Number).filter((n) => Number.isFinite(n)))].slice(0, 40);
        if (!ids.length || !['approved', 'not_approved', 'on_hold'].includes(b.status)) return err('Choose submissions and a status', 422);
        const { sum, year } = await loadSummary(env, b.year || null);
        // only submissions named in a query inside this person's own region may be changed
        const allowed = new Set((sum?.flags || []).filter((f) => who.role === 'hq' || SCHOOL_BY_ID[f.school]?.region === who.region).flatMap((f) => (f.recs || []).map((r) => Number(r[5]))));
        const bad = ids.filter((n) => !allowed.has(n));
        if (bad.length) return err('Some submissions are not part of a query you can act on', 403);
        const result = await setValidation(env.KOBO_SERVER || 'kf.kobotoolbox.org', env.KOBO_ASSET_ID, env.KOBO_TOKEN, ids, b.status);
        const log = (await kv(env).get('v2:kobolog')) || [];
        log.push({ at: new Date().toISOString(), by: who.name, status: b.status, ids, year });
        await kv(env).put('v2:kobolog', log.slice(-200));
        return json({ ok: true, updated: ids.length, status: b.status });
      }
      // ---------- the assistant: HQ only (all levels), read-only ----------
      if (path === '/api/assistant' && method === 'POST') {
        if (who.role !== 'hq') return err('The assistant is for the HQ team for now', 403);
        const b = await request.json().catch(() => ({}));
        const ld = await loadSummary(env, null); const plans = Object.fromEntries(await Promise.all(REGIONS.map(async (r) => [r, await getPlan(env, r)])));
        try { const r = await askAssistant(env, who, b.messages, { sum: ld.sum, year: ld.year, rehearsal: ld.rehearsal, queries: await loadQueries(env), plans, today: eatToday() }); if (r.error) return err(r.error, 422); await logActivity(env, who, 'Asked the assistant', String((b.messages || []).slice(-1)[0]?.content || '').slice(0, 120)); return json(r); } catch (e) { return err(String(e.message || e), 502); }
      }
      if (path === '/api/assistant/draft' && method === 'POST') {
        if (who.role !== 'hq') return err('The assistant is for the HQ team for now', 403);
        try { const r = await draftReportText(env, who, await request.json().catch(() => ({}))); return r.error ? err(r.error, 422) : json(r); } catch (e) { return err(String(e.message || e), 502); }
      }
      if (path === '/api/assign-info') { // for information only: helpers, grade differences, planned people with no records
        if (who.role === 'volunteer') return json({ items: [] });
        const { sum } = await loadSummary(env, CURRENT_YEAR); return json({ items: ((sum && sum.info) || []).filter((x) => who.role === 'hq' || x.region === who.region) });
      }
      // ---------- the HQ Bridge ----------
      if (path.startsWith('/api/bridge')) {
        if (who.role !== 'hq') return err('HQ only', 403);
        try {
          if (path === '/api/bridge') { const v = await bridgeFor(env, who, url.searchParams.get('fresh') === '1'); return v ? json(v.br) : json({ status: 'waiting' }); }
          if (path === '/api/bridge/update') { const v = await bridgeFor(env, who); if (!v) return err('No data yet', 404); const aud = url.searchParams.get('audience') || 'ed'; const u = await buildUpdate(env, aud, v.br, v.sum); return json({ audience: aud, audiences: AUDIENCES, ...u }); }
          if (path === '/api/bridge/snapshots') return json({ items: await listSnapshots(env) });
          if (path === '/api/bridge/snapshot' && method === 'POST') { if ((who.level || 'admin') === 'viewer') return err('Not allowed', 403); const b = await request.json().catch(() => ({})); return json(await saveSnapshot(env, who, b)); }
          if (path === '/api/bridge/milestones' && method === 'GET') return json({ milestones: await getMilestones(env), settings: (await kv(env).get('v2:bridge:settings')) || { ed_email: true } });
          if (path === '/api/bridge/ops') {
            if (method === 'GET') return json({ items: (await kv(env).get('v2:bridge:ops')) || [] });
            if (method === 'POST') { if ((who.level || 'admin') === 'viewer') return err('Not allowed', 403); const b = await request.json().catch(() => ({})); const clean = (Array.isArray(b.items) ? b.items : []).slice(0, 40).map((x, i) => ({ id: String(x.id || 'o' + Date.now() + i).replace(/[^a-z0-9_]/gi, '').slice(0, 24), title: String(x.title || '').trim().slice(0, 100), owner: String(x.owner || '').trim().slice(0, 50), due: /^\d{4}-\d\d-\d\d$/.test(x.due || '') ? x.due : '', status: ['not started', 'in progress', 'blocked', 'done'].includes(x.status) ? x.status : 'not started', note: String(x.note || '').trim().slice(0, 200) })).filter((x) => x.title); await kv(env).put('v2:bridge:ops', clean); return json({ ok: true, items: clean }); }
          }
          if (path === '/api/bridge/milestones' && method === 'POST') { const b = await request.json().catch(() => ({})); if (b.ed_email !== undefined) { if ((who.level || 'admin') !== 'admin') return err('Only an HQ Admin', 403); await kv(env).put('v2:bridge:settings', { ed_email: Boolean(b.ed_email) }); } if (b.milestones) { const r = await saveMilestones(env, who, b.milestones); if (r.error) return err(r.error, r.status || 422); } BR.clear(); return json({ ok: true }); }
        } catch (e) { return err(String(e.message || e), 500); }
        return err('Not found', 404);
      }
      // ---------- narrative report per school (RC/ARC write, HQ and the region read) ----------
      if (path.startsWith('/api/narratives')) {
        if (!(who.role === 'hq' || who.role === 'rc' || who.role === 'arc')) return err('Not allowed', 403);
        const region = String(url.searchParams.get('region') || who.region || '').toUpperCase();
        try {
          if (path === '/api/narratives' && method === 'GET') { const { sum } = await loadSummary(env, CURRENT_YEAR); const r = await listNarr(env, who, region, sum); return r.error ? err(r.error, r.status || 422) : json(r); }
          if (path === '/api/narratives/school' && method === 'GET') { const r = await getNarr(env, who, url.searchParams.get('school') || ''); return r.error ? err(r.error, r.status || 422) : json(r); }
          if (path === '/api/narratives' && method === 'POST') { const r = await saveNarr(env, who, await request.json().catch(() => ({}))); return r.error ? err(r.error, r.status || 422) : json(r); }
          if (path === '/api/narratives/compiled' && method === 'GET') {
            const regs = url.searchParams.get('region') ? [region] : (who.role === 'hq' ? REGIONS : [who.region]); const { sum } = await loadSummary(env, CURRENT_YEAR);
            const plans = Object.fromEntries(await Promise.all(regs.map(async (r) => [r, await getPlan(env, r)])));
            return new Response(await compiledHtml(env, who, regs, sum, plans, eatToday()), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
          }
        } catch (e) { return err(String(e.message || e), 500); }
        return err('Not found', 404);
      }
      // ---------- guides and manuals (staff only; kept inside the system, not on a public link) ----------
      if (path === '/api/docs') { const meta = (await kv(env).get('v2:docs')) || {}; return json({ docs: Object.entries(meta).filter(([, m]) => !m.hq_only || who.role === 'hq').map(([id, m]) => ({ id, ...m })).sort((a, b) => (a.order || 9) - (b.order || 9)) }); }
      if (path === '/api/docs/file') { const id = (url.searchParams.get('id') || '').replace(/[^a-z]/g, ''); const meta = ((await kv(env).get('v2:docs')) || {})[id]; const buf = meta && (!meta.hq_only || who.role === 'hq') && env.DASHBOARD_KV ? await env.DASHBOARD_KV.get('doc:' + id, 'arrayBuffer') : null; if (!buf) return err('Not found', 404); return new Response(buf, { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'content-disposition': `attachment; filename="${meta.filename}"`, 'cache-control': 'no-store' } }); }
      if (path === '/api/admin/doc' && method === 'POST') {
        if (!(who.role === 'hq' && (who.level || 'admin') === 'admin' && !who.viewAs)) return err('Only an HQ Admin can publish documents', 403);
        const id = (url.searchParams.get('id') || '').replace(/[^a-z]/g, ''); if (!id) return err('Give an id', 422); const buf = await request.arrayBuffer(); if (!buf.byteLength || buf.byteLength > 20 * 1024 * 1024) return err('The file is empty or too large', 422);
        await env.DASHBOARD_KV.put('doc:' + id, buf); const meta = (await kv(env).get('v2:docs')) || {};
        meta[id] = { title: url.searchParams.get('title') || id, version: url.searchParams.get('version') || '', filename: (url.searchParams.get('filename') || id + '.docx').replace(/[^A-Za-z0-9._\- ]/g, ''), order: Number(url.searchParams.get('order')) || 9, hq_only: url.searchParams.get('hq') === '1', size: buf.byteLength, updated: new Date().toISOString(), by: who.name };
        await kv(env).put('v2:docs', meta); return json({ ok: true, id, size: buf.byteLength });
      }
      // ---------- guest pages: public-facing reports only ----------
      if (path === '/api/guest/reports') { return json({ reports: GUEST_REPORTS.map((id) => { const t = TEMPLATES.find((x) => x.id === id); return { id, title: t?.title || id, desc: t?.desc || '' }; }), can_download: Boolean(who.can_download) }); }
      if (path === '/api/guest/report') {
        const id = url.searchParams.get('id') || ''; if (!GUEST_REPORTS.includes(id)) return err('Not found', 404);
        const ld = await loadSummary(env, CURRENT_YEAR); const plans = Object.fromEntries(await Promise.all(REGIONS.map(async (r) => [r, await getPlan(env, r)])));
        const b = buildReport(id, { sum: ld.sum, year: ld.year, rehearsal: ld.rehearsal, queries: await loadQueries(env), plans, today: eatToday() }, {}, null);
        return json({ ...b, can_download: Boolean(who.can_download) });
      }
      if (path === '/api/admin/guests') {
        if (!(who.role === 'hq' && (who.level || 'admin') === 'admin')) return err('Only an HQ Admin can manage guests', 403);
        if (method === 'POST') { const r = await guestAction(env, who, await request.json().catch(() => ({}))); return r.error ? err(r.error, r.status || 422) : json(r); }
        return json(await listGuests(env));
      }
      // ---------- reports: HQ (all levels) and RCs for their own region; not ARCs or volunteers ----------
      if (path.startsWith('/api/reports')) {
        if (!(who.role === 'hq' || who.role === 'rc' || who.role === 'arc')) return err('Reports are for HQ and the coordinators', 403);
        const scope = who.role === 'hq' ? null : who.region;
        const ctxFor = async (params) => { const ld = await loadSummary(env, params.year || null); const plans = Object.fromEntries(await Promise.all(REGIONS.map(async (r) => [r, await getPlan(env, r)]))); return { sum: ld.sum, year: ld.year, rehearsal: ld.rehearsal, queries: await loadQueries(env), plans, today: eatToday() }; };
        if (path === '/api/reports/templates') return json({ templates: TEMPLATES.filter((t) => who.role === 'hq' || (t.who === 'both' && t.rc)), scope });
        if (path === '/api/reports' && method === 'GET') return json({ reports: await listReports(env, who) });
        if (path === '/api/reports/item') { const r = await getReport(env, who, url.searchParams.get('id') || ''); return r ? json(r) : err('Not found', 404); }
        const b = method === 'POST' ? await request.json().catch(() => ({})) : {};
        if (path === '/api/reports/preview' && method === 'POST') { const t = TEMPLATES.find((x) => x.id === b.template); if (!t || (who.role !== 'hq' && !(t.who === 'both' && t.rc))) return err('Choose a report', 422); return json(buildReport(b.template, await ctxFor(b.params || {}), b.params || {}, scope)); }
        if (path === '/api/reports/save' && method === 'POST') { const t = TEMPLATES.find((x) => x.id === b.template); if (!t || (who.role !== 'hq' && !(t.who === 'both' && t.rc))) return err('Choose a report', 422); const built = buildReport(b.template, await ctxFor(b.params || {}), b.params || {}, scope); const r = await saveReport(env, who, b, built); return r.error ? err(r.error, r.status || 422) : json(r); }
        if (path === '/api/reports/delete' && method === 'POST') { const r = await deleteReport(env, who, b.id); return r.error ? err(r.error, r.status || 422) : json(r); }
      }
      if (path === '/api/news' && method === 'GET') return json(await listNews(env, who));
      if (path === '/api/news/seen' && method === 'POST') { const b = await request.json().catch(() => ({})); return json(await markSeen(env, who, b.ids)); }
      if (path === '/api/news/react' && method === 'POST') { const b = await request.json().catch(() => ({})); const r = await reactNews(env, who, b.id, b.emoji); return r.error ? err(r.error, r.status || 400) : json(r); }
      if (path === '/api/layouts' && method === 'GET') { const rk = who.role === 'arc' ? 'rc' : who.role === 'guest' ? 'guest_' + who.profile : who.role; return json(await layoutsFor(env, who, rk)); }
      if (path === '/api/layouts' && method === 'POST') { const r = await saveLayout(env, who, await request.json().catch(() => ({}))); return r.error ? err(r.error, r.status || 422) : json(r); }
      // ---------- direct messages, questions to HQ, HQ-only notes ----------
      if (path.startsWith('/api/dm') || path.startsWith('/api/ask') || path.startsWith('/api/hqnotes')) {
        const send = (r) => (r.error ? err(r.error, r.status || 422) : json(r));
        try {
          if (path === '/api/dm' && method === 'POST') return send(await sendDm(env, who, await request.json().catch(() => ({}))));
          if (path === '/api/dm/inbox') return json(await dmInbox(env, who));
          if (path === '/api/dm/ack' && method === 'POST') return send(await dmAck(env, who, (await request.json().catch(() => ({}))).id));
          if (path === '/api/dm/sent') return send(await dmSent(env, who, { person: url.searchParams.get('person') || '' }));
          if (path === '/api/ask/counts') return json(await askCounts(env, who));
          if (path === '/api/ask' && method === 'GET') return json(await askList(env, who));
          if (path === '/api/ask' && method === 'POST') { const b = await request.json().catch(() => ({})); return send(b.action === 'create' ? await askCreate(env, who, b) : await askAct(env, who, b)); }
          if (path === '/api/hqnotes' && method === 'GET') return send(await notesList(env, who, url.searchParams.get('target') || ''));
          if (path === '/api/hqnotes' && method === 'POST') return send(await notesAct(env, who, await request.json().catch(() => ({}))));
        } catch (e) { return err(String(e.message || e), 500); }
        return err('Not found', 404);
      }
      if (path === '/api/usage' && method === 'POST') { const b = await request.json().catch(() => ({})); await recordUsage(env, who, b); return json({ ok: true }); }
      if (path === '/api/usage/report') { const r = await usageReport(env, who); return r.error ? err(r.error, r.status || 403) : json(r); }
      if (path === '/api/push/subscribe' && method === 'POST') {
        const b = await request.json();
        const r = await subscribe(env, who, b.subscription);
        return r.error ? err(r.error) : json(r);
      }
      if (path === '/api/push/unsubscribe' && method === 'POST') { const b = await request.json(); await unsubscribe(env, b.endpoint || ''); return json({ ok: true }); }
      if (path === '/api/predict') {
        const { sum } = await loadSummary(env, CURRENT_YEAR);
        if (!sum) return json({ status: 'waiting' });
        const f = await forecast(env, sum, eatToday());
        const region = who.role === 'hq' ? (url.searchParams.get('region') || null) : who.region;
        const risk = who.role === 'volunteer' ? [] : await atRiskSchools(env, sum, eatToday(), region);
        return json({ ...f, at_risk: risk });
      }

      if (path === '/api/query' && method === 'POST') {
        const body = await request.json();
        const school = String(body.key || '').split('|')[1];
        const sch = SCHOOL_BY_ID[school] || PRACTICE_BY_ID[school];
        if (!sch || (!sch.practice && !canSeeRegion(who, sch.region) && !(PILOT_ALLOC[school] || []).includes(who.region))) return err('Not your region', 403); // practice schools are open to everyone
        const r = await postQuery(env, who, body);
        if (r.error) return err(r.error, r.status || 400);
        if (r.notify) { const job = notifyQuery(env, r.notify).catch(() => {}); if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job; }
        return json({ q: r.q });
      }

      if (path === '/api/brief') {
        const region = who.role === 'hq' ? (url.searchParams.get('region') || null) : who.region;
        const { sum } = await loadSummary(env, null);
        const brief = await buildBrief(env, sum, eatToday(), region);
        const ai = who.role === 'volunteer' ? null : await aiBrief(env, brief, region || 'national').catch(() => null);
        return json({ ...brief, ai, ai_enabled: Boolean(env.ANTHROPIC_API_KEY) });
      }

      if (path === '/api/schools') {
        const { sum } = await loadSummary(env, url.searchParams.get('year'));
        if (!sum) return json({ schools: [] });
        const rows = (who.role === 'hq' ? REGIONS : [who.region]).flatMap((r) => (SCHOOLS_BY_REGION[r] || []).map((s) => ({ ...schoolRow(sum.schools[s.id]), region: r })));
        return json({ schools: rows });
      }
      if (path === '/api/work') {
        const { sum } = await loadSummary(env, url.searchParams.get('year'));
        const name = url.searchParams.get('name') || '';
        const a = sum?.admins?.find((x) => x.name === name);
        if (!a) return json({ work: [] });
        if (who.role === 'volunteer' && a.staff_id !== who.id) return err('Not yours', 403);
        if (who.role !== 'hq' && a.region !== who.region) return err('Not your region', 403);
        return json({ work: sum.work[name] || [], days: sum.days?.[name] || [] });
      }

      // ---------- teacher data (baseline school visits) and the links between sources ----------
      if (path === '/api/teachers' || path === '/api/linked') {
        if (who.role === 'volunteer') return err('Not available to test admins', 403);
        const regs = who.role === 'hq' ? REGIONS : [who.region];
        const base = await loadSummary(env, CURRENT_YEAR);               // teacher forms are the 2026 baseline
        const live = await loadSummary(env, url.searchParams.get('year')); // assessments/sampling: selected year (rehearsal until 2026 tests exist)
        if (!base.sum) return json({ status: 'waiting' });
        const baseSchools = regs.flatMap((r) => (SCHOOLS_BY_REGION[r] || []).map((s) => base.sum.schools[s.id]).filter(Boolean));
        const wm = await kv(env).get('v2:wm:teachers');
        const sources = { teachers: { records: baseSchools.reduce((a, s) => a + (s.tch ? s.tch.n : 0), 0), updated: wm?.done_at || wm?.last_check || null, phase: 'Baseline 2026' }, assessments: { year: live.year, rehearsal: live.rehearsal, updated: live.sum?.as_of || null, phase: 'Endline ' + (live.year || '') } };
        if (path === '/api/teachers') {
          const roll = {};
          for (const s of baseSchools) {
            const R = (roll[s.region] ||= { region: s.region, expected: 0, with_forms: 0, teachers: 0, head: 0, subj: 0, male: 0, female: 0, smart: 0, replaced: 0, enrol: { 1: [0, 0, 0], 2: [0, 0, 0], 3: [0, 0, 0] }, weo: { 1: 0, 2: 0, 3: 0 }, gaps: { r1: 0, a1: 0, r2: 0, a2: 0, r3: 0, a3: 0 }, nt: 0, nkf: 0, nsch_nt: 0 });
            if (s.arm !== 'Control') R.expected += 1;
            const t = s.tch; if (!t) continue;
            R.with_forms += 1; R.teachers += t.n; R.head += t.head; R.subj += t.subj; R.male += t.male; R.female += t.female; R.smart += t.smart; R.replaced += t.replaced;
            if (t.enrol) for (const g of [1, 2, 3]) if (t.enrol[g]) for (let k = 0; k < 3; k++) R.enrol[g][k] += t.enrol[g][k];
            if (t.weo) R.weo[t.weo] = (R.weo[t.weo] || 0) + 1;
            for (const g of [1, 2, 3]) { if (!t.teach[g].r) R.gaps['r' + g] += 1; if (!t.teach[g].a) R.gaps['a' + g] += 1; }
            if (t.nt != null) { R.nt += t.nt; R.nkf += t.nkf || 0; R.nsch_nt += 1; }
          }
          const schools = baseSchools.filter((s) => s.arm !== 'Control' || s.tch).map((s) => ({ id: s.id, name: s.name, region: s.region, lga: s.lga, arm: s.arm, mne: s.mne, t: s.tch || null }));
          return json({ status: 'ok', sources, regions: Object.values(roll), schools });
        }
        // linked: coverage + enrollment vs attendance for everyone with access; results by grade and subject for HQ only
        const out = { status: 'ok', sources, coverage: [], attendance: [], hq_only: who.role === 'hq' };
        const cov = {};
        for (const s of baseSchools) {
          const L = live.sum?.schools?.[s.id];
          const c = (cov[s.region] ||= { region: s.region, expected_teacher: 0, with_teacher: 0, assessed: 0, assessed_no_teacher: 0, teacher_not_assessed: 0 });
          const expected = s.arm !== 'Control'; if (expected) c.expected_teacher += 1;
          if (s.tch) c.with_teacher += 1;
          if (L?.started) c.assessed += 1;
          if (L?.started && expected && !s.tch) c.assessed_no_teacher += 1;
          if (s.tch && !L?.started) c.teacher_not_assessed += 1;
          if (s.tch?.enrol && L) for (const g of [1, 2, 3]) { const e = s.tch.enrol[g], att = L.g[g].att; if (e && att != null && e[2] > 0) out.attendance.push({ school: s.id, name: s.name, region: s.region, lga: s.lga, grade: g, enrolled: e[2], attended: att, rate: Math.round((att / e[2]) * 100) }); }
        }
        out.coverage = Object.values(cov);
        if (who.role === 'hq') {
          out.results = [];
          for (const s of baseSchools) { const L = live.sum?.schools?.[s.id]; if (!L) continue; for (const g of [1, 2, 3]) for (const [dom, label] of [['r', 'Reading'], ['a', 'Arithmetic']]) { const [p, n] = L.res[g][dom]; out.results.push({ school: s.id, name: s.name, region: s.region, grade: g, subject: label, teachers: s.tch ? s.tch.teach[g][dom] : null, tested: L.g[g].av, pass_rate: n ? Math.round((p / n) * 100) : null }); } }
        }
        return json(out);
      }

      // ---------- practice: the training schools, open to everyone, never part of the real numbers ----------
      if (path === '/api/practice') {
        const sum = await readSummary(env, 'practice');
        // everyone who took part, by name: test admins and whoever filled in a sampling form
        const people = await (async () => {
          const Y = await loadYear(env, 'practice'); if (!Y) return [];
          const P = {}; const who = (nm) => (P[nm] ||= { name: nm, tests: { 1: 0, 2: 0, 3: 0 }, tested: 0, schools: new Set(), sampling: [], phones: new Set(), days: new Set() });
          for (const [key, c] of Object.entries(Y.cells || {})) { const [date, school, grade, nm] = key.split('|'); if (!nm) continue; const w = who(nm); w.tests[grade] = (w.tests[grade] || 0) + c.n; w.tested += c.av; w.schools.add(school); w.days.add(date); for (const d of Object.keys(c.dv || {})) w.phones.add(devCodeOf(d)); }
          for (const [key, g] of Object.entries(Y.sg || {})) { if (!g.enum) continue; const [school, grade] = key.split('|'); const w = who(g.enum); w.schools.add(school); w.sampling.push(`${PRACTICE_BY_ID[school]?.name || school} Gr ${grade}: ${g.att ?? '–'} present`); if (g.dev) w.phones.add(devCodeOf(g.dev)); if (g.date) w.days.add(g.date); }
          return Object.values(P).map((w) => { const st = staffForKoboName(w.name); return { name: w.name, position: st ? st.position : null, region: st ? st.region : null, tests: w.tests, tested: w.tested, schools: [...w.schools].map((i) => PRACTICE_BY_ID[i]?.name || i), sampling: w.sampling, phones: [...w.phones], days: [...w.days].sort() }; }).sort((a, b) => b.tested - a.tested || a.name.localeCompare(b.name));
        })().catch(() => []);
        const queries = await loadQueries(env);
        if (!sum) return json({ status: 'empty', schools: PRACTICE_SCHOOLS_UI(), note: 'No practice submissions yet. Submit a test or a sampling record for a TRAINING school and it appears here within a few minutes.' });
        const flags = decorate((sum.flags || []).map((f) => ({ ...f, school_name: PRACTICE_BY_ID[f.school]?.name, region: PRACTICE_REGION, lga: 'TRAINING LGA', ward: 'TRAINING' })), queries);
        return json({ status: 'ok', as_of: sum.as_of, records: sum.national.records, tested: sum.national.tested, schools: Object.values(sum.schools).map(schoolRow).map((s) => ({ ...s, region: PRACTICE_REGION })), flags, admins: sum.admins.map((a) => ({ name: a.name, position: a.position, region: a.region, tested: a.tested, avg_min: a.avg_min, by_grade: a.by_grade, quality: a.quality, days: a.days })), bands: sum.bands, devices: (sum.devices || []).length, people });
      }

      // ---------- phones: what each phone did, for the whole team to see ----------
      if (path === '/api/phones') {
        const years = await readYears(env);
        const wantY = url.searchParams.get('year');
        const isPr = wantY === 'practice'; // practice phones are open to everyone, in every region
        let year = isPr ? 'practice' : wantY && years.includes(wantY) ? wantY : null; let dates = [];
        for (const y of year ? [year] : [...years].reverse()) { const d = env.DASHBOARD_KV ? await env.DASHBOARD_KV.get(`tl:${y}:dates`, { type: 'json', cacheTtl: 30 }) : null; if (d && d.length) { year = y; dates = d; break; } }
        if (!year || !dates.length) return json({ status: 'none', note: 'No phone data yet. It appears once sampling or test records carry the phone ID.' });
        const date = dates.includes(url.searchParams.get('date')) ? url.searchParams.get('date') : dates[dates.length - 1];
        const doc = await env.DASHBOARD_KV.get(`tl:${year}:${date}`, { type: 'json' });
        const sum = await readSummary(env, year);
        const myRegion = isPr ? null : who.role === 'hq' ? (url.searchParams.get('region') || null) : who.region;
        const inScope = (sc) => isPr || !myRegion || SCHOOL_BY_ID[sc]?.region === myRegion;
        const SI = (id) => SCHOOL_BY_ID[id] || PRACTICE_BY_ID[id];
        const events = (doc?.events || []).filter((e) => inScope(e.sc));
        const codes = new Set(events.map((e) => e.c));
        const phones = (doc?.phones || []).filter((p) => p.schools.some(inScope)).map((p) => ({ ...p, schools: p.schools.filter(inScope).map((sc) => ({ id: sc, name: SI(sc)?.name?.trim() })) }));
        const DEVT = new Set(['devoverlap', 'devtravel', 'devswitch', 'devnames', 'namedevs', 'nameoverlap', 'devpeople', 'devshare', 'headcount', 'devowner']);
        const flags = (sum?.flags || []).filter((f) => DEVT.has(f.type) && f.date === date && inScope(f.school))  .map((f) => ({ ...f, school_name: SI(f.school)?.name, region: SI(f.school)?.region, lga: SI(f.school)?.lga }));
        const bySchool = {};
        for (const e of events) (bySchool[e.sc] ||= new Set()).add(e.c);
        return json({ status: 'ok', year, date, dates, region: myRegion, events, phones, flags, schools: Object.entries(bySchool).map(([id, set]) => ({ id, name: SI(id)?.name?.trim(), region: SI(id)?.region, phones: set.size })) });
      }

      // ---------- compare (regions are public; people are role-limited) ----------
      if (path === '/api/compare') {
        const { sum, year } = await loadSummary(env, url.searchParams.get('year'));
        if (!sum) return json({ status: 'waiting' });
        const regions = publicView(sum).regions
          .map((r) => ({ ...r, pct: r.total ? Math.round((r.done / r.total) * 100) : 0, tested_pct: r.target ? Math.round((r.tested / r.target) * 100) : 0 }))
          .sort((a, b) => b.tested_pct - a.tested_pct || b.done - a.done);
        let people = [];
        if (who.role !== 'hq') {
          const ranked = rankAdmins(sum.admins.filter((a) => a.region === who.region));
          const myIdx = ranked.findIndex((a) => a.staff_id === who.id);
          people = ranked.map((a, i) => ({ rank: i + 1, name: i < 5 || who.role !== 'volunteer' || a.staff_id === who.id ? a.name : 'Colleague', quality: a.quality, tested: a.tested, you: a.staff_id === who.id }));
          if (who.role === 'volunteer' && myIdx >= 5) people = people.filter((p) => p.rank <= 5 || p.you || p.rank === myIdx);
        } else {
          people = rankAdmins(sum.admins).slice(0, 25).map((a, i) => ({ rank: i + 1, name: a.name, region: a.region, quality: a.quality, tested: a.tested }));
        }
        return json({ year, regions, people });
      }

      // ---------- plan & calendar ----------
      if (path === '/api/plan') {
        const region = (url.searchParams.get('region') || who.region || '').toUpperCase();
        if (!REGIONS.includes(region)) return err('Unknown region', 404);
        if (!canSeeRegion(who, region)) return err('Not your region', 403);
        const today = eatToday();
        const { sum } = await loadSummary(env, CURRENT_YEAR); // the real 2026 visits, never the rehearsal year
        const enrolMap = sum ? Object.fromEntries(Object.values(sum.schools).filter((s) => s.region === region && s.tch?.enrol).map((s) => [s.id, s.tch.enrol])) : {}; // baseline enrollment by grade [girls, boys, total]
        const withEnrol = (p) => ({ ...p, visits: p.visits.map((v) => ({ ...v, enrol: enrolMap[v.school] || null })) });
        const visitDates = sum ? Object.fromEntries(Object.values(sum.schools).filter((s) => s.region === region).map((s) => [s.id, s.dates])) : {};

        if (method === 'GET') {
          const plan = await getPlan(env, region);
          return json({ plan: withEnrol(withNotices(plan, today, visitDates)), schools: (SCHOOLS_BY_REGION[region] || []).map((s) => ({ id: s.id, enrol: enrolMap[s.id] || null, name: s.name, lga: s.lga, mne: s.mne, arm: s.arm })), staff: STAFF.filter((s) => s.active && s.region === region).map((s) => ({ name: s.name, position: s.position })), today });
        }
        if (method === 'POST') {
          if (who.role !== 'rc' && who.role !== 'arc' && who.role !== 'hq') return err('Only coordinators can change the plan', 403);
          const body = await request.json();
          let r;
          if (body.action === 'submit') r = await submitPlan(env, who, region, body.visits || [], body.day_notes || {});
          else if (body.action === 'draft') r = await saveDraft(env, region, body.visits || [], body.day_notes || {});
          else if (body.action === 'change') r = await changeVisit(env, who, region, body, today);
          else if (body.action === 'notice') r = await markNotice(env, who, region, body);
          else return err('Unknown action');
          if (r.error) return err(r.error, r.status || 400, { errors: r.errors });
          if (body.action === 'submit' || body.action === 'change') await markCalendarDirty(env); // the phone calendar file is refreshed shortly if HQ has switched that on
          return json({ plan: withEnrol(withNotices(r.plan, today, visitDates)) });
        }
      }

      if (path === '/api/pilot') { try { if (method === 'POST') { const r = await pilotSet(env, who, await request.json().catch(() => ({}))); return r.error ? err(r.error, r.status || 422) : json(r); } const v = await pilotView(env, who);
          // live results from KoBo for the pilot schools (real 2026 data): sampling in, pupils tested per grade
          try { const { sum } = await loadSummary(env, '2026'); if (sum) for (const c of v.schools) { const r = sum.schools?.[c.school]; if (r) c.live = { g: r.g, started: r.started, first: r.first, last: r.last, admins: (r.admins || []).length }; } } catch { /* the page works without live numbers */ }
          return json(v); } catch (e) { return err(String(e.message || e), 502); } }
      if (path === '/api/work/files') { try { const r = await workFiles(env, who, Object.fromEntries(url.searchParams)); return r.error ? err(r.error, r.status || 422) : json(r); } catch (e) { return err(String(e.message || e), 502); } }
      if (path === '/api/corrections') {
        try {
          if (method !== 'POST') { const r = await correctionsView(env, who); return r.error ? err(r.error, r.status || 422) : json(r); }
          const b = await request.json().catch(() => ({}));
          const r = b.action === 'find' ? await findToMove(env, who, b) : b.action === 'preview' ? await previewMove(env, who, b) : b.action === 'apply' ? await applyMove(env, who, b) : { error: 'Unknown action' };
          if (b.action === 'apply' && !r.error) await logActivity(env, who, `Moved ${(r.done || []).filter((d) => d.ok).length} record(s) to ${b.target_school}`, b.form);
          return r.error ? err(r.error, r.status || 422) : json(r);
        } catch (e) { return err(String(e.message || e), 502); }
      }
      if (path === '/api/corrections/copy') { const c = await correctionCopy(env, who, url.searchParams.get('id') || ''); return c ? json(c) : err('Not found or not allowed', 404); }
      if (path === '/api/pupils') { try { const r = await pupilRecords(env, who, Object.fromEntries(url.searchParams)); return r.error ? err(r.error, r.status || 422) : json(r); } catch (e) { return err(String(e.message || e), 502); } }
      if (path.startsWith('/api/deletions')) {
        if (!(who.role === 'hq' || who.role === 'rc' || who.role === 'arc')) return err('Not allowed', 403);
        try {
          if (path === '/api/deletions/find') { const r = await findRecords(env, who, Object.fromEntries(url.searchParams)); return r.error ? err(r.error, r.status || 422) : json(r); }
          if (path === '/api/deletions/copy') { if (who.role !== 'hq' || (who.review_level || 0) < 2) return err('Only the HQ reviewers can download the saved copy', 403); const c = await copyOf(env, url.searchParams.get('id') || ''); if (!c) return err('No copy', 404); const bin = Uint8Array.from(atob(c.gz_b64), (x) => x.charCodeAt(0)); return new Response(bin, { headers: { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="deleted-records-${url.searchParams.get('id')}.json.gz"`, 'cache-control': 'no-store' } }); }
          if (method === 'POST') { const r = await actOnRequest(env, who, await request.json().catch(() => ({}))); return r.error ? err(r.error, r.status || 422) : json(r); }
          return json(await listRequests(env, who));
        } catch (e) { return err(String(e.message || e), 502); }
      }
      // ---------- payments (HQ Admin only): the COD engine on the stored year; no names or bank details ----------
      if (path === '/api/payments') {
        if (who.role !== 'hq' || (who.level || 'admin') !== 'admin') return err('The payments page is for HQ Admin only', 403);
        const y = String(url.searchParams.get('year') || ''); const years = (await stateYears(env)).filter((x) => x !== 'practice'); let year = years.includes(y) ? y : null; if (!year) { for (const c of [CURRENT_YEAR, ...years.slice().reverse()]) { if (!years.includes(c)) continue; const t = await loadYear(env, c); if (t && t.n > 0) { year = c; break; } } year = year || years[years.length - 1]; }
        const Y = await loadYear(env, year); if (!Y) return json({ status: 'waiting', years });
        const prev = [...INFRA_WINNERS['2023-2024'], ...(Number(year) >= 2026 ? INFRA_WINNERS['2025'] : [])];
        await logActivity(env, who, 'Opened the payments page', year);
        return json({ status: 'ok', year, years: years.filter((x) => x !== 'practice'), current: year === CURRENT_YEAR, ...codFromYear(Y, prev) });
      }
      // ---------- HQ only ----------
      if (who.role !== 'hq') return err('HQ only', 403);

      if (path === '/api/admin/codes') {
        const map = await staffCodes(env);
        if (!map) return err('AUTH_SALT is not set', 500);
        const rows = Object.entries(map).map(([code, s]) => ({ region: s.region, position: s.position, name: s.name, code }));
        rows.sort((a, b) => a.region.localeCompare(b.region) || a.position.localeCompare(b.position));
        return json({ codes: rows });
      }
      if (path === '/api/admin/recipients') {
        if (method === 'POST') { const b = await request.json(); return json({ saved: await saveRecipients(env, b.rows || []) }); }
        return json({ recipients: await loadRecipients(env), sending: { enabled: env.EMAIL_ENABLED === 'true', domain_ready: Boolean(env.EMAIL_FROM && (env.RESEND_API_KEY || env.EMAIL)) } });
      }
      if (path === '/api/admin/digest-preview') {
        const { sum } = await loadSummary(env, null);
        const region = (url.searchParams.get('region') || '').toUpperCase() || null;
        const kind = url.searchParams.get('kind') === 'evening' ? 'evening' : 'morning';
        const site = env.SITE_URL || url.origin;
        const msg = kind === 'morning' ? await morningDigest(env, sum, region, eatToday(), site) : await eveningGap(env, sum, region, eatToday(), site);
        return json(msg || { subject: 'Nothing to send', html: '<p>Nothing to send right now.</p>', text: '' });
      }
      if (path === '/api/admin/hq-onboarding' && method === 'POST') {
        const b = await request.json();
        const site = env.SITE_URL || 'https://kf-assessments.learnimpacttz.workers.dev';
        const out = [];
        for (const p of b.people || []) {
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email || '')) continue;
          try { await sendMail(env, p.email, await hqOnboardingEmail(env, p.name || 'colleague', site, Boolean(p.copy))); out.push({ email: p.email, sent: true }); } catch (e) { out.push({ email: p.email, error: String(e && e.message) }); }
        }
        return json({ results: out });
      }
      if (path === '/api/admin/followup') {
        const b = method === 'POST' ? await request.json().catch(() => ({})) : {}; const site = env.SITE_URL || url.origin;
        if (method !== 'POST' || b.action === 'preview') { const m = await followupEmail(env, { region: (b.region || url.searchParams.get('region') || 'TANGA').toUpperCase(), role: 'rc' }, site, { preview: true }); return json(m || { subject: 'No match', html: '<p>No person.</p>', text: '' }); }
        if (b.action === 'test') { if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.to || '')) return err('Give one valid email address'); const r = await runFollowup(env, { dry: false, to: b.to }); return json({ results: r, note: 'Sent to you only, with a real access code. Delete after checking.' }); }
        if (b.action === 'count') return json({ recipients: (await runFollowup(env, { dry: true })).length, cc: (await hqCc(env)).length });
        if (b.action === 'send') { const r = await runFollowup(env, { dry: false }); await logActivity(env, who, 'Sent the onboarding follow-up email', `${r.filter((x) => x.sent).length} sent`); return json({ results: r }); }
        return err('Unknown action');
      }
      if (path === '/api/admin/onboarding-preview') {
        const rec = await loadRecipients(env);
        const region = (url.searchParams.get('region') || 'TANGA').toUpperCase(); const role = url.searchParams.get('role') === 'arc' ? 'arc' : 'rc';
        const msg = await onboardingEmail(env, { region, role }, env.SITE_URL || url.origin);
        return json(msg || { subject: 'No match', html: '<p>No person for that region and role.</p>', text: '' });
      }
      if (path === '/api/admin/test-email' && method === 'POST') {
        const b = await request.json();
        if (b.kind === 'onboarding') {
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.to || '')) return err('Give one valid email address');
          const m = await onboardingEmail(env, { region: (b.region || 'TANGA').toUpperCase(), role: b.role === 'arc' ? 'arc' : 'rc' }, env.SITE_URL || url.origin);
          if (!m) return err('No person for that region and role', 404);
          await sendMail(env, b.to, { ...m, subject: '[TEST] ' + m.subject });
          return json({ sent_to: b.to, note: 'Contains a real access code. Delete after checking.' });
        }
        if (!env.EMAIL_FROM || !(env.RESEND_API_KEY || env.EMAIL)) return err('Sending is not set up yet (needs RESEND_API_KEY and EMAIL_FROM)', 409);
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.to || '')) return err('Give one valid email address');
        const { sum } = await loadSummary(env, null);
        const msg = await morningDigest(env, sum, (b.region || '').toUpperCase() || null, eatToday(), env.SITE_URL || url.origin);
        await sendMail(env, b.to, { ...msg, subject: '[TEST] ' + msg.subject });
        return json({ sent_to: b.to });
      }
      if (path === '/api/admin/digest-run' && method === 'POST') { const b = await request.json(); return json({ results: await runDigests(env, b.kind === 'evening' ? 'evening' : 'morning', { dry: b.dry !== false }) }); }
      if (path === '/api/admin/archive-export') {
        const y = url.searchParams.get('year');
        const Y = await loadYear(env, y);
        if (!Y) return err('No data for that year', 404);
        return new Response(JSON.stringify({ year: y, exported_at: new Date().toISOString(), note: 'Aggregated by day, school, grade and test admin. Not pupil-level.', ...Y }), { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="kf-archive-${y}.json"` } });
      }
      if (path === '/api/admin/archive' && method === 'POST') {
        const b = await request.json();
        const Y = await loadYear(env, String(b.year));
        if (!Y) return err('No data for that year', 404);
        const meta = { year: String(b.year), at: new Date().toISOString(), by: who.name, records: Y.n, cells: Object.keys(Y.cells).length };
        await kv(env).put(`v2:arch:${b.year}`, meta);
        return json({ archived: meta });
      }
      if (path === '/api/admin/calendar-csv' && url.searchParams.get('which') === 'last') {
        // the copy the system last put on the phones by itself, kept as a backup
        const last = await kv(env).get('v2:calsync:csv');
        if (!last) return err('Nothing has been uploaded automatically yet', 404);
        return new Response(last, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="ref_calendar.csv"', 'cache-control': 'no-store' } });
      }
      if (path === '/api/admin/calendar-csv') {
        // Reference file for the KoBo forms (upload as media named ref_calendar.csv). One row per planned school.
        const built = await buildCalendar(env);
        await kv(env).put('v2:calcsv:last', { at: new Date().toISOString(), rows: built.rows, version: built.version });
        return new Response(built.csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="ref_calendar.csv"`, 'x-calendar-rows': String(built.rows), 'x-calendar-version': built.version, 'cache-control': 'no-store' } });
      }
      if (path === '/api/admin/fields') {
        // Field NAMES only (never values) from the first records of a form, so the importer can be written against the real layout.
        const kind = url.searchParams.get('kind') === 'sampling' ? 'KOBO_ASSET_SAMPLING' : url.searchParams.get('kind') === 'teachers' ? 'KOBO_ASSET_TEACHER' : 'KOBO_ASSET_ID';
        const page = await fetchKoboPage(env.KOBO_SERVER || 'kf.kobotoolbox.org', env[kind], env.KOBO_TOKEN, null, Number(url.searchParams.get('since')) || 0);
        const keys = new Set(); for (const r of page.results.slice(0, 40)) for (const k of Object.keys(r)) keys.add(k);
        // optional: how often each value of a few SAFE coded fields occurs (counts only, never free text)
        const SAFE = /(^|\/)(deviceid|_submitted_by|rc_username|username|phonenumber|subscriberid|position|position_new|position_label_eng|position_label_eng_new|gender|gender_new|smartphone|smartphone_new|grade[123]|grade[123]_subs|grade[123]_subs_label|s[123]_(kisw|arit)|weo_att|mne|arm|year|confirm|assi_confirm|no_teachers|no_kf_teachers)$/;
        const counts = {};
        const OPAQUE = /(deviceid|_submitted_by|rc_username|username|phonenumber|subscriberid)$/;
        for (const k of (url.searchParams.get('counts') || '').split(',').filter((x) => SAFE.test(x))) { if (OPAQUE.test(k)) { const vals = page.results.map((r) => String(r[k] ?? '')).filter(Boolean); const m = {}; vals.forEach((v) => (m[v] = (m[v] || 0) + 1)); counts[k] = { filled: vals.length, of: page.results.length, distinct: Object.keys(m).length, top_share_pct: vals.length ? Math.round((100 * Math.max(...Object.values(m))) / vals.length) : 0 }; continue; } const c = {}; for (const r of page.results) { const v = String(r[k] ?? '(blank)').slice(0, 60); c[v] = (c[v] || 0) + 1; } counts[k] = Object.fromEntries(Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 12)); }
        return json({ kind, counts, records_seen: page.results.length, total: page.count, keys: [...keys].filter((k) => !/bank|acc_|account|mobile|tin|checkno|name$|_name|branch|geolocation|gps/i.test(k)).sort() });
      }
      if (path === '/api/admin/readiness') {
        const today = eatToday();
        const sync = await syncStatus(env);
        const years = (await kv(env).get('v2:years')) || [];
        const sum26 = years.includes(CURRENT_YEAR) ? await kv(env).get('v2:sum:' + CURRENT_YEAR) : null;
        const plans = await Promise.all(REGIONS.map((r) => getPlan(env, r)));
        const submitted = plans.filter((p, k) => REGIONS[k] !== 'DODOMA' && p.status === 'locked').length;
        const rec = await loadRecipients(env);
        const push = await pushStatus(env);
        const cal = await kv(env).get('v2:calcsv:last');
        const bak = await kv(env).get('v2:backup:last');
        const age = (iso) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 60000) : null);
        const checks = [];
        const add = (ok, label, detail, fix) => checks.push({ ok, label, detail, fix: ok ? '' : fix });
        const stale = Object.entries(sync).filter(([, v]) => v.configured && (age(v.last_check) ?? 9999) > 40);
        add(!stale.length && Object.values(sync).every((v) => v.configured), 'KoBo connections are fresh', Object.entries(sync).map(([k, v]) => `${k}: ${age(v.last_check) ?? '–'} min ago`).join(' · '), 'Press Sync now. If it stays stale, check the KoBo token.');
        add(submitted === 10, 'Field plans submitted', `${submitted} of 10 regions (Dodoma pilot plan is separate)`, 'Remind the coordinators who have not submitted.');
        const d = plans[REGIONS.indexOf('DODOMA')];
        add(d.status === 'locked' && d.visits.every((v) => v.date === PILOT_DAY), 'Dodoma pilot plan on 15 Oct', `${d.visits.length} schools`, 'Submit the Dodoma plan for 15 October.');
        { const cs = await loadCalSync(env).catch(() => null); const auto = Boolean(cs && cs.enabled && cs.last && cs.last.ok);
          add(auto || Boolean(cal), 'Calendar file on the KoBo forms', auto ? `updated automatically ${age(cs.last.at)} min ago, ${cs.last.rows} schools, ${cs.last.version}` : cal ? `last manual download ${age(cal.at)} min ago, ${cal.rows} schools, ${cal.version}` : 'not on the forms yet', 'Admin > KoBo & forms: switch on the automatic update, or download ref_calendar.csv and upload it to both forms.'); }
        add(Boolean(sum26) && (sum26.admins || []).filter((a) => a.role === 'unlisted').length === 0, 'Every test admin name matches the roster', sum26 ? `${(sum26.admins || []).filter((a) => a.role === 'unlisted').length} unlisted name(s) in 2026 data` : 'no 2026 tests yet', 'Assign unlisted names to people in the roster section.');
        add(rec && Object.values(rec).filter((r) => r.active !== false).length > 0 && env.EMAIL_ENABLED === 'true' && Boolean(env.EMAIL_FROM && env.RESEND_API_KEY), 'Email is on and has recipients', `${Object.values(rec).filter((r) => r.active !== false).length} active recipients`, 'Check recipients and the Resend key.');
        add(push.devices > 0, 'Phone alerts have devices', `${push.devices} device(s)`, 'Ask people to tap "Turn on alerts".');
        add(Boolean(bak) && age(bak.at) < 36 * 60, 'A recent backup exists', bak ? `last backup ${Math.round(age(bak.at) / 60)} h ago` : 'no backup yet', 'Press "Back up now".');
        const pilot = sum26 ? Object.values(sum26.schools).filter((s) => s.region === 'DODOMA') : [];
        const pilotData = pilot.filter((s) => s.dates.includes(PILOT_DAY));
        const parsed = sum26 ? Object.values(sum26.schools).flatMap((s) => [1, 2, 3].map((g) => s.g[g])).filter((g) => g.n > 0) : [];
        add(parsed.length === 0 || parsed.every((g) => g.att !== null), 'Sampling attendance is being read', parsed.length ? `${parsed.filter((g) => g.att !== null).length} of ${parsed.length} school-grades with tests have an attendance record` : 'no 2026 tests yet', 'Check that the sampling form was submitted before testing, and that field names match.');
        return json({ today, pilot_day: PILOT_DAY, checks, pilot: { schools: pilot.length, with_tests: pilotData.length, tested: pilotData.reduce((a, s) => a + s.g[1].av + s.g[2].av + s.g[3].av, 0), target: 600 } });
      }
      if (path === '/api/admin/roster') {
        if (method === 'POST') {
          const b = await request.json();
          const r = await changeRoster(env, b);
          if (r.error) return err(r.error, 422);
          await recomputeSummaries(env);
          let code = null;
          if (b.action === 'reissue') { const map = await staffCodes(env); code = Object.entries(map || {}).find(([, s]) => s.id === Number(b.id))?.[0] || null; }
          return json({ ok: true, code });
        }
        const { sum } = await loadSummary(env, CURRENT_YEAR);
        const names = new Set((await Promise.all(['2026', '2025'].map(async (y) => ((await readSummary(env, y))?.admins || [])))).flat().filter((a) => a.role === 'unlisted').map((a) => a.name));
        return json({ staff: STAFF.map((s) => ({ id: s.id, name: s.name, region: s.region, position: s.position, role: s.role, active: s.active })), aliases: rosterState.aliases, unlisted: [...names], options: rosterOptions() });
      }
      if (path === '/api/admin/backup') {
        if (method === 'POST') {
          const b = await request.json().catch(() => ({}));
          const testTo = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.test_to || '') ? b.test_to : null;
          const made = await runBackup(env, { full: Boolean(b.full) });
          if (b.email) { const m = await emailLatestFull(env, { testTo }); return json({ ...made, emailed: m.emailed, to: m.to || null, cc: m.cc || [], mail_error: m.error || null }); }
          return json(made);
        }
        if (url.searchParams.get('list') === '1') return json({ backups: await listBackups(env), last: await kv(env).get('v2:backup:last') });
        if (url.searchParams.get('key')) { const raw = await rawStoredBackup(env, url.searchParams.get('key')); if (!raw) return err('No such backup', 404); return new Response(raw, { headers: { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${url.searchParams.get('key').slice(3)}.json.gz"`, 'cache-control': 'no-store' } }); }
        const data = await buildBackup(env, url.searchParams.get('full') === '1');
        if (env.BACKUP_PASSPHRASE) return new Response(await sealBuf(env, await gzip(JSON.stringify(data))), { headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="kf4-backup-${data.at.slice(0, 10)}${data.full ? '-full' : ''}.json.gz.enc"`, 'cache-control': 'no-store' } });
        return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="kf4-backup-${data.at.slice(0, 10)}${data.full ? '-full' : ''}.json"`, 'cache-control': 'no-store' } });
      }
      if (path === '/api/admin/restore' && method === 'POST') {
        const b = await request.json();
        if (b.confirm !== 'RESTORE') return err('Type RESTORE to confirm', 422);
        const source = b.key ? await readStoredBackup(env, b.key) : b.backup;
        const r = await restoreBackup(env, source, { states: Boolean(b.states) });
        if (r.error) return err(r.error, 422);
        await ensureRoster(env, true); await recomputeSummaries(env);
        return json(r);
      }
      if (path === '/api/admin/days-worked') {
        const { sum } = await loadSummary(env, url.searchParams.get('year') || CURRENT_YEAR);
        if (!sum) return err('No data yet', 404);
        const from = url.searchParams.get('from') || '0000', to = url.searchParams.get('to') || '9999';
        const rows = [];
        for (const a of sum.admins) {
          const days = (sum.days?.[a.name] || []).filter((d) => d[0] >= from && d[0] <= to);
          const st = staffForKoboName(a.name);
          for (const d of days) rows.push({ region: a.region || '', name: st ? st.name : a.name, position: a.position || 'not in roster', date: d[0], schools: d[1], pupils: d[2], first_hour: d[3], last_hour: d[4] });
        }
        rows.sort((x, y) => x.region.localeCompare(y.region) || x.name.localeCompare(y.name) || x.date.localeCompare(y.date));
        if (url.searchParams.get('format') === 'csv') {
          const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
          const head = ['Region', 'Name', 'Position', 'Date', 'Schools with tests', 'Pupils tested', 'First test hour', 'Last test hour'];
          return new Response('\ufeff' + [head, ...rows.map((r) => [r.region, r.name, r.position, r.date, r.schools, r.pupils, r.first_hour, r.last_hour])].map((r) => r.map(q).join(',')).join('\n') + '\n', { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="days-worked.csv"', 'cache-control': 'no-store' } });
        }
        const per = {};
        for (const r of rows) { const p = (per[r.name] ||= { name: r.name, region: r.region, position: r.position, days: 0, schools: 0, pupils: 0, first: r.date, last: r.date }); p.days += 1; p.schools += r.schools; p.pupils += r.pupils; if (r.date < p.first) p.first = r.date; if (r.date > p.last) p.last = r.date; }
        return json({ note: 'A day counts when at least one test was submitted. Training days, travel days and days without tests are not included.', year: sum.year, people: Object.values(per) });
      }
      if (path === '/api/admin/kobo-test' && method === 'POST') {
        // Writes one real submission's status and puts it back exactly as it was. Every step is reported.
        const b = await request.json();
        const srv = env.KOBO_SERVER || 'kf.kobotoolbox.org';
        const steps = [];
        const id = Number(b.id);
        if (!Number.isFinite(id)) return err('Give a submission id', 422);
        const before = await getValidation(srv, env.KOBO_ASSET_ID, env.KOBO_TOKEN, id); steps.push({ step: 'read status before', status: before });
        await setValidation(srv, env.KOBO_ASSET_ID, env.KOBO_TOKEN, [id], 'on_hold'); steps.push({ step: 'set to on hold', ok: true });
        const during = await getValidation(srv, env.KOBO_ASSET_ID, env.KOBO_TOKEN, id); steps.push({ step: 'read status after writing', status: during });
        if (before) await setValidation(srv, env.KOBO_ASSET_ID, env.KOBO_TOKEN, [id], before.replace('validation_status_', '')); else await clearValidation(srv, env.KOBO_ASSET_ID, env.KOBO_TOKEN, id);
        const after = await getValidation(srv, env.KOBO_ASSET_ID, env.KOBO_TOKEN, id); steps.push({ step: 'restored, read status again', status: after });
        return json({ id, steps, restored_exactly: (after || null) === (before || null), write_worked: during === 'validation_status_on_hold' });
      }
      if (path === '/api/admin/kobo-check') return json(await koboWho(env.KOBO_SERVER || 'kf.kobotoolbox.org', env.KOBO_ASSET_ID, env.KOBO_TOKEN));
      if (path === '/api/admin/devices') {
        const { sum } = await loadSummary(env, url.searchParams.get('year') || CURRENT_YEAR);
        if (method === 'POST') {
          const b = await request.json();
          const dev = (sum?.devices || []).find((d) => d.code === b.code);
          if (!dev) return err('Device not found', 404);
          const owners = (await kv(env).get('v2:devowners')) || {};
          if (b.staff_id) owners[dev.raw] = Number(b.staff_id); else delete owners[dev.raw];
          await kv(env).put('v2:devowners', owners);
          await recomputeSummaries(env);
          return json({ ok: true });
        }
        return json({ devices: (sum?.devices || []).map(({ raw, ...d }) => d).sort((a, b) => b.tests - a.tests) });
      }
      if (path === '/api/admin/form-content') {
        // The deployed form definition, row by row (questions and choice lists, no submissions), so a new file can be compared with it
        const key = url.searchParams.get('kind') === 'sampling' ? 'KOBO_ASSET_SAMPLING' : url.searchParams.get('kind') === 'teachers' ? 'KOBO_ASSET_TEACHER' : 'KOBO_ASSET_ID';
        const r = await fetch(`https://${env.KOBO_SERVER || 'kf.kobotoolbox.org'}/api/v2/assets/${env[key]}/?format=json`, { headers: { Authorization: `Token ${env.KOBO_TOKEN}` } });
        if (!r.ok) return err('KoBo ' + r.status, 502);
        const a = await r.json(); const c = a.content || {};
        return json({ name: a.name, date_deployed: a.date_deployed, survey: (c.survey || []).map((q) => ({ type: q.type, list: q.select_from_list_name || null, name: q.name || q.$autoname || null, calc: q.calculation || null, rel: q.relevant || null, req: q.required ?? null, cons: q.constraint || null, filt: q.choice_filter || null, app: q.appearance || null, label: q.label || null, hint: q.hint || null })), choices: (c.choices || []).map((o) => ({ list: o.list_name, name: o.name, label: o.label || null })), settings: c.settings || null });
      }
      if (path === '/api/admin/form-meta') {
        // What each deployed KoBo form contains in the way of device/user metadata (names and types only, no data)
        const srv = env.KOBO_SERVER || 'kf.kobotoolbox.org';
        const out = {};
        for (const [label, key] of [['students', 'KOBO_ASSET_ID'], ['sampling', 'KOBO_ASSET_SAMPLING'], ['teachers', 'KOBO_ASSET_TEACHER']]) {
          const r = await fetch(`https://${srv}/api/v2/assets/${env[key]}/?format=json`, { headers: { Authorization: `Token ${env.KOBO_TOKEN}` } });
          if (!r.ok) { out[label] = { error: r.status }; continue; }
          const a = await r.json();
          const survey = a.content?.survey || [];
          out[label] = {
            name: a.name, deployed_version_count: (a.deployed_versions?.count ?? null), date_deployed: a.date_deployed || null, date_modified: a.date_modified || null, submissions: a.deployment__submission_count ?? null,
            metadata_rows: survey.filter((q) => ['start', 'end', 'today', 'deviceid', 'phonenumber', 'username', 'subscriberid', 'simserial', 'audit', 'start-geopoint'].includes(q.type)).map((q) => `${q.type}:${q.name || q.$autoname || ''}`),
            has_deviceid: survey.some((q) => q.type === 'deviceid'), question_count: survey.length,
          };
        }
        return json(out);
      }
      if (path === '/api/admin/kobo-form' && method === 'POST') { try { return json(await koboForm(env, await request.json())); } catch (e) { return err(String(e.message || e), 502); } }
      if (path === '/api/admin/hq-users') {
        if (method === 'POST') {
          const b = await request.json().catch(() => ({}));
          if (b.action === 'email') { const u = (await loadHq(env, true)).users.find((x) => x.id === b.id); if (!u || !u.email) return err('This person has no email address', 422); const m = await hqPersonalCodeEmail(env, u, await codeFor(env, u), env.SITE_URL || url.origin); await sendMail(env, u.email, m); return json({ ok: true, sent_to: u.email }); }
          const r = await hqChange(env, who, b); if (r.error) return err(r.error, r.status || 422); return json(r);
        }
        return json(await hqList(env));
      }
      if (path === '/api/admin/settings') {
        if (method === 'POST') { const r = await saveSettings(env, await request.json().catch(() => ({}))); if (r.error) return err(r.error, 422); return json(r); }
        return json(await settingsView(env));
      }
      if (path === '/api/admin/activity') return json({ log: (await readActivity(env)).slice(0, 400) });
      if (path === '/api/admin/email-schedule') return json(await emailSchedule(env));
      if (path === '/api/admin/calsync') {
        if (method === 'POST') {
          const b = await request.json().catch(() => ({}));
          if (b.action === 'enable') await setCalSync(env, { enabled: true });
          else if (b.action === 'disable') await setCalSync(env, { enabled: false });
          else if (b.action === 'reset_prev') { await kv(env).delete('v2:calsync:csv'); const c = await loadCalSync(env); c.last = null; c.history = []; await kv(env).put('v2:calsync', c); }
          else if (b.action === 'run') { try { return json({ ran: await syncCalendar(env, { force: true, assets: b.assets || null }), status: await calendarStatus(env) }); } catch (e) { return err(String(e.message || e), 502); } }
          else return err('Unknown action');
        }
        return json(await calendarStatus(env));
      }
      if (path === '/api/admin/do-usage') { return json(await kv(env).usage()); }
      if (path === '/api/admin/storage') { try { return json({ ...(await storageView(env)), dash: await kv(env).usage().catch(() => null) }); } catch (e) { return err(String(e.message || e), 502); } }
      if (path === '/api/admin/attach') {
        try {
          if (method === 'POST') { const r = await attachDelete(env, who, await request.json().catch(() => ({}))); return r.error ? err(r.error, r.status || 422) : json(r); }
          const asset = url.searchParams.get('asset') || '';
          if (url.searchParams.get('url')) return await attachFetch(env, asset, url.searchParams.get('url'));
          return json(await attachList(env, asset, url.searchParams.get('cursor') || null, Math.min(500, Number(url.searchParams.get('limit')) || 100)));
        } catch (e) { return err(String(e.message || e), 502); }
      }
      if (path === '/api/admin/messages') {
        try {
          if (method !== 'POST') return json(await messagesApi(env, who, { action: 'view' }));
          const b = await request.json().catch(() => ({}));
          if (b.action === 'builtin_save') { const r = await builtinSave(env, who, b); return r.error ? err(r.error, 422) : json(r); }
          const r = await messagesApi(env, who, b); return r.error ? err(r.error, r.status || 422) : json(r);
        } catch (e) { return err(String(e.message || e), 502); }
      }
      if (path === '/api/admin/forms') {
        try {
          if (method === 'POST') { const b = await request.json().catch(() => ({})); if (b.action === 'rehearse') return json(await formsRehearse(env, who, b)); if (b.action === 'deploy') { const r = await formsDeploy(env, who, b); await logActivity(env, who, 'Deployed a form: ' + r.label, b.filename || ''); return json(r); } if (b.action === 'rollback') { const r = await formsRollback(env, who, b); await logActivity(env, who, 'Rolled back a form: ' + r.label, ''); return json(r); } return err('Unknown action'); }
          return json(await formsView(env));
        } catch (e) { return err(String(e.message || e), 422); }
      }
      if (path === '/api/admin/formjob') {
        if (method === 'POST') {
          const b = await request.json().catch(() => ({}));
          const st = await loadFormJob(env);
          if (b.action === 'disarm') { st.armed = false; await saveFormJob(env, st); }
          else if (b.action === 'arm') { st.armed = true; if (st.done === 'failed' || st.done === 'expired') st.done = null; await saveFormJob(env, st); }
          else if (b.action === 'run') { const o = b.asset ? { asset: b.asset, expectCurrentRows: b.expect_current_rows ?? undefined, expectNewRows: b.expect_new_rows } : { force: true }; return json({ ran: await runFormJob(env, o) }); }
          else return err('Unknown action');
        }
        const { ...st } = await loadFormJob(env); return json(st);
      }
      if (path === '/api/admin/news') {
        if (method === 'POST') {
          const b = await request.json().catch(() => ({}));
          let r;
          if (b.action === 'save') r = await saveNews(env, who, b);
          else if (b.action === 'send') { const sv = await saveNews(env, who, b); if (sv.error) return err(sv.error, 422); r = await publishNews(env, sv.id, who.name || 'HQ'); }
          else if (b.action === 'publish') r = await publishNews(env, b.id, who.name || 'HQ');
          else if (b.action === 'delete') r = await deleteNews(env, b.id);
          else if (b.action === 'pin') r = await pinNews(env, b.id, b.pinned);
          else if (b.action === 'polish') r = await polishNews(env, b);
          else return err('Unknown action');
          if (r.error) return err(r.error, r.status || 422);
          return json(r);
        }
        return json(await manageNews(env, who));
      }
      if (path === '/api/admin/team-note' && method === 'POST') {
        // One automated note to the HQ team only (never to coordinators): first HQ person is the recipient, the other HQ people are copied
        const b = await request.json().catch(() => ({}));
        if (!b.subject || !b.html || !b.text) return err('subject, html and text are required', 422);
        const rec = await loadRecipients(env);
        const hq = Object.entries(rec).filter(([, r]) => r.role === 'hq' && r.active !== false);
        if (!hq.length) return err('No HQ recipients', 409);
        const [to] = hq.find(([, r]) => r.backup === 'to') || hq[0];
        const cc = hq.map(([e]) => e).filter((e) => e !== to);
        const msg = { subject: b.subject, html: b.html, text: b.text, cc, ...(b.attach_b64 ? { attachments: [{ filename: b.filename || 'attachment.docx', content: b.attach_b64 }] } : {}) };
        await sendMail(env, to, msg);
        return json({ sent_to: to, cc });
      }
      if (path === '/api/admin/practice-clear' && method === 'POST') { const b = await request.json().catch(() => ({})); if (b.confirm !== 'CLEAR') return err('Type CLEAR to confirm', 422); await clearPractice(env); return json({ ok: true }); }
      if (path === '/api/admin/push-status') return json(await pushStatus(env));
      if (path === '/api/admin/push-test' && method === 'POST') {
        const b = await request.json();
        const r = await pushTo(env, (w) => (!b.region || w.region === b.region) && (!b.role || w.role === b.role) && (!b.id || w.id === b.id), { title: 'KiuFunza 4 · Test alert', body: 'If you can read this, phone alerts work on this device.', url: '/' });
        return json(r);
      }
      if (path === '/api/admin/push-field' && method === 'POST') { // a one-off message to all field staff (approved wording only); the automatic reminders are not touched
        if (who.role !== 'hq' || (who.level || 'admin') !== 'admin') return err('Only an HQ Admin can send this', 403);
        const b = await request.json().catch(() => ({})); const MSG = { finalize: { title: 'Maliza kila tathmini · Finalize every assessment', body: 'Finish and send each assessment before you leave the pupil. Do not reopen or edit a sent record. / Kamilisha na utume kila tathmini kabla ya kumwacha mwanafunzi. Usifungue wala kuhariri rekodi iliyotumwa.', url: '/' } };
        const m = MSG[b.kind]; if (!m) return err('Unknown message', 422);
        return json(await pushTo(env, (w) => w.role !== 'hq', m));
      }
      if (path === '/api/admin/reminders' && method === 'POST') { const b = await request.json(); return json({ results: await runReminders(env, { dry: b.dry !== false }) }); }
      if (path === '/api/admin/reminder-preview') { const m = await reminderEmail(env, (url.searchParams.get('region') || 'TANGA').toUpperCase(), eatToday(), env.SITE_URL || url.origin); return json(m || { subject: 'Nothing to remind', html: '<p>Nothing due right now.</p>', text: '' }); }
      if (path === '/api/admin/status') { const years = (await kv(env).get('v2:years')) || []; const archived = {}; for (const y of years) { const m = await kv(env).get(`v2:arch:${y}`); if (m) archived[y] = m; } return json({ sync: await syncStatus(env), years, archived }); }
      if (path === '/api/admin/refresh' && method === 'POST') return json({ ran: await tick(env, { force: true }) });
      if (path === '/api/admin/resync' && method === 'POST') {
        const b = await request.json();
        if (b.kind === 'teachers') for (const y of await stateYears(env)) { const Y = await loadYear(env, y); if (Y && Object.keys(Y.tf || {}).length) { Y.tf = {}; Y.tfp = {}; await saveYear(env, y, Y); } } // teacher aggregates are rebuilt from scratch so nothing is counted twice
        await resetKind(env, b.kind); return json({ ok: true, kind: b.kind });
      }
      if (path === '/api/admin/rebuild' && method === 'POST') { // queue a clean re-read of chosen years of a form (used after corrections made in KoBo)
        const b = await request.json().catch(() => ({})); if (b.seed) return json({ ok: true, first_ids: await seedFirstIds(env) });
        if (!['students', 'sampling'].includes(b.kind) || !Array.isArray(b.years) || !b.years.length) return err('Choose a form and years', 422);
        if (b.from_id) { await restartRebuildFrom(env, b.kind, b.years.map(String), b.from_id); await logActivity(env, who, 'Restarted a rebuild from record ' + b.from_id + ': ' + b.kind + ' ' + b.years.join(', ')); return json({ ok: true, restarted_from: b.from_id }); }
        const rb = (await kv(env).get('v2:rebuild')) || []; for (const y of b.years.map(String)) if (!rb.find((x) => x.kind === b.kind && x.year === y)) rb.push({ kind: b.kind, year: y }); await kv(env).put('v2:rebuild', rb); await logActivity(env, who, 'Queued a rebuild: ' + b.kind + ' ' + b.years.join(', ')); return json({ ok: true, queued: rb });
      }
      if (path === '/api/admin/recompute' && method === 'POST') { await recomputeSummaries(env, null, { allDays: true }); return json({ ok: true }); }
      if (path === '/api/admin/full-resync' && method === 'POST') { await resetAll(env); return json({ ok: true, note: 'State cleared. The next ticks re-read every form from the start.' }); }
      if (path === '/api/admin/state-size') { const s = await loadState(env); return json({ years: Object.fromEntries(Object.entries(s.yrs).map(([y, Y]) => [y, { records: Y.n, cells: Object.keys(Y.cells).length, sg: Object.keys(Y.sg).length, teacher_schools: Object.keys(Y.tf).length }])) }); }

      return err('Not found', 404);
    } catch (e) {
      return err('Something went wrong on the server', 500, { detail: String(e && e.message || e) });
    }
  },

  async scheduled(event, env, ctx) {
    try {
      // a KoBo or roster problem must not stop the emails, News, backups and messages that follow
      try { await ensureRoster(env, true); const out = await tick(env); if (out.length) console.log(JSON.stringify(out)); } catch (e) { console.error('sync failed: ' + (e && e.message)); }
      const hhmm = new Date().toISOString().slice(11, 16);
      const hourNow = Number(hhmm.slice(0, 2));
      const alertSlot = { '04:05': 'morning', '05:30': 'queries', '08:00': 'silent', '13:30': 'evening' }[hhmm] || (hhmm.endsWith(':00') && hourNow >= 4 && hourNow <= 15 ? 'health' : null); // health: every hour of the field day
      if (alertSlot) {
        const day = eatToday(); const last = (await kv(env).get('v2:push:ran')) || {};
        const ranKey = alertSlot + ':' + hhmm;
        if (last[ranKey] !== day) { last[ranKey] = day; await kv(env).put('v2:push:ran', last); const sum = await kv(env).get('v2:sum:' + CURRENT_YEAR); console.log('alerts ' + JSON.stringify(await runAlerts(env, alertSlot, sum)).slice(0, 400)); }
      }
      try { const cs = await syncCalendar(env); if (cs) console.log('calendar ' + JSON.stringify(cs).slice(0, 400)); } catch (e) { console.error('calendar sync failed: ' + (e && e.message)); }
      try { const fj = await maybeRunFormJob(env); if (fj) console.log('formjob ' + JSON.stringify(fj).slice(0, 600)); } catch (e) { console.error('form job failed: ' + (e && e.message)); }
      try { const nw = await runDueNews(env); if (nw.length) console.log('news ' + JSON.stringify(nw)); if (new Date().getUTCMinutes() % 15 === 0) { const ms = await checkMilestones(env); if (ms && ms.length) console.log('milestones ' + JSON.stringify(ms)); } } catch (e) { console.error('news failed: ' + (e && e.message)); }
      try { const mj = await runDueMessages(env); if (mj) console.log('messages ' + JSON.stringify(mj).slice(0, 500)); } catch (e) { console.error('messages failed: ' + (e && e.message)); }
      if (hhmm === '04:00' && new Date().getUTCDay() === 1) { try { const md = await mondayDraft(env); if (md) console.log('monday draft ' + JSON.stringify(md)); } catch (e) { console.error('monday draft failed: ' + (e && e.message)); } }
      const bk = await maybeRunScheduledBackup(env); if (bk) console.log('backup ' + JSON.stringify(bk));
      const dg = await maybeRunScheduledDigests(env);
      if (dg) console.log('digest ' + JSON.stringify(dg).slice(0, 500));
    } catch (e) {
      console.error('scheduled run failed: ' + (e && e.message));
    }
  },
};
