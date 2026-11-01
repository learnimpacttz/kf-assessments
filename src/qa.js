// Field QA visits: the quality-assurance form (KoBo project "KF4 Quality Assurance 2026") that headquarters observers fill in at schools.
// It is read every few minutes into a small list of visits, scored, and checked against what the Command Center already knows
// (the plan, the school's location, who tested there that day, the attendance the team entered). HQ only; a prompt for support, not a verdict.
// Nothing here changes KoBo or any KiuFunza number: it only reads. Re-reading is safe: visits are keyed by the KoBo record id.
import { kv } from './store.js';
import { fetchKoboPage } from './kobo.js';
import { SCHOOL_BY_ID, staffForKoboName, eatToday, FIELD_START, norm } from './config.js';
import { SCHOOL_COORDS } from './data/school_coords.js';
import { metres } from './location.js';
import { getPlan } from './plan.js';

const K_VISITS = 'v2:qa:visits', K_FORM = 'v2:qa:form', K_SYNC = 'v2:qa:sync';
export const SECTIONS = { b: 'Pre-visit compliance', c: 'Arrival and opening meeting', d: 'School readiness', e: 'Assessor and field plan', f: 'Materials', g: 'Attendance check and random selection', h: 'Room setup', i: 'Test administration' };
// Items where a "No" is a serious lapse in the protocol (proposed definition: consent, attendance integrity, random selection, grading accuracy, the app's rules)
export const CRITICAL = new Set(['c2', 'g1', 'g2', 'g3', 'g5', 'g6', 'i3', 'i4']);
const GPS_FAR_M = 1500;
const ITEM = /^([b-h])(\d)$|^i([1-6])_p([1-4])$/;
const clean = (s) => String(s || '').replace(/\s*\([^)]*\)\s*$/, '').trim(); // the form labels carry a role in brackets

// ---- the form: question wording and the name lists, kept once per version
async function loadForm(env, force = false) {
  const have = await kv(env).get(K_FORM);
  if (have && !force && Date.now() - Date.parse(have.at || 0) < 6 * 3600e3) return have;
  const r = await fetch(`https://${env.KOBO_SERVER || 'kf.kobotoolbox.org'}/api/v2/assets/${env.KOBO_ASSET_QA}/?format=json`, { headers: { Authorization: `Token ${env.KOBO_TOKEN}` } });
  if (!r.ok) { if (have) return have; throw new Error(`KoBo ${r.status} reading the QA form`); }
  const a = await r.json(); const c = a.content || {}; const lab = (x) => (Array.isArray(x.label) ? x.label[0] : x.label) || '';
  const items = {}; for (const q of c.survey || []) { const m = ITEM.exec(q.name || ''); if (!m || !/^select_one/.test(q.type || '')) continue; const base = m[1] ? q.name : 'i' + m[3]; items[base] = { label: lab(q).replace(/^[A-Z]\d+\.\s*/, ''), sec: m[1] || 'i' }; }
  const lists = {}; for (const x of c.choices || []) if (['observer', 'enumerator', 'leader', 'region', 'lga'].includes(x.list_name)) (lists[x.list_name] ||= {})[x.name] = lab(x);
  const f = { at: new Date().toISOString(), version: a.deployed_version_id || a.version_id || '', name: a.name || '', items, lists, submissions: a.deployment__submission_count ?? null };
  await kv(env).put(K_FORM, f); return f;
}

// ---- one KoBo record -> one compact visit
const flat = (r) => { const o = {}; for (const k of Object.keys(r)) o[k.slice(k.lastIndexOf('/') + 1)] = r[k]; return o; };
const tm = (s) => (typeof s === 'string' && /^\d\d:\d\d/.test(s) ? s.slice(0, 5) : '');
export function visitOf(r, F) {
  const o = flat(r); const L = F.lists || {}; const s = SCHOOL_BY_ID[o.school]; const ans = {};
  for (const k of Object.keys(o)) { if (!ITEM.test(k)) continue; const v = String(o[k]); if (v === '1' || v === '0' || v === '99') ans[k] = Number(v); }
  const g = Array.isArray(r._geolocation) && r._geolocation[0] != null ? [Number(r._geolocation[0]), Number(r._geolocation[1])] : null; // only the distance from the school is kept, never the point
  const sc = SCHOOL_COORDS[o.school]; const gps_m = g && sc && Number.isFinite(g[0]) && Number.isFinite(g[1]) ? Math.round(metres(g, sc)) : null;
  const num = (x) => (x === undefined || x === '' || x === null ? null : Number(x));
  return { id: r._id, at: r._submission_time || '', date: String(o.visit_date || '').slice(0, 10), region: o.region || '', lga: o.lga || '', school: o.school || '', school_name: s ? s.name : String(o.school_name || o.school || ''),
    observer: (L.observer || {})[o.observer] || o.observer || '', user: o.username || '', leader: clean((L.leader || {})[o.team_leader] || o.team_leader || ''), first: String(o.first_ass) === '1', arrival: tm(o.obs_arrival),
    ass: clean((L.enumerator || {})[o.ass_name] || o.ass_name || ''), grade: num(o.ass_grade), team: String(o.planned_team || ''), b3a: num(o.b3a), b4a: num(o.b4a), reg: num(o.g2a), n_pupils: num(o.n_pupils) || (Object.keys(ans).some((k) => /_p1$/.test(k)) ? 1 : 0),
    comment: String(o.obs_comment || ''), has_gps: Boolean(g), gps_m, start: String(o.start || '').slice(11, 16), end: String(o.end || '').slice(11, 16), ans };
}

