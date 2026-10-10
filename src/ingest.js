// Folds KoBo submissions into compact, anonymous aggregates. Never stores or
// returns: pupil names, GPS coordinates, pupil gender/age, or test item content.
//
// Student tool -> `cells` (one per day x school x grade x test admin) and `sg`
//                 (one per school x grade: random numbers drawn, for the
//                 "was this pupil actually on the sampling list" check)
// Sampling tool -> `sg[...]` attendance and the random numbers the app drew
// Teacher form  -> `tf[school]` teacher forms completed
import { SKILLS_BY_GRADE } from './aggregate.js';
import { isPracticeSchool } from './config.js';

// How late a record was sent: whole days after the visit date (0 = the same day) and hours from finishing the form to sending it
const parseUtc = (s) => Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z');
function lateness(r, visitDate) {
  const sub = parseUtc(String(r._submission_time || '')); if (Number.isNaN(sub) || !visitDate) return null;
  const sd = new Date(sub + 3 * 3600e3).toISOString().slice(0, 10);
  const days = Math.max(0, Math.round((Date.parse(sd) - Date.parse(visitDate)) / 86400000));
  const end = Date.parse(String(r.end || r.start || ''));
  return { b: Math.min(3, days), lag: Number.isNaN(end) ? null : Math.max(0, (sub - end) / 3600e3) };
}
// [same day, 1 day, 2 days, 3+ days, hours summed, longest hours, records with hours]
function addLate(slot, L) {
  if (!L) return slot;
  const s = slot || [0, 0, 0, 0, 0, 0, 0]; s[L.b] += 1;
  if (L.lag !== null) { s[4] += L.lag; s[6] += 1; if (L.lag > s[5]) s[5] = L.lag; }
  return s;
}

export const HIST_BUCKETS = 61; // 0.5 min each, last bucket = 30 min and over
const SKILL_TIME_FIELDS = [
  's1_letters_time', 's1_syllables_time', 's1_words_time', 's1_sentences_time', 's1_nr_recog_time', 's1_nr_compare_time', 's1_nr_addition_time', 's1_subtraction_time',
  's2_words_time', 's2_read_speed_time', 's2_story_time', 's2_nr_compare_time', 's2_nr_nissing_time', 's2_addition_time', 's2_subtraction_time',
  's3_dictation_time', 's3_meaning_time', 's3_read_speed_time', 's3_story_time', 's3_nr_missing_time', 's3_addition_time', 's3_subtraction_time', 's3_multiply_time',
];

export function emptyYear() {
  return { cells: {}, sg: {}, tf: {}, tl: {}, n: 0 };
}

const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : null;
};

function pick(r, name, prefixes = ['', 'id_data/', 'att_gr/', 'group_intro/', 'selection/']) {
  for (const p of prefixes) if (r[p + name] !== undefined && r[p + name] !== '') return r[p + name];
  return undefined;
}

// Which stored year a record belongs to. Practice (training-school) records never mix with a real year.
export function stateYearOf(r) {
  const school = r['id_data/school'] || r.school || r['group_intro/school'];
  return isPracticeSchool(school) ? 'practice' : yearOf(r);
}
export function yearOf(r) {
  return String(r.year || (r.today || pick(r, 'date') || '').slice(0, 4) || '').slice(0, 4);
}

function localHour(startIso) {
  // KoBo start timestamps carry the device offset, e.g. 2025-10-21T08:03:10.170+03:00
  const m = /T(\d\d):/.exec(startIso || '');
  return m ? parseInt(m[1], 10) : null;
}

// New fields added by the calendar check (their group name may differ, so match on the field name)
function calFields(r) {
  const out = {};
  for (const k in r) { const m = /(?:^|\/)(cal_status|cal_planned|cal_confirm|cal_confirm_other|cal_reason|cal_reason_other|cal_approved)$/.exec(k); if (m && r[k] !== '' && r[k] != null) out[m[1]] = r[k]; }
  return out;
}

const secsOf = (iso) => { const m = /T(\d\d):(\d\d):(\d\d)/.exec(iso || ''); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null; };
function pushEvent(Y, date, ev) { const day = ((Y.tl ||= {})[date] ||= []); if (day.length < 9000) day.push(ev); }

