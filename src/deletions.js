// Deleting submissions from the dashboard, only through an approval chain (see DATA_DELETION_PROTOCOL.md).
// RC/ARC or Mundo suggest, Joram reviews and initiates, Mundo approves and carries it out. A full copy of every
// record is saved before anything is deleted. Every step stays in the history.
import { kv } from './store.js';
import { SCHOOL_BY_ID, SCHOOLS_BY_REGION } from './config.js';
import { tellHQ } from './formjob.js';
import { pushTo } from './push.js';
import { FIELDS, checkEdit, patchFor, describe, runEdit } from './edits.js';
import { previewMove, applyMove } from './corrections.js';

const KEY = 'v2:delreq', LOG = 'v2:delog', CAP = 200;
const uid = () => Math.random().toString(36).slice(2, 10);
const KINDS = { students: { env: 'KOBO_ASSET_ID', label: 'Students assessment' }, sampling: { env: 'KOBO_ASSET_SAMPLING', label: 'Sampling' } };
export const STAGE_LABEL = { suggested: 'Waiting for Joram', initiated: 'Waiting for Mundo', rework: 'Sent back to the person who suggested it', deleted: 'Deleted', done: 'Applied', rejected: 'Rejected', withdrawn: 'Withdrawn' };
const lvl = (w) => (w.role === 'hq' ? w.review_level || 0 : 0);
const sfx = (r, s) => { for (const k in r) if (k === s || k.endsWith('/' + s)) return r[k]; return undefined; };
const srv = (env) => `https://${env.KOBO_SERVER || 'kf.kobotoolbox.org'}`;
const H = (env) => ({ Authorization: `Token ${env.KOBO_TOKEN}` });
const load = async (env) => (await kv(env).get(KEY)) || [];
const save = (env, d) => kv(env).put(KEY, d);

function summ(kind, r) {
  const school = sfx(r, 'school') || ''; const date = String(sfx(r, 'date') || r.today || '').slice(0, 10);
  const o = { id: r._id, school, school_name: SCHOOL_BY_ID[school]?.name || '', region: SCHOOL_BY_ID[school]?.region || '', grade: String(sfx(r, 'grade_conf') ?? sfx(r, 'grade') ?? ''), date, enumerator: sfx(r, 'enumerator') || '', sub: r._submission_time || '' };
  if (kind === 'students') Object.assign(o, { stuid: r.stuid || '', rand: r['stu_info/rand_nr'] ?? sfx(r, 'rand_nr') ?? '', tt: sfx(r, 'testtime_rounded') ?? '', at: (r.start || '').slice(11, 16), avail: String(r.stu_avail) === '2' ? 'absent' : 'present' });
  else Object.assign(o, { att: sfx(r, 'att') ?? '', at: (r.start || '').slice(11, 16) });
  return o;
}
async function koboData(env, kind, query, max = 4000) {
  const asset = env[KINDS[kind].env]; if (!asset) throw new Error('That project is not connected');
  let url = `${srv(env)}/api/v2/assets/${asset}/data/?format=json&limit=1000&query=${encodeURIComponent(JSON.stringify(query))}`; const out = [];
  for (let i = 0; i < 6 && url && out.length < max; i++) { const r = await fetch(url, { headers: H(env) }); if (!r.ok) throw new Error(`KoBo ${r.status} reading records`); const d = await r.json(); out.push(...(d.results || [])); url = d.next || null; }
  return out;
}
async function koboCount(env, kind) { const asset = env[KINDS[kind].env]; const r = await fetch(`${srv(env)}/api/v2/assets/${asset}/data/?format=json&limit=1`, { headers: H(env) }); if (!r.ok) throw new Error(`KoBo ${r.status} counting`); return (await r.json()).count; }
const regionOk = (who, school) => who.role === 'hq' || (SCHOOL_BY_ID[school]?.region === who.region);

