// Three ways of talking that stay attached to the work:
//  - direct messages: a short note to a person, a team or the people at a school, with a phone alert and an inbox that records who read it
//  - questions to HQ: field staff ask, the right person answers (a volunteer's RC first, then HQ), and the asker is told
//  - HQ-only notes: private notes on a query, school, person, region or request, with @mentions that raise an alert
import { kv } from './store.js';
import { STAFF, SCHOOL_BY_ID, REGIONS, staffForKoboName, eatToday } from './config.js';
import { getPlan } from './plan.js';
import { PILOT_ALLOC } from './pilot.js';
import { pushTo } from './push.js';
import { loadHq } from './hq.js';

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();
const staffById = (id) => STAFF.find((s) => String(s.id) === String(id));
const isHq = (w) => w.role === 'hq'; const hqWriter = (w) => w.role === 'hq' && (w.level || 'admin') !== 'viewer';
const coord = (w) => w.role === 'rc' || w.role === 'arc';
const cut = (s, n) => String(s || '').trim().slice(0, n);

// ---------------- direct messages ----------------
const DM = 'v2:dm';
async function recipients(env, who, to) {
  const out = new Map(); const add = (s) => { if (s && s.active) out.set(String(s.id), s); };
  if (!to) return { error: 'Choose who the message is for' };
  if (to.kind === 'person') { const s = to.id != null ? staffById(to.id) : staffForKoboName(to.name || ''); if (!s) return { error: 'That person is not on the staff list' }; if (coord(who) && s.region !== who.region) return { error: 'You can message people in your own region', status: 403 }; add(s); return { list: [...out.values()], label: s.name }; }
  if (to.kind === 'region') { const R = String(to.region || '').toUpperCase(); if (!REGIONS.includes(R)) return { error: 'Unknown region' }; if (coord(who) && R !== who.region) return { error: 'You can message your own region', status: 403 }; const roles = Array.isArray(to.roles) && to.roles.length ? new Set(to.roles) : null; STAFF.filter((s) => s.active && s.region === R && (!roles || roles.has(s.role))).forEach(add); return { list: [...out.values()], label: `${R.charAt(0)}${R.slice(1).toLowerCase()} team${roles ? ' (' + [...roles].join(', ') + ')' : ''}` }; }
  if (to.kind === 'school') {
    const sc = SCHOOL_BY_ID[to.school]; if (!sc) return { error: 'Unknown school' }; if (coord(who) && sc.region !== who.region && !(PILOT_ALLOC[to.school] || []).includes(who.region)) return { error: 'You can message teams in your own region', status: 403 };
    if (PILOT_ALLOC[to.school]) { for (const r of PILOT_ALLOC[to.school]) STAFF.filter((s) => s.active && s.region === r).forEach(add); return { list: [...out.values()], label: `${sc.name} (pilot teams)` }; }
    const plan = await getPlan(env, sc.region); const today = eatToday(); const v = (plan.visits || []).filter((x) => x.school === to.school).sort((a, b) => (a.date < b.date ? -1 : 1)); const pick = v.find((x) => x.date >= today) || v[v.length - 1];
    if (!pick) return { error: 'No planned visit for this school, so there is no team to message' };
    for (const n of pick.team || []) add(staffForKoboName(n)); return { list: [...out.values()], label: `${sc.name} team, ${pick.date}` };
  }
  return { error: 'Choose who the message is for' };
}
export async function sendDm(env, who, b) {
  if (!(hqWriter(who) || coord(who))) return { error: 'Only HQ and coordinators can send messages', status: 403 };
  const text = cut(b.text, 280); if (text.length < 3) return { error: 'Write the message first' };
  const log = (await kv(env).get(DM)) || []; const mine = log.filter((m) => m.by.id === String(who.id) && Date.now() - Date.parse(m.at) < 3600e3).length; if (mine >= 30) return { error: 'You have sent many messages this hour. Please wait a little.', status: 429 };
  const r = await recipients(env, who, b.to); if (r.error) return r; if (!r.list.length) return { error: 'Nobody to send this to' };
  const ids = new Set(r.list.map((s) => String(s.id)));
  const pr = await pushTo(env, (w) => w && ids.has(String(w.id)), { title: `${cut(who.name, 40)}: message for you`, body: text.slice(0, 120), url: '/#news' }).catch(() => ({ sent: 0 }));
  const m = { id: uid(), at: now(), by: { id: String(who.id), name: who.name, role: who.role, region: who.region || null }, text, to: { kind: b.to.kind, label: r.label, ids: [...ids] }, push: { sent: pr.sent || 0 }, acks: {} };
  log.unshift(m); await kv(env).put(DM, log.slice(0, 400));
  return { ok: true, id: m.id, recipients: r.list.length, alerts: pr.sent || 0, label: r.label };
}
export async function dmInbox(env, who) {
  const log = (await kv(env).get(DM)) || []; const me = String(who.id);
  const mine = log.filter((m) => m.to.ids.includes(me) && Date.now() - Date.parse(m.at) < 45 * 864e5).slice(0, 30).map((m) => ({ id: m.id, at: m.at, from: m.by.name, role: m.by.role, text: m.text, label: m.to.label, read: Boolean(m.acks[me]) }));
  return { items: mine, unread: mine.filter((m) => !m.read).length };
}
export async function dmAck(env, who, id) { const log = (await kv(env).get(DM)) || []; const m = log.find((x) => x.id === id); if (!m || !m.to.ids.includes(String(who.id))) return { error: 'Not found', status: 404 }; m.acks[String(who.id)] = now(); await kv(env).put(DM, log); return { ok: true }; }
export async function dmSent(env, who, filter = {}) {
  if (!(hqWriter(who) || coord(who) || isHq(who))) return { error: 'Not allowed', status: 403 };
  const log = (await kv(env).get(DM)) || [];
  let list = isHq(who) ? log : log.filter((m) => m.by.id === String(who.id));
  if (filter.person) list = list.filter((m) => m.to.ids.includes(String(filter.person)));
  return { items: list.slice(0, 60).map((m) => { const unread = m.to.ids.filter((i) => !m.acks[i]).map((i) => staffById(i)?.name).filter(Boolean); return { id: m.id, at: m.at, by: m.by.name, text: m.text, label: m.to.label, n: m.to.ids.length, read: m.to.ids.length - unread.length, alerts: m.push.sent, unread_names: unread.slice(0, 12) }; }) };
}

