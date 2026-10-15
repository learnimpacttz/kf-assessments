// Local rehearsal server: the real Worker code against an in-memory store and synthetic 2026 submissions.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import worker from '../src/index.js';
import { addStudents, addSampling, addTeachers } from '../src/ingest.js';
import { recomputeSummaries } from '../src/sync.js';
import { SCHOOLS_BY_REGION, STAFF, REGIONS } from '../src/config.js';

// fake KoBo: record write-back requests instead of sending them anywhere
const realFetch = globalThis.fetch; globalThis.__kobo = [];
const tangaSchool = SCHOOLS_BY_REGION['TANGA'][0].id;
globalThis.__db = []; for (let k = 1; k <= 6; k++) globalThis.__db.push({ _id: 700000 + k, year: '2026', today: '2026-10-20', 'group_intro/date': '2026-10-20', 'id_data/school': tangaSchool, 'id_data/grade': '1', 'id_data/enumerator': 'Hawa Hussein', stuid: k <= 2 ? 'DUP1' : 'S' + k, 'stu_info/rand_nr': k, start: '2026-10-20T09:0' + k + ':00+03:00', _submission_time: '2026-10-20T07:0' + k + ':00', stu_avail: '1' });
for (let k = 1; k <= 4; k++) globalThis.__db.push({ _id: 800000 + k, year: '2026', today: '2026-10-15', 'group_intro/date': '2026-10-15', 'id_data/school': 'PS0302089', 'id_data/grade': '2', 'id_data/enumerator': 'Hawa Hussein', stuid: String(1200 + k), 'stu_info/rand_nr': String(k * 3), stu_avail: k === 4 ? '2' : '1', start: '2026-10-15T09:1' + k + ':00+03:00', 'end_note_gr/testtime_rounded': k === 1 ? '1.5' : '6.2', _submission_time: '2026-10-15T10:30:00' });
// Mafunzo (training school) records sent on the pilot day by a Tanga tester, to be moved to Chihikwi
for (let k = 1; k <= 3; k++) globalThis.__db.push({ _id: 810000 + k, year: '2026', today: '2026-10-15', 'group_intro/date': '2026-10-15', 'id_data/school': 'TRAIN001', 'id_data/region': 'TRAINING', 'id_data/lga': 'TRAINING_LGA', 'id_data/school_name': 'SHULE YA MAFUNZO 1', 'id_data/grade': '1', 'id_data/enumerator': 'Evodia Mwashilindi', stuid: '2026TRAIN0011' + String(30 + k).padStart(3, '0'), rand_long: String(30 + k).padStart(3, '0'), 'stu_info/rand_nr': String(30 + k), mne_text: 'PRACTICE', stu_avail: '1', start: '2026-10-15T09:0' + k + ':00+03:00', _submission_time: '2026-10-15T10:30:00' });
globalThis.__db.push({ _id: 810010, year: '2026', today: '2026-10-15', 'group_intro/date': '2026-10-15', 'id_data/school': 'PS0302089', 'id_data/region': 'DODOMA', 'id_data/lga': 'DODOMA(M)', 'id_data/school_name': 'CHIHIKWI', 'id_data/grade': '1', 'id_data/enumerator': 'Ally Mgazza', stuid: '2026PS03020891085', rand_long: '085', 'stu_info/rand_nr': '85', 'stu_info/schoolname_conf': 'CHIHIKWI', mne_text: 'Pilot school', ward: 'MBALAWALA', arm: 'Pilot', mne: 'M&E', latitude: '-6.04337668', longitude: '35.68167059', 'id_data/cal_planned': '2026-10-15', stu_avail: '1', start: '2026-10-15T10:00:00+03:00', _submission_time: '2026-10-15T10:30:00' });
globalThis.fetch = async (u, i) => { const su = String(u); const mm = /\/api\/v2\/assets\/ASSET1\/data\/(\d+)?\/?(\?.*)?$/.exec(su);
  if (/\/api\/v2\/assets\/ASSET1\/data\/bulk\/$/.test(su) && i && i.method === 'PATCH') { const b = JSON.parse(i.body).payload; for (const id of b.submission_ids) { const r = globalThis.__db.find((x) => x._id === id); if (r) { Object.assign(r, b.data); r['meta/deprecatedID'] = 'uuid:old'; } } globalThis.__patches = (globalThis.__patches || 0) + 1; return new Response(JSON.stringify({ count: b.submission_ids.length, successes: b.submission_ids.length, failures: 0 }), { status: 200 }); }
  const one = /\/api\/v2\/assets\/ASSET1\/data\/(\d+)\/\?/.exec(su); if (one && (!i || !i.method || i.method === 'GET')) { const r = globalThis.__db.find((x) => String(x._id) === one[1]); return r ? new Response(JSON.stringify(r), { status: 200 }) : new Response('{}', { status: 404 }); }
  if (mm) { if (i && i.method === 'DELETE') { const n = globalThis.__db.length; globalThis.__db = globalThis.__db.filter((r) => String(r._id) !== mm[1]); return new Response(null, { status: n === globalThis.__db.length ? 404 : 204 }); } const q = new URL(su).searchParams.get('query'); let rows = globalThis.__db; if (q) { const o = JSON.parse(q); if (o._id && o._id.$in) rows = rows.filter((r) => o._id.$in.includes(r._id)); else if (o._id && o._id.$gt !== undefined) rows = rows.filter((r) => r._id > o._id.$gt); if (o['id_data/school']) rows = rows.filter((r) => (o['id_data/school'].$in ? o['id_data/school'].$in.includes(r['id_data/school']) : r['id_data/school'] === o['id_data/school'])); if (o.today) rows = rows.filter((r) => (o.today.$gte ? r.today >= o.today.$gte && r.today <= o.today.$lte : r.today === o.today)); if (o['id_data/grade']) rows = rows.filter((r) => r['id_data/grade'] === o['id_data/grade']); } return new Response(JSON.stringify({ count: globalThis.__db.length, results: new URL(su).searchParams.get('limit') === '1' ? rows.slice(0, 1) : rows, next: null }), { status: 200 }); }
 if (String(u).includes('validation_statuses')) { globalThis.__kobo.push({ url: String(u), method: i.method, body: i.body, auth: i.headers.Authorization ? 'present' : 'missing' }); return new Response('{"detail":"updated"}', { status: 200 }); } return realFetch(u, i); };