export function addStudents(state, records) {
  for (const r of records) {
    const year = stateYearOf(r);
    if (!year) continue;
    const Y = (state.yrs[year] ||= emptyYear());
    const school = r['id_data/school'];
    const grade = r['id_data/grade'];
    if (!school || !['1', '2', '3'].includes(String(grade))) continue;
    const enumerator = r['id_data/enumerator'] || '';
    const date = (r['group_intro/date'] || r.today || '').slice(0, 10);
    const key = `${date}|${school}|${grade}|${enumerator}`;
    const c = (Y.cells[key] ||= { n: 0, av: 0, ts: 0, tn: 0, h: new Array(HIST_BUCKETS).fill(0), late: 0, far: 0, st: {}, ps: {}, h0: 99, h1: -1, sub: '', ex: { lo: [], hi: [], late: [], far: [] } });
    Y.n += 1;
    c.n += 1;
    c.sub = r._submission_time || c.sub;
    c.sb = addLate(c.sb, lateness(r, date));
    // availability: 1 = pupil present and tested, 2 = absent (emergence)
    if (String(r.stu_avail) !== '2') c.av += 1;

    const stuid = r.stuid || '';
    const setNo = (() => { for (const k in r) if (/k[123]set$/.test(k)) return r[k]; return ''; })();
    const tt = num(r['end_note_gr/testtime_rounded']) ?? num(r.testtime_rounded) ?? (r.start && r.end ? (Date.parse(r.end) - Date.parse(r.start)) / 60000 : null);
    if (tt !== null && tt > 0 && String(r.stu_avail) !== '2') {
      c.ts += tt;
      c.tn += 1;
      c.h[Math.min(HIST_BUCKETS - 1, Math.floor(tt * 2))] += 1;
      // identifying detail for the most unusual tests, so a flag can point at the exact submissions
      const hh = (r.start || '').slice(11, 16);
      const rec = [stuid, r['stu_info/rand_nr'] ?? '', tt, hh, setNo, r._id];
      c.ex.lo.push(rec); c.ex.lo.sort((a, b) => a[2] - b[2]); if (c.ex.lo.length > 4) c.ex.lo.pop();
      c.ex.hi.push(rec); c.ex.hi.sort((a, b) => b[2] - a[2]); if (c.ex.hi.length > 3) c.ex.hi.pop();
    }
    const hr = localHour(r.start);
    if (hr !== null) {
      if (hr < c.h0) c.h0 = hr;
      if (hr > c.h1) c.h1 = hr;
      if (hr < 7 || hr > 14) { c.late += 1; if (c.ex.late.length < 3) c.ex.late.push([stuid, r['stu_info/rand_nr'] ?? '', tt, (r.start || '').slice(11, 16), setNo, r._id]); }
    }
    const dist = num(r.distance);
    if (dist !== null && dist > 500) { c.far += 1; if (c.ex.far.length < 2) c.ex.far.push([stuid, r['stu_info/rand_nr'] ?? '', tt, (r.start || '').slice(11, 16), setNo, r._id, Math.round(dist)]); }

    for (const f of SKILL_TIME_FIELDS) {
      const v = num(r[f]);
      if (v === null) continue;
      const s = (c.st[f] ||= [0, 0, 0]); // seconds sum, count, count at <=2s
      s[0] += v;
      s[1] += 1;
      if (v <= 2) s[2] += 1;
    }
    const gs = SKILLS_BY_GRADE[grade];
    for (const domain of ['reading', 'arithmetic']) {
      for (const [field, label] of gs[domain]) {
        const raw = r[field];
        if (raw === undefined || raw === null || raw === '') continue;
        const p = (c.ps[domain[0] + grade + ':' + label] ||= [0, 0]);
        p[1] += 1;
        if (raw === '1') p[0] += 1;
      }
    }
    if (r.deviceid) {
      c.dv ||= {}; c.dv[r.deviceid] = (c.dv[r.deviceid] || 0) + 1;
      const s0 = secsOf(r.start), e0 = secsOf(r.end);
      if (s0 !== null && e0 !== null && e0 >= s0) pushEvent(Y, date, [r.deviceid, s0, e0, school, +grade, enumerator, 't']);
    }
    const cf = calFields(r);
    if (cf.cal_status === 'diff' || cf.cal_status === 'none') {
      const cal = (c.cal ||= { n: 0, a: 0, b: 0, c: 0, planned: cf.cal_planned || '', other: [] });
      cal.n += 1; const ans = cf.cal_confirm; if (ans === 'a' || ans === 'b' || ans === 'c') cal[ans] += 1;
      if (cf.cal_confirm_other && cal.other.length < 3 && !cal.other.includes(cf.cal_confirm_other)) cal.other.push(String(cf.cal_confirm_other).slice(0, 120));
    }
    const rn = r['stu_info/rand_nr'];
    const sgk = `${school}|${grade}`;
    const sg = (Y.sg[sgk] ||= { att: null, list: null, rn: [], date: null });
    if (rn !== undefined && rn !== '') sg.rn.push(`${parseInt(rn, 10)}~${enumerator}~${stuid}~${r._id}`);
  }
  return state;
}

