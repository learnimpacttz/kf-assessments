import { kv } from './store.js';
import { buildBrief, aiBrief } from './brief.js';
import { morningDigest, eveningGap, loadRecipients, saveRecipients, runDigests, maybeRunScheduledDigests, sendMail, onboardingEmail, runOnboarding, hqOnboardingEmail, reminderEmail, runReminders } from './digest.js';
import { loadQueries, decorate, postQuery, flagKey } from './queries.js';
import { identify, staffCodes, canSeeRegion } from './auth.js';
import { forecast, atRiskSchools } from './predict.js';
import { subscribe, unsubscribe, takeAlert, hashEndpoint, pushTo, pushStatus, pushReady, runAlerts } from './push.js';
import { tick, syncStatus, recomputeSummaries, resetAll, resetKind, loadState, loadYear } from './sync.js';
import { getPlan, submitPlan, saveDraft, changeVisit, markNotice, withNotices } from './plan.js';
import {
  REGIONS, PARTNERS, REASONS, FIELD_START, FIELD_END, CURRENT_YEAR, STAFF, SCHOOLS_BY_REGION, SCHOOL_BY_ID, eatToday,
  TARGET_PER_GRADE, DODOMA_TARGET_PER_GRADE, NOTICE_AEK_WORKING_DAYS, NOTICE_HT_WORKING_DAYS,
} from './config.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
const err = (message, status = 400, extra = {}) => json({ error: message, ...extra }, status);

async function loadSummary(env, wanted) {
  const years = (await kv(env).get('v2:years')) || [];
  let year = wanted && years.includes(wanted) ? wanted : years.includes(CURRENT_YEAR) ? CURRENT_YEAR : years[years.length - 1];
  if (!year) return { years, sum: null, year: null, rehearsal: false };
  let sum = await kv(env).get(`v2:sum:${year}`);
  // Until the first 2026 test arrives the live year is empty (the teacher baseline alone creates it),
  // so open on the latest earlier year as a clearly marked rehearsal. A person can still pick 2026 directly.
  if (!wanted && year === CURRENT_YEAR && sum && !sum.national.records) {
    const earlier = years.filter((y) => y !== CURRENT_YEAR).pop();
    if (earlier) { year = earlier; sum = await kv(env).get(`v2:sum:${year}`); }
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
  first: s.first, last: s.last, dates: s.dates, admins: s.admins, max_team: s.maxTeam, teacher_forms: s.tf,
});

function rankAdmins(admins) {
  return admins.filter((a) => a.quality !== null).sort((a, b) => b.quality - a.quality || b.tested - a.tested);
}

function regionBundle(sum, region, who, queries = {}) {
  const schools = (SCHOOLS_BY_REGION[region] || []).map((s) => schoolRow(sum.schools[s.id]));
  const admins = sum.admins.filter((a) => a.region === region);
  const flags = decorate(sum.flags.filter((f) => SCHOOL_BY_ID[f.school]?.region === region).map((f) => ({ ...f, school_name: SCHOOL_BY_ID[f.school]?.name, region, lga: SCHOOL_BY_ID[f.school]?.lga, ward: SCHOOL_BY_ID[f.school]?.ward })), queries);
  const staff = STAFF.filter((s) => s.region === region).map((s) => ({ id: s.id, name: s.name, position: s.position, role: s.role }));
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

    try {
      if (path === '/api/config') {
        return json({
          year: CURRENT_YEAR, field: { start: FIELD_START, end: FIELD_END }, regions: REGIONS, partners: PARTNERS, reasons: REASONS,
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

      // ---------- role-aware overview ----------
      if (path === '/api/overview') {
        const { years, sum, year, rehearsal } = await loadSummary(env, url.searchParams.get('year'));
        if (!sum) return json({ status: 'waiting', who, years });
        const queries = await loadQueries(env);
        const base = { status: 'ok', who, year, years, rehearsal, as_of: sum.as_of, today: eatToday(), bands: sum.bands, ...publicView(sum) };
        if (who.role === 'hq') {
          const plans = {};
          for (const r of REGIONS) { const p = await getPlan(env, r); plans[r] = { status: p.status, visits: p.visits.length, changes: p.changes.length, late_changes: p.changes.filter((c) => c.late).length, submitted_at: p.submitted_at }; }
          return json({ ...base, work: sum.work, admins: sum.admins, flags: decorate(sum.flags.map((f) => ({ ...f, school_name: SCHOOL_BY_ID[f.school]?.name, region: SCHOOL_BY_ID[f.school]?.region, lga: SCHOOL_BY_ID[f.school]?.lga, ward: SCHOOL_BY_ID[f.school]?.ward })), queries).slice(0, 600), plans, unlisted: sum.admins.filter((a) => a.role === 'unlisted').map((a) => a.name) });
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
          return json({ plan: withNotices(plan, today, visitDates), schools: (SCHOOLS_BY_REGION[region] || []).map((s) => ({ id: s.id, name: s.name, lga: s.lga, mne: s.mne, arm: s.arm })), staff: STAFF.filter((s) => s.region === region).map((s) => ({ name: s.name, position: s.position })), today });
        }
        if (method === 'POST') {
          if (who.role !== 'rc' && who.role !== 'arc' && who.role !== 'hq') return err('Only coordinators can change the plan', 403);
          const body = await request.json();
          let r;
          if (body.action === 'submit') r = await submitPlan(env, who, region, body.visits || []);
          else if (body.action === 'draft') r = await saveDraft(env, region, body.visits || []);
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
      if (path === '/api/admin/resync' && method === 'POST') { const b = await request.json(); await resetKind(env, b.kind); return json({ ok: true, kind: b.kind }); }
      if (path === '/api/admin/recompute' && method === 'POST') { await recomputeSummaries(env); return json({ ok: true }); }
      if (path === '/api/admin/full-resync' && method === 'POST') { await resetAll(env); return json({ ok: true, note: 'State cleared. The next ticks re-read every form from the start.' }); }
      if (path === '/api/admin/state-size') { const s = await loadState(env); return json({ years: Object.fromEntries(Object.entries(s.yrs).map(([y, Y]) => [y, { records: Y.n, cells: Object.keys(Y.cells).length, sg: Object.keys(Y.sg).length, teacher_schools: Object.keys(Y.tf).length }])) }); }

      return err('Not found', 404);
    } catch (e) {
      return err('Something went wrong on the server', 500, { detail: String(e && e.message || e) });
    }
  },

  async scheduled(event, env, ctx) {
    try {
      const out = await tick(env);
      if (out.length) console.log(JSON.stringify(out));
      const hhmm = new Date().toISOString().slice(11, 16);
      const alertSlot = { '04:05': 'morning', '13:30': 'evening' }[hhmm];
      if (alertSlot) {
        const day = eatToday(); const last = (await kv(env).get('v2:push:ran')) || {};
        if (last[alertSlot] !== day) { last[alertSlot] = day; await kv(env).put('v2:push:ran', last); const sum = await kv(env).get('v2:sum:' + CURRENT_YEAR); console.log('alerts ' + JSON.stringify(await runAlerts(env, alertSlot, sum)).slice(0, 400)); }
      }
      const dg = await maybeRunScheduledDigests(env);
      if (dg) console.log('digest ' + JSON.stringify(dg).slice(0, 500));
    } catch (e) {
      console.error('scheduled run failed: ' + (e && e.message));
    }
  },
};