// ---- reading KoBo (all records each time: a few hundred at most, and edits and deletions are picked up)
export async function syncQa(env, { force = false } = {}) {
  if (!env.KOBO_ASSET_QA || !env.KOBO_TOKEN) return null;
  const st = (await kv(env).get(K_SYNC)) || {}; const now = Date.now();
  if (!force && st.at && now - Date.parse(st.at) < 4 * 60e3) return null;
  try {
    const F = await loadForm(env, force); const rows = []; let cursor = null;
    for (let i = 0; i < 20; i++) { const p = await fetchKoboPage(env.KOBO_SERVER || 'kf.kobotoolbox.org', env.KOBO_ASSET_QA, env.KOBO_TOKEN, cursor, 0); rows.push(...p.results); if (!p.next) break; cursor = p.next; }
    const visits = rows.map((r) => visitOf(r, F)).sort((a, b) => b.id - a.id);
    await kv(env).put(K_VISITS, visits); await kv(env).put(K_SYNC, { at: new Date().toISOString(), ok: true, n: visits.length, version: F.version });
    return { n: visits.length };
  } catch (e) { await kv(env).put(K_SYNC, { ...st, at: new Date().toISOString(), ok: false, error: String(e.message || e).slice(0, 200) }); return { error: String(e.message || e) }; }
}

// ---- scoring
export function score(v, F) {
  const secs = {}; const fails = []; let yes = 0, tot = 0, crit = 0;
  for (const [k, a] of Object.entries(v.ans)) {
    const m = ITEM.exec(k); if (!m || a === 99) continue; const sec = m[1] || 'i'; const base = m[1] ? k : 'i' + m[3]; const S = (secs[sec] ||= { yes: 0, n: 0 });
    S.n++; tot++; if (a === 1) { S.yes++; yes++; } else { const lab = ((F.items || {})[base] || {}).label || base; const c = CRITICAL.has(base); if (c) crit++; fails.push({ k: base, sec, pupil: m[4] ? Number(m[4]) : null, label: lab, critical: c }); }
  }
  for (const S of Object.values(secs)) S.pct = S.n ? Math.round((100 * S.yes) / S.n) : null;
  return { pct: tot ? Math.round((100 * yes) / tot) : null, answered: tot, secs, fails, critical: crit };
}