// ---------------- questions to HQ ----------------
const ASK = 'v2:askq'; export const ASK_CATS = { records: 'My records or a check', plan: 'Plan, schedule or notices', phone: 'Phone, form or the app', pay: 'Days worked or payment', other: 'Something else' };
const hqTargets = (w) => w && w.role === 'hq' && String(w.level || 'admin') !== 'viewer';
const handlerOf = (who, q) => hqWriter(who) || (coord(who) && q.owner === 'rc' && who.region === q.by.region);
const canSee = (who, q) => isHq(who) || String(who.id) === q.by.id || (coord(who) && q.by.region === who.region && q.by.role === 'volunteer');
export async function askCreate(env, who, b) {
  if (!['volunteer', 'rc', 'arc'].includes(who.role)) return { error: 'Questions come from field staff', status: 403 };
  const text = cut(b.text, 600); if (text.length < 10) return { error: 'Write the question in a sentence or two (at least 10 characters)' };
  const cat = ASK_CATS[b.cat] ? b.cat : 'other'; const school = SCHOOL_BY_ID[b.school] ? b.school : '';
  const all = (await kv(env).get(ASK)) || []; if (all.filter((q) => q.by.id === String(who.id) && Date.now() - Date.parse(q.at) < 3600e3).length >= 8) return { error: 'Please wait a little before asking again', status: 429 };
  const owner = who.role === 'volunteer' ? 'rc' : 'hq';
  const q = { id: uid(), at: now(), by: { id: String(who.id), name: who.name, role: who.role, region: who.region || null, position: who.position || '' }, cat, school, text, urgent: Boolean(b.urgent), status: 'open', owner, events: [{ at: now(), by: who.name, kind: 'asked', text }], updated_at: now() };
  all.unshift(q); await kv(env).put(ASK, all.slice(0, 600));
  const pred = owner === 'rc' ? (w) => coord(w) && w.region === who.region : hqTargets;
  await pushTo(env, pred, { title: q.urgent ? 'Urgent question' : 'New question', body: `${cut(who.name, 30)}: ${text.slice(0, 90)}`, url: owner === 'rc' ? '/#ask' : '/#questions' }).catch(() => {});
  return { ok: true, id: q.id, owner };
}
export async function askList(env, who) {
  const all = (await kv(env).get(ASK)) || []; const list = all.filter((q) => canSee(who, q));
  const mine = list.filter((q) => q.by.id === String(who.id)); const others = list.filter((q) => q.by.id !== String(who.id));
  const open = (q) => q.status === 'open' || q.status === 'escalated';
  return { mine, others, counts: { to_answer: others.filter((q) => open(q) && (isHq(who) ? true : q.owner === 'rc')).length, mine_waiting: mine.filter(open).length, mine_answered: mine.filter((q) => q.status === 'answered').length }, cats: ASK_CATS, can_answer: hqWriter(who) || coord(who) };
}
export async function askAct(env, who, b) {
  const all = (await kv(env).get(ASK)) || []; const q = all.find((x) => x.id === b.id); if (!q || !canSee(who, q)) return { error: 'Not found', status: 404 };
  const t = cut(b.text, 800); const ev = (kind, text) => { q.events.push({ at: now(), by: who.name, kind, text }); q.updated_at = now(); };
  if (b.action === 'answer') {
    if (!handlerOf(who, q) && !hqWriter(who)) return { error: 'This question is for someone else to answer', status: 403 }; if (t.length < 3) return { error: 'Write the answer first' };
    q.answer = { text: t, by: who.name, role: who.role, at: now() }; q.status = 'answered'; ev('answered', t);
    await pushTo(env, (w) => w && String(w.id) === q.by.id, { title: 'Your question was answered', body: t.slice(0, 100), url: '/#ask' }).catch(() => {});
  } else if (b.action === 'escalate') {
    if (!(coord(who) && handlerOf(who, q))) return { error: 'Only the coordinator handling it can send it to HQ', status: 403 }; q.owner = 'hq'; q.status = 'escalated'; ev('escalated', t || 'Sent to HQ');
    await pushTo(env, hqTargets, { title: 'Question sent up to HQ', body: `${cut(q.by.name, 30)}: ${q.text.slice(0, 90)}`, url: '/#questions' }).catch(() => {});
  } else if (b.action === 'followup') {
    if (String(who.id) !== q.by.id) return { error: 'Only the person who asked can follow up', status: 403 }; if (t.length < 3) return { error: 'Write your follow-up' }; q.status = q.owner === 'hq' ? 'escalated' : 'open'; ev('comment', t);
    await pushTo(env, q.owner === 'rc' ? (w) => coord(w) && w.region === q.by.region : hqTargets, { title: 'Follow-up on a question', body: `${cut(q.by.name, 30)}: ${t.slice(0, 90)}`, url: q.owner === 'rc' ? '/#ask' : '/#questions' }).catch(() => {});
  } else if (b.action === 'close') { if (String(who.id) !== q.by.id && !handlerOf(who, q) && !hqWriter(who)) return { error: 'Not allowed', status: 403 }; q.status = 'closed'; ev('closed', t || 'Closed'); }
  else return { error: 'Unknown action' };
  await kv(env).put(ASK, all); return { ok: true, status: q.status };
}
export async function askCounts(env, who) { const l = await askList(env, who); return l.counts; }

