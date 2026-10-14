// Dodoma pilot day (training): two regional teams meet at each pilot school.
//  - one of the two RCs leads the whole day and talks to the head teacher; the other RC (the assistant RC) supports the
//    lead, oversees one grade, and may lead the sampling in one grade
//  - each grade has a sampling lead: one of the two ARCs, or the assistant RC (so at most three leads, one per grade)
//  - every volunteer tests one grade; some volunteers also run the sampling in that same grade (on their phones, guided by
//    the ARC or the assistant RC). The ARCs can also run the sampling.
// The RC or ARC of a region places that region's volunteers in grades. The lead RC (or HQ) names the sampling leads.
import { kv } from './store.js';
import { STAFF, SCHOOL_BY_ID, PILOT_DAY } from './config.js';
import { getPlan } from './plan.js';
import { pushTo } from './push.js';

export const PILOT_ALLOC = { PS0302005: ['KIGOMA', 'MARA'], PS0302057: ['SONGWE', 'MANYARA'], PS0302041: ['MTWARA', 'SINGIDA'], PS0302023: ['LINDI', 'SHINYANGA'], PS0302089: ['TANGA', 'RUKWA'] };
const KEY = 'v2:pilot';
const person = (s) => ({ id: s.id, name: s.name, position: s.position, region: s.region });
const PILOT_DEFAULT_LEAD = (regs) => { const rcs = regs.flatMap((r) => STAFF.filter((s) => s.active && s.region === r && s.role === 'rc')); return rcs[0]?.id ?? null; };
const staffIn = (regs, role) => regs.flatMap((r) => STAFF.filter((s) => s.active && s.region === r && s.role === role));
const hqOk = (who) => who.role === 'hq' && (who.level || 'admin') !== 'viewer';

const load = async (env) => {
  const d = (await kv(env).get(KEY)) || { grades: {}, log: [] };
  d.lead ||= {}; d.support ||= {}; d.sampling ||= {}; d.sampling_lead ||= {}; d.samplers ||= {};
  // volunteers earlier named as "sampling lead" now count as people who run the sampling in their grade; nothing is lost
  for (const [sid, gs] of Object.entries(d.sampling)) for (const [g, id] of Object.entries(gs || {})) { const arr = ((d.samplers[sid] ||= {})[g] ||= []); if (!arr.includes(id)) arr.push(id); }
  return d;
};
// keep the plan consistent: a volunteer samples only the grade they test; a sampling lead is an ARC or the assistant RC, and leads one grade
const tidy = (d, sid, regs) => {
  const arcs = new Set(staffIn(regs, 'arc').map((s) => s.id)); const lead = d.lead[sid] ?? PILOT_DEFAULT_LEAD(regs); const assistant = new Set(staffIn(regs, 'rc').filter((s) => s.id !== lead).map((s) => s.id));
  const sm = d.samplers[sid]; if (sm) for (const g of Object.keys(sm)) sm[g] = (sm[g] || []).filter((id) => arcs.has(id) || d.grades[sid]?.[id] === Number(g));
  const sl = d.sampling_lead[sid]; if (sl) { const seen = new Set(); for (const g of Object.keys(sl).sort()) { const id = sl[g]; if (!(arcs.has(id) || assistant.has(id)) || seen.has(id)) delete sl[g]; else seen.add(id); } }
};