// ---- the view: every visit with its score and the cross-checks, and the roll-ups
export async function qaView(env, sum) {
  const F = (await kv(env).get(K_FORM)) || { items: {}, lists: {} }; const sync = (await kv(env).get(K_SYNC)) || null; const raw = (await kv(env).get(K_VISITS)) || [];
  const today = eatToday(); const plans = {}; const regions = [...new Set(raw.map((v) => String(v.region || '').toUpperCase()).filter(Boolean))];
  for (const r of regions) { try { plans[r] = await getPlan(env, r); } catch { plans[r] = { visits: [] }; } }
  const first = new Map(); const kOf = (v) => [v.school, v.date, norm(v.ass), v.grade, v.observer].join('|'); for (const v of raw) { const k = kOf(v); if (!first.has(k) || v.id < first.get(k)) first.set(k, v.id); }
  const visits = raw.map((v) => {
    const sc = score(v, F); const flags = []; const R = String(v.region).toUpperCase(); const S = SCHOOL_BY_ID[v.school]; const canon = (staffForKoboName(v.ass) || {}).name || v.ass;
    if (v.date && v.date > today) flags.push({ t: 'date', text: `The visit date ${v.date} is in the future.` });
    if (v.date && v.date < FIELD_START) flags.push({ t: 'date', text: `The visit date ${v.date} is before field work began (${FIELD_START}).` });
    if (!S) flags.push({ t: 'school', text: 'The school code is not in the school list.' });
    if (v.gps_m != null) { if (v.gps_m > GPS_FAR_M) flags.push({ t: 'gps', text: `The QA form was filled ${(v.gps_m / 1000).toFixed(1)} km from the school.` }); }
    else if (!v.has_gps) flags.push({ t: 'gps', text: 'No location was saved with the QA form.' });
    if (v.ass && !staffForKoboName(v.ass)) flags.push({ t: 'person', text: `"${v.ass}" is not in the people list.` });
    const pv = ((plans[R] || {}).visits || []).filter((x) => x.school === v.school);
    if (pv.length) { const on = pv.find((x) => x.date === v.date); if (!on) flags.push({ t: 'plan', text: `The plan has this school on ${pv.map((x) => x.date).join(', ')}, not on ${v.date}.` }); else if (v.ass && !(on.team || []).some((n) => norm(n) === norm(canon))) flags.push({ t: 'plan', text: `${canon} is not on the planned team for this visit (${(on.team || []).join(', ')}).` }); }
    const da = (((sum || {}).schools || {})[v.school] || {}).dayAdmins || {}; if (sum && v.date && v.date <= today && v.ass && !(da[v.date] || []).includes(canon)) flags.push({ t: 'records', text: `The Command Center has no tests or sampling by ${canon} at this school on ${v.date} (records may not have arrived yet).` });
    const att = (((((sum || {}).schools || {})[v.school] || {}).g || {})[v.grade] || {}).att; if (v.reg != null && att != null && att !== v.reg) flags.push({ t: 'register', text: `The register count seen by the observer (${v.reg}) differs from the attendance the team entered (${att}).` });
    if (v.ans.e1 === 0) flags.push({ t: 'plan', text: 'The observer marked the assessor as not on the planned team.' });
    const f0 = first.get(kOf(v)); if (f0 !== v.id) flags.push({ t: 'dup', text: `Looks like a repeat of QA record ${f0}.` });
    return { ...v, school_name: S ? S.name : v.school_name, region_name: R, lga_name: S ? S.lga : v.lga, pct: sc.pct, answered: sc.answered, secs: sc.secs, fails: sc.fails, critical: sc.critical, flags };
  });
  // roll-ups
  const avg = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null);
  const by = (f) => { const m = {}; for (const v of visits) { const k = f(v); if (!k) continue; (m[k] ||= []).push(v); } return m; };
  const items = {}; for (const v of visits) for (const f of v.fails) { const x = (items[f.k] ||= { k: f.k, label: f.label, sec: f.sec, critical: f.critical, fails: 0, asked: 0 }); x.fails++; } for (const v of visits) for (const k of Object.keys(v.ans)) { const b = /^i\d/.test(k) ? k.replace(/_p\d$/, '') : k; if (items[b] && v.ans[k] !== 99) items[b].asked++; }
  const secs = {}; for (const sec of Object.keys(SECTIONS)) { const p = visits.map((v) => (v.secs[sec] || {}).pct).filter((x) => x != null); secs[sec] = { label: SECTIONS[sec], pct: avg(p), n: p.length }; }
  const summary = { visits: visits.length, schools: new Set(visits.map((v) => v.school)).size, assessors: new Set(visits.map((v) => norm(v.ass))).size, avg_pct: avg(visits.map((v) => v.pct).filter((x) => x != null)), critical_visits: visits.filter((v) => v.critical).length, flagged: visits.filter((v) => v.flags.length).length,
    sections: secs, top_fails: Object.values(items).sort((a, b) => b.fails - a.fails).slice(0, 10),
    by_region: Object.entries(by((v) => v.region_name)).map(([r, a]) => ({ region: r, visits: a.length, avg_pct: avg(a.map((v) => v.pct).filter((x) => x != null)), critical: a.filter((v) => v.critical).length })).sort((a, b) => b.visits - a.visits),
    by_assessor: Object.entries(by((v) => canonName(v.ass))).map(([n, a]) => ({ name: n, visits: a.length, avg_pct: avg(a.map((v) => v.pct).filter((x) => x != null)), critical: a.reduce((s, v) => s + v.critical, 0) })).sort((a, b) => (a.avg_pct ?? 101) - (b.avg_pct ?? 101)),
    by_observer: Object.entries(by((v) => v.observer)).map(([n, a]) => ({ name: n, visits: a.length, schools: new Set(a.map((v) => v.school)).size })).sort((a, b) => b.visits - a.visits) };
  return { status: 'ok', form: { name: F.name || '', version: F.version || '', url: env.QA_FORM_URL || '', configured: Boolean(env.KOBO_ASSET_QA) }, sync, summary, visits };
}
const canonName = (n) => (staffForKoboName(n) || {}).name || n;
