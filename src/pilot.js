// Dodoma pilot day (training): two regional teams meet at each pilot school.
//  - the two RCs oversee everything and talk to the head teacher (they do not administer assessments)
//  - the two ARCs coordinate the sampling and train the new test admins on the spot
//  - all test admins (volunteers) of both teams run the assessments, spread over the grades as the RCs plan
// The RC or ARC of a region sets the grade of their own region's test admins. HQ can set any.
import { kv } from './store.js';
import { STAFF, SCHOOL_BY_ID, PILOT_DAY } from './config.js';
import { getPlan } from './plan.js';
import { pushTo } from './push.js';

export const PILOT_ALLOC = { PS0302005: ['KIGOMA', 'MARA'], PS0302057: ['SONGWE', 'MANYARA'], PS0302041: ['MTWARA', 'SINGIDA'], PS0302023: ['LINDI', 'SHINYANGA'], PS0302089: ['TANGA', 'RUKWA'] };
const KEY = 'v2:pilot';
const person = (s) => ({ id: s.id, name: s.name, position: s.position, region: s.region });
const load = async (env) => (await kv(env).get(KEY)) || { grades: {}, log: [] };

export async function pilotView(env, who) {
  const d = await load(env); const plan = await getPlan(env, 'DODOMA').catch(() => null); const out = [];
  for (const [sid, regs] of Object.entries(PILOT_ALLOC)) {
    const visit = (plan?.visits || []).find((v) => v.school === sid && v.date === PILOT_DAY);
    const staff = {}; for (const r of regs) { const all = STAFF.filter((s) => s.active && s.region === r); staff[r] = { rc: all.filter((s) => s.role === 'rc').map(person), arc: all.filter((s) => s.role === 'arc').map(person), volunteers: all.filter((s) => s.role === 'volunteer').map((s) => ({ ...person(s), grade: d.grades[sid]?.[s.id] ?? null })) }; }
    const editable = regs.filter((r) => who.role === 'hq' && (who.level || 'admin') !== 'viewer' || ((who.role === 'rc' || who.role === 'arc') && who.region === r));
    const mine = ['volunteer', 'rc', 'arc'].includes(who.role) && regs.includes(who.region);
    out.push({ school: sid, name: SCHOOL_BY_ID[sid]?.name || sid, date: PILOT_DAY, start: visit?.start || null, regions: regs, staff, editable, mine });
  }
  return { schools: out, day: PILOT_DAY, updated: d.updated || null };
}

export async function pilotSet(env, who, b) {
  const regs = PILOT_ALLOC[b.school]; if (!regs) return { error: 'Unknown pilot school', status: 404 };
  const d = await load(env); const sc = (d.grades[b.school] ||= {});
  const canRegion = (r) => (who.role === 'hq' && (who.level || 'admin') !== 'viewer') || ((who.role === 'rc' || who.role === 'arc') && who.region === r);
  const changes = [];
  if (b.action === 'grade') {
    const s = STAFF.find((x) => x.id === Number(b.staff_id)); if (!s || s.role !== 'volunteer' || !regs.includes(s.region)) return { error: 'That person is not a test admin of this school\'s teams.' };
    if (!canRegion(s.region)) return { error: 'Only the RC or ARC of ' + s.region.toLowerCase() + ' can set this.', status: 403 };
    const g = b.grade === null || b.grade === '' ? null : Number(b.grade); if (g !== null && ![1, 2, 3].includes(g)) return { error: 'Grade must be 1, 2 or 3' };
    if (g === null) delete sc[s.id]; else sc[s.id] = g; changes.push([s, g]);
  } else if (b.action === 'spread') { // share one region's test admins across the three grades
    const r = String(b.region || '').toUpperCase(); if (!regs.includes(r)) return { error: 'That region is not at this school.' }; if (!canRegion(r)) return { error: 'Not allowed', status: 403 };
    const vols = STAFF.filter((x) => x.active && x.region === r && x.role === 'volunteer'); vols.forEach((s, i) => { sc[s.id] = (i % 3) + 1; changes.push([s, (i % 3) + 1]); });
  } else return { error: 'Unknown action' };
  d.updated = new Date().toISOString(); d.log = [{ at: d.updated, by: who.name, school: b.school, action: b.action, n: changes.length }, ...(d.log || [])].slice(0, 100);
  await kv(env).put(KEY, d);
  const nm = SCHOOL_BY_ID[b.school]?.name || b.school;
  for (const [s, g] of changes.slice(0, 20)) { try { await pushTo(env, (w) => w && w.id === s.id && w.role === 'volunteer', { title: 'Pilot day: your grade', body: g ? `You test Grade ${g} at ${nm} on Thursday.` : `Your grade at ${nm} was cleared.`, url: '/#pilot' }); } catch { /* the page still shows it */ } }
  return { ok: true, changed: changes.length };
}