export async function pilotView(env, who) {
  const d = await load(env); const plan = await getPlan(env, 'DODOMA').catch(() => null); const out = [];
  for (const [sid, regs] of Object.entries(PILOT_ALLOC)) {
    const visit = (plan?.visits || []).find((v) => v.school === sid && v.date === PILOT_DAY); tidy(d, sid, regs);
    const staff = {}; for (const r of regs) { const all = STAFF.filter((s) => s.active && s.region === r); staff[r] = { rc: all.filter((s) => s.role === 'rc').map((s) => ({ ...person(s), support: d.support[sid]?.[s.id] ?? null })), arc: all.filter((s) => s.role === 'arc').map((s) => ({ ...person(s), support: d.support[sid]?.[s.id] ?? null })), volunteers: all.filter((s) => s.role === 'volunteer').map((s) => ({ ...person(s), grade: d.grades[sid]?.[s.id] ?? null })) }; }
    const editable = regs.filter((r) => hqOk(who) || ((who.role === 'rc' || who.role === 'arc') && who.region === r));
    const mine = ['volunteer', 'rc', 'arc'].includes(who.role) && regs.includes(who.region);
    const lead = d.lead[sid] ?? PILOT_DEFAULT_LEAD(regs); const leadMe = who.role === 'rc' && who.id === lead;
    out.push({ school: sid, name: SCHOOL_BY_ID[sid]?.name || sid, date: PILOT_DAY, start: visit?.start || null, regions: regs, staff, editable, mine, lead, lead_set: d.lead[sid] != null,
      can_set_lead: hqOk(who) || (who.role === 'rc' && regs.includes(who.region)), can_set_sampling: hqOk(who) || leadMe,
      sampling_lead: d.sampling_lead[sid] || {}, samplers: d.samplers[sid] || {} });
  }
  return { schools: out, day: PILOT_DAY, updated: d.updated || null };
}

