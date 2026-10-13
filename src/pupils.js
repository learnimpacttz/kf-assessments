// Pupil-level list for the field team: every student record with its key information (no pupil names), so people can
// look at and count what has been recorded. Read straight from KoBo for the chosen school, region and dates.
import { SCHOOL_BY_ID, SCHOOLS_BY_REGION, devCode } from './config.js';

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