// ---- find records (for choosing what to suggest) ----
export async function findRecords(env, who, p) {
  const kind = KINDS[p.kind] ? p.kind : 'students';
  if (who.role !== 'hq' && who.role !== 'rc' && who.role !== 'arc') return { error: 'Not allowed', status: 403 };
  const school = String(p.school || '').trim(); if (!school) return { error: 'Choose a school first.' };
  if (!SCHOOL_BY_ID[school]) return { error: 'Unknown school code.' };
  if (!regionOk(who, school)) return { error: 'That school is not in your region.', status: 403 };
  const q = { 'id_data/school': school }; if (p.date && /^\d{4}-\d\d-\d\d$/.test(p.date)) q.today = p.date;
  let recs = (await koboData(env, kind, q)).map((r) => summ(kind, r));
  if (p.grade) recs = recs.filter((r) => r.grade === String(p.grade));
  if (p.enumerator) recs = recs.filter((r) => r.enumerator === p.enumerator);
  if (p.stuid) recs = recs.filter((r) => String(r.stuid).includes(p.stuid));
  if (p.dups) {
    const g = {}; for (const r of recs) (g[kind === 'students' ? `${r.grade}|${r.stuid || 'x' + r.id}` : r.grade] ||= []).push(r);
    recs = Object.values(g).filter((x) => x.length > 1).flat();
  }
  const pend = new Set((await load(env)).filter((r) => ['suggested', 'initiated', 'rework'].includes(r.stage)).flatMap((r) => r.ids));
  recs.sort((a, b) => (a.grade + a.stuid + a.date).localeCompare(b.grade + b.stuid + b.date) || a.sub.localeCompare(b.sub));
  return { kind, records: recs.slice(0, 500).map((r) => ({ ...r, pending: pend.has(r.id) })), total: recs.length };
}

// ---- requests ----
const hist = (who, action, text) => ({ at: new Date().toISOString(), by: who.name, by_id: String(who.id ?? who.hq_id ?? ''), role: who.role === 'hq' ? 'HQ' : who.position || who.role, action, text: String(text || '').slice(0, 1000) });
const visible = (r, who) => who.role === 'hq' || (r.regions || []).includes(who.region) || r.by_id === String(who.id);
export async function listRequests(env, who) {
  const d = await load(env); const log = who.role === 'hq' ? ((await kv(env).get(LOG)) || []).slice(0, 50) : [];
  const rebuild = (await kv(env).get('v2:rebuild')) || [];
  return { requests: d.filter((r) => visible(r, who)).sort((a, b) => (b.updated_at || '') > (a.updated_at || '') ? 1 : -1).map((r) => ({ ...r, stage_label: STAGE_LABEL[r.stage], edit_lines: r.type === 'edit' ? r.items.map((it) => ({ id: it.id, text: describe(r.edit, it) })) : undefined, field_label: r.edit ? FIELDS[r.edit.field] : undefined })), log, rebuilding: rebuild.length > 0, caps: { max: CAP }, me: { level: lvl(who), can_suggest: who.role !== 'volunteer' && (who.role !== 'hq' || lvl(who) >= 2) } };
}
async function notify(env, r, text, pred) { try { await pushTo(env, pred, { title: r.type === 'edit' ? 'Data edit request' : 'Data deletion request', body: text.slice(0, 120), url: '/#clean' }); } catch { /* the page still shows it */ } }
const hqLvl = (n) => (w) => w && w.role === 'hq' && (w.review_level || 0) >= n;

