// Dodoma pilot day (training): two regional teams meet at each pilot school.
//  - one of the two RCs leads the whole activity (and talks to the head teacher); the other RC supports the lead and
//    oversees sampling and test administration in one grade
//  - RCs and ARCs may also support test administration as a second responsibility, to save time at the school
//  - the two ARCs oversee the sampling and administer tests as needed
//  - volunteers test their grade and help run the sampling; one volunteer per grade per school leads the sampling
//    administration, named by the lead RC (or by HQ, e.g. Joram); the ARCs and RCs support and coach them
// The RC or ARC of a region sets the grades of their own region's people. Either RC (or HQ) names the lead RC.
import { kv } from './store.js';
import { STAFF, SCHOOL_BY_ID, PILOT_DAY } from './config.js';
import { getPlan } from './plan.js';
import { pushTo } from './push.js';

export const PILOT_ALLOC = { PS0302005: ['KIGOMA', 'MARA'], PS0302057: ['SONGWE', 'MANYARA'], PS0302041: ['MTWARA', 'SINGIDA'], PS0302023: ['LINDI', 'SHINYANGA'], PS0302089: ['TANGA', 'RUKWA'] };
const KEY = 'v2:pilot';
const person = (s) => ({ id: s.id, name: s.name, position: s.position, region: s.region });
const PILOT_DEFAULT_LEAD = (regs) => { const rcs = regs.flatMap((r) => STAFF.filter((s) => s.active && s.region === r && s.role === 'rc')); return rcs[0]?.id ?? null; };
const load = async (env) => { const d = (await kv(env).get(KEY)) || { grades: {}, log: [] }; d.lead ||= {}; d.support ||= {}; d.sampling ||= {}; return d; };
// a sampling lead must be a volunteer who tests that grade; drop any that no longer fits
const tidy = (d, sid) => { const sl = d.sampling[sid]; if (!sl) return; for (const g of Object.keys(sl)) if (d.grades[sid]?.[sl[g]] !== Number(g)) delete sl[g]; };

