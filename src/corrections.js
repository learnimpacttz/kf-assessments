// Moving records that were sent under the wrong school (for example "Mafunzo" on a pilot day) to the right one.
// Flow: find the records -> preview exactly what would change -> a reviewer approves -> the originals are saved, the change is made
// through KoBo's data interface (not the web editor), every record is read back and checked, and a fast rebuild of the dashboard is queued.
import { kv } from './store.js';
import { SCHOOL_BY_ID } from './config.js';

const FORMS = { students: { env: 'KOBO_ASSET_ID', label: 'Students assessment' }, sampling: { env: 'KOBO_ASSET_SAMPLING', label: 'Sampling' } };
const LOG = 'v2:corrections'; // newest first: who moved what, when
const APPROVED = 'v2:approvededits'; // record ids corrected on purpose, so the "changed after it was sent" check leaves them alone
const sfx = (x, k) => { for (const key in x) if (key === k || key.endsWith('/' + k)) return x[key]; return undefined; };
const base = (env) => `https://${env.KOBO_SERVER || 'kf.kobotoolbox.org'}`;
const hdr = (env) => ({ Authorization: `Token ${env.KOBO_TOKEN}`, 'content-type': 'application/json' });
const canApply = (who) => who.role === 'hq' && who.level === 'admin' && (who.review_level || 0) >= 2;
const canLook = (who) => who.role === 'hq' && who.level !== 'viewer';
const isPractice = (id) => /^TRAIN/.test(String(id || ''));

async function read(env, asset, path) { const r = await fetch(`${base(env)}/api/v2/assets/${asset}/${path}`, { headers: hdr(env) }); if (!r.ok) throw new Error(`KoBo ${r.status} reading the form. Try again in a minute.`); return r.json(); }
// The newest records sit at the end of the form: read just the last few hundred instead of searching the whole form.
async function tail(env, form, n) {
  const asset = env[FORMS[form].env]; const total = (await read(env, asset, 'data/?format=json&limit=1')).count || 0; const k = Math.min(Math.max(Number(n) || 1500, 100), 5000);
  return (await read(env, asset, `data/?format=json&limit=${k}&start=${Math.max(0, total - k)}`)).results || [];
}
const dayOf = (x) => String(x.today || sfx(x, 'date') || '').slice(0, 10);
const brief = (x) => ({ id: x._id, school: sfx(x, 'school'), school_name: sfx(x, 'school_name'), grade: String(sfx(x, 'grade_conf') ?? sfx(x, 'grade') ?? ''), who: sfx(x, 'enumerator') || '', at: (x.start || '').slice(11, 16), pupil: x.stuid || sfx(x, 'rand_nr') || '', edited: Boolean(x['meta/deprecatedID']) });

export async function findRecords(env, who, p) {
  if (!canLook(who)) return { error: 'HQ only', status: 403 };
  if (!FORMS[p.form]) return { error: 'Choose the Students or the Sampling form' };
  if (!/^\d{4}-\d\d-\d\d$/.test(p.day || '')) return { error: 'Choose the day' };
  const rows = (await tail(env, p.form, p.tail)).filter((x) => dayOf(x) === p.day && (!p.person || String(sfx(x, 'enumerator') || '').toLowerCase() === String(p.person).toLowerCase()) && (!p.school || sfx(x, 'school') === p.school));
  return { form: p.form, day: p.day, records: rows.map(brief), note: rows.length ? null : 'Nothing found in the newest records of that form. Check the name and day, or search a wider window.' };
}