export async function actOnRequest(env, who, b) {
  const d = await load(env); const a = b.action; const now = new Date().toISOString();
  if (a === 'suggest') {
    if (who.role === 'volunteer' || (who.role === 'hq' && lvl(who) < 2)) return { error: 'You cannot suggest deletions with this access.', status: 403 };
    const kind = KINDS[b.kind] ? b.kind : 'students'; const want = [...new Set((b.ids || []).map(Number).filter(Boolean))];
    if (!want.length) return { error: 'Choose at least one record.' }; if (want.length > CAP) return { error: `One request can hold at most ${CAP} records.` };
    if (String(b.reason || '').trim().length < 15) return { error: 'Write the reason clearly (at least a sentence).' };
    const pend = new Set(d.filter((r) => ['suggested', 'initiated', 'rework'].includes(r.stage)).flatMap((r) => r.ids));
    if (want.some((i) => pend.has(i))) return { error: 'Some of these records are already in an open request.' };
    const rawRecs = await koboData(env, kind, { _id: { $in: want } }); const recs = rawRecs.map((r) => summ(kind, r));
    let edit = null;
    if (b.type === 'edit') {
      const c = checkEdit(b, kind, who); if (c.error) return { error: c.error, status: c.status };
      edit = c.edit; if (edit.field === 'pupil' && want.some((i) => !edit.values[i])) return { error: 'Type a new pupil number for every ticked record.' };
      if (edit.field === 'grade' && recs.some((x) => x.grade === edit.value)) return { error: 'Some of these records are already in that grade.' };
      if (edit.field === 'school' && recs.some((x) => x.school === edit.value)) return { error: 'Some of these records are already at that school.' };
      if (edit.field === 'pupil' || edit.field === 'grade') for (const raw of rawRecs) { const ns = patchFor(kind, edit.field, raw, edit.field === 'pupil' ? edit.values[raw._id] : edit.value).stuid; if (ns) { const clash = await koboData(env, kind, { stuid: ns }, 5); if (clash.length) return { error: `Pupil ID ${ns} already exists in KoBo (record ${clash[0]._id}). That change would create a duplicate.` }; } }
    }
    if (recs.length !== want.length) return { error: 'Some records no longer exist in KoBo. Search again.' };
    if (recs.some((r) => !regionOk(who, r.school))) return { error: 'Some records are not in your region.', status: 403 };
    const level = lvl(who); const r = { id: uid(), type: edit ? 'edit' : 'delete', edit, kind, ids: want, items: recs, regions: [...new Set(recs.map((x) => x.region).filter(Boolean))], reason: String(b.reason).trim().slice(0, 1500), link: String(b.link || '').slice(0, 200), by: who.name, by_id: String(who.id ?? who.hq_id ?? ''), by_role: who.role === 'hq' ? 'HQ' : who.position || who.role, by_level: level, created_at: now, updated_at: now, stage: level === 2 ? 'initiated' : 'suggested', history: [hist(who, 'suggested', b.reason)] };
    if (level === 2) { r.initiated_by = r.by_id; r.history.push(hist(who, 'initiated', 'Suggested and initiated by the same person; Mundo decides.')); }
    d.unshift(r); await save(env, d);
    await notify(env, r, `${who.name}: ${want.length} record(s) to ${edit ? 'edit' : 'delete'}`, hqLvl(r.stage === 'initiated' ? 3 : 2));
    return { ok: true, id: r.id, stage: r.stage };
  }
  const r = d.find((x) => x.id === b.id); if (!r) return { error: 'Not found', status: 404 };
  if (!visible(r, who)) return { error: 'Not allowed', status: 403 };
  const me = String(who.id ?? who.hq_id ?? '');
  const open = ['suggested', 'initiated', 'rework'].includes(r.stage); if (!open) return { error: 'This request is closed.' };
  const text = String(b.text || '').trim();
  const needReason = () => (text.length < 5 ? 'Write the reason.' : null);
  const removeIds = (ids) => { const gone = new Set((ids || []).map(Number)); if (!gone.size) return; r.ids = r.ids.filter((i) => !gone.has(i)); r.items = r.items.filter((i) => !gone.has(i.id)); };
  if (a === 'withdraw') { if (r.by_id !== me) return { error: 'Only the person who suggested it can withdraw it.', status: 403 }; r.stage = 'withdrawn'; r.history.push(hist(who, 'withdrawn', text)); }
  else if (a === 'resubmit') { if (r.stage !== 'rework' || r.by_id !== me) return { error: 'Not allowed', status: 403 }; if (text.length < 15) return { error: 'Write the reason again, clearly.' }; r.reason = text; removeIds(b.remove); if (!r.ids.length) return { error: 'Nothing left in the request.' }; r.stage = r.by_level >= 3 ? 'suggested' : r.by_level === 2 ? 'initiated' : 'suggested'; r.history.push(hist(who, 'resubmitted', text)); }
  else if (a === 'initiate') {
    if (r.stage !== 'suggested' || lvl(who) < 2) return { error: 'Only Joram (or Mundo) can initiate a suggestion.', status: 403 };
    if (r.by_id === me) return { error: 'You cannot initiate your own suggestion.', status: 403 };
    removeIds(b.remove); if (!r.ids.length) return { error: 'Nothing left in the request. Reject it instead.' }; r.stage = 'initiated'; r.initiated_by = me; r.history.push(hist(who, 'initiated', text || (b.remove?.length ? `Removed ${b.remove.length} record(s) from the list.` : 'Reviewed and passed to Mundo.')));
    await notify(env, r, `${r.ids.length} record(s) waiting for your decision`, hqLvl(3));
  } else if (a === 'send_back' || a === 'reject') {
    const e = needReason(); if (e) return { error: e };
    const allowed = (r.stage === 'suggested' && lvl(who) >= 2) || (r.stage === 'initiated' && lvl(who) >= 3) || (r.stage === 'rework' && false); if (!allowed) return { error: 'It is not your step.', status: 403 };
    r.stage = a === 'reject' ? 'rejected' : 'rework'; r.history.push(hist(who, a === 'reject' ? 'rejected' : 'sent back', text));
    await notify(env, r, a === 'reject' ? 'Your deletion request was rejected' : 'Your deletion request was sent back', (w) => w && String(w.id) === r.by_id);
  } else if (a === 'comment') { if (!text) return { error: 'Write something first.' }; r.history.push(hist(who, 'comment', text)); }
  else if (a === 'delete' && r.type !== 'edit') return effect(env, who, r, d, b);
  else if (a === 'apply' && r.type === 'edit') return effectEdit(env, who, r, d, b);
  else return { error: 'Unknown action' };
  r.updated_at = now; await save(env, d); return { ok: true, stage: r.stage };
}

