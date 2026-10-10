import { kv } from './store.js';
import { buildBrief, aiBrief } from './brief.js';
import { morningDigest, eveningGap, loadRecipients, saveRecipients, runDigests, maybeRunScheduledDigests, sendMail, onboardingEmail, runOnboarding, hqOnboardingEmail, reminderEmail, runReminders } from './digest.js';
import { loadQueries, decorate, postQuery, flagKey } from './queries.js';
import { identify, staffCodes, canSeeRegion } from './auth.js';
import { forecast, atRiskSchools } from './predict.js';
import { ensureRoster, changeRoster, rosterOptions } from './roster.js';
import { runBackup, buildBackup, restoreBackup, maybeRunScheduledBackup, listBackups, readStoredBackup, rawStoredBackup, emailLatestFull } from './backup.js';
import { setValidation, koboWho, getValidation, clearValidation } from './kobo.js';
import { fetchKoboPage } from './kobo.js';
import { subscribe, unsubscribe, takeAlert, hashEndpoint, pushTo, pushStatus, pushReady, runAlerts } from './push.js';
import { tick, syncStatus, recomputeSummaries, resetAll, resetKind, loadState, loadYear, saveYear, stateYears } from './sync.js';
import { getPlan, submitPlan, saveDraft, changeVisit, markNotice, withNotices } from './plan.js';
import {
  REGIONS, PARTNERS, REASONS, DAY_REASONS, FIELD_START, FIELD_END, PILOT_DAY, TRAINING_START, CURRENT_YEAR, STAFF, rosterState, staffForKoboName, SCHOOLS_BY_REGION, SCHOOL_BY_ID, eatToday,
  TARGET_PER_GRADE, DODOMA_TARGET_PER_GRADE, NOTICE_AEK_WORKING_DAYS, NOTICE_HT_WORKING_DAYS,
} from './config.js';

const dayCounts = (p) => { const per = {}; for (const v of p.visits || []) per[v.date] = (per[v.date] || 0) + 1; const n = Object.values(per); return { one: n.filter((x) => x === 1).length, two: n.filter((x) => x === 2).length, three: n.filter((x) => x === 3).length }; };
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
  return { region: sum.regions[region], schools, admins, flags, staff, work_all: work };
}

