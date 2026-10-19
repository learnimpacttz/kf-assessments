// Pupil-level list for the field team: every student record with its key information (no pupil names), so people can
// look at and count what has been recorded. Read straight from KoBo for the chosen school, region and dates.
import { SCHOOL_BY_ID, SCHOOLS_BY_REGION, devCode, staffForKoboName } from './config.js';

const sfx = (r, s) => { for (const k in r) if (k === s || k.endsWith('/' + s)) return r[k]; return undefined; };
const FIELDS = ['_id', 'today', 'group_intro/date', 'id_data/school', 'id_data/grade', 'id_data/enumerator', 'stuid', 'stu_info/rand_nr', 'stu_avail', 'start', 'end', 'end_note_gr/testtime_rounded', 'testtime_rounded', 'deviceid', '_submission_time'];
const CAP = 3000;

export async function pupilRecords(env, who, p) {
  if (!['hq', 'rc', 'arc', 'volunteer'].includes(who.role)) return { error: 'Not allowed', status: 403 };
  const asset = env.KOBO_ASSET_ID; if (!asset) return { error: 'The student form is not connected' };
  const srv = `https://${env.KOBO_SERVER || 'kf.kobotoolbox.org'}`;
  let schools = null;
  const region = who.role === 'hq' ? String(p.region || '').toUpperCase() : who.region;
  if (p.school) { const s = SCHOOL_BY_ID[p.school]; if (!s) return { error: 'Unknown school.' }; if (who.role !== 'hq' && s.region !== who.region) return { error: 'That school is not in your region.', status: 403 }; schools = [p.school]; }
  else if (region) schools = (SCHOOLS_BY_REGION[region] || []).map((s) => s.id);
  const from = /^\d{4}-\d\d-\d\d$/.test(p.from || '') ? p.from : '', to = /^\d{4}-\d\d-\d\d$/.test(p.to || '') ? p.to : from;
  if (!schools && !from) return { error: 'Choose a region, a school or a date first.' };
  const q = {}; if (schools) q['id_data/school'] = { $in: schools }; if (from) q.today = { $gte: from, $lte: to || from };
  if (p.grade) q['id_data/grade'] = String(p.grade);
  const base = `${srv}/api/v2/assets/${asset}/data/?format=json&limit=1000&query=${encodeURIComponent(JSON.stringify(q))}`;
  const rows = []; let total = null;
  for (const useFields of [true, false]) {
    let url = base + (useFields ? `&fields=${encodeURIComponent(JSON.stringify(FIELDS))}` : ''); rows.length = 0; let ok = true;
    for (let i = 0; i < 4 && url; i++) { const r = await fetch(url, { headers: { Authorization: `Token ${env.KOBO_TOKEN}` } }); if (!r.ok) { ok = false; break; } const d = await r.json(); total = d.count; rows.push(...(d.results || [])); url = rows.length >= CAP ? null : d.next || null; }
    if (ok) break; if (!useFields) return { error: 'KoBo could not be read just now. Try again in a minute.' };
  }
  let out = rows.map((r) => { const school = sfx(r, 'school') || ''; const tt = sfx(r, 'testtime_rounded'); return { id: r._id, date: String(sfx(r, 'date') || r.today || '').slice(0, 10), region: SCHOOL_BY_ID[school]?.region || '', school, school_name: SCHOOL_BY_ID[school]?.name || school, grade: String(sfx(r, 'grade') ?? ''), enumerator: sfx(r, 'enumerator') || '', stuid: r.stuid || '', rand: r['stu_info/rand_nr'] ?? sfx(r, 'rand_nr') ?? '', present: String(r.stu_avail) === '2' ? 'absent' : 'present', at: (r.start || '').slice(11, 16), mins: tt === undefined || tt === '' ? '' : Number(tt), phone: r.deviceid ? devCode(r.deviceid) : '', sub: (r._submission_time || '').slice(0, 16).replace('T', ' ') }; });
  if (p.enumerator) out = out.filter((r) => r.enumerator.toLowerCase().includes(String(p.enumerator).toLowerCase()));
  if (p.stuid) out = out.filter((r) => String(r.stuid).toLowerCase().includes(String(p.stuid).toLowerCase()));
  if (p.absent === '1') out = out.filter((r) => r.present === 'absent');
  out.sort((a, b) => (a.date + a.school + a.grade + a.at).localeCompare(b.date + b.school + b.grade + b.at));
  const by = (k) => { const m = {}; for (const r of out) m[r[k] || '–'] = (m[r[k] || '–'] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  return { total: out.length, kobo_total: total, capped: rows.length >= CAP, records: out.slice(0, 1500), summary: { present: out.filter((r) => r.present === 'present').length, absent: out.filter((r) => r.present === 'absent').length, by_grade: by('grade'), by_enumerator: by('enumerator').slice(0, 40), by_date: by('date').slice(0, 40) } };
}

// Everything one test admin sent for one school on one day: the sampling forms and a line for every pupil file (numbers only, no names).
// A person sees their own; an RC or ARC sees their region's people; HQ sees all. Works for the Dodoma pilot schools too.
export async function workFiles(env, who, p) {
  const name = String(p.name || '').trim(), school = String(p.school || ''), date = String(p.date || '');
  if (!name || !SCHOOL_BY_ID[school] || !/^\d{4}-\d\d-\d\d$/.test(date)) return { error: 'Choose a person, a school and a day.' };
  const st = staffForKoboName(name);
  if (who.role === 'volunteer' ? !(st && st.id === who.id) : who.role !== 'hq' && !(['rc', 'arc'].includes(who.role) && st && st.region === who.region)) return { error: 'These are not your files.', status: 403 };
  const srv = `https://${env.KOBO_SERVER || 'kf.kobotoolbox.org'}`; const H = { Authorization: `Token ${env.KOBO_TOKEN}` };
  const q = encodeURIComponent(JSON.stringify({ 'id_data/school': school, today: date }));
  const read = async (asset, fields) => { if (!asset) return []; const base = `${srv}/api/v2/assets/${asset}/data/?format=json&limit=1000&query=${q}`; for (const f of [true, false]) { const r = await fetch(base + (f && fields ? `&fields=${encodeURIComponent(JSON.stringify(fields))}` : ''), { headers: H }); if (r.ok) return (await r.json()).results || []; } throw new Error('KoBo could not be read just now. Try again in a minute.'); };
  const mine = (r) => String(sfx(r, 'enumerator') || '').trim().toLowerCase() === name.toLowerCase();
  const [stu, smp] = await Promise.all([read(env.KOBO_ASSET_ID, FIELDS), read(env.KOBO_ASSET_SAMPLING, null)]);
  const pupils = stu.filter(mine).map((r) => { const tt = sfx(r, 'testtime_rounded'); return { id: r._id, grade: String(sfx(r, 'grade') ?? ''), pupil: r.stuid || r['stu_info/rand_nr'] || sfx(r, 'rand_nr') || '', present: String(r.stu_avail) === '2' ? 'absent' : 'present', at: (r.start || '').slice(11, 16), mins: tt === undefined || tt === '' ? null : Number(tt), sub: (r._submission_time || '').slice(0, 16).replace('T', ' ') }; }).sort((a, b) => (a.grade + a.at).localeCompare(b.grade + b.at));
  const sampling = smp.filter(mine).map((r) => { let drawn = 0; for (let i = 1; i <= 40; i++) { const v = sfx(r, 'int' + i); if (v !== undefined && v !== null && v !== '') drawn++; } return { id: r._id, grade: String(sfx(r, 'grade_conf') ?? sfx(r, 'grade') ?? ''), register: sfx(r, 'att') === undefined ? null : Number(sfx(r, 'att')), drawn, at: (r.start || '').slice(11, 16), sub: (r._submission_time || '').slice(0, 16).replace('T', ' ') }; }).sort((a, b) => (a.grade + a.at).localeCompare(b.grade + b.at));
  return { name, school, date, pupils: pupils.slice(0, 600), pupils_total: pupils.length, present: pupils.filter((x) => x.present === 'present').length, absent: pupils.filter((x) => x.present === 'absent').length, sampling };
}

// The full detail of the records a query points at, read from KoBo by record number (numbers only, no names).
// HQ sees any; an RC or ARC sees their region; a test admin sees their own.
export async function flagRecords(env, who, idsRaw) {
  if (!['hq', 'rc', 'arc', 'volunteer'].includes(who.role)) return { error: 'Not allowed', status: 403 };
  const ids = [...new Set(String(idsRaw || '').split(',').map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0))].slice(0, 40);
  if (!ids.length) return { records: [] };
  const asset = env.KOBO_ASSET_ID; if (!asset) return { error: 'The student form is not connected' };
  const srv = `https://${env.KOBO_SERVER || 'kf.kobotoolbox.org'}`;
  const fields = [...FIELDS, 'distance', '_last_edited', '_validation_status'];
  const q = { _id: { $in: ids } };
  let rows = [];
  for (const useFields of [true, false]) {
    const url = `${srv}/api/v2/assets/${asset}/data/?format=json&limit=100&query=${encodeURIComponent(JSON.stringify(q))}` + (useFields ? `&fields=${encodeURIComponent(JSON.stringify(fields))}` : '');
    const r = await fetch(url, { headers: { Authorization: `Token ${env.KOBO_TOKEN}` } });
    if (r.ok) { rows = (await r.json()).results || []; break; }
    if (!useFields) return { error: 'KoBo could not be read just now. Try again in a minute.' };
  }
  const me = String(who.name || '').toLowerCase();
  const hm = (iso) => (iso ? String(iso).slice(11, 16) : '');
  const out = rows.map((r) => {
    const school = sfx(r, 'school') || ''; const region = SCHOOL_BY_ID[school]?.region || ''; const tt = sfx(r, 'testtime_rounded'); const enumerator = sfx(r, 'enumerator') || '';
    const sub = r._submission_time || ''; const end = r.end || ''; const lagMs = sub && end ? Date.parse(sub + (/[zZ]|[+-]\d\d:?\d\d$/.test(sub) ? '' : 'Z')) - Date.parse(end) : null;
    const ed = r._last_edited && sub && Math.abs(Date.parse(r._last_edited) - Date.parse(sub + (/[zZ]|[+-]\d\d:?\d\d$/.test(sub) ? '' : 'Z'))) > 120e3 ? String(r._last_edited).slice(0, 16).replace('T', ' ') : '';
    return { id: r._id, stuid: r.stuid || '', rand: r['stu_info/rand_nr'] ?? sfx(r, 'rand_nr') ?? '', enumerator, region, school, grade: String(sfx(r, 'grade') ?? ''), date: String(sfx(r, 'date') || r.today || '').slice(0, 10), start: hm(r.start), end: hm(end), mins: tt === undefined || tt === '' ? '' : Number(tt), sub: (() => { const t = sub ? Date.parse(sub + (/[zZ]|[+-]\d\d:?\d\d$/.test(sub) ? '' : 'Z')) : NaN; return Number.isFinite(t) ? new Date(t + 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : ''; })(), /* East Africa Time */ lag_h: lagMs != null && Number.isFinite(lagMs) ? Math.round((lagMs / 3600e3) * 10) / 10 : null, phone: r.deviceid ? devCode(r.deviceid) : '', present: String(r.stu_avail) === '2' ? 'absent' : 'present', distance: r.distance != null && r.distance !== '' ? Math.round(Number(r.distance)) : null, edited_at: ed, validation: (r._validation_status && r._validation_status.label) || '' };
  }).filter((x) => who.role === 'hq' || (who.role === 'volunteer' ? x.enumerator.toLowerCase() === me : x.region === who.region));
  return { records: out };
}
