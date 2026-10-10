// News and announcements: messages from HQ (written, polished with AI, sent now or scheduled) and automatic ones
// (good wishes, reminders, milestones). Everyone signed in sees them in the News tab; a phone alert goes out too.
import { kv } from './store.js';
import { REGIONS, FIELD_START, eatToday } from './config.js';
import { pushTo } from './push.js';

const KEY = 'v2:news';
export const KINDS = { announcement: 'Announcement', goodwill: 'Good wishes', reminder: 'Reminder', congrats: 'Congratulations', update: 'Update' };
export const EMOJI = ['👍', '👏', '🎉', '❤️'];
const AUDIENCES = ['all', 'hq', 'coordinators', 'volunteers'];

const load = async (env) => ({ items: [], marks: {}, seeded: false, ...((await kv(env).get(KEY)) || {}) });
const save = (env, d) => kv(env).put(KEY, d);
const uid = () => Math.random().toString(36).slice(2, 9);

// Messages written in advance (HQ can edit, move or cancel each one in the News tab)
const SEEDS = [
  { seed: 'pilot_eve', kind: 'reminder', publish_at: '2026-10-14T04:30:00Z', title: 'Pilot day is tomorrow / Kesho ni siku ya majaribio',
    body: 'Tomorrow, Thursday 15 October, we visit the 5 Dodoma pilot schools. Please charge your phone tonight, check that the forms are updated, and have your booklets and ID with you. We leave at 06:30.\n\nKesho, Alhamisi 15 Oktoba, tunatembelea shule 5 za majaribio Dodoma. Tafadhali chaji simu usiku huu, hakikisha fomu zimesasishwa, na uwe na vitabu vya majaribio na kitambulisho. Tunaondoka saa 12:30 asubuhi.' },
  { seed: 'pilot_day', kind: 'goodwill', publish_at: '2026-10-15T02:30:00Z', title: 'All the best on pilot day / Kazi njema leo',
    body: 'Today is our practice for the real thing. Take your time, follow the steps, and ask when something is not clear. Every question today makes the next six weeks easier.\n\nLeo ni mazoezi kwa kazi halisi. Fanyeni kazi kwa utulivu, fuateni hatua, na muulize pale pasipo wazi. Tunawatakia kazi njema!' },
  { seed: 'field_start', kind: 'goodwill', publish_at: '2026-10-19T03:00:00Z', title: 'Kazi njema! First day of field work',
    body: 'Today the KiuFunza 4 endline field work begins. Thank you for the preparation and the long days of training. Be kind to the children, test carefully, send your records the same day, and look after each other.\n\nLeo tunaanza kazi ya uwandani ya KiuFunza 4. Asanteni kwa maandalizi na mafunzo marefu. Wapendeni watoto, fanyeni majaribio kwa makini, tumeni taarifa siku hiyohiyo, na muangaliane. Tunawatakia kazi njema!' },
];

async function ensureSeeds(env, d) {
  if (d.seeded) return d;
  const now = Date.now();
  for (const s of SEEDS) {
    if (d.items.some((i) => i.seed === s.seed)) continue;
    d.items.push({ id: uid(), kind: s.kind, title: s.title, body: s.body, to: 'all', regions: [], status: Date.parse(s.publish_at) > now ? 'scheduled' : 'draft', publish_at: s.publish_at, sent_at: null, push: true, pinned: false, auto: true, seed: s.seed, by: 'Automatic', created_at: new Date().toISOString(), rx: {} });
  }
  d.seeded = true; await save(env, d); return d;
}

const regionOk = (item, who) => !item.regions?.length || who.role === 'hq' || item.regions.includes(who.region);
const toOk = (item, who) => who.role === 'hq' || item.to === 'all' || (item.to === 'coordinators' && (who.role === 'rc' || who.role === 'arc')) || (item.to === 'volunteers' && who.role === 'volunteer');
const myId = (who) => String(who.id ?? 'hq');
function shape(item, who, hq) {
  const counts = {}; let mine = null; const names = {};
  for (const [uidk, r] of Object.entries(item.rx || {})) { counts[r.e] = (counts[r.e] || 0) + 1; if (uidk === myId(who)) mine = r.e; if (hq) (names[r.e] ||= []).push(r.n); }
  const out = { id: item.id, kind: item.kind, kind_label: KINDS[item.kind] || 'Announcement', title: item.title, body: item.body, pinned: item.pinned, sent_at: item.sent_at, counts, mine, auto: item.auto };
  if (hq) Object.assign(out, { status: item.status, publish_at: item.publish_at, to: item.to, regions: item.regions, push: item.push, by: item.by, names, seed: item.seed || null, created_at: item.created_at });
  return out;
}
const order = (a, b) => (b.pinned - a.pinned) || ((b.sent_at || b.publish_at || b.created_at || '') > (a.sent_at || a.publish_at || a.created_at || '') ? 1 : -1);

