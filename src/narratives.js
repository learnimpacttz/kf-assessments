// Short narrative report per school, written by the Regional Coordinator or the Assistant after the visit, in Kiswahili or English.
// At the end of the field work the system compiles them, with the numbers for each school, into one report.
import { kv } from './store.js';
import { SCHOOL_BY_ID, SCHOOLS_BY_REGION, REGIONS } from './config.js';
import { PILOT_ALLOC } from './pilot.js';

const KEY = 'v2:narr';
export const QUESTIONS = [
  { k: 'overall', en: 'How did the visit go overall?', sw: 'Ziara ilikuwaje kwa ujumla?' },
  { k: 'ready', en: 'Was the school ready? (head teacher, classrooms, register, pupils present)', sw: 'Shule ilikuwa tayari? (mwalimu mkuu, madarasa, rejista, wanafunzi waliokuwepo)' },
  { k: 'sampling', en: 'How did the pupil sampling and the testing go in each grade?', sw: 'Uteuzi wa wanafunzi na upimaji ulikwendaje katika kila darasa?' },
  { k: 'challenges', en: 'What problems did the team meet? (network, phones, weather, transport, absent pupils)', sw: 'Changamoto gani timu ilikutana nazo? (mtandao, simu, hali ya hewa, usafiri, wanafunzi kutohudhuria)' },
  { k: 'solved', en: 'What did the team do about them, and what is still open?', sw: 'Timu ilichukua hatua gani, na nini bado hakijakamilika?' },
  { k: 'team', en: 'How did the team work? (volunteers, timekeeping, conduct, anything to praise or correct)', sw: 'Timu ilifanyaje kazi? (watu wa kujitolea, kuzingatia muda, nidhamu, kinachostahili pongezi au marekebisho)' },
  { k: 'follow', en: 'What needs follow-up? (a return visit, missing pupils, records to check)', sw: 'Nini kinahitaji ufuatiliaji? (kurudi shuleni, wanafunzi waliokosekana, rekodi za kukagua)' },
];
const MAXA = 1500;
const clip = (s) => String(s || '').trim().slice(0, MAXA);
const load = async (env) => (await kv(env).get(KEY)) || {};
const mine = (who) => String(who.id ?? who.hq_id ?? '');
const regionOf = (id) => SCHOOL_BY_ID[id]?.region;
const pilotMine = (who, id) => Boolean(PILOT_ALLOC[id] && PILOT_ALLOC[id].includes(who.region)); // the coordinators of the two regions that worked at a pilot school
const canWrite = (who, id) => (who.role === 'rc' || who.role === 'arc') && (regionOf(id) === who.region || pilotMine(who, id));
const canRead = (who, region) => who.role === 'hq' || ((who.role === 'rc' || who.role === 'arc') && (who.region === region || (who.regions || []).includes(region))); // a Lead Coordinator also reads the regions of their organization

export async function listNarr(env, who, region, sum) {
  if (!REGIONS.includes(region) || !canRead(who, region)) return { error: 'Not your region', status: 403 };
  const d = await load(env);
  const extra = who.role === 'hq' ? [] : Object.keys(PILOT_ALLOC).filter((id) => PILOT_ALLOC[id].includes(region) && regionOf(id) !== region).map((id) => SCHOOL_BY_ID[id]);
  const schools = [...(SCHOOLS_BY_REGION[region] || []), ...extra].map((s) => {
    const e = Object.values(d[s.id]?.entries || {}); const x = sum?.schools?.[s.id];
    return { id: s.id, name: s.name, lga: s.lga, first: x?.first || null, last: x?.last || null, visited: Boolean(x && (x.dates || []).length), n_done: e.filter((y) => y.done).length, n_draft: e.filter((y) => !y.done).length, mine: e.find((y) => y.by_id === mine(who)) ? (e.find((y) => y.by_id === mine(who)).done ? 'done' : 'draft') : null };
  });
  return { region, schools, questions: QUESTIONS };
}

export async function getNarr(env, who, school) {
  const region = regionOf(school); if (!region || !(canRead(who, region) || pilotMine(who, school))) return { error: 'Not your region', status: 403 };
  const d = await load(env); const entries = Object.values(d[school]?.entries || {}).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return { school, name: SCHOOL_BY_ID[school].name, entries, mine: entries.find((e) => e.by_id === mine(who)) || null, can_write: canWrite(who, school), questions: QUESTIONS };
}

