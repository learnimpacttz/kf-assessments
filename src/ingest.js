// Folds KoBo submissions into compact, anonymous aggregates. Never stores or
// returns: pupil names, GPS coordinates, pupil gender/age, or test item content.
//
// Student tool -> `cells` (one per day x school x grade x test admin) and `sg`
//                 (one per school x grade: random numbers drawn, for the
//                 "was this pupil actually on the sampling list" check)
// Sampling tool -> `sg[...]` attendance and the random numbers the app drew
// Teacher form  -> `tf[school]` teacher forms completed
import { SKILLS_BY_GRADE } from './aggregate.js';

export const HIST_BUCKETS = 61; // 0.5 min each, last bucket = 30 min and over
const SKILL_TIME_FIELDS = [
  's1_letters_time', 's1_syllables_time', 's1_words_time', 's1_sentences_time', 's1_nr_recog_time', 's1_nr_compare_time', 's1_nr_addition_time', 's1_subtraction_time',
  's2_words_time', 's2_read_speed_time', 's2_story_time', 's2_nr_compare_time', 's2_nr_nissing_time', 's2_addition_time', 's2_subtraction_time',
  's3_dictation_time', 's3_meaning_time', 's3_read_speed_time', 's3_story_time', 's3_nr_missing_time', 's3_addition_time', 's3_subtraction_time', 's3_multiply_time',
];

export function emptyYear() {
  return { cells: {}, sg: {}, tf: {}, n: 0 };
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

export function yearOf(r) {
  return String(r.year || (r.today || pick(r, 'date') || '').slice(0, 4) || '').slice(0, 4);
}

function localHour(startIso) {
  // KoBo start timestamps carry the device offset, e.g. 2025-10-21T08:03:10.170+03:00
  const m = /T(\d\d):/.exec(startIso || '');
  return m ? parseInt(m[1], 10) : null;
}

export function addStudents(state, records) {
  for (const r of records) {
    const year = yearOf(r);
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
    const rn = r['stu_info/rand_nr'];
    const sgk = `${school}|${grade}`;
    const sg = (Y.sg[sgk] ||= { att: null, list: null, rn: [], date: null });
    if (rn !== undefined && rn !== '') sg.rn.push(`${parseInt(rn, 10)}~${enumerator}~${stuid}~${r._id}`);
  }
  return state;
}

export function addSampling(state, records) {
  for (const r of records) {
    const year = yearOf(r);
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
    sg.att = att;
    // keep every draw for the class: a class may be sampled again and pupils tested from an earlier draw
    sg.list = [...new Set([...(sg.list || []), ...list])]; // empty when the class had 20 or fewer present (test all)
    sg.date = (pick(r, 'date') || r.today || '').slice(0, 10);
    sg.enum = pick(r, 'enumerator') || '';
    sg.sub = r._submission_time || '';
    Y.nsamp = (Y.nsamp || 0) + 1;
  }
  return state;
}

export function addTeachers(state, records) {
  for (const r of records) {
    const year = yearOf(r) || String(new Date().getUTCFullYear());
    const Y = (state.yrs[year] ||= emptyYear());
    const school = pick(r, 'school');
    if (!school) continue;
    const t = (Y.tf[school] ||= { n: 0, date: null });
    t.n += 1;
    t.date = (pick(r, 'date') || r.today || t.date || '').slice(0, 10);
  }
  return state;
}