// What each record would look like at the target school. The school's own fields are copied from a record of that school on the same day.
async function buildPlan(env, p) {
  if (!FORMS[p.form]) throw new Error('Choose the Students or the Sampling form');
  const target = SCHOOL_BY_ID[p.target_school]; if (!target) throw new Error('The target must be a real school in the list');
  const ids = [...new Set((p.ids || []).map(Number).filter(Boolean))]; if (!ids.length || ids.length > 60) throw new Error('Choose between 1 and 60 records');
  const asset = env[FORMS[p.form].env]; const all = await tail(env, p.form, p.tail || 3000);
  const recs = []; for (const id of ids) { const r = all.find((x) => x._id === id) || (await read(env, asset, `data/${id}/?format=json`)); recs.push(r); }
  if (recs.some((r) => sfx(r, 'school') === p.target_school)) throw new Error('One of the records is already at the target school');
  const days = new Set(recs.map(dayOf));
  const ref = all.find((x) => sfx(x, 'school') === p.target_school && days.has(dayOf(x)) && !x['meta/deprecatedID']) || all.find((x) => sfx(x, 'school') === p.target_school && !x['meta/deprecatedID']);
  if (!ref) throw new Error(`No record from ${target.name} was found in this form to copy the school's fields from. Wait for one, or ask HQ to set it up.`);
  const copyStudents = ['id_data/school_name', 'stu_info/schoolname_conf', 'mne_text', 'id_data/cal_planned', 'region_label', 'lga_label', 'mne', 'ward', 'arm', 'latitude', 'longitude', 'gps2'];
  const copySampling = ['id_data/school_name', 'id_data/cal_planned'];
  const warnings = []; const plan = [];
  const sameSchoolStuids = new Set(all.filter((x) => sfx(x, 'school') === p.target_school).map((x) => x.stuid).filter(Boolean));
  let draws = {}; if (p.form === 'students' && env.KOBO_ASSET_SAMPLING) { try { const sa = await tail(env, 'sampling', 1500); for (const x of sa) if (sfx(x, 'school') === p.target_school) { const g = String(sfx(x, 'grade_conf') ?? sfx(x, 'grade')); const set = (draws[g] ||= new Set()); for (let i = 1; i <= 40; i++) { const v = sfx(x, 'int' + i); if (v !== undefined && v !== null && v !== '') set.add(Number(v)); } } } catch { /* the preview still works without the sampling check */ } }
  for (const r of recs) {
    const oldSchool = sfx(r, 'school'); const d = { 'id_data/region': ref['id_data/region'] ?? target.region, 'id_data/lga': ref['id_data/lga'] ?? target.lga, 'id_data/school': p.target_school };
    for (const k of (p.form === 'students' ? copyStudents : copySampling)) if (ref[k] !== undefined) d[k] = ref[k];
    if (p.form === 'students') {
      const g = String(r['id_data/grade']); const rl = String(r.rand_long || ('000' + (r['stu_info/rand_nr'] || '')).slice(-3));
      d.stuid = r.stuid && oldSchool && String(r.stuid).includes(oldSchool) ? String(r.stuid).replace(oldSchool, p.target_school) : `${String(dayOf(r)).slice(0, 4)}${p.target_school}${g}${rl}`;
      if (sameSchoolStuids.has(d.stuid)) warnings.push({ id: r._id, level: 'block', text: `Pupil ${d.stuid} already exists at ${target.name}. Moving this record would create a duplicate.` });
      const dr = draws[g]; const pn = Number(r['stu_info/rand_nr']); if (dr && dr.size && !dr.has(pn)) warnings.push({ id: r._id, level: 'warn', text: `Pupil number ${pn} is not in the Grade ${g} sampling draw at ${target.name}. A "not on the sampling list" query may follow.` });
      if (!draws[g]) warnings.push({ id: r._id, level: 'info', text: `No Grade ${g} sampling form from ${target.name} was found yet to check the pupil number against.` });
    }
    const changes = Object.entries(d).filter(([k, v]) => String(r[k] ?? '') !== String(v)).map(([k, v]) => ({ field: k, old: r[k] ?? null, new: v }));
    plan.push({ id: r._id, who: sfx(r, 'enumerator') || '', grade: String(sfx(r, 'grade_conf') ?? sfx(r, 'grade') ?? ''), from_school: oldSchool, from_name: sfx(r, 'school_name') || oldSchool, data: d, changes });
  }
  const token = (await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([p.form, p.target_school, plan.map((x) => [x.id, x.data])])))); const tk = [...new Uint8Array(token)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  return { form: p.form, target: { id: p.target_school, name: target.name, region: target.region, lga: target.lga }, reference_id: ref._id, plan, warnings, token: tk, originals: recs };
}

