// Replies to automatic flags ("queries"). A flag is identified by its content, so the
// same check on the same school/grade/day keeps its thread across re-computation.
import { kv } from './store.js';
import { workingDaysBetween, SCHOOL_BY_ID, PRACTICE_BY_ID, STAFF, staffForKoboName } from './config.js';
import { PILOT_ALLOC } from './pilot.js';

export const flagKey = (f) => [f.type, f.school, f.grade || 0, f.date || '', f.admin || ''].join('|');
const KEY = 'v2:queries';

// A query must get a reply within 2 working days of the visit. Overdue = still open, nobody has replied, and the 2 days have passed.
export const QUERY_REPLY_DAYS = 2;
export function overdueQueries(flags, today) {
  // overdue = nobody has submitted a response (or written a comment) and the 2 working days have passed
  return (flags || []).filter((f) => f.date && !(f.q && f.q.status === 'resolved') && !(f.q && f.q.wf && f.q.wf.response) && !(f.q && f.q.thread && f.q.thread.length) && workingDaysBetween(f.date, today) > QUERY_REPLY_DAYS);
}
export const loadQueries = async (env) => (await kv(env).get(KEY)) || {};


// ---------- the approval chain ----------
// 1. the person the query is about writes the response (an RC or ARC works on their own and a region-level query themselves)
// 2. the RC or ARC of the region reviews a volunteer's response (skipped when an RC or ARC wrote it)
// 3. HQ first review ("Joram's level"), 4. HQ final approval ("Mundo's level"). Each reviewer can approve, reject (with a reason)
// or edit and approve. Every step stays in the history, visible to everyone involved.
export const STAGES = { open: 'Waiting for the response', rework: 'Sent back for rework', team: 'Team review (RC or ARC)', hq1: 'First HQ review', final: 'Final approval', approved: 'Approved and closed' };
export const STEP_LABEL = { team: 'Team review', hq1: 'First HQ review', final: 'Final approval' };
const parseKey = (key) => { const [type, school, grade, date, admin] = String(key).split('|'); return { type, school, grade, date, admin: admin || '' }; };
const stageOf = (q) => (q && q.wf && q.wf.stage) || 'open';
const MAXH = 40;

export function decorate(flags, queries) {
  return flags.map((f) => {
    const k = flagKey(f);
    const q = queries[k];
    return { ...f, qk: k, q: q ? { status: q.status, thread: q.thread, wf: q.wf ? { stage: q.wf.stage, response: q.wf.response, responder: q.wf.responder, history: q.wf.history, rework_note: q.wf.rework_note } : null } : null };
  });
}

// who the response belongs to: the person the query is about, or the region's coordinators when it is about nobody in particular
function responderInfo(key) {
  const info = parseKey(key); const st = info.admin ? staffForKoboName(info.admin) : null; let region = SCHOOL_BY_ID[info.school]?.region || (PRACTICE_BY_ID[info.school] ? 'TRAINING' : null);
  if (PILOT_ALLOC[info.school] && st?.region) region = st.region; // pilot day: the person's own regional team handles the query, as in a live school
  return { info, st, region };
}
const isCoord = (who, region) => (who.role === 'rc' || who.role === 'arc') && (who.region === region || region === 'TRAINING'); // anyone may practise the chain in the TRAINING schools

function canRespond(who, ri) {
  if (ri.region === 'TRAINING' && who.role !== 'hq') return 'self';
  if (ri.st && who.id === ri.st.id) return 'self';
  if (isCoord(who, ri.region) && (!ri.st || ri.st.role === 'volunteer' || ri.st.role === 'rc' || ri.st.role === 'arc')) return ri.st && ri.st.id !== who.id ? 'behalf' : 'self';
  return null;
}
function canReview(who, stage, q, ri) {
  const authorId = q.wf?.response?.by_id;
  if (stage === 'team') return isCoord(who, ri.region) && who.id !== authorId;
  if (stage === 'hq1') return who.role === 'hq' && (who.review_level || 0) >= 2 && who.hq_id !== authorId;
  if (stage === 'final') { const prior = (q.wf?.history || []).filter((h) => h.level === 'hq1' && h.action !== 'rejected').map((h) => h.by_id); return who.role === 'hq' && (who.review_level || 0) >= 3 && !prior.includes(who.hq_id) && who.hq_id !== authorId; }
  return false;
}
const push = (q, who, level, action, text, from, to, extra = {}) => { (q.wf.history ||= []).push({ at: new Date().toISOString(), by: who.name, by_id: who.hq_id || who.id, role: who.role === 'hq' ? 'HQ' : (who.position || who.role), level, action, text: String(text || '').slice(0, 600), from, to, ...extra }); if (q.wf.history.length > MAXH) q.wf.history = q.wf.history.slice(-MAXH); };