export function addSampling(state, records) {
  for (const r of records) {
    const year = isPracticeSchool(pick(r, 'school')) ? 'practice' : yearOf(r);
    if (!year) continue;
    const Y = (state.yrs[year] ||= emptyYear());
    const school = pick(r, 'school');
    const grade = String(pick(r, 'grade_conf') ?? pick(r, 'grade') ?? '');
    if (!school || !['1', '2', '3'].includes(grade)) continue;
    const att = num(pick(r, 'att'));
    const list = [];
    for (let i = 1; i <= 40; i++) {
      const v = num(pick(r, 'int' + i));
      if (v !== null) list.push(v);
    }
    const sg = (Y.sg[`${school}|${grade}`] ||= { att: null, list: null, rn: [], date: null });
    const cf = calFields(r);
    if (cf.cal_status === 'diff' || cf.cal_status === 'none') sg.cal = { status: cf.cal_status, planned: cf.cal_planned || '', reason: cf.cal_reason || '', other: String(cf.cal_reason_other || '').slice(0, 160), approved: cf.cal_approved || '' };
    sg.att = att;
    // keep every draw for the class: a class may be sampled again and pupils tested from an earlier draw
    sg.list = [...new Set([...(sg.list || []), ...list])]; // empty when the class had 20 or fewer present (test all)
    sg.date = (pick(r, 'date') || r.today || '').slice(0, 10);
    sg.enum = pick(r, 'enumerator') || '';
    const dev = r.deviceid || pick(r, 'deviceid'); // the phone that sent the sampling form
    if (dev) {
      sg.dev = dev; sg.devWho = sg.enum;
      // A sampling form is often left open for hours and finalised later, so its window says little. Use the moment it was opened, as one point in time.
      const s0 = secsOf(r.start);
      if (s0 !== null && sg.date) {
        const day = ((Y.tl ||= {})[sg.date] ||= []);
        const hit = day.find((x) => x[6] === 's' && x[0] === dev && x[1] === s0 && x[3] === school && x[4] === +grade);
        if (hit) hit[2] = hit[1]; else pushEvent(Y, sg.date, [dev, s0, s0, school, +grade, sg.enum, 's']);
      }
    }
    sg.sub = r._submission_time || '';
    sg.sb = addLate(sg.sb, lateness(r, sg.date));
    Y.nsamp = (Y.nsamp || 0) + 1;
  }
  return state;
}

// Teacher form (baseline school visit). One record per teacher; the school block repeats on each record.
// Only counts and codes are kept. Never stored: names, check numbers, phone numbers, TIN, bank details, WEO contacts.
const T = 't/teaching_assignments/';
const hasCode = (v, code) => String(v || '').split(/\s+/).includes(code);
export function addTeachers(state, records) {
  for (const r of records) {
    const year = yearOf(r) || String(new Date().getUTCFullYear());
    const Y = (state.yrs[year] ||= emptyYear());
    const school = pick(r, 'school');
    if (!school) continue;
    const t = (Y.tf[school] ||= { n: 0, date: null, head: 0, subj: 0, male: 0, female: 0, smart: 0, replaced: 0, teach: { 1: { r: 0, a: 0 }, 2: { r: 0, a: 0 }, 3: { r: 0, a: 0 } }, enrol: null, nt: null, nkf: null, weo: null, last: 0 });
    t.n += 1;
    { const who = String(pick(r, 'enumerator') || '').trim(); if (who) { const P = (Y.tfp ||= {}); P[who] = (P[who] || 0) + 1; } }
    t.date = (pick(r, 'date') || r.today || t.date || '').slice(0, 10);
    const replaced = Boolean(r['t/gr_teacher_info_new/position_new']);
    if (replaced) t.replaced += 1;
    const pos = String(r['t/gr_teacher_info/position'] || r['t/gr_teacher_info_new/position_new'] || '');
    if (pos === '1') t.head += 1; else if (pos === '2') t.subj += 1;
    const gen = String(r['t/gr_teacher_info/gender'] || r['t/gr_teacher_info_new/gender_new'] || '');
    if (gen === '1') t.male += 1; else if (gen === '2') t.female += 1;
    const sp = String(r['t/gr_teacher_info/smartphone'] || r['t/gr_teacher_info_new/smartphone_new'] || '');
    if (sp === '01' || sp === '1') t.smart += 1;
    for (const gr of [1, 2, 3]) {
      if (String(r[`${T}grade${gr}`]) !== '01') continue; // teaches this grade
      const subs = r[`${T}gr_grade${gr}/grade${gr}_subs`];
      if (hasCode(subs, `${gr}1`)) t.teach[gr].r += 1; // reading
      if (hasCode(subs, `${gr}2`)) t.teach[gr].a += 1; // arithmetic
    }
    // school block: take the most recent record's numbers
    if (typeof r._id === 'number' && r._id >= t.last) {
      t.last = r._id;
      const e = {};
      for (const gr of [1, 2, 3]) {
        const b = `gr_schooldata/group_grade${gr}/g${gr}`;
        const girls = num(r[b + 'girls']), boys = num(r[b + 'boys']), total = num(r[b + 'total']);
        if (girls !== null || boys !== null) e[gr] = [girls ?? 0, boys ?? 0, total ?? (girls ?? 0) + (boys ?? 0)];
      }
      if (Object.keys(e).length) t.enrol = e;
      const nt = num(r['gr_schooldata/teacher_gr/no_teachers']), nkf = num(r['gr_schooldata/teacher_gr/no_kf_teachers']);
      if (nt !== null) t.nt = nt;
      if (nkf !== null) t.nkf = nkf;
      const w = r['gr_schooldata/weo/weo_att']; if (w) t.weo = String(w); // 1 took part, 2 did not, 3 sent a representative
    }
  }
  return state;
}
