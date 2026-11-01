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
import { loadYear } from './sync.js';
import { flagKey } from './queries.js';
import { pushTo } from './push.js';
import { CURRENT_YEAR } from './config.js';

const K_VISITS = 'v2:qa:visits', K_FORM = 'v2:qa:form', K_SYNC = 'v2:qa:sync', K_RAISED = 'v2:qa:raised', K_ALERTED = 'v2:qa:alerted';
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
  const lists = {}; for (const x of c.choices || []) if (['observer', 'enumerator', 'leader', 'region', 'lga', 'follow_up'].includes(x.list_name)) (lists[x.list_name] ||= {})[x.name] = lab(x);
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
    follow: (L.follow_up || {})[o.follow_up] || String(o.follow_up || ''), rands: [1, 2, 3, 4].map((k) => { const n = parseInt(o['rand_p' + k], 10); return Number.isFinite(n) ? n : null; }), comment: String(o.obs_comment || ''), has_gps: Boolean(g), gps_m, start: String(o.start || '').slice(11, 16), end: String(o.end || '').slice(11, 16), ans };
}

// ---- reading KoBo (all records each time: a few hundred at most, and edits and deletions are picked up)
export async function syncQa(env, { force = false, minAge = 4 * 60e3 } = {}) {
  if (!env.KOBO_ASSET_QA || !env.KOBO_TOKEN) return null;
  const st = (await kv(env).get(K_SYNC)) || {}; const now = Date.now();
  if (!force && st.at && now - Date.parse(st.at) < minAge) return null;
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

// ---- phone alert to the HQ team (not Advisors) when a new visit has a serious item answered No. One alert per visit; the first run only notes what is already there.
export async function alertQa(env, send = pushTo) {
  const raw = (await kv(env).get(K_VISITS)) || []; const seen = await kv(env).get(K_ALERTED);
  if (!seen) { await kv(env).put(K_ALERTED, raw.map((v) => v.id)); return { baseline: raw.length }; }
  const F = (await kv(env).get(K_FORM)) || { items: {} }; const done = new Set(seen); const fresh = raw.filter((v) => !done.has(v.id));
  if (!fresh.length) return { sent: 0 };
  let sent = 0;
  for (const v of fresh) {
    done.add(v.id); if (/^\s*test\b/i.test(v.comment || '')) continue; const n = score(v, F).critical; if (!n) continue;
    await send(env, (w) => Boolean(w && w.role === 'hq' && !(Array.isArray(w.hide) && w.hide.length)), { title: 'QA visit: serious item answered No', body: `${(SCHOOL_BY_ID[v.school] || {}).name || 'A school'}: ${n} serious item${n === 1 ? '' : 's'}. Open QA visits.`, url: '/#qa' }); sent++;
  }
  await kv(env).put(K_ALERTED, [...done]); return { sent };
}

// ---- visits from the last few days with a serious item answered No (for the Bridge)
export async function qaAttention(env, today, days = 3) {
  const raw = (await kv(env).get(K_VISITS)) || []; if (!raw.length) return { n: 0, list: [] };
  const F = (await kv(env).get(K_FORM)) || { items: {} }; const from = new Date(Date.parse(today + 'T00:00:00Z') - days * 86400e3).toISOString().slice(0, 10);
  const list = raw.filter((v) => !/^\s*test\b/i.test(v.comment || '')).filter((v) => v.date >= from || String(v.at).slice(0, 10) >= from).map((v) => ({ v, sc: score(v, F) })).filter((x) => x.sc.critical).map((x) => ({ id: x.v.id, school: (SCHOOL_BY_ID[x.v.school] || {}).name || x.v.school, ass: x.v.ass, serious: x.sc.critical }));
  return { n: list.length, list };
}

// ---- HQ decides to send a finding to the team as a query: it becomes an ordinary check ("qa") that follows the normal review chain.
// Nothing is sent by this step itself; the person the visit was about finds it under their queries, like any other check.
const qaFlagOf = (v, F, note, by, at) => {
  const sc = score(v, F); const st = staffForKoboName(v.ass); const name = st ? st.name : v.ass; const sch = SCHOOL_BY_ID[v.school];
  const items = [...new Set(sc.fails.map((f) => f.label))].slice(0, 8);
  return { sev: 'warn', type: 'qa', school: v.school, grade: v.grade || 0, admin: name, date: v.date, region: sch ? sch.region : '', recs: [], qa_id: v.id, raised_by: by, raised_at: at,
    text: `A quality-assurance visit on ${v.date} noted ${items.length} item${items.length === 1 ? '' : 's'} to follow up: ${items.join('; ')}.${note ? ' Note from HQ: ' + note : ''}`,
    hint: 'Write what happened and what was done, or what will change next time. This comes from an HQ observer who watched the visit, and it is for support.', normal: 'every checklist item answered Yes' };
};
export async function raiseQa(env, who, { id, note }) {
  const raw = (await kv(env).get(K_VISITS)) || []; const v = raw.find((x) => String(x.id) === String(id)); if (!v) return { error: 'That QA visit was not found. Read the new visits and try again.', status: 404 };
  const F = (await kv(env).get(K_FORM)) || { items: {} }; const sc = score(v, F);
  if (/^\s*test\b/i.test(v.comment || '')) return { error: 'This is a practice visit.', status: 422 };
  if (!SCHOOL_BY_ID[v.school]) return { error: 'The school code is not in the school list.', status: 422 };
  if (!staffForKoboName(v.ass)) return { error: `"${v.ass}" is not in the people list, so the query has nobody to go to. Ask the Systems Owner to fix the name first.`, status: 422 };
  if (!sc.fails.length) return { error: 'No item was answered No, so there is nothing to send.', status: 422 };
  const n = String(note || '').trim().slice(0, 300); const f = qaFlagOf(v, F, n, who.name, new Date().toISOString()); const key = flagKey(f);
  const raised = (await kv(env).get(K_RAISED)) || {}; if (raised[key]) return { error: 'This finding was already sent to the team as a query.', status: 409, key };
  raised[key] = { visit: v.id, note: n, by: who.name, at: f.raised_at }; await kv(env).put(K_RAISED, raised); return { ok: true, key };
}
// the checks for the findings HQ sent on (rebuilt from the stored visit each time, so the wording follows the form)
export async function qaRaisedFlags(env) {
  const raised = (await kv(env).get(K_RAISED)) || {}; const keys = Object.keys(raised); if (!keys.length) return [];
  const raw = (await kv(env).get(K_VISITS)) || []; const F = (await kv(env).get(K_FORM)) || { items: {} }; const out = [];
  for (const [k, r] of Object.entries(raised)) { const v = raw.find((x) => String(x.id) === String(r.visit)); if (v) out.push({ ...qaFlagOf(v, F, r.note, r.by, r.at), qa_key: k }); }
  return out;
}

// ---- the view: every visit with its score and the cross-checks, and the roll-ups
export async function qaView(env, sum) {
  const F = (await kv(env).get(K_FORM)) || { items: {}, lists: {} }; const sync = (await kv(env).get(K_SYNC)) || null; const raw = (await kv(env).get(K_VISITS)) || [];
  const today = eatToday(); const plans = {}; const regions = [...new Set(raw.map((v) => String(v.region || '').toUpperCase()).filter(Boolean))];
  for (const r of regions) { try { plans[r] = await getPlan(env, r); } catch { plans[r] = { visits: [] }; } }
  let SG = null; if (raw.some((v) => (v.rands || []).some((n) => n != null))) { try { SG = ((await loadYear(env, CURRENT_YEAR)) || {}).sg || null; } catch { SG = null; } }
  const raisedMap = (await kv(env).get(K_RAISED)) || {}; const raisedBy = (v) => { const r = Object.values(raisedMap).find((x) => String(x.visit) === String(v.id)); return r ? { at: r.at, by: r.by } : null; };
  const first = new Map(); const kOf = (v) => [v.school, v.date, norm(v.ass), v.grade, v.observer].join('|'); for (const v of raw) { const k = kOf(v); if (!first.has(k) || v.id < first.get(k)) first.set(k, v.id); }
  let visits = raw.map((v) => {
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
    if (SG && v.grade) { const rn = (SG[`${v.school}|${v.grade}`] || {}).rn || []; (v.rands || []).forEach((n, i) => { if (n == null) return; const hit = rn.map((e) => e.split('~')).find((e) => parseInt(e[0], 10) === n); if (!hit) flags.push({ t: 'pupil', text: `Pupil ${i + 1} (number ${n}) has no test record for this school and grade yet.` }); else if (v.ass && norm(hit[1]) !== norm(canon)) flags.push({ t: 'pupil', text: `Pupil ${i + 1} (number ${n}) was tested by ${hit[1]}, not by ${canon}.` }); }); }
    const f0 = first.get(kOf(v)); if (f0 !== v.id) flags.push({ t: 'dup', text: `Looks like a repeat of QA record ${f0}.` });
    const test = /^\s*test\b/i.test(v.comment); // a practice submission (comment starts with TEST) is shown but never counted
    return { ...v, test, raised: raisedBy(v), school_name: S ? S.name : v.school_name, region_name: R, lga_name: S ? S.lga : v.lga, pct: sc.pct, answered: sc.answered, secs: sc.secs, fails: sc.fails, critical: sc.critical, flags };
  });
  // roll-ups (practice submissions are left out)
  const all = visits; visits = all.filter((v) => !v.test);
  const avg = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null);
  const by = (f) => { const m = {}; for (const v of visits) { const k = f(v); if (!k) continue; (m[k] ||= []).push(v); } return m; };
  const items = {}; for (const v of visits) for (const f of v.fails) { const x = (items[f.k] ||= { k: f.k, label: f.label, sec: f.sec, critical: f.critical, fails: 0, asked: 0 }); x.fails++; } for (const v of visits) for (const k of Object.keys(v.ans)) { const b = /^i\d/.test(k) ? k.replace(/_p\d$/, '') : k; if (items[b] && v.ans[k] !== 99) items[b].asked++; }
  const secs = {}; for (const sec of Object.keys(SECTIONS)) { const p = visits.map((v) => (v.secs[sec] || {}).pct).filter((x) => x != null); secs[sec] = { label: SECTIONS[sec], pct: avg(p), n: p.length }; }
  const summary = { visits: visits.length, schools: new Set(visits.map((v) => v.school)).size, assessors: new Set(visits.map((v) => norm(v.ass))).size, avg_pct: avg(visits.map((v) => v.pct).filter((x) => x != null)), critical_visits: visits.filter((v) => v.critical).length, flagged: visits.filter((v) => v.flags.length).length,
    sections: secs, top_fails: Object.values(items).sort((a, b) => b.fails - a.fails).slice(0, 10),
    by_region: Object.entries(by((v) => v.region_name)).map(([r, a]) => ({ region: r, visits: a.length, avg_pct: avg(a.map((v) => v.pct).filter((x) => x != null)), critical: a.filter((v) => v.critical).length })).sort((a, b) => b.visits - a.visits),
    by_assessor: Object.entries(by((v) => canonName(v.ass))).map(([n, a]) => ({ name: n, visits: a.length, avg_pct: avg(a.map((v) => v.pct).filter((x) => x != null)), critical: a.reduce((s, v) => s + v.critical, 0) })).sort((a, b) => (a.avg_pct ?? 101) - (b.avg_pct ?? 101)),
    by_observer: Object.entries(by((v) => v.observer)).map(([n, a]) => ({ name: n, visits: a.length, schools: new Set(a.map((v) => v.school)).size })).sort((a, b) => b.visits - a.visits) };
  return { status: 'ok', form: { name: F.name || '', version: F.version || '', url: env.QA_FORM_URL || '', configured: Boolean(env.KOBO_ASSET_QA) }, sync, summary, visits: all };
}
const canonName = (n) => (staffForKoboName(n) || {}).name || n;