export async function listNews(env, who) {
  const d = await ensureSeeds(env, await load(env));
  const hq = who.role === 'hq';
  const items = d.items.filter((i) => i.status === 'sent' && toOk(i, who) && regionOk(i, who)).sort(order).map((i) => shape(i, who, false));
  return { items, emoji: EMOJI, latest: items.reduce((m, i) => (i.sent_at > m ? i.sent_at : m), '') };
}
export async function manageNews(env, who) {
  const d = await ensureSeeds(env, await load(env));
  const key = (i) => i.publish_at || '9';
  return { items: d.items.slice().sort((a, b) => (a.status === 'sent') - (b.status === 'sent') || (a.status === 'sent' ? order(a, b) : key(a) < key(b) ? -1 : 1)).map((i) => shape(i, who, true)), emoji: EMOJI, kinds: KINDS };
}

export async function react(env, who, id, emoji) {
  if (!EMOJI.includes(emoji)) return { error: 'Not a reaction' };
  const d = await load(env); const item = d.items.find((i) => i.id === id && i.status === 'sent');
  if (!item || !toOk(item, who) || !regionOk(item, who)) return { error: 'Not found', status: 404 };
  item.rx ||= {}; const k = myId(who);
  if (item.rx[k]?.e === emoji) delete item.rx[k]; else item.rx[k] = { e: emoji, n: who.name || 'HQ' };
  await save(env, d); return { ok: true, item: shape(item, who, false) };
}

function clean(b, who, old = {}) {
  const title = String(b.title ?? old.title ?? '').trim().slice(0, 120), body = String(b.body ?? old.body ?? '').trim().slice(0, 2000);
  const to = AUDIENCES.includes(b.to) ? b.to : old.to || 'all';
  const regions = Array.isArray(b.regions) ? b.regions.filter((r) => REGIONS.includes(r)) : old.regions || [];
  const kind = KINDS[b.kind] ? b.kind : old.kind || 'announcement';
  return { title, body, to, regions, kind, push: b.push === undefined ? old.push ?? true : Boolean(b.push), pinned: b.pinned === undefined ? old.pinned ?? false : Boolean(b.pinned) };
}

async function announce(env, item) {
  if (!item.push) return { skipped: 'no phone alert requested' };
  const pred = (w) => { if (!w) return false; if (w.role === 'hq') return true; return toOk(item, w) && regionOk(item, w); };
  const firstLine = item.body.split('\n').find((l) => l.trim()) || '';
  return pushTo(env, pred, { title: item.title, body: firstLine.slice(0, 140), url: '/#news' });
}

export async function publish(env, id, by) {
  const d = await load(env); const item = d.items.find((i) => i.id === id);
  if (!item || item.status === 'sent') return { error: 'Already sent or not found' };
  if (!item.title || !item.body) return { error: 'Write a title and a message first' };
  item.status = 'sent'; item.sent_at = new Date().toISOString(); item.sent_by = by; await save(env, d);
  return { ok: true, push: await announce(env, item) };
}

export async function saveNews(env, who, b) {
  const d = await ensureSeeds(env, await load(env));
  let item = b.id ? d.items.find((i) => i.id === b.id) : null;
  if (item && item.status === 'sent') return { error: 'A message that was sent cannot be edited. Write a new one.' };
  const c = clean(b, who, item || {});
  if (!c.title && !c.body) return { error: 'Write a title and a message' };
  if (!item) { item = { id: uid(), status: 'draft', publish_at: null, sent_at: null, auto: false, by: who.name || 'HQ', created_at: new Date().toISOString(), rx: {} }; d.items.push(item); }
  Object.assign(item, c);
  if (b.publish_at) { const t = Date.parse(b.publish_at); if (Number.isNaN(t)) return { error: 'Not a valid time' }; item.publish_at = new Date(t).toISOString(); item.status = t > Date.now() ? 'scheduled' : 'draft'; if (t <= Date.now()) return { error: 'Choose a time in the future, or use Send now' }; }
  else if (b.publish_at === null || b.unschedule) { item.publish_at = null; item.status = 'draft'; }
  await save(env, d); return { ok: true, id: item.id, status: item.status };
}
export async function deleteNews(env, id) {
  const d = await load(env); const i = d.items.findIndex((x) => x.id === id);
  if (i < 0) return { error: 'Not found', status: 404 };
  d.items.splice(i, 1); await save(env, d); return { ok: true };
}
export async function pinNews(env, id, pinned) { const d = await load(env); const it = d.items.find((x) => x.id === id); if (!it) return { error: 'Not found', status: 404 }; it.pinned = Boolean(pinned); await save(env, d); return { ok: true }; }

