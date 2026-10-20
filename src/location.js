// Read-only check of the location data in KoBo: how many records carry a GPS point and how far each is from its school.
// Returns counts and school codes only. It never returns, stores or logs coordinates.
import { SCHOOL_COORDS } from './data/school_coords.js';
import { SCHOOL_BY_ID } from './config.js';

const rad = (d) => (d * Math.PI) / 180;
export function metres(a, b) { // haversine distance between two [lat, lon] points
  const R = 6371000, dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const sfx = (x, k) => { for (const key in x) if (key === k || key.endsWith('/' + k)) return x[key]; return undefined; };
const okPoint = (p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v)) && !(p[0] === 0 && p[1] === 0) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

// the PHONE's point for one record, and which field it came from. The form's latitude and longitude fields are the school's own coordinates copied from the school list, so they are never used here.
export const schoolPointOf = (r) => { const la = num(sfx(r, 'latitude')), lo = num(sfx(r, 'longitude')); return okPoint([la, lo]) ? [la, lo] : null; };
export function pointOf(r) {
  const g = r._geolocation; if (okPoint(g)) return { p: g, src: '_geolocation' };
  for (const k of ['start-geopoint', 'gps', 'geopoint', 'location']) { const v = sfx(r, k); if (typeof v === 'string') { const t = v.trim().split(/\s+/).map(Number); if (okPoint(t.slice(0, 2))) return { p: t.slice(0, 2), src: k }; } }
  return null;
}
const pct = (a, n) => (n ? Math.round((1000 * a) / n) / 10 : null);
const q = (arr, f) => (arr.length ? Math.round(arr.slice().sort((x, y) => x - y)[Math.min(arr.length - 1, Math.floor(f * arr.length))]) : null);

export function summarizeLocation(records) {
  const out = { sampled: records.length, with_point: 0, sources: {}, with_form_distance: 0, school_has_coords: 0, measured: 0, within_500: 0, within_1000: 0, median_m: null, p90_m: null, by_region: {}, far_schools: [], key_names: [], form_school_point: 0, form_agrees_500: 0, form_differs: [], missing_in_ours: {} };
  const names = new Set(), dists = [], bySchool = {};
  for (const r of records) {
    for (const k of Object.keys(r)) if (/geo|gps|lat|lon|dist|location/i.test(k)) names.add(k);
    const school = String(sfx(r, 'school') || ''); const reg = SCHOOL_BY_ID[school]?.region || 'OTHER';
    const b = (out.by_region[reg] ||= { sampled: 0, with_point: 0, within_500: 0 }); b.sampled++;
    if (num(sfx(r, 'distance')) !== null) out.with_form_distance++;
    const sp = schoolPointOf(r); if (sp) { out.form_school_point++; const mine = SCHOOL_COORDS[school]; if (mine) { if (metres(sp, mine) <= 500) out.form_agrees_500++; else if (out.form_differs.length < 30 && !out.form_differs.some((x) => x.school === school)) out.form_differs.push({ school, name: SCHOOL_BY_ID[school]?.name || '', apart_m: Math.round(metres(sp, mine)) }); } else if (SCHOOL_BY_ID[school]) out.missing_in_ours[school] = sp; }
    const pt = pointOf(r); if (!pt) continue;
    out.with_point++; b.with_point++; out.sources[pt.src] = (out.sources[pt.src] || 0) + 1;
    const sc = SCHOOL_COORDS[school]; if (!sc) continue;
    out.school_has_coords++; const d = metres(pt.p, sc); out.measured++; dists.push(d); if (d <= 500) { out.within_500++; b.within_500++; } if (d <= 1000) out.within_1000++;
    (bySchool[school] ||= []).push(d);
  }
  out.median_m = q(dists, 0.5); out.p90_m = q(dists, 0.9); out.pct_with_point = pct(out.with_point, out.sampled); out.pct_within_500 = pct(out.within_500, out.measured);
  out.far_schools = Object.entries(bySchool).filter(([, a]) => a.length >= 3 && q(a, 0.5) > 1000).map(([id, a]) => ({ school: id, name: SCHOOL_BY_ID[id]?.name || '', tests: a.length, median_m: q(a, 0.5) })).sort((a, b) => b.median_m - a.median_m).slice(0, 30);
  out.key_names = [...names].slice(0, 20);
  return out;
}

export async function locationCheck(env, who, p) {
  if (who.role !== 'hq' || (who.level || 'admin') !== 'admin') return { error: 'The location check is for HQ Admin only', status: 403 };
  const y = /^20\d\d$/.test(p.year || '') ? p.year : '2025'; const asset = env.KOBO_ASSET_ID; if (!asset) return { error: 'The student project is not connected', status: 422 };
  const server = `https://${env.KOBO_SERVER || 'kf.kobotoolbox.org'}`;
  const query = { _submission_time: { $gte: `${y}-01-01`, $lt: `${Number(y) + 1}-01-01` } };
  const url = `${server}/api/v2/assets/${asset}/data/?format=json&limit=1000&sort=${encodeURIComponent(JSON.stringify({ _submission_time: -1 }))}&query=${encodeURIComponent(JSON.stringify(query))}`;
  const r = await fetch(url, { headers: { Authorization: `Token ${env.KOBO_TOKEN}` } }); if (!r.ok) return { error: `KoBo ${r.status} reading records`, status: 502 };
  const d = await r.json(); return { year: y, total_in_year: d.count, ...summarizeLocation(d.results || []) };
}
