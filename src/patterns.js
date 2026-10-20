// Team patterns: where a test administrator or a team is far from their peers, repeatedly, so HQ can offer support early.
// Built only from the aggregates the system already keeps (counts, times, hours, checks). It never returns locations or pupil details,
// never changes a record, and gives possible reasons to check, not conclusions. Needs a minimum of evidence before it says anything.
import { PARTNERS } from './config.js';

export const MIN_DAYS = 3, MIN_TESTS = 20;
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG = { Sun: 'Sundays', Mon: 'Mondays', Tue: 'Tuesdays', Wed: 'Wednesdays', Thu: 'Thursdays', Fri: 'Fridays', Sat: 'Saturdays' };
const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const partnerOf = (region) => Object.entries(PARTNERS).find(([, rs]) => rs.includes(region))?.[0] || '';
// distance from the peer middle in "robust standard deviations" (median and MAD), with a floor so a tight group does not inflate small gaps
export function zScores(values, floor) {
  const xs = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v)); const m = med(xs);
  if (xs.length < 5 || m === null) return values.map(() => null);
  const mad = med(xs.map((v) => Math.abs(v - m))) * 1.4826; const sc = Math.max(mad, floor);
  return values.map((v) => (v === null || v === undefined || !Number.isFinite(v) ? null : (v - m) / sc));
}

// what to look at first, in plain words, for each kind of signal
const CAUSES = {
  fast: ['The test may be rushed or the instructions shortened', 'A pupil may be getting help or hints', 'A new tester who has not yet got the pace of the form', 'Check a few recordings or sit in on a visit'],
  slow: ['Large class or hard-to-reach pupils', 'The tester may need help with the form flow', 'A slow phone or form lag', 'Interruptions at the school'],
  pace: ['Mixed grade load: the average depends on the grade tested', 'Very fast or very slow averages point to the same checks as above'],
  late_start: ['Long travel the day before or that morning', 'Late arrival at the school or a late start after assembly', 'A small number of tests after 14:00 may only be finishing a school'],
  arrival: ['Long or difficult road to the school', 'Transport not arranged early enough', 'The day plan puts too many far schools together'],
  finish: ['The school day ended early (exams, closure, assembly)', 'Testing stopped before the sample was complete', 'Illness or a transport deadline'],
  short_day: ['One school only, a small school, or few pupils present', 'The team split and this person tested fewer pupils', 'Time lost to travel or waiting for permission'],
  no_location: ['Phone location is switched off or has no signal', 'Location permission for KoBo Collect is off', 'An older form version without the location question'],
  away: ['GPS can drift 100 to 300 m inside buildings: check the pattern, not one reading', 'The recorded school may be a neighbouring school or a different site', 'The test may have been recorded after leaving the school'],
  quality: ['Pupil numbers entered or sampled incorrectly', 'The sampling list was not used or was out of date', 'A phone problem or a sync problem on that day'],
};