export async function pilotView(env, who) {
  const d = await load(env); const plan = await getPlan(env, 'DODOMA').catch(() => null); const out = [];
  for (const [sid, regs] of Object.entries(PILOT_ALLOC)) {
    const visit = (plan?.visits || []).find((v) => v.school === sid && v.date === PILOT_DAY);
    const staff = {}; for (const r of regs) { const all = STAFF.filter((s) => s.active && s.region === r); staff[r] = { rc: all.filter((s) => s.role === 'rc').map((s) => ({ ...person(s), support: d.support[sid]?.[s.id] ?? null })), arc: all.filter((s) => s.role === 'arc').map((s) => ({ ...person(s), support: d.support[sid]?.[s.id] ?? null })), volunteers: all.filter((s) => s.role === 'volunteer').map((s) => ({ ...person(s), grade: d.grades[sid]?.[s.id] ?? null })) }; }
    const editable = regs.filter((r) => who.role === 'hq' && (who.level || 'admin') !== 'viewer' || ((who.role === 'rc' || who.role === 'arc') && who.region === r));
    const mine = ['volunteer', 'rc', 'arc'].includes(who.role) && regs.includes(who.region);
    tidy(d, sid); const lead = d.lead[sid] ?? PILOT_DEFAULT_LEAD(regs); const canSampling = who.role === 'hq' ? (who.level || 'admin') !== 'viewer' : (who.role === 'rc' && who.id === lead); const canLead = who.role === 'hq' ? (who.level || 'admin') !== 'viewer' : who.role === 'rc' && regs.includes(who.region);
    out.push({ school: sid, name: SCHOOL_BY_ID[sid]?.name || sid, date: PILOT_DAY, start: visit?.start || null, regions: regs, staff, editable, mine, lead, lead_set: d.lead[sid] != null, can_set_lead: canLead, sampling_lead: d.sampling[sid] || {}, can_set_sampling: canSampling });
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
  } else if (b.action === 'sampling_lead') { // one volunteer per grade leads the sampling administration; named by the lead RC or by HQ
    const lead = d.lead[b.school] ?? PILOT_DEFAULT_LEAD(regs); const okWho = (who.role === 'hq' && (who.level || 'admin') !== 'viewer') || (who.role === 'rc' && who.id === lead);
    if (!okWho) return { error: 'Only the lead RC (or HQ) names the sampling leads.', status: 403 };
    const g = Number(b.grade); if (![1, 2, 3].includes(g)) return { error: 'Grade must be 1, 2 or 3' };
    const sl = (d.sampling[b.school] ||= {});
    if (b.staff_id === null || b.staff_id === '') delete sl[g];
    else { const s = STAFF.find((x) => x.id === Number(b.staff_id)); if (!s || s.role !== 'volunteer' || !regs.includes(s.region)) return { error: 'Choose a test admin from the two teams.' }; if (d.grades[b.school]?.[s.id] !== g) return { error: 'Set that person to test Grade ' + g + ' first.' }; sl[g] = s.id; changes.push([s, g]); }
  } else if (b.action === 'lead') { // which RC leads the whole activity
    const s = STAFF.find((x) => x.id === Number(b.staff_id)); if (!s || s.role !== 'rc' || !regs.includes(s.region)) return { error: 'The lead must be one of the two RCs at this school.' };
    if (!((who.role === 'hq' && (who.level || 'admin') !== 'viewer') || (who.role === 'rc' && regs.includes(who.region)))) return { error: 'Only the RCs at this school (or HQ) name the lead.', status: 403 };
    d.lead[b.school] = s.id; changes.push([s, null]);
  } else if (b.action === 'support') { // grade an RC or ARC oversees or helps test, as a second responsibility
    const s = STAFF.find((x) => x.id === Number(b.staff_id)); if (!s || !['rc', 'arc'].includes(s.role) || !regs.includes(s.region)) return { error: 'That person is not an RC or ARC at this school.' };
    if (!canRegion(s.region)) return { error: 'Only the RC or ARC of ' + s.region.toLowerCase() + ' can set this.', status: 403 };
    const g = b.grade === null || b.grade === '' ? null : Number(b.grade); if (g !== null && ![1, 2, 3].includes(g)) return { error: 'Grade must be 1, 2 or 3' };
    const sp = (d.support[b.school] ||= {}); if (g === null) delete sp[s.id]; else sp[s.id] = g; changes.push([s, g]);
  } else if (b.action === 'spread') { // share one region's test admins across the three grades
    const r = String(b.region || '').toUpperCase(); if (!regs.includes(r)) return { error: 'That region is not at this school.' }; if (!canRegion(r)) return { error: 'Not allowed', status: 403 };
    const vols = STAFF.filter((x) => x.active && x.region === r && x.role === 'volunteer'); vols.forEach((s, i) => { sc[s.id] = (i % 3) + 1; changes.push([s, (i % 3) + 1]); });
  } else return { error: 'Unknown action' };
  tidy(d, b.school); d.updated = new Date().toISOString(); d.log = [{ at: d.updated, by: who.name, school: b.school, action: b.action, n: changes.length }, ...(d.log || [])].slice(0, 100);
  await kv(env).put(KEY, d);
  const nm = SCHOOL_BY_ID[b.school]?.name || b.school;
  for (const [s, g] of changes.slice(0, 20)) { try { const body = b.action === 'sampling_lead' ? `You lead the sampling for Grade ${g} at ${nm}.` : b.action === 'lead' ? `You lead the whole pilot activity at ${nm}.` : b.action === 'support' ? (g ? `At ${nm} you also support Grade ${g}.` : `Your grade support at ${nm} was cleared.`) : g ? `At ${nm} you test Grade ${g} and help with the sampling.` : `Your grade at ${nm} was cleared.`; await pushTo(env, (w) => w && w.id === s.id, { title: 'Pilot day: your role', body, url: '/#pilot' }); } catch { /* the page still shows it */ } }
  return { ok: true, changed: changes.length };
}