// every minute: send what is due
export async function runDueNews(env) {
  const d = await ensureSeeds(env, await load(env)); const now = Date.now(); const out = [];
  for (const i of d.items) if (i.status === 'scheduled' && i.publish_at && Date.parse(i.publish_at) <= now) out.push((await publish(env, i.id, 'Scheduled')).ok ? i.title : null);
  return out.filter(Boolean);
}

// Milestones: each region and the whole programme reach 25, 50, 75 and 100% of schools complete
export async function checkMilestones(env) {
  const today = eatToday(); const sum = await kv(env).get('v2:sum:2026');
  if (!sum || !sum.regions) return null;
  const d = await load(env); const marks = (d.marks ||= {}); const first = !d.marks_init; d.marks_init = true;
  const made = [];
  const hit = (pct) => [25, 50, 75, 100].filter((t) => pct >= t);
  const add = (key, pct, make) => {
    for (const t of hit(pct)) {
      const k = key + ':' + t; if (marks[k]) continue; marks[k] = new Date().toISOString();
      if (today < FIELD_START || first) continue; // never announce rehearsal or pre-field numbers
      made.push(make(t));
    }
  };
  let done = 0, total = 0;
  for (const r of REGIONS) {
    const R = sum.regions[r]; if (!R || !R.total) continue; done += R.done; total += R.total;
    const name = r[0] + r.slice(1).toLowerCase();
    add('r:' + r, Math.floor((100 * R.done) / R.total), (t) => ({ kind: 'congrats', to: 'all', regions: [], title: t === 100 ? `Hongera ${name}! All schools complete` : `${name}: ${t}% of schools complete`, body: t === 100 ? `${name} has completed every school. Thank you to the whole team. Hongera sana, mmefanya kazi nzuri!` : `${name} has completed ${R.done} of ${R.total} schools (${t}%). Keep going. Endeleeni hivyo, hongera!` }));
  }
  if (total) add('n', Math.floor((100 * done) / total), (t) => ({ kind: 'congrats', to: 'all', regions: [], title: t === 100 ? 'Hongera! All schools are complete' : `Programme: ${t}% of schools complete`, body: t === 100 ? 'Every school in the endline is complete. Thank you all, hongera sana kwa kazi nzuri!' : `Together we have completed ${done} of ${total} schools (${t}%). Asanteni kwa juhudi zenu!` }));
  for (const m of made) { const item = { id: uid(), ...m, status: 'sent', publish_at: null, sent_at: new Date().toISOString(), push: true, pinned: false, auto: true, by: 'Automatic', created_at: new Date().toISOString(), rx: {} }; d.items.push(item); await announce(env, item); }
  await save(env, d); return made.map((m) => m.title);
}

// AI polish: keeps the meaning and any Swahili, makes it clear and warm; optionally adds a Swahili version
export async function polish(env, b) {
  if (!env.ANTHROPIC_API_KEY) return { error: 'AI polishing is not set up' };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 900,
      system: 'You polish short announcements from the HQ of the KiuFunza 4 endline field work in Tanzania to field staff (coordinators and volunteer test administrators). Keep every fact and instruction exactly as given; never add dates, numbers, names or promises that are not in the draft. Make it clear, warm, respectful and short (a title under 70 characters and a message of a few short lines). Plain words, no jargon, no emojis unless the draft has them. Keep any Swahili the draft contains and write natural Tanzanian Kiswahili where you translate. ' + (b.add_swahili ? 'After the English message add a blank line and then the Kiswahili version of the same message, and give a bilingual title like "English / Kiswahili". ' : 'Keep the language(s) of the draft. ') + 'Reply with JSON only: {"title":"...","body":"..."}',
    messages: [{ role: 'user', content: JSON.stringify({ kind: b.kind || 'announcement', title: b.title || '', message: b.body || '' }) }] }),
  });
  if (!res.ok) return { error: 'The AI service did not answer (' + res.status + ')' };
  const data = await res.json(); const txt = (data.content || []).map((c) => c.text || '').join('');
  try { const p = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)); return { title: String(p.title || b.title || '').slice(0, 120), body: String(p.body || '').slice(0, 2000) }; } catch { return { error: 'Could not read the AI answer. Try again.' }; }
}