async function effect(env, who, r, d, b) {
  const me = String(who.id ?? who.hq_id ?? '');
  if (r.stage !== 'initiated') return { error: 'The request is not waiting for the final decision.' };
  if (lvl(who) < 3) return { error: 'Only Mundo (final approval) can delete.', status: 403 };
  if (r.initiated_by === me) return { error: 'The person who initiated it cannot also delete it.', status: 403 };
  if (Number(b.confirm) !== r.ids.length) return { error: `Type the number of records (${r.ids.length}) to confirm.` };
  const kind = r.kind;
  const recs = await koboData(env, kind, { _id: { $in: r.ids } });
  if (!recs.length) { r.stage = 'rejected'; r.history.push(hist(who, 'closed', 'The records no longer exist in KoBo.')); await save(env, d); return { error: 'The records no longer exist in KoBo. The request was closed.' }; }
  // 1. copy first
  const json = JSON.stringify(recs); const gz = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  let bin = ''; const u = new Uint8Array(gz); for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  await kv(env).put(`v2:delcopy:${r.id}`, { at: new Date().toISOString(), n: recs.length, kind, gz_b64: btoa(bin), by: who.name });
  const back = await kv(env).get(`v2:delcopy:${r.id}`); if (!back || back.n !== recs.length) return { error: 'The safety copy could not be saved, so nothing was deleted.' };
  // 2. delete one by one (a known, simple call)
  const before = await koboCount(env, kind); const asset = env[KINDS[kind].env]; const done = [], failed = [];
  for (const rec of recs) { const res = await fetch(`${srv(env)}/api/v2/assets/${asset}/data/${rec._id}/`, { method: 'DELETE', headers: H(env) }); if (res.status === 204 || res.status === 404) done.push(rec._id); else failed.push(`${rec._id}: ${res.status}`); }
  const after = await koboCount(env, kind);
  const ok = !failed.length && before - after === done.length;
  const entry = { at: new Date().toISOString(), request: r.id, kind: KINDS[kind].label, suggested_by: r.by, initiated_by: r.history.find((h) => h.action === 'initiated')?.by || r.by, approved_by: who.name, reason: r.reason, ids: done, regions: r.regions, count_before: before, count_after: after, copy: `v2:delcopy:${r.id}`, ok, failed };
  const lg = (await kv(env).get(LOG)) || []; lg.unshift(entry); await kv(env).put(LOG, lg.slice(0, 500));
  r.stage = 'deleted'; r.deleted = { at: entry.at, n: done.length, before, after, ok, failed }; r.history.push(hist(who, 'deleted', `${done.length} record(s) deleted. KoBo count ${before} to ${after}.${failed.length ? ' Problems: ' + failed.join('; ') : ''}`)); r.updated_at = entry.at;
  await save(env, d);
  // 3. the dashboard keeps totals, so rebuild the affected years from KoBo
  const years = [...new Set(r.items.map((i) => (i.school && /^TRAIN/i.test(i.school) ? 'practice' : (i.date || '').slice(0, 4))).filter(Boolean))];
  const rb = (await kv(env).get('v2:rebuild')) || []; for (const y of years) if (!rb.find((x) => x.kind === kind && x.year === y)) rb.push({ kind, year: y }); await kv(env).put('v2:rebuild', rb);
  await tellHQ(env, 'KiuFunza 4 · Automated update · Records deleted from KoBo', [`${who.name} deleted ${done.length} record(s) from the ${KINDS[kind].label} project after the approval chain (suggested by ${r.by}). KoBo count ${before} to ${after}.`, `Reason: ${r.reason}`, 'A full copy of the records is stored in the dashboard system. The dashboard totals are being rebuilt.']).catch(() => {});
  return { ok, deleted: done.length, before, after, failed };
}
export async function copyOf(env, id) { return kv(env).get(`v2:delcopy:${id}`); }