export async function previewMove(env, who, p) {
  if (!canLook(who)) return { error: 'HQ only', status: 403 };
  const r = await buildPlan(env, p);
  return { form: r.form, target: r.target, reference_id: r.reference_id, token: r.token, blocked: r.warnings.some((w) => w.level === 'block'), warnings: r.warnings, can_apply: canApply(who), records: r.plan.map((x) => ({ id: x.id, who: x.who, grade: x.grade, from: x.from_name, to: r.target.name, fields_changed: x.changes.length, changes: x.changes.slice(0, 14) })) };
}

export async function applyMove(env, who, p) {
  if (!canApply(who)) return { error: 'Only an HQ reviewer (level 2 or 3) can apply a correction', status: 403 };
  const r = await buildPlan(env, p);
  if (!p.token || p.token !== r.token) return { error: 'The records changed since the preview. Preview again before applying.', status: 409 };
  if (r.warnings.some((w) => w.level === 'block')) return { error: 'A duplicate would be created. Fix that first.', status: 422 };
  const asset = env[FORMS[p.form].env]; const at = new Date().toISOString(); const id = at.replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + r.plan.length;
  await kv(env).put(`v2:corr:${id}`, { id, at, by: who.name, form: p.form, target: r.target, originals: r.originals, plan: r.plan }); // the originals are saved before anything is changed
  const done = [];
  for (const x of r.plan) {
    const pr = await fetch(`${base(env)}/api/v2/assets/${asset}/data/bulk/`, { method: 'PATCH', headers: hdr(env), body: JSON.stringify({ payload: { submission_ids: [x.id], data: x.data } }) });
    const after = await read(env, asset, `data/${x.id}/?format=json`);
    const wrong = Object.entries(x.data).filter(([k, v]) => String(after[k] ?? '') !== String(v)).map(([k, v]) => ({ field: k, wanted: v, got: after[k] ?? null }));
    done.push({ id: x.id, ok: pr.ok && !wrong.length, mismatches: wrong }); if (!pr.ok || wrong.length) break; // stop at the first problem
  }
  const okIds = done.filter((d) => d.ok).map((d) => d.id);
  if (okIds.length) {
    const cur = new Set(((await kv(env).get(APPROVED)) || []).map(Number)); for (const i of okIds) cur.add(i); await kv(env).put(APPROVED, [...cur]);
    const years = [...new Set([...r.originals.map((o) => (isPractice(sfx(o, 'school')) ? 'practice' : String(dayOf(o)).slice(0, 4))), String(dayOf(r.originals[0])).slice(0, 4)])];
    const rb = (await kv(env).get('v2:rebuild')) || []; for (const y of years) if (!rb.find((q) => q.kind === p.form && q.year === y)) rb.push({ kind: p.form, year: y }); await kv(env).put('v2:rebuild', rb);
  }
  const log = (await kv(env).get(LOG)) || []; log.unshift({ id, at, by: who.name, form: p.form, to: r.target.name, count: okIds.length, of: r.plan.length, ok: okIds.length === r.plan.length }); await kv(env).put(LOG, log.slice(0, 100));
  return { ok: okIds.length === r.plan.length, id, done, rebuild: okIds.length ? 'queued: the dashboard updates itself in a few minutes' : null };
}

export async function correctionsView(env, who) {
  if (!canLook(who)) return { error: 'HQ only', status: 403 };
  return { history: (await kv(env).get(LOG)) || [], can_apply: canApply(who) };
}
export async function correctionCopy(env, who, id) { if (!canApply(who)) return null; return kv(env).get(`v2:corr:${String(id).replace(/[^0-9-]/g, '')}`); }