const mem = new Map();
const locks = new Map();
const stub = {
  get: async (k) => mem.get(k) ?? null, put: async (k, v) => void mem.set(k, v), del: async (k) => void mem.delete(k),
  acquire: async () => true, release: async () => {},
};
const kvMem = new Map();
const FAKE_KV = { get: async (k, o) => { const e = kvMem.get(k); if (!e) return null; const t = typeof o === 'string' ? o : o?.type; return t === 'json' ? JSON.parse(e.v) : t === 'arrayBuffer' ? e.v : e.v; }, put: async (k, v, o) => void kvMem.set(k, { v: typeof v === 'string' || v instanceof ArrayBuffer ? v : JSON.stringify(v), meta: o?.metadata }), list: async ({ prefix }) => ({ keys: [...kvMem.entries()].filter(([k]) => k.startsWith(prefix || '')).map(([name, e]) => ({ name, metadata: e.meta })), list_complete: true }), delete: async (k) => void kvMem.delete(k) };
const PUB = path.resolve('../public');
const env = {
  DASHBOARD_KV: FAKE_KV,
  STORE: { idFromName: () => 'x', get: () => stub }, HQ_SECRET: 'HQTEST', AUTH_SALT: 'salt', KOBO_SERVER: 'kobo.test', KOBO_ASSET_ID: 'ASSET1', KOBO_ASSET_SAMPLING: 'ASSET1', KOBO_TOKEN: 'tok', EMAIL_ENABLED: 'true', EMAIL_FROM: 'x@test.org', EMAIL: { send: async (m) => { (globalThis.__mail ||= []).push({ to: m.to, subject: m.subject }); } },
  ASSETS: { fetch: async (req) => { const u = new URL(req.url); let p = path.join(PUB, u.pathname === '/' ? 'index.html' : u.pathname); if (!fs.existsSync(p)) return new Response('nf', { status: 404 }); const ext = path.extname(p); const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' }; return new Response(fs.readFileSync(p), { headers: { 'content-type': types[ext] || 'application/octet-stream' } }); } },
};

// ---- synthetic data: 2025 (history for bands) and 2026 (live) ----
const state = { yrs: {} };
let id = 1;
const rnd = (a, b) => a + Math.random() * (b - a);
function visit(year, region, schoolIdx, date, nSchoolsStaff) {
  const s = SCHOOLS_BY_REGION[region][schoolIdx]; let staff = STAFF.filter((x) => x.region === region); if (!staff.length) staff = [{ name: 'Dodoma Team' }];
  const recs = [], samp = [];
  for (const g of [1, 2, 3]) {
    const att = 40 + Math.floor(Math.random() * 60);
    samp.push({ year, 'id_data/school': s.id, 'id_data/grade': String(g), 'id_data/enumerator': staff[0].name, deviceid: 'collect:' + staff[0].name.replace(/\s/g, ''), 'att_gr/att': String(att), ...Object.fromEntries(Array.from({ length: 20 }, (_, k) => ['att_gr/int' + (k + 1), String((k + 1) * 3)])), date });
    for (let i = 1; i <= 20; i++) {
      const adm = staff[(i + g) % staff.length].name;
      const forced = region === 'TANGA' && schoolIdx === 3 && year === '2026';
      const dev = forced ? 'collect:SHARED' : 'collect:' + adm.replace(/\s/g, '');
      const rushed = region === 'TANGA' && g === 2 && i % 7 === 0 && schoolIdx === 1;
      recs.push({ _id: id++, year, today: date, 'group_intro/date': date, 'id_data/school': s.id, 'id_data/grade': String(g), 'id_data/enumerator': adm, 'stu_info/rand_nr': String(i * 3), start: `${date}T0${8 + (i % 4)}:${10 + i}:00+03:00`, 'end_note_gr/testtime_rounded': String(rushed ? 1.5 : (g * 2.6 + rnd(2, 5)).toFixed(1)), stu_avail: '1', deviceid: dev, ['k' + g + '_g_words']: '1', _submission_time: date + 'T10:00:00' });
    }
  }
  // submission times: some people send within the hour, some a day or two later
  const stamp = (r) => { const nm = String(r['id_data/enumerator'] || ''); let h = 0; for (const ch of nm) h = (h * 31 + ch.charCodeAt(0)) >>> 0; const e0 = Date.parse(r.end || r.start || ''); const end = Number.isNaN(e0) ? Date.parse(date + 'T10:00:00+03:00') : e0; const add = h % 4 === 0 ? 50 * 3600e3 : h % 4 === 1 ? 26 * 3600e3 : 45 * 60e3; r._submission_time = new Date(end + add).toISOString().slice(0, 19); };
  for (const r of recs) stamp(r); for (const r of samp) stamp(r);
  return { recs, samp };
}
for (const region of REGIONS) {
  const cnt = SCHOOLS_BY_REGION[region].length;
  for (let i = 0; i < Math.min(9, cnt); i++) { const { recs } = visit('2025', region, i, `2025-10-${String(15 + i).padStart(2, '0')}`); addStudents(state, recs); }
  const n = { TANGA: 11, SINGIDA: 12, MARA: 3, MTWARA: 2 }[region] ?? 6;
  for (let i = 0; i < Math.min(n, cnt); i++) { const day = 19 + Math.floor(i / 3) + (i >= 12 ? 2 : 0); const { recs, samp } = visit('2026', region, i, `2026-10-${String(day).padStart(2, '0')}`); addStudents(state, recs); addSampling(state, samp); }
}
// pilot day (15 Oct): Tanga volunteers test at Chihikwi; one volunteer rushes Grade 2 so the "fast" check fires
{
  const vols = STAFF.filter((x) => x.active && x.region === 'TANGA' && x.role === 'volunteer'); let rid = 960000;
  vols.forEach((v, vi) => { const g = [1, 2, 3, 3][vi] || 1; for (let i = 1; i <= 8; i++) { const rushed = vi === 1; const date = '2026-10-15'; addStudents(state, [{ _id: rid++, year: '2026', today: date, 'group_intro/date': date, 'id_data/school': 'PS0302089', 'id_data/grade': String(g), 'id_data/enumerator': v.name, 'stu_info/rand_nr': String(rid), deviceid: 'collect:' + v.name.replace(/\s/g, ''), start: `${date}T09:${String(10 + i).padStart(2, '0')}:00+03:00`, 'end_note_gr/testtime_rounded': String(rushed ? 1.5 : (g * 2.6 + 3).toFixed(1)), stu_avail: '1', _submission_time: date + 'T10:30:00' }]); } });
}
// phone behaviour scenarios on 2026-10-22 (Tanga): each phone is built to trigger exactly one check, plus one normal phone
{
  const A = SCHOOLS_BY_REGION.TANGA[0].id, B = SCHOOLS_BY_REGION.TANGA[1].id; let rid = 950000;
  const t = (hhmm, extra = 0) => { const [hh, mm] = hhmm.split(':').map(Number); const s = hh * 3600 + mm * 60 + extra; return `2026-10-22T${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}+03:00`; };
  const rec = (dev, who, school, grade, from, to) => ({ _id: rid++, year: '2026', today: '2026-10-22', 'group_intro/date': '2026-10-22', 'id_data/school': school, 'id_data/grade': String(grade), 'id_data/enumerator': who, 'stu_info/rand_nr': String(rid), deviceid: dev, start: t(from), end: t(to), 'end_note_gr/testtime_rounded': '8', stu_avail: '1' });
  const R = [
    rec('collect:TRAVEL', 'Ayubu Abasi', A, 1, '09:00', '09:09'), rec('collect:TRAVEL', 'Ayubu Abasi', B, 1, '09:15', '09:24'),
    rec('collect:OVERLAP', 'Hawa Hussein', A, 2, '09:00', '09:10'), rec('collect:OVERLAP', 'Hawa Hussein', A, 2, '09:05', '09:15'),
    ...[[1, '09:00', '09:09'], [2, '09:10', '09:19'], [1, '09:20', '09:29'], [2, '09:30', '09:39'], [1, '09:40', '09:49']].map(([g, f, to]) => rec('collect:SWITCH', 'Mainda Lucas', A, g, f, to)),
    ...[['Ally Mgazza', '09:00', '09:09'], ['Halima Hosea', '09:11', '09:20'], ['Ally Mgazza', '09:22', '09:31'], ['Halima Hosea', '09:33', '09:42']].map(([w, f, to]) => rec('collect:NAMES', w, A, 3, f, to)),
    rec('collect:H1', 'Hatibu Lugendo', A, 3, '09:00', '09:10'), rec('collect:H2', 'Hatibu Lugendo', A, 3, '09:05', '09:15'),
    ...['09:00', '09:10', '09:20', '09:30'].map((f, k) => rec('collect:OK', 'Ayubu Abasi'.replace('Ayubu Abasi', 'Hawa Hussein') === 'x' ? '' : 'Halima Hosea', B, 3, f, ['09:09', '09:19', '09:29', '09:39'][k])),
  ];
  addStudents(state, R);
  const PY = (state.yrs.practice ||= { cells: {}, sg: {}, tf: {}, tl: {}, n: 0 }); (PY.sg ||= {})['TRAIN001|1'] = { att: 25, list: [3, 5, 9], rn: [], date: '2026-10-14', enum: 'Hawa Hussein', dev: 'collect:P1' }; PY.sg['TRAIN001|2'] = { att: 18, list: [], rn: [], date: '2026-10-14', enum: 'Hawa Hussein', dev: 'collect:P1' }; PY.nsamp = 2;
}
// calendar-check answers coming back from the forms (Tanga school 3: one sampling record off-calendar, tests answered 'c' and 'b')
{
  const sc = SCHOOLS_BY_REGION.TANGA[2]; const nm = 'Hatibu Lugendo';
  addSampling(state, [{ year: '2026', 'id_data/school': sc.id, 'id_data/grade': '2', 'att_gr/att': '80', 'id_data/enumerator': nm, date: '2026-10-21', 'id_data/cal_status': 'diff', 'id_data/cal_planned': '2026-10-22', 'id_data/cal_reason': 'rain', 'id_data/cal_approved': 'no', ...Object.fromEntries(Array.from({ length: 20 }, (_, k) => ['att_gr/int' + (k + 1), String((k + 1) * 3)])) }]);
  const recs = [];
  for (let i = 0; i < 6; i++) recs.push({ _id: 900000 + i, year: '2026', today: '2026-10-21', 'group_intro/date': '2026-10-21', 'id_data/school': sc.id, 'id_data/grade': '2', 'id_data/enumerator': nm, 'stu_info/rand_nr': String(i + 1), start: '2026-10-21T09:10:00+03:00', 'end_note_gr/testtime_rounded': '8', stu_avail: '1', 'id_data/cal_status': 'diff', 'id_data/cal_planned': '2026-10-22', 'id_data/cal_confirm': i < 2 ? 'c' : 'b', 'id_data/cal_confirm_other': i < 2 ? 'Head teacher asked us to come earlier' : '' });
  addStudents(state, recs);
}
// synthetic teacher forms (baseline): 4 teachers per school in Tanga and Mara; one Tanga school with no grade-3 arithmetic teacher
{
  let tid = 700000;
  for (const region of ['TANGA', 'MARA']) SCHOOLS_BY_REGION[region].forEach((s, si) => {
    const recs = [];
    for (let k = 0; k < 4; k++) {
      const head = k === 0; const g3math = !(region === 'TANGA' && si === 3);
      recs.push({ _id: tid++, year: '2026', today: '2026-03-23', 'group_intro/date': '2026-03-23', 'id_data/school': s.id, 't/gr_teacher_info/position': head ? '1' : '2', 't/gr_teacher_info/gender': k % 2 ? '2' : '1', 't/gr_teacher_info/smartphone': '01',
        't/teaching_assignments/grade1': k < 2 ? '01' : '02', 't/teaching_assignments/gr_grade1/grade1_subs': k === 0 ? '11' : '12 11',
        't/teaching_assignments/grade2': k === 1 || k === 2 ? '01' : '02', 't/teaching_assignments/gr_grade2/grade2_subs': k === 1 ? '21 22' : '22 21',
        't/teaching_assignments/grade3': k >= 2 ? '01' : '02', 't/teaching_assignments/gr_grade3/grade3_subs': k === 2 ? '31' : g3math ? '32' : '31',
        'gr_schooldata/group_grade1/g1girls': String(20 + si), 'gr_schooldata/group_grade1/g1boys': String(22 + si), 'gr_schooldata/group_grade1/g1total': String(42 + 2 * si),
        'gr_schooldata/group_grade2/g2girls': '30', 'gr_schooldata/group_grade2/g2boys': '28', 'gr_schooldata/group_grade2/g2total': '58',
        'gr_schooldata/group_grade3/g3girls': '25', 'gr_schooldata/group_grade3/g3boys': '27', 'gr_schooldata/group_grade3/g3total': '52',
        'gr_schooldata/teacher_gr/no_teachers': '7', 'gr_schooldata/teacher_gr/no_kf_teachers': '4', 'gr_schooldata/weo/weo_att': String((si % 3) + 1) });
    }
    addTeachers(state, recs);
  });
}
// practice (training) records: TRAIN schools, submitted by people from two different regions
{
  let pid = 990000;
  const mk = (school, grade, who, dev, i, day = '2026-10-14') => ({ _id: pid++, year: '2026', today: day, 'group_intro/date': day, 'id_data/school': school, 'id_data/grade': String(grade), 'id_data/enumerator': who, deviceid: dev, 'stu_info/rand_nr': String(i), start: `${day}T09:${String(10 + i).padStart(2, '0')}:00+03:00`, end: `${day}T09:${String(18 + i).padStart(2, '0')}:00+03:00`, 'end_note_gr/testtime_rounded': '8', stu_avail: '1' });
  const R = [];
  for (let i = 1; i <= 5; i++) R.push(mk('TRAIN001', 1, 'Hawa Hussein', 'collect:P1', i), mk('TRAIN002', 2, 'Halima Hosea', 'collect:P2', i));
  R.push(mk('TRAIN001', 1, 'Hawa Hussein', 'collect:P1', 3));
  addStudents(state, R);
}
for (const m of ['get','put','del']) { const f = stub[m]; stub[m] = async (...a) => { globalThis.__ops = (globalThis.__ops || 0) + 1; return f(...a); }; }
await stub.put('v2:state', JSON.stringify(state));
await recomputeSummaries(env);

const sess = {};
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost:8788');
  if (u.pathname === '/__kobo') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(globalThis.__kobo)); }
  if (u.pathname === '/__ops') { const n = globalThis.__ops || 0; globalThis.__ops = 0; res.writeHead(200); return res.end(String(n)); }
  if (u.pathname === '/__tick') { await worker.scheduled({ scheduledTime: Date.now() }, env, { waitUntil() {} }); res.writeHead(200); return res.end('ok'); }
  if (u.pathname === '/__mail') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(globalThis.__mail || [])); }
  const m = /^\/__as\/(\w+)\/?$/.exec(u.pathname);
  if (m) { const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8').replace('<script src="/app.js">', `<script>localStorage.setItem('kf_code','${m[1]}')</script><script src="/app.js">`); res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html); }
  const body = await new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
  const r = new Request(u, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
  const out = await worker.fetch(r, env, {});
  res.writeHead(out.status, Object.fromEntries(out.headers)); res.end(Buffer.from(await out.arrayBuffer()));
}).listen(8788, () => console.log('ready'));