// ---------------- HQ-only notes ----------------
const NOTES = 'v2:hqnotes';
const okTarget = (t) => /^(query|school|person|region|dr|corr):[^\u0000-\u001f]{1,160}$/.test(String(t || ''));
export async function notesList(env, who, target) {
  if (!isHq(who)) return { error: 'HQ only', status: 403 };
  const d = (await kv(env).get(NOTES)) || { notes: [] };
  const hq = (await loadHq(env)).users.filter((u) => u.active !== false && u.level !== 'viewer').map((u) => ({ id: 'hq:' + u.id, name: u.name }));
  if (target) return { target, notes: d.notes.filter((n) => n.target === target).sort((a, b) => (b.pinned - a.pinned) || (a.at < b.at ? 1 : -1)), people: hq, can_write: hqWriter(who) };
  const counts = {}; for (const n of d.notes) counts[n.target] = (counts[n.target] || 0) + 1;
  const me = String(who.id); const mentions = d.notes.filter((n) => (n.mentions || []).includes(me) && !(n.seen || {})[me]).slice(0, 20);
  return { counts, mentions, recent: d.notes.slice(0, 25), people: hq, can_write: hqWriter(who) };
}
export async function notesAct(env, who, b) {
  if (!hqWriter(who)) return { error: 'Only HQ can write notes', status: 403 };
  const d = (await kv(env).get(NOTES)) || { notes: [] };
  if (b.action === 'add') {
    if (!okTarget(b.target)) return { error: 'Choose what the note is about' }; const text = cut(b.text, 800); if (text.length < 2) return { error: 'Write the note' };
    const hq = (await loadHq(env)).users; const valid = new Set(hq.map((u) => 'hq:' + u.id)); const mentions = [...new Set((b.mentions || []).map(String).filter((m) => valid.has(m) && m !== String(who.id)))];
    const n = { id: uid(), target: b.target, at: now(), by: who.name, by_id: String(who.id), text, mentions, pinned: false }; d.notes.unshift(n); await kv(env).put(NOTES, { notes: d.notes.slice(0, 2500) });
    if (mentions.length) await pushTo(env, (w) => w && w.role === 'hq' && mentions.includes(String(w.id)), { title: `${cut(who.name, 30)} tagged you in a note`, body: text.slice(0, 100), url: '/#hq' }).catch(() => {});
    return { ok: true, id: n.id };
  }
  const n = d.notes.find((x) => x.id === b.id); if (!n) return { error: 'Not found', status: 404 };
  if (b.action === 'pin') n.pinned = !n.pinned;
  else if (b.action === 'seen') { (n.seen ||= {})[String(who.id)] = now(); }
  else if (b.action === 'delete') { if (n.by_id !== String(who.id) && (who.level || 'admin') !== 'admin') return { error: 'Only the author or an Admin can delete a note', status: 403 }; d.notes = d.notes.filter((x) => x.id !== n.id); }
  else return { error: 'Unknown action' };
  await kv(env).put(NOTES, d); return { ok: true };
}