export { Store } from './store.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    await ensureRoster(env);

    try {
      if (path === '/api/config') {
        return json({
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

      const who = await identify(request, env);

      if (path === '/api/login') {
        if (!who) return err('That code was not recognised', 401);
        return json({ who });
      }
      if (!who) return err('Sign in with your access code', 401);
      if (who.viewAs && method !== 'GET') return err('You are previewing as ' + who.name + '. Previews are read-only, so nothing was changed.', 403);

      // ---------- role-aware overview ----------
      if (path === '/api/overview') {
        const { years, sum, year, rehearsal } = await loadSummary(env, url.searchParams.get('year'));
        if (!sum) return json({ status: 'waiting', who, years });
        const queries = await loadQueries(env);
        const base = { status: 'ok', who, year, years, rehearsal, as_of: sum.as_of, today: eatToday(), bands: sum.bands, ...publicView(sum) };
        if (who.role === 'hq') {
          const plans = {};
          (await Promise.all(REGIONS.map((r) => getPlan(env, r)))).forEach((p, k) => { plans[REGIONS[k]] = { status: p.status, visits: p.visits.length, changes: p.changes.length, late_changes: p.changes.filter((c) => c.late).length, submitted_at: p.submitted_at, days_one: dayCounts(p).one, days_three: dayCounts(p).three }; });
          return json({ ...base, staff: STAFF.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, position: s.position, region: s.region, role: s.role })), admins: sum.admins, flags: decorate(sum.flags.map((f) => ({ ...f, school_name: SCHOOL_BY_ID[f.school]?.name, region: SCHOOL_BY_ID[f.school]?.region, lga: SCHOOL_BY_ID[f.school]?.lga, ward: SCHOOL_BY_ID[f.school]?.ward })), queries).slice(0, 600), plans, unlisted: sum.admins.filter((a) => a.role === 'unlisted').map((a) => a.name) });
        }
        if (who.role === 'rc' || who.role === 'arc') {
          return json({ ...base, mine: regionBundle(sum, who.region, who, queries) });
        }
        // volunteer: own numbers, own queries, own work, and region ranks
        const me = sum.admins.find((a) => a.staff_id === who.id) || null;
        const bundle = regionBundle(sum, who.region, who, queries);
        const myName = me?.name || who.name;
        const mine = {
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
        const reg = SCHOOL_BY_ID[school]?.region;
        if (!reg || !canSeeRegion(who, reg)) return err('Not your region', 403);
        const r = await postQuery(env, who, body);
        if (r.error) return err(r.error, r.status || 400);
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
        // linked: coverage + enrolment vs attendance for everyone with access; results by grade and subject for HQ only
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

      // ---------- phones: what each phone did, for the whole team to see ----------
      if (path === '/api/phones') {
        const years = await readYears(env);
        const wantY = url.searchParams.get('year');
        let year = wantY && years.includes(wantY) ? wantY : null; let dates = [];
        for (const y of year ? [year] : [...years].reverse()) { const d = env.DASHBOARD_KV ? await env.DASHBOARD_KV.get(`tl:${y}:dates`, { type: 'json', cacheTtl: 30 }) : null; if (d && d.length) { year = y; dates = d; break; } }
        if (!year || !dates.length) return json({ status: 'none', note: 'No phone data yet. It appears once sampling or test records carry the phone ID.' });
        const date = dates.includes(url.searchParams.get('date')) ? url.searchParams.get('date') : dates[dates.length - 1];
        const doc = await env.DASHBOARD_KV.get(`tl:${year}:${date}`, { type: 'json' });
        const sum = await readSummary(env, year);
        const myRegion = who.role === 'hq' ? (url.searchParams.get('region') || null) : who.region;
        const inScope = (sc) => !myRegion || SCHOOL_BY_ID[sc]?.region === myRegion;
        const events = (doc?.events || []).filter((e) => inScope(e.sc));
        const codes = new Set(events.map((e) => e.c));
        const phones = (doc?.phones || []).filter((p) => p.schools.some(inScope)).map((p) => ({ ...p, schools: p.schools.filter(inScope).map((sc) => ({ id: sc, name: SCHOOL_BY_ID[sc]?.name?.trim() })) }));
        const DEVT = new Set(['devoverlap', 'devtravel', 'devswitch', 'devnames', 'namedevs', 'devshare', 'headcount', 'devowner']);
        const flags = (sum?.flags || []).filter((f) => DEVT.has(f.type) && f.date === date && inScope(f.school)).map((f) => ({ ...f, school_name: SCHOOL_BY_ID[f.school]?.name, region: SCHOOL_BY_ID[f.school]?.region, lga: SCHOOL_BY_ID[f.school]?.lga }));
        const bySchool = {};
        for (const e of events) (bySchool[e.sc] ||= new Set()).add(e.c);
        return json({ status: 'ok', year, date, dates, region: myRegion, events, phones, flags, schools: Object.entries(bySchool).map(([id, set]) => ({ id, name: SCHOOL_BY_ID[id]?.name?.trim(), region: SCHOOL_BY_ID[id]?.region, phones: set.size })) });
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
        const visitDates = sum ? Object.fromEntries(Object.values(sum.schools).filter((s) => s.region === region).map((s) => [s.id, s.dates])) : {};

        if (method === 'GET') {
          const plan = await getPlan(env, region);
          return json({ plan: withNotices(plan, today, visitDates), schools: (SCHOOLS_BY_REGION[region] || []).map((s) => ({ id: s.id, name: s.name, lga: s.lga, mne: s.mne, arm: s.arm })), staff: STAFF.filter((s) => s.active && s.region === region).map((s) => ({ name: s.name, position: s.position })), today });
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
          return json({ plan: withNotices(r.plan, today, visitDates) });
        }
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
      if (path === '/api/admin/calendar-csv') {
        // Reference file for the KoBo forms (upload as media named ref_calendar.csv). One row per planned school.
        const plans = await Promise.all(REGIONS.map((r) => getPlan(env, r)));
        const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const stamp = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
        const version = plans.reduce((a, p) => a + (p.version || 0), 0);
        const rows = [['school', 'planned_date', 'school_name', 'region', 'lga', 'start', 'team']];
        rows.push(['_CALENDAR', `v${version} ${stamp}`, 'calendar switch and version', '', '', '', '']);
        let n = 0;
        plans.forEach((p, k) => { if (p.status !== 'locked') return; for (const v of p.visits) { const s = SCHOOL_BY_ID[v.school]; rows.push([v.school, v.date, s?.name?.trim() || '', REGIONS[k], s?.lga || '', v.start || '', (v.team || []).join('; ')]); n++; } });
        await kv(env).put('v2:calcsv:last', { at: new Date().toISOString(), rows: n, version: `v${version}` });
        return new Response(rows.map((r) => r.map(q).join(',')).join('\n') + '\n', { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="ref_calendar.csv"`, 'x-calendar-rows': String(n), 'x-calendar-version': `v${version}`, 'cache-control': 'no-store' } });
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
        add(Boolean(cal), 'Calendar file downloaded for the KoBo forms', cal ? `last download ${age(cal.at)} min ago, ${cal.rows} schools, ${cal.version}` : 'never downloaded', 'Admin: download ref_calendar.csv after plans are in, and upload it to both forms.');
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
      if (path === '/api/admin/push-status') return json(await pushStatus(env));
      if (path === '/api/admin/push-test' && method === 'POST') {
        const b = await request.json();
        const r = await pushTo(env, (w) => (!b.region || w.region === b.region) && (!b.role || w.role === b.role) && (!b.id || w.id === b.id), { title: 'KiuFunza 4 · Test alert', body: 'If you can read this, phone alerts work on this device.', url: '/' });
        return json(r);
      }
      if (path === '/api/admin/reminders' && method === 'POST') { const b = await request.json(); return json({ results: await runReminders(env, { dry: b.dry !== false }) }); }
      if (path === '/api/admin/reminder-preview') { const m = await reminderEmail(env, (url.searchParams.get('region') || 'TANGA').toUpperCase(), eatToday(), env.SITE_URL || url.origin); return json(m || { subject: 'Nothing to remind', html: '<p>Nothing due right now.</p>', text: '' }); }
      if (path === '/api/admin/status') { const years = (await kv(env).get('v2:years')) || []; const archived = {}; for (const y of years) { const m = await kv(env).get(`v2:arch:${y}`); if (m) archived[y] = m; } return json({ sync: await syncStatus(env), years, archived }); }
      if (path === '/api/admin/refresh' && method === 'POST') return json({ ran: await tick(env, { force: true }) });
      if (path === '/api/admin/resync' && method === 'POST') {
        const b = await request.json();
        if (b.kind === 'teachers') for (const y of await stateYears(env)) { const Y = await loadYear(env, y); if (Y && Object.keys(Y.tf || {}).length) { Y.tf = {}; await saveYear(env, y, Y); } } // teacher aggregates are rebuilt from scratch so nothing is counted twice
        await resetKind(env, b.kind); return json({ ok: true, kind: b.kind });
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
      await ensureRoster(env, true);
      const out = await tick(env);
      if (out.length) console.log(JSON.stringify(out));
      const hhmm = new Date().toISOString().slice(11, 16);
      const hourNow = Number(hhmm.slice(0, 2));
      const alertSlot = { '04:05': 'morning', '08:00': 'silent', '13:30': 'evening' }[hhmm] || (hhmm.endsWith(':00') && hourNow >= 4 && hourNow <= 15 ? 'health' : null); // health: every hour of the field day
      if (alertSlot) {
        const day = eatToday(); const last = (await kv(env).get('v2:push:ran')) || {};
        const ranKey = alertSlot + ':' + hhmm;
        if (last[ranKey] !== day) { last[ranKey] = day; await kv(env).put('v2:push:ran', last); const sum = await kv(env).get('v2:sum:' + CURRENT_YEAR); console.log('alerts ' + JSON.stringify(await runAlerts(env, alertSlot, sum)).slice(0, 400)); }
      }
      const bk = await maybeRunScheduledBackup(env); if (bk) console.log('backup ' + JSON.stringify(bk));
      const dg = await maybeRunScheduledDigests(env);
      if (dg) console.log('digest ' + JSON.stringify(dg).slice(0, 500));
    } catch (e) {
      console.error('scheduled run failed: ' + (e && e.message));
    }
  },
};