export function computePatterns(sum, today) {
  const nat = { 1: [0, 0], 2: [0, 0], 3: [0, 0] }; // national average minutes per grade
  const staff = (sum.admins || []).filter((a) => a.role !== 'unlisted' || a.tested >= MIN_TESTS);
  for (const a of staff) for (const g of [1, 2, 3]) if (a.by_grade && a.by_grade[g] != null && a.by_grade_n) { nat[g][0] += a.by_grade[g] * a.by_grade_n[g]; nat[g][1] += a.by_grade_n[g]; }
  const natAvg = Object.fromEntries([1, 2, 3].map((g) => [g, nat[g][1] ? nat[g][0] / nat[g][1] : null]));
  const flagBy = {}; for (const f of sum.flags || []) for (const nm of String(f.admin || '').split(' and ')) if (nm) { const o = (flagBy[nm] ||= {}); o[f.type] = (o[f.type] || 0) + 1; }

  const rows = staff.map((a) => {
    const days = (sum.days && sum.days[a.name]) || []; // [date, schools, tested, h0, h1, tn, ts, fast, slow, late, gp, gk, gn, gv]
    const tn = a.tested || 0; const recs = a.records || 0;
    let exp = 0, expN = 0; for (const g of [1, 2, 3]) if (a.by_grade_n && a.by_grade_n[g] && natAvg[g]) { exp += natAvg[g] * a.by_grade_n[g]; expN += a.by_grade_n[g]; }
    const paceRatio = a.avg_min && expN ? a.avg_min / (exp / expN) : null; // 1 means the usual pace for the grades this person tested
    const dayRows = days.map((d) => ({ date: d[0], schools: d[1], tested: d[2], first: d[3], last: d[4], tn: d[5] || 0, avg: d[5] ? r1(d[6] / d[5]) : null, fast: d[7] || 0, slow: d[8] || 0, late: d[9] || 0, gp: d[10] || 0, gk: d[11] || 0, gn: d[12] || 0, gv: d[13] || 0 }));
    const firsts = dayRows.map((d) => d.first).filter((x) => x !== null), lasts = dayRows.map((d) => d.last).filter((x) => x !== null);
    const x = {
      name: a.name, staff_id: a.staff_id, role: a.role, position: a.position, region: a.region, partner: partnerOf(a.region),
      tests: tn, records: recs, days: dayRows.length, schools: a.schools, avg_min: a.avg_min, pace: r1(paceRatio),
      fast_pct: tn ? r1((100 * a.fast) / tn) : null, slow_pct: tn ? r1((100 * a.slow) / tn) : null, late_pct: tn ? r1((100 * a.late) / tn) : null,
      first_h: med(firsts), last_h: med(lasts), tests_per_day: dayRows.length ? r1(tn / dayRows.length) : null,
      gps_pct: recs ? r1((100 * (a.gp || 0)) / recs) : null, at_school_pct: a.gk ? r1((100 * (a.gn || 0)) / a.gk) : null, gk: a.gk || 0, far_n: a.gv || 0,
      queries: flagBy[a.name] || {}, quality: a.quality,
      _dayRows: dayRows,
    };
    return x;
  });
  const enough = (x) => x.days >= MIN_DAYS && x.tests >= MIN_TESTS;
  const groupOf = (x) => (x.role === 'volunteer' ? 'v' : 'l'); // volunteers are compared with volunteers, coordinators with coordinators
  const metrics = [
    ['fast', (x) => x.fast_pct, 3, 1], ['slow', (x) => x.slow_pct, 3, 1], ['pace', (x) => x.pace, 0.08, -1], ['late_start', (x) => x.late_pct, 3, 1],
    ['arrival', (x) => x.first_h, 0.7, 1], ['finish', (x) => x.last_h, 0.7, -1], ['short_day', (x) => x.tests_per_day, 5, -1],
    ['no_location', (x) => (x.gps_pct === null ? null : 100 - x.gps_pct), 10, 1], ['away', (x) => (x.gk >= 10 ? 100 - x.at_school_pct : null), 8, 1],
    ['quality', (x) => (x.tests ? ((x.queries.dup || 0) + (x.queries.notlist || 0) + (x.queries.edited || 0) + (x.queries.latesub || 0)) / x.tests * 100 : null), 1, 1],
  ];
  const labels = { fast: 'Many tests faster than normal', slow: 'Many tests slower than normal', pace: 'Average test time far from the usual pace', late_start: 'Tests outside field hours', arrival: 'First test of the day later than peers', finish: 'Last test of the day earlier than peers', short_day: 'Fewer tests a day than peers', no_location: 'Phone location often missing', away: 'Tests often recorded away from the school', quality: 'Frequent data-quality checks' };
  const zs = {};
  for (const grp of ['v', 'l']) { const pool = rows.filter((x) => groupOf(x) === grp && enough(x)); for (const [k, f, floor] of metrics) { const z = zScores(pool.map(f), floor); pool.forEach((x, i) => { ((zs[x.name] ||= {})[k] = z[i]); }); } }
  for (const x of rows) {
    x.signals = []; x.level = 'ok'; x.causes = [];
    if (!enough(x)) { x.level = 'early'; continue; }
    const strong = [];
    for (const [k, f, , dir] of metrics) {
      const z = zs[x.name]?.[k]; if (z === null || z === undefined) continue; const val = f(x);
      // each signal needs both a gap from peers and a meaningful size on its own
      const big = { fast: val >= 10, slow: val >= 10, pace: z * dir > 0 && (val < 0.75 || val > 1.3), late_start: val >= 8, arrival: z * dir > 0, finish: z * dir > 0, short_day: z * dir > 0, no_location: val >= 70, away: val >= 40 || x.far_n >= 3, quality: val >= 3 }[k];
      if (z * dir >= 2 && big) { x.signals.push({ key: k, label: labels[k], z: r1(z * dir), detail: detailOf(k, x) }); if (z * dir >= 3.5) strong.push(k); }
    }
    // repeated on specific days, and the weekday it clusters on
    const fastDays = x._dayRows.filter((d) => d.tn >= 5 && d.fast / d.tn >= 0.3), lateDays = x._dayRows.filter((d) => d.late >= 2);
    x.patterns = [];
    for (const [lab, ds] of [['fast tests', fastDays], ['tests outside field hours', lateDays]]) {
      if (ds.length >= 3) { const wd = {}; for (const d of ds) { const w = DAY[new Date(d.date + 'T00:00:00Z').getUTCDay()]; wd[w] = (wd[w] || 0) + 1; } const top = Object.entries(wd).sort((a, b) => b[1] - a[1])[0]; x.patterns.push({ text: `${ds.length} days with ${lab}` + (top[1] >= 3 && top[1] / ds.length >= 0.6 ? `, mostly on ${LONG[top[0]]}` : ''), days: ds.length }); }
    }
    const nSig = x.signals.length + (x.patterns.length ? 1 : 0);
    x.level = nSig >= 3 || (strong.length && x.patterns.length) ? 'attention' : nSig >= 2 || strong.length ? 'watch' : 'ok';
    if (x.level === 'ok' && x.patterns.length) x.level = 'watch';
    const keys = [...new Set([...x.signals.map((s) => s.key), ...(x.patterns.some((p) => /fast/.test(p.text)) ? ['fast'] : [])])];
    x.causes = [...new Set(keys.flatMap((k) => (CAUSES[k] || []).slice(0, 2)))].slice(0, 6);
    x.headline = headlineOf(x);
  }
  // the weekday picture across everyone: where fast and late days cluster
  const wk = Object.fromEntries(DAY.slice(1, 6).map((d) => [d, { tests: 0, fast: 0, late: 0 }]));
  for (const x of rows) for (const d of x._dayRows) { const w = DAY[new Date(d.date + 'T00:00:00Z').getUTCDay()]; if (wk[w]) { wk[w].tests += d.tn; wk[w].fast += d.fast; wk[w].late += d.late; } }
  // by region: how many people need attention, and the middle of the main measures
  const reg = {}; for (const x of rows) { const r = (reg[x.region || 'OTHER'] ||= { region: x.region || 'OTHER', partner: partnerOf(x.region), people: 0, attention: 0, watch: 0, fast: [], pace: [], gps: [], at: [], first: [] }); r.people++; if (x.level === 'attention') r.attention++; if (x.level === 'watch') r.watch++; if (x.fast_pct !== null) r.fast.push(x.fast_pct); if (x.pace !== null) r.pace.push(x.pace); if (x.gps_pct !== null) r.gps.push(x.gps_pct); if (x.at_school_pct !== null) r.at.push(x.at_school_pct); if (x.first_h !== null) r.first.push(x.first_h); }
  const regions = Object.values(reg).map((r) => ({ region: r.region, partner: r.partner, people: r.people, attention: r.attention, watch: r.watch, fast_pct: r1(med(r.fast)), pace: r1(med(r.pace)), gps_pct: r1(med(r.gps)), at_school_pct: r1(med(r.at)), first_h: med(r.first) })).sort((a, b) => (b.attention - a.attention) || (b.watch - a.watch));
  const order = { attention: 0, watch: 1, ok: 2, early: 3 };
  const people = rows.map((x) => { const { _dayRows, ...rest } = x; return { ...rest, strip: _dayRows.slice(-14).map((d) => [d.date, d.schools, d.tn, d.avg, d.fast, d.late, d.first, d.last, d.gp && d.tn ? Math.round((100 * d.gp) / Math.max(d.tn, d.gp)) : null, d.gk ? Math.round((100 * d.gn) / d.gk) : null]) }; })
    .sort((a, b) => (order[a.level] - order[b.level]) || (b.signals.length - a.signals.length) || ((b.fast_pct || 0) - (a.fast_pct || 0)));
  const count = (l) => people.filter((p) => p.level === l).length;
  const phone = rows.reduce((s, x) => s + (x.records || 0), 0), withGps = staff.reduce((s, a) => s + (a.gp || 0), 0);
  return { as_of: sum.as_of, today, min_days: MIN_DAYS, min_tests: MIN_TESTS, counts: { people: people.length, attention: count('attention'), watch: count('watch'), ok: count('ok'), early: count('early') }, gps_share: phone ? r1((100 * withGps) / phone) : null, nat_avg: Object.fromEntries(Object.entries(natAvg).map(([g, v]) => [g, r1(v)])), weekdays: wk, regions, people };
}