async function effectEdit(env, who, r, d, b) {
  const me = String(who.id ?? who.hq_id ?? '');
  if (r.stage !== 'initiated') return { error: 'The request is not waiting for the final decision.' };
  if (lvl(who) < 3) return { error: 'Only Mundo (final approval) can apply an edit.', status: 403 };
  if (r.initiated_by === me) return { error: 'The person who initiated it cannot also apply it.', status: 403 };
  if (Number(b.confirm) !== r.ids.length) return { error: `Type the number of records (${r.ids.length}) to confirm.` };
  const recs = await koboData(env, r.kind, { _id: { $in: r.ids } });
  if (recs.length !== r.ids.length) return { error: 'Some records no longer exist in KoBo. Reject this request and suggest it again.' };
  const json = JSON.stringify(recs); const gz = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  let bin = ''; const u = new Uint8Array(gz); for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  await kv(env).put(`v2:delcopy:${r.id}`, { at: new Date().toISOString(), n: recs.length, kind: r.kind, gz_b64: btoa(bin), by: who.name });
  const back = await kv(env).get(`v2:delcopy:${r.id}`); if (!back || back.n !== recs.length) return { error: 'The safety copy could not be saved, so nothing was changed.' };
  const res = await runEdit(env, who, r, recs, { preview: previewMove, apply: applyMove });
  const at = new Date().toISOString();
  const entry = { at, request: r.id, kind: KINDS[r.kind].label, type: 'edit', change: FIELDS[r.edit.field], suggested_by: r.by, initiated_by: r.history.find((h) => h.action === 'initiated')?.by || r.by, approved_by: who.name, reason: r.reason, ids: res.done || [], regions: r.regions, count_before: recs.length, count_after: recs.length, copy: `v2:delcopy:${r.id}`, ok: res.ok, failed: res.failed || [] };
  const lg = (await kv(env).get(LOG)) || []; lg.unshift(entry); await kv(env).put(LOG, lg.slice(0, 500));
  if (res.ok) { r.stage = 'done'; r.applied = { at, n: res.done.length }; }
  r.history.push(hist(who, res.ok ? 'applied' : 'tried', res.ok ? `${res.done.length} record(s) changed and checked in KoBo.` : `Stopped. ${(res.failed || []).join('; ')}`)); r.updated_at = at; await save(env, d);
  if ((res.done || []).length) {
    const years = [...new Set(r.items.map((i) => (i.school && /^TRAIN/i.test(i.school) ? 'practice' : (i.date || '').slice(0, 4))).filter(Boolean))];
    const rb = (await kv(env).get('v2:rebuild')) || []; for (const y of years) if (!rb.find((x) => x.kind === r.kind && x.year === y)) rb.push({ kind: r.kind, year: y }); await kv(env).put('v2:rebuild', rb);
    await tellHQ(env, 'KiuFunza 4 · Automated update · Records edited in KoBo', [`${who.name} applied an edit (${FIELDS[r.edit.field]}) to ${res.done.length} record(s) in the ${KINDS[r.kind].label} project after the approval chain (suggested by ${r.by}).`, `Reason: ${r.reason}`, 'The originals are saved in the dashboard system. The dashboard totals are being rebuilt.']).catch(() => {});
  }
  return { ok: res.ok, changed: (res.done || []).length, failed: res.failed || [] };
}