export async function saveNarr(env, who, b) {
  if (!b.school || !canWrite(who, b.school)) return { error: 'Only the RC or ARC of the region can write the school report', status: 403 };
  const answers = {}; for (const q of QUESTIONS) { const t = clip(b.answers?.[q.k]); if (t) answers[q.k] = t; }
  const open = clip(b.open);
  if (b.done && !Object.keys(answers).length && !open) return { error: 'Write at least one answer before marking it complete' };
  if (b.done && (answers.overall || '').length < 15) return { error: 'Answer the first question (how the visit went) in a sentence or two before marking it complete' };
  const d = await load(env); const rec = (d[b.school] ||= { school: b.school, entries: {} });
  rec.entries[mine(who)] = { by: who.name, by_id: mine(who), role: who.position || who.role, lang: b.lang === 'sw' ? 'sw' : 'en', answers, open, done: Boolean(b.done), at: new Date().toISOString() };
  await kv(env).put(KEY, d);
  return { ok: true, done: Boolean(b.done) };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const title = (s) => String(s || '').toLowerCase().replace(/(^|[\s(-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
// One document: for every school of the chosen regions, its numbers and what the coordinators wrote.
export async function compiledHtml(env, who, regions, sum, plans, today) {
  const d = await load(env); const regs = regions.filter((r) => canRead(who, r));
  let nSchools = 0, nWith = 0;
  const body = regs.map((r) => {
    const rows = [...(SCHOOLS_BY_REGION[r] || []), ...(who.role === 'hq' ? [] : Object.keys(PILOT_ALLOC).filter((id) => PILOT_ALLOC[id].includes(r) && regionOf(id) !== r).map((id) => SCHOOL_BY_ID[id]))].map((s) => {
      nSchools += 1; const x = sum?.schools?.[s.id]; const es = Object.values(d[s.id]?.entries || {}).filter((e) => e.done); if (es.length) nWith += 1;
      const g = x?.g; const nums = g ? [1, 2, 3].map((k) => `Grade ${k}: ${g[k].av} of ${g[k].target}`).join(' · ') : 'No tests yet';
      const visit = (plans[r]?.visits || []).find((v) => v.school === s.id);
      const head = `<h3>${esc(s.name)} <span class="m">${esc(title(s.lga))}${x?.ward ? ' · ' + esc(title(x.ward)) : ''}</span></h3><p class="m">${x?.first ? 'Visited ' + esc(x.first) + (x.last && x.last !== x.first ? ' to ' + esc(x.last) : '') : visit ? 'Planned ' + esc(visit.date) + ', not visited yet' : 'No visit recorded'} · Pupils tested (tested of sample): ${esc(nums)}${x?.done ? ' · complete' : ''}</p>`;
      if (!es.length) return head + '<p class="none">No narrative report was written for this school.</p>';
      return head + es.map((e) => `<div class="e"><p class="m"><b>${esc(e.by)}</b> (${esc(e.role)}) · ${e.lang === 'sw' ? 'Kiswahili' : 'English'} · ${esc(String(e.at).slice(0, 10))}</p>${QUESTIONS.filter((q) => e.answers[q.k]).map((q) => `<p><b>${esc(q[e.lang === 'sw' ? 'sw' : 'en'])}</b><br>${esc(e.answers[q.k]).replace(/\n/g, '<br>')}</p>`).join('')}${e.open ? `<p><b>${e.lang === 'sw' ? 'Mengineyo' : 'Anything else'}</b><br>${esc(e.open).replace(/\n/g, '<br>')}</p>` : ''}</div>`).join('');
    }).join('');
    return `<h2>${esc(title(r))}</h2>${rows}`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KiuFunza 4 endline: school narrative reports</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#243049}h1{color:#354062}h2{margin-top:36px;border-bottom:2px solid #FFC650;padding-bottom:4px;color:#354062}h3{margin:22px 0 2px}.m{color:#5A6478;font-size:13px;margin:2px 0}.e{border-left:3px solid #5EA6B8;padding-left:12px;margin:10px 0}.none{color:#8089a0;font-style:italic}@media print{h2{page-break-before:always}}</style></head><body><h1>KiuFunza 4 endline 2026: school narrative reports</h1><p class="m">Compiled ${esc(today)} from the dashboard. ${nWith} of ${nSchools} schools have a completed narrative. Numbers come from the submitted records; the narratives are written by the Regional Coordinators and Assistants.</p>${body}</body></html>`;
}
