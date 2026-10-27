// Correcting submitted records (grade, pupil number/ID, tester name, school) through the same approval chain as deletions.
// The change is made through KoBo's data interface, every record is read back and checked, and the originals are saved first.
import { kv } from './store.js';
import { SCHOOL_BY_ID, REGIONS, staffForKoboName } from './config.js';

export const FIELDS = {
  grade: 'Grade', lga: 'District (LGA)', region: 'Region', pupil: 'Pupil number / ID', tester: 'Test administrator name', school: 'School',
  att: 'Pupils present on the sampling day',
};
const sfx = (r, s) => { for (const k in r) if (k === s || k.endsWith('/' + s)) return r[k]; return undefined; };
const keysEnding = (r, s) => Object.keys(r).filter((k) => k === s || k.endsWith('/' + s));
const srv = (env) => `https://${env.KOBO_SERVER || 'kf.kobotoolbox.org'}`;
const H = (env) => ({ Authorization: `Token ${env.KOBO_TOKEN}`, 'content-type': 'application/json' });
const pad3 = (n) => String(n).padStart(3, '0');

// What the patch for one record looks like. Pure function: also used to show the "from, to" lines before anything is approved.
export function patchFor(kind, field, rec, to) {
  const d = {};
  if (field === 'grade') {
    const g = String(to);
    for (const k of keysEnding(rec, 'grade')) if (/(^|\/)id_data\/grade$|^grade$/.test(k)) d[k] = g;
    for (const k of keysEnding(rec, 'grade_conf')) d[k] = g;
    if (kind === 'students' && rec.stuid) { const old = String(sfx(rec, 'grade_conf') ?? sfx(rec, 'grade')); const s = String(rec.stuid); const sch = sfx(rec, 'school'); const i = sch ? s.indexOf(sch) : -1; if (i >= 0 && s[i + sch.length] === old) d.stuid = s.slice(0, i + sch.length) + g + s.slice(i + sch.length + 1); }
  } else if (field === 'pupil') {
    const n = Number(to); const rl = pad3(n);
    if (rec['stu_info/rand_nr'] !== undefined) d['stu_info/rand_nr'] = String(n);
    if (rec['stu_info/name'] !== undefined && String(rec['stu_info/name']) === String(rec['stu_info/rand_nr'])) d['stu_info/name'] = String(n);
    if (rec.rand_long !== undefined) d.rand_long = rl;
    if (rec.stuid) { const s = String(rec.stuid); const old = pad3(rec.rand_long ?? sfx(rec, 'rand_nr')); if (s.endsWith(old)) d.stuid = s.slice(0, s.length - 3) + rl; }
  } else if (field === 'att') { // the attendance answer only. The helper numbers the form calculated from it are not touched (see attGuard)
    for (const k of keysEnding(rec, 'att')) if (/(^|\/)att_gr\/att$|^att$/.test(k)) d[k] = String(Math.trunc(Number(to)));
  } else if (field === 'tester') {
    for (const k of keysEnding(rec, 'enumerator')) d[k] = String(to);
  } else if (field === 'lga' || field === 'region') {
    for (const k of keysEnding(rec, field)) if (/^id_data\//.test(k) || k === field) d[k] = String(to);
  }
  return Object.fromEntries(Object.entries(d).filter(([k, v]) => String(rec[k] ?? '') !== String(v)));
}

// Checks done when a request is suggested.
export function checkEdit(b, kind, who) {
  const field = b.field; if (!FIELDS[field]) return { error: 'Choose what to change' };
  if (kind === 'sampling' && field === 'pupil') return { error: 'Pupil numbers exist only in the Students project' };
  if (field === 'att') {
    if (kind !== 'sampling') return { error: 'Attendance is recorded only in the Sampling project' };
    const n = Number(b.value); if (!Number.isInteger(n) || n < 1 || n > 20) return { error: 'Use a whole number from 1 to 20. When more than 20 pupils were present the random draw of 20 depends on the number, so that needs the systems owner.' };
    return { edit: { field, value: String(n) } };
  }
  if (field === 'grade') { if (!['1', '2', '3'].includes(String(b.value))) return { error: 'The grade must be 1, 2 or 3' }; return { edit: { field, value: String(b.value) } }; }
  if (field === 'region') { const v = String(b.value || '').toUpperCase(); if (!REGIONS.includes(v)) return { error: 'Choose a real region' }; if (who.role !== 'hq' && v !== who.region) return { error: 'You can only use your own region', status: 403 }; return { edit: { field, value: v } }; }
  if (field === 'lga') { const v = String(b.value || '').trim().toUpperCase(); if (!Object.values(SCHOOL_BY_ID).some((x) => String(x.lga).toUpperCase() === v)) return { error: 'That district is not on the school list. Type it exactly as listed.' }; return { edit: { field, value: Object.values(SCHOOL_BY_ID).find((x) => String(x.lga).toUpperCase() === v).lga } }; }
  if (field === 'tester') { const st = staffForKoboName(String(b.value || '')); if (!st) return { error: 'That name is not on the staff list. Type it exactly as in the roster.' }; return { edit: { field, value: st.name } }; }
  if (field === 'school') {
    const s = SCHOOL_BY_ID[String(b.value || '')]; if (!s) return { error: 'The school must be a real school code' };
    if (who.role !== 'hq' && s.region !== who.region) return { error: 'You can move records only to a school in your region', status: 403 };
    return { edit: { field, value: s.id } };
  }
  const vals = {}; for (const [id, v] of Object.entries(b.values || {})) { const n = Number(v); if (!String(v).trim() || !Number.isInteger(n) || n < 1 || n > 400) return { error: `Record ${id}: "${String(v).slice(0, 20)}" is not a pupil number. Type only the pupil number, from 1 to 400, which is the last digits of the pupil ID (for 2026PS21030253006 type 6), not the whole ID.` }; vals[id] = n; }
  if (!Object.keys(vals).length) return { error: 'No pupil numbers arrived. Type the new number in the box beside each ticked record, then press Suggest again.' };
  return { edit: { field, values: vals } };
}
// Attendance can be corrected only where it cannot change the pupils drawn: when 20 or fewer were present the form draws nobody (every present pupil is
// tested), so only the attendance answer needs to change. Above 20 the draw of 20 is made from that number, so it must not be edited here.
export function attGuard(rec, to) {
  const cur = Number(sfx(rec, 'att')); const n = Number(to);
  if (!Number.isInteger(n) || n < 1 || n > 20) return 'The new attendance must be a whole number from 1 to 20.';
  if (!Number.isInteger(cur) || cur < 1) return 'This record has no attendance to correct.';
  if (cur > 20) return `${cur} pupils were present, so the draw of 20 pupils was made from that number. Changing it needs a new draw: ask the systems owner.`;
  if (cur === n) return `Attendance is already ${n}.`;
  return null;
}
const toOf = (edit, id) => (edit.field === 'pupil' ? edit.values[id] : edit.value);
export const describe = (edit, it) => (edit.field === 'att' ? `Pupils present ${it.att ?? ''} to ${edit.value}` : edit.field === 'grade' ? `Grade ${it.grade} to ${edit.value}` : edit.field === 'tester' ? `${it.enumerator} to ${edit.value}` : edit.field === 'region' || edit.field === 'lga' ? `${edit.field === 'lga' ? 'District' : 'Region'} to ${edit.value}` : edit.field === 'school' ? `${it.school_name || it.school} to ${SCHOOL_BY_ID[edit.value]?.name}` : `Pupil ${it.rand || it.stuid} to ${edit.values[it.id]}`);

// Carry out an approved edit request. Returns { ok, done[], failed[] }.
export async function runEdit(env, who, r, recs, schoolMover) {
  const asset = env[r.kind === 'sampling' ? 'KOBO_ASSET_SAMPLING' : 'KOBO_ASSET_ID']; const edit = r.edit; const done = [], failed = [];
  if (edit.field === 'school') {
    const pv = await schoolMover.preview(env, who, { form: r.kind, target_school: edit.value, ids: r.ids }); if (pv.error) return { ok: false, failed: [pv.error] };
    if (pv.blocked) return { ok: false, failed: ['A duplicate would be created at the target school. Nothing was changed.'] };
    const ap = await schoolMover.apply(env, who, { form: r.kind, target_school: edit.value, ids: r.ids, token: pv.token }); if (ap.error) return { ok: false, failed: [ap.error] };
    return { ok: ap.ok, done: ap.done.filter((x) => x.ok).map((x) => x.id), failed: ap.done.filter((x) => !x.ok).map((x) => `${x.id}: not as expected`) };
  }
  for (const rec of recs) {
    if (edit.field === 'att') { const why = attGuard(rec, edit.value); if (why) { failed.push(`${rec._id}: ${why}`); break; } } // checked again against the record as it is now
    const data = patchFor(r.kind, edit.field, rec, toOf(edit, rec._id)); if (!Object.keys(data).length) { done.push(rec._id); continue; }
    const pr = await fetch(`${srv(env)}/api/v2/assets/${asset}/data/bulk/`, { method: 'PATCH', headers: H(env), body: JSON.stringify({ payload: { submission_ids: [rec._id], data } }) });
    const back = await (await fetch(`${srv(env)}/api/v2/assets/${asset}/data/${rec._id}/?format=json`, { headers: H(env) })).json().catch(() => ({}));
    const bad = Object.entries(data).filter(([k, v]) => String(back[k] ?? '') !== String(v));
    if (pr.ok && !bad.length) done.push(rec._id); else { failed.push(`${rec._id}: ${pr.ok ? bad.map(([k]) => k).join(', ') + ' not as expected' : 'KoBo ' + pr.status}`); break; }
  }
  if (done.length) { const cur = new Set(((await kv(env).get('v2:approvededits')) || []).map(Number)); for (const i of done) cur.add(i); await kv(env).put('v2:approvededits', [...cur]); }
  return { ok: !failed.length, done, failed };
}