export async function postQuery(env, who, { key, text, action, decision, note }) {
  if (!key) return { error: 'Missing flag', status: 400 };
  const queries = await loadQueries(env);
  const q = (queries[key] ||= { status: 'open', thread: [] });
  const ri = responderInfo(key);
  if (!ri.region) return { error: 'This query is not in a known school', status: 404 };
  if (who.role !== 'hq' && who.region !== ri.region && ri.region !== 'TRAINING') return { error: 'Not your region', status: 403 };
  const now = new Date().toISOString(); let notify = null;
  if (action === 'respond') {
    const stage = stageOf(q); if (stage !== 'open' && stage !== 'rework') return { error: 'A response is already with the reviewers. Wait for their decision.', status: 409 };
    const t = String(text || '').trim(); if (t.length < 10) return { error: 'Write a meaningful response: what happened and what was done (at least a sentence).', status: 422 };
    const rel = canRespond(who, ri); if (!rel) return { error: 'The response comes from the person the query is about, or from the region\'s coordinators.', status: 403 };
    q.wf = { ...(q.wf || {}), response: { text: t.slice(0, 600), by: who.name, by_id: who.id, role: who.position || who.role, at: now, on_behalf_of: rel === 'behalf' ? ri.st.name : null }, responder: { name: ri.st ? ri.st.name : who.name, role: ri.st ? ri.st.role : who.role }, history: q.wf?.history || [], versions: q.wf?.versions || [] };
    q.wf.versions.push({ at: now, by: who.name, text: t.slice(0, 600) });
    const skip = who.role === 'rc' || who.role === 'arc'; const to = skip ? 'hq1' : 'team'; const from = stage; q.wf.stage = to; q.wf.rework_note = null;
    push(q, who, 'responder', stage === 'rework' ? 'resubmitted' : 'submitted', t, from, to, rel === 'behalf' ? { on_behalf_of: ri.st.name } : {});
    if (skip) push(q, { name: 'Team review', role: 'system' }, 'team', 'skipped', 'Written by a coordinator, so it goes straight to HQ.', 'team', 'hq1');
    q.status = 'open'; notify = { to_stage: to, region: ri.region, author_id: who.id, responder_id: ri.st?.id ?? who.id };
  } else if (action === 'review') {
    const stage = stageOf(q); if (!['team', 'hq1', 'final'].includes(stage)) return { error: 'There is nothing to review at the moment.', status: 409 };
    if (!canReview(who, stage, q, ri)) return { error: stage === 'team' ? 'This is waiting for the RC or ARC of the region (not the person who wrote it).' : stage === 'hq1' ? 'This is waiting for the first HQ reviewer.' : 'This is waiting for the final approver (a different person from the first HQ reviewer).', status: 403 };
    if (decision === 'reject') {
      const n = String(note || '').trim(); if (n.length < 8) return { error: 'Write why you are sending it back (at least a short sentence).', status: 422 };
      push(q, who, stage, 'rejected', n, stage, 'rework'); q.wf.stage = 'rework'; q.wf.rework_note = n; notify = { to_stage: 'rework', region: ri.region, responder_id: ri.st?.id ?? q.wf.response?.by_id, reviewer: who.name };
    } else if (decision === 'approve' || decision === 'edit') {
      const next = stage === 'team' ? 'hq1' : stage === 'hq1' ? 'final' : 'approved';
      if (decision === 'edit') { const t = String(text || '').trim(); if (t.length < 10) return { error: 'Write the corrected response (at least a sentence).', status: 422 }; const before = q.wf.response.text; q.wf.response = { ...q.wf.response, text: t.slice(0, 600), edited_by: who.name, edited_at: now }; q.wf.versions.push({ at: now, by: who.name, text: t.slice(0, 600) }); push(q, who, stage, 'edited_approved', t, stage, next, { before: before.slice(0, 600), note: String(note || '').slice(0, 300) }); }
      else push(q, who, stage, 'approved', String(note || '').slice(0, 300), stage, next);
      q.wf.stage = next; if (next === 'approved') { q.status = 'resolved'; q.wf.approved_at = now; }
      notify = { to_stage: next, region: ri.region, responder_id: ri.st?.id ?? q.wf.response?.by_id, reviewer: who.name };
    } else return { error: 'Choose approve, reject or edit and approve', status: 422 };
  } else if (action === 'resolve') {
    if (!(who.role === 'hq' && (who.level || 'admin') === 'admin')) return { error: 'Only an HQ Admin can close a query without the review chain. Use the chain: response, review, approval.', status: 403 };
    q.status = 'resolved'; q.wf = { ...(q.wf || {}), stage: 'approved', history: q.wf?.history || [] }; push(q, who, 'admin', 'closed', text || 'Closed by an Admin without the review chain', stageOf(q), 'approved');
  } else { // a plain comment: kept in the thread, does not move the chain
    const t = String(text || '').trim(); if (!t) return { error: 'Write a comment first', status: 422 };
    q.thread.push({ by: who.name, role: who.role, text: t.slice(0, 400), at: now });
  }
  await kv(env).put(KEY, queries);
  return { q, notify };
}