export async function pilotSet(env, who, b) {
  const regs = PILOT_ALLOC[b.school]; if (!regs) return { error: 'Unknown pilot school', status: 404 };
  const d = await load(env); const sc = (d.grades[b.school] ||= {});
  const canRegion = (r) => hqOk(who) || ((who.role === 'rc' || who.role === 'arc') && who.region === r);
  const leadId = d.lead[b.school] ?? PILOT_DEFAULT_LEAD(regs); const isLeadRc = hqOk(who) || (who.role === 'rc' && who.id === leadId);
  const gradeOf = (v) => { const g = v === null || v === '' || v === undefined ? null : Number(v); return g !== null && ![1, 2, 3].includes(g) ? undefined : g; };
  const changes = []; // [person, grade, kind]
  if (b.action === 'grade') {
    const s = STAFF.find((x) => x.id === Number(b.staff_id)); if (!s || s.role !== 'volunteer' || !regs.includes(s.region)) return { error: 'That person is not a test admin of this school\'s teams.' };
    if (!canRegion(s.region)) return { error: 'Only the RC or ARC of ' + s.region.toLowerCase() + ' can set this.', status: 403 };
    const g = gradeOf(b.grade); if (g === undefined) return { error: 'Grade must be 1, 2 or 3' };
    if (g === null) delete sc[s.id]; else sc[s.id] = g; changes.push([s, g, 'grade']);
  } else if (b.action === 'sampling_lead') { // a grade's sampling lead: one of the ARCs, or the assistant RC
    if (!isLeadRc) return { error: 'Only the lead RC (or HQ) names the sampling leads.', status: 403 };
    const g = Number(b.grade); if (![1, 2, 3].includes(g)) return { error: 'Grade must be 1, 2 or 3' };
    const sl = (d.sampling_lead[b.school] ||= {});
    if (b.staff_id === null || b.staff_id === '' || b.staff_id === undefined) delete sl[g];
    else {
      const s = STAFF.find((x) => x.id === Number(b.staff_id)); const okRole = s && regs.includes(s.region) && (s.role === 'arc' || (s.role === 'rc' && s.id !== leadId));
      if (!okRole) return { error: 'The sampling lead is one of the two ARCs or the assistant RC.' };
      const other = Object.entries(sl).find(([gg, id]) => id === s.id && Number(gg) !== g); if (other) return { error: s.name.split(' ')[0] + ' already leads the sampling in Grade ' + other[0] + '.' };
      sl[g] = s.id; changes.push([s, g, 'sampling_lead']);
    }
  } else if (b.action === 'sampler') { // who runs the sampling in a grade: volunteers of that grade, and the ARCs
    const g = Number(b.grade); if (![1, 2, 3].includes(g)) return { error: 'Grade must be 1, 2 or 3' };
    const s = STAFF.find((x) => x.id === Number(b.staff_id)); if (!s || !regs.includes(s.region) || !['volunteer', 'arc'].includes(s.role)) return { error: 'Choose a test admin or an ARC from the two teams.' };
    if (!(isLeadRc || canRegion(s.region))) return { error: 'Only the lead RC, or the RC or ARC of ' + s.region.toLowerCase() + ', can set this.', status: 403 };
    if (s.role === 'volunteer' && sc[s.id] !== g) return { error: s.name.split(' ')[0] + ' tests ' + (sc[s.id] ? 'Grade ' + sc[s.id] : 'no grade yet') + '. Sampling is done in the grade you test: place them in Grade ' + g + ' first.' };
    const arr = ((d.samplers[b.school] ||= {})[g] ||= []); const has = arr.includes(s.id);
    if (b.on === false || b.on === 'false') { d.samplers[b.school][g] = arr.filter((i) => i !== s.id); for (const gg of Object.keys(d.samplers[b.school])) if (Number(gg) !== g && s.role === 'volunteer') d.samplers[b.school][gg] = d.samplers[b.school][gg].filter((i) => i !== s.id); changes.push([s, null, 'sampler']); }
    else { if (!has) arr.push(s.id); changes.push([s, g, 'sampler']); }
  } else if (b.action === 'lead') { // which RC leads the whole day
    const s = STAFF.find((x) => x.id === Number(b.staff_id)); if (!s || s.role !== 'rc' || !regs.includes(s.region)) return { error: 'The lead must be one of the two RCs at this school.' };
    if (!(hqOk(who) || (who.role === 'rc' && regs.includes(who.region)))) return { error: 'Only the RCs at this school (or HQ) name the lead.', status: 403 };
    d.lead[b.school] = s.id; changes.push([s, null, 'lead']);
  } else if (b.action === 'support') { // the grade an RC or ARC oversees or also tests, as a second responsibility
    const s = STAFF.find((x) => x.id === Number(b.staff_id)); if (!s || !['rc', 'arc'].includes(s.role) || !regs.includes(s.region)) return { error: 'That person is not an RC or ARC at this school.' };
    if (!canRegion(s.region)) return { error: 'Only the RC or ARC of ' + s.region.toLowerCase() + ' can set this.', status: 403 };
    const g = gradeOf(b.grade); if (g === undefined) return { error: 'Grade must be 1, 2 or 3' };
    const sp = (d.support[b.school] ||= {}); if (g === null) delete sp[s.id]; else sp[s.id] = g; changes.push([s, g, 'support']);
  } else if (b.action === 'spread') { // fill in the test admins of one region who have no grade yet; grades already set are never changed
    const r = String(b.region || '').toUpperCase(); if (!regs.includes(r)) return { error: 'That region is not at this school.' }; if (!canRegion(r)) return { error: 'Not allowed', status: 403 };
    const vols = STAFF.filter((x) => x.active && x.region === r && x.role === 'volunteer'); const used = { 1: 0, 2: 0, 3: 0 };
    for (const x of staffIn(regs, 'volunteer')) if (sc[x.id]) used[sc[x.id]]++;
    for (const s2 of vols.filter((x) => !sc[x.id])) { const g = [1, 2, 3].sort((a, b2) => used[a] - used[b2] || a - b2)[0]; sc[s2.id] = g; used[g]++; changes.push([s2, g, 'grade']); }
  } else return { error: 'Unknown action' };
  d.sampling = {}; // the earlier volunteer "sampling leads" now live in the sampling lists
  tidy(d, b.school, regs); d.updated = new Date().toISOString(); d.log = [{ at: d.updated, by: who.name, school: b.school, action: b.action, n: changes.length }, ...(d.log || [])].slice(0, 100);
  await kv(env).put(KEY, d);
  const nm = SCHOOL_BY_ID[b.school]?.name || b.school;
  for (const [s, g, kind] of changes.slice(0, 20)) {
    const body = kind === 'lead' ? `You lead the whole pilot day at ${nm}.`
      : kind === 'sampling_lead' ? `You lead the sampling for Grade ${g} at ${nm}.`
      : kind === 'sampler' ? (g ? `At ${nm} you also run the sampling in Grade ${g}.` : `You no longer run the sampling at ${nm}.`)
      : kind === 'support' ? (g ? `At ${nm} you also support Grade ${g}.` : `Your grade support at ${nm} was cleared.`)
      : g ? `At ${nm} you test Grade ${g}.` : `Your grade at ${nm} was cleared.`;
    try { await pushTo(env, (w) => w && w.id === s.id, { title: 'Pilot day: your role', body, url: '/#pilot' }); } catch { /* the page still shows it */ }
  }
  return { ok: true, changed: changes.length };
}