function detailOf(k, x) {
  const f = (v) => (v === null || v === undefined ? 'n/a' : v);
  return ({
    fast: `${f(x.fast_pct)}% of tests were faster than the normal range`, slow: `${f(x.slow_pct)}% of tests were slower than the normal range`,
    pace: `average ${f(x.avg_min)} min, ${f(x.pace)} times the usual pace for these grades`, late_start: `${f(x.late_pct)}% of tests started outside 07:00 to 14:00`,
    arrival: `first test usually around ${f(x.first_h)}:00`, finish: `last test usually around ${f(x.last_h)}:00`, short_day: `${f(x.tests_per_day)} tests a day`,
    no_location: `${f(x.gps_pct)}% of records have a phone location`, away: `${f(x.at_school_pct)}% of located tests were within 500 m of the school${x.far_n ? `, ${x.far_n} more than 2 km away` : ''}`,
    quality: `${((x.queries.dup || 0) + (x.queries.notlist || 0) + (x.queries.edited || 0) + (x.queries.latesub || 0))} data-quality checks on ${x.tests} tests`,
  })[k] || '';
}
function headlineOf(x) {
  const parts = x.signals.slice(0, 3).map((s) => s.detail); if (x.patterns.length) parts.push(x.patterns[0].text);
  return `${parts.join('; ')}.`;
}
