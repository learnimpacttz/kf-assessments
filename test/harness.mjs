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
globalThis.fetch = async (u, i) => { if (String(u).includes('validation_statuses')) { globalThis.__kobo.push({ url: String(u), method: i.method, body: i.body, auth: i.headers.Authorization ? 'present' : 'missing' }); return new Response('{"detail":"updated"}', { status: 200 }); } return realFetch(u, i); };
const mem = new Map();
const locks = new Map();
const stub = {
  get: async (k) => mem.get(k) ?? null, put: async (k, v) => void mem.set(k, v), del: async (k) => void mem.delete(k),
  acquire: async () => true, release: async () => {},
};
const PUB = path.resolve('../public');
const env = {
  STORE: { idFromName: () => 'x', get: () => stub }, HQ_SECRET: 'HQTEST', AUTH_SALT: 'salt', KOBO_SERVER: 'kobo.test', KOBO_ASSET_ID: 'ASSET1', KOBO_TOKEN: 'tok',
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
    samp.push({ year, 'id_data/school': s.id, 'id_data/grade': String(g), 'id_data/enumerator': staff[0].name, 'att_gr/att': String(att), ...Object.fromEntries(Array.from({ length: 20 }, (_, k) => ['att_gr/int' + (k + 1), String((k + 1) * 3)])), date });
    for (let i = 1; i <= 20; i++) {
      const adm = staff[(i + g) % staff.length].name;
      const rushed = region === 'TANGA' && g === 2 && i % 7 === 0 && schoolIdx === 1;
      recs.push({ _id: id++, year, today: date, 'group_intro/date': date, 'id_data/school': s.id, 'id_data/grade': String(g), 'id_data/enumerator': adm, 'stu_info/rand_nr': String(i * 3), start: `${date}T0${8 + (i % 4)}:${10 + i}:00+03:00`, 'end_note_gr/testtime_rounded': String(rushed ? 1.5 : (g * 2.6 + rnd(2, 5)).toFixed(1)), stu_avail: '1', ['k' + g + '_g_words']: '1', _submission_time: date + 'T10:00:00' });
    }
  }
  return { recs, samp };
}
for (const region of REGIONS) {
  const cnt = SCHOOLS_BY_REGION[region].length;
  for (let i = 0; i < Math.min(9, cnt); i++) { const { recs } = visit('2025', region, i, `2025-10-${String(15 + i).padStart(2, '0')}`); addStudents(state, recs); }
  const n = { TANGA: 11, SINGIDA: 12, MARA: 3, MTWARA: 2 }[region] ?? 6;
  for (let i = 0; i < Math.min(n, cnt); i++) { const day = 19 + Math.floor(i / 3) + (i >= 12 ? 2 : 0); const { recs, samp } = visit('2026', region, i, `2026-10-${String(day).padStart(2, '0')}`); addStudents(state, recs); addSampling(state, samp); }
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
await stub.put('v2:state', JSON.stringify(state));
await recomputeSummaries(env);

const sess = {};
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost:8788');
  if (u.pathname === '/__kobo') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(globalThis.__kobo)); }
  const m = /^\/__as\/(\w+)\/?$/.exec(u.pathname);
  if (m) { const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8').replace('<script src="/app.js">', `<script>localStorage.setItem('kf_code','${m[1]}')</script><script src="/app.js">`); res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html); }
  const body = await new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
  const r = new Request(u, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
  const out = await worker.fetch(r, env, {});
  res.writeHead(out.status, Object.fromEntries(out.headers)); res.end(Buffer.from(await out.arrayBuffer()));
}).listen(8788, () => console.log('ready'));
