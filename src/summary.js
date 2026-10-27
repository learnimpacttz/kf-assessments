// Turns the raw per-day aggregates into everything the dashboards show:
// school progress, test-admin stats, checks/flags, pace and projected finish.
// Computed once per sync (not per request) and stored; the API only slices it.
import { devCode as devCodeOf, PRACTICE_BY_ID, PRACTICE_REGION, SCHOOL_BY_ID, SCHOOLS_BY_REGION, REGIONS, FIELD_END, DEFAULT_BANDS, targetPerGrade, staffForKoboName, PILOT_DAY, addWorkingDays, workingDaysBetween, isWorkingDay, STAFF } from './config.js';
import { HIST_BUCKETS, uniqueRn } from './ingest.js';
import { summarizeAnswers } from './answers.js';

const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const r1 = (x) => Math.round(x * 10) / 10;

// ---- calibration from earlier rounds (2024/2025) ----
export function percentileFromHist(h, p) {
  const total = h.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let acc = 0;
  for (let i = 0; i < h.length; i++) {
    acc += h[i];
    if (acc / total >= p) return i * 0.5 + 0.25;
  }
  return (HIST_BUCKETS - 1) * 0.5;
}

export function buildBands(yrs, excludeYear) {
  const hist = { 1: new Array(HIST_BUCKETS).fill(0), 2: new Array(HIST_BUCKETS).fill(0), 3: new Array(HIST_BUCKETS).fill(0) };
  let any = false;
  for (const [y, Y] of Object.entries(yrs)) {
    if (y === excludeYear || y === 'practice') continue;
    for (const [k, c] of Object.entries(Y.cells)) {
      const g = k.split('|')[2];
      if (!hist[g]) continue;
      for (let i = 0; i < HIST_BUCKETS; i++) hist[g][i] += c.h[i];
      any = true;
    }
  }
  const out = {};
  for (const g of [1, 2, 3]) {
    const n = hist[g].reduce((a, b) => a + b, 0);
    if (!any || n < 200) {
      const d = DEFAULT_BANDS[g];
      out[g] = { n, p3: d[0], p10: d[0] + 1, p50: d[1], p90: d[2] - 4, p99: d[2], source: 'default' };
    } else {
      out[g] = {
        n,
        p3: Math.max(1.5, percentileFromHist(hist[g], 0.03)),
        p10: percentileFromHist(hist[g], 0.1),
        p50: percentileFromHist(hist[g], 0.5),
        p90: percentileFromHist(hist[g], 0.9),
        p99: percentileFromHist(hist[g], 0.99),
        source: 'history',
      };
    }
  }
  return out;
}

const below = (h, minutes) => {
  const idx = Math.floor(minutes * 2);
  let s = 0;
  for (let i = 0; i < idx && i < h.length; i++) s += h[i];
  return s;
};
const above = (h, minutes) => {
  const idx = Math.floor(minutes * 2);
  let s = 0;
  for (let i = idx; i < h.length; i++) s += h[i];
  return s;
};

const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWords = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return `${DAYN[d.getUTCDay()]} ${d.getUTCDate()} ${MONN[d.getUTCMonth()]}`; };
const utcMs = (s) => Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z');
const spanWords = (min) => { const m = Math.max(0, Math.round(min)); const h = Math.floor(m / 60); return h >= 1 ? `${h} hour${h > 1 ? 's' : ''}${m % 60 ? ` ${m % 60} min` : ''}` : `${m} minute${m === 1 ? '' : 's'}`; };
// The words that explain every time shown on a query (the phone clock and the server clock are different things)
export const TIME_NOTE = 'Started and finished are the times on the phone when the test was done. Sent is the time the record reached KoBo (East Africa Time). After the test is the wait between finishing and sending.';
const hms = (t) => `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`;
const sname = (id) => (SCHOOL_BY_ID[id]?.name || PRACTICE_BY_ID[id]?.name || id).trim();

// What one phone did in one day, in time order. Thresholds are deliberately forgiving: a flag means "look", not "wrong".
const gradeTesters = (sc, g) => { const dg = (sc.dayGrade || {})[sc.last]; return dg && dg[g] ? dg[g].slice(0, 3).join(' and ') : ''; }; // the people who tested that grade on the last visit day
export function analyseDay(date, events) {
  const flags = [];
  const byDev = {}; const byName = {};
  for (const e of events) { (byDev[e[0]] ||= []).push(e); if (e[5]) (byName[e[5]] ||= []).push(e); }
  const row = (e) => [hms(e[1]), hms(e[2]), devCodeOf(e[0]), e[5], sname(e[3]), e[4], e[6]];
  const add = (type, sev, dev, evs, text, hint, normal) => { const e0 = evs[0]; flags.push({ sev, type, school: e0[3], grade: e0[4], admin: [...new Set(evs.map((x) => x[5]).filter(Boolean))].join(' and '), date, text, hint, normal, evs: evs.slice(0, 10).map(row) }); };
  for (const [dev, list] of Object.entries(byDev)) {
    list.sort((a, b) => a[1] - b[1]);
    const code = devCodeOf(dev);
    // 1. overlapping tests on one phone: a phone can only run one test at a time
    const over = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length && list[j][1] < list[i][2]; j++) if (list[i][2] - list[j][1] > 30 && !(list[i][6] === 's' && list[j][6] === 's') && !(list[i][5] && list[i][5] === list[j][5])) over.push([list[i], list[j]]); // the same person overlapping is caught per person below
    if (over.length) add('devoverlap', 'warn', dev, over.slice(0, 4).flat(), `Phone ${code} has ${over.length} pair${over.length > 1 ? 's' : ''} of tests that ran at the same time. For example one test ran from ${hms(over[0][0][1])} to ${hms(over[0][0][2])} and another from ${hms(over[0][1][1])} to ${hms(over[0][1][2])}`, `One phone cannot run two tests at once. Check whether records were edited or entered twice. ${TIME_NOTE}`, 'one test at a time');
    // 2. the phone appears at different schools within a short time
    const trav = [];
    for (let i = 1; i < list.length; i++) if (list[i][3] !== list[i - 1][3]) { const gap = list[i][1] - list[i - 1][2]; if (gap < 30 * 60) trav.push({ a: list[i - 1], b: list[i], gap }); }
    if (trav.length) { const worst = Math.min(...trav.map((t) => t.gap)); add('devtravel', worst < 10 * 60 ? 'bad' : 'warn', dev, trav.slice(0, 3).flatMap((t) => [t.a, t.b]), `Phone ${code} was used at two different schools very close in time. The last test at ${sname(trav[0].a[3])} finished at ${hms(trav[0].a[2])} and the next test, at ${sname(trav[0].b[3])}, started at ${hms(trav[0].b[1])}, which is ${trav[0].gap >= 0 ? `${spanWords(trav[0].gap / 60)} later` : `${spanWords(-trav[0].gap / 60)} before the first one finished`}${trav.length > 1 ? ` (${trav.length} such moves that day)` : ''}. These are the start and finish times on the phone, not the time of sending`, `Schools are rarely this close. Check whether the phone was passed between teams or the school was chosen wrongly. ${TIME_NOTE}`, 'at least 30 min between schools'); }
    // 3. jumping back and forth between grades in the same school
    const sw = {};
    for (let i = 2; i < list.length; i++) { const [p2, p1, c] = [list[i - 2], list[i - 1], list[i]]; if (c[3] === p1[3] && p1[3] === p2[3] && c[4] === p2[4] && c[4] !== p1[4] && c[1] - p2[2] < 30 * 60) (sw[c[3]] ||= []).push([p2, p1, c]); }
    for (const [school, runs] of Object.entries(sw)) if (runs.length >= 2) add('devswitch', 'warn', dev, runs.slice(0, 2).flat(), `Phone ${code} went back and forth between grades ${runs.length} times at ${sname(school)}`, `Each person usually works one class. Ask who was testing which class. ${TIME_NOTE}`, 'one class at a time');
    // 4. one phone used under more than one name on the same day, at any time and at any school (people swapping, even hours apart)
    const named = list.filter((e) => e[5]); const who = [...new Set(named.map((e) => e[5]))];
    if (who.length >= 2) {
      const seq = []; for (const e of named) if (seq[seq.length - 1] !== e[5]) seq.push(e[5]);
      const back = seq.length > who.length; // A, then B, then A again: the phone keeps changing hands
      const span = who.map((n) => { const m = named.filter((e) => e[5] === n); return `${n} ${hms(Math.min(...m.map((e) => e[1])))}-${hms(Math.max(...m.map((e) => e[2])))}`; }).join('; ');
      add('devpeople', back ? 'bad' : 'warn', dev, who.flatMap((n) => { const m = named.filter((e) => e[5] === n); return m.length > 1 ? [m[0], m[m.length - 1]] : m; }), `Phone ${code} was used under ${who.length} names on the same day: ${span}${back ? ', switching back and forth' : ''}`, `Each person should use their own phone and their own name. When two people share a phone we cannot tell who tested which child. ${TIME_NOTE}`, 'one name per phone');
    }
  }
  // 5a. one person with two tests running at the same time (same phone or different phones, same school or not)
  const overlapped = new Set();
  for (const [who, list] of Object.entries(byName)) {
    const t = list.filter((e) => e[6] === 't').sort((a, b) => a[1] - b[1]); const pairs = [];
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length && t[j][1] < t[i][2]; j++) if (t[i][2] - t[j][1] > 30) pairs.push([t[i], t[j]]);
    if (pairs.length) { overlapped.add(who); const ph = new Set(pairs.flat().map((e) => e[0])); add('nameoverlap', pairs.length >= 3 ? 'bad' : 'warn', who, pairs.slice(0, 4).flat(), `${who} has ${pairs.length} pair${pairs.length > 1 ? 's' : ''} of tests that ran at the same time. For example one test ran from ${hms(pairs[0][0][1])} to ${hms(pairs[0][0][2])} and another from ${hms(pairs[0][1][1])} to ${hms(pairs[0][1][2])}${ph.size > 1 ? ', on ' + ph.size + ' different phones' : ' on one phone'}`, `One person can test only one child at a time. Overlapping times can mean records were typed in afterwards, copied, or another person used this name. ${TIME_NOTE}`, 'one test at a time'); }
  }
  // 5b. one person on two phones at the same time
  for (const [who, list] of Object.entries(byName)) {
    const devs = [...new Set(list.map((e) => e[0]))];
    if (devs.length < 2 || overlapped.has(who)) continue; // a real overlap is already flagged for this person above
    list.sort((a, b) => a[1] - b[1]);
    const clash = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length && list[j][1] < list[i][2] + 120; j++) if (list[i][0] !== list[j][0] && list[i][3] !== undefined) clash.push([list[i], list[j]]);
    if (clash.length) add('namedevs', 'warn', who, clash.slice(0, 3).flat(), `${who} has tests on ${devs.length} different phones (${devs.map(devCodeOf).join(', ')}) that ran at the same time`, `A person normally works with one phone. Check whether someone else used this name. ${TIME_NOTE}`, 'one phone per person');
  }
  return flags;
}

export function phoneDay(events) {
  const phones = {};
  for (const e of events) { const p = (phones[e[0]] ||= { c: devCodeOf(e[0]), names: {}, schools: new Set(), n: 0, first: 1e9, last: 0 }); if (e[5]) p.names[e[5]] = (p.names[e[5]] || 0) + 1; p.schools.add(e[3]); p.n += 1; p.first = Math.min(p.first, e[1]); p.last = Math.max(p.last, e[2]); }
  return Object.values(phones).map((p) => ({ c: p.c, names: Object.entries(p.names).sort((a, b) => b[1] - a[1]).map(([n]) => n), schools: [...p.schools], n: p.n, first: p.first, last: p.last }));
}

// Submission timeliness helpers (slot = [same day, 1 day, 2 days, 3+ days, hours summed, longest hours, records with hours])
const mergeSb = (into, from) => { for (let i = 0; i < 7; i++) into[i] = i === 5 ? Math.max(into[i], from[i] || 0) : into[i] + (from[i] || 0); };
const sumSb = (a, b) => { const o = [0, 0, 0, 0, 0, 0, 0]; mergeSb(o, a); mergeSb(o, b); return o; };
function subStats(s) {
  const n = s[0] + s[1] + s[2] + s[3]; if (!n) return null;
  return { n, same: s[0], d1: s[1], d2: s[2], d3: s[3], same_pct: Math.round((100 * s[0]) / n), avg_h: s[6] ? Math.round((s[4] / s[6]) * 10) / 10 : null, max_h: s[6] ? Math.round(s[5] * 10) / 10 : null };
}
// This check began on 27 Oct 2026 and finds records from earlier days. Its reply clock (2 working days) starts on the day the records were sent, and never
// before this date, so a query that could not have existed earlier is not overdue the moment it appears.
const LATE_CLOCK_FROM = '2026-10-27';
// Records sent on a later day than the test. The wait is described in clock times, and compared with the person's next school that day, because holding
// finished work until the next school is the pattern to explain (poor signal happens, but it is not a reason to leave data on the phone).
function sentLater(Y, canonFn, { c, n, date, schoolId, grade, who, kind }) {
  const later = c.sb[1] + c.sb[2] + c.sb[3]; if (!later || !c.sub) return null;
  const subMs = utcMs(c.sub); if (Number.isNaN(subMs)) return null;
  const sent = new Date(subMs + 3 * 3600e3).toISOString(); const sentDay = sent.slice(0, 10), sentHm = sent.slice(11, 16);
  const mine = (e) => canonFn(e[5]) === canonFn(who);
  const fin = Math.max(0, ...((Y.tl && Y.tl[date]) || []).filter((e) => e[6] === (kind === 'form' ? 's' : 't') && e[3] === schoolId && +e[4] === +grade && mine(e)).map((e) => e[2]));
  const finHm = fin ? hms(fin) : '';
  const waitMin = finHm && sentDay ? (Date.parse(sentDay + 'T' + sentHm + ':00Z') - Date.parse(date + 'T' + finHm + ':00Z')) / 60000 : (c.sb[5] ? c.sb[5] * 60 : null);
  const next = ((Y.tl && Y.tl[sentDay]) || []).filter((e) => mine(e) && e[3] !== schoolId).sort((a, b) => a[1] - b[1])[0];
  const sentSec = +sentHm.slice(0, 2) * 3600 + +sentHm.slice(3) * 60; const gap = next ? Math.round((next[1] - sentSec) / 60) : null;
  const nextName = next ? sname(next[3]) : '';
  const what = kind === 'form' ? `The sampling form for ${sname(schoolId)} Grade ${grade}` : `${later} of ${n} test record${n > 1 ? 's' : ''} at ${sname(schoolId)} Grade ${grade}`;
  const text = `${what} ${later > 1 || kind === 'form' ? 'were' : 'was'} sent on ${dayWords(sentDay)}, not on the test day ${dayWords(date)}. ${finHm ? `Testing finished at ${finHm} on the phone and the` : 'The'} last record was sent at ${sentHm}${waitMin != null ? `, ${spanWords(waitMin)} later` : ''}.${next ? ` The first test that day, at ${nextName}, started at ${hms(next[1])} on the phone, ${gap >= 0 ? `${spanWords(gap)} after the records were sent` : `${spanWords(-gap)} before the records were sent`}.` : ''}`;
  const timing = [['Tested', `${dayWords(date)} at ${sname(schoolId)}, Grade ${grade}`], ...(finHm ? [['Testing finished (phone clock)', `${dayWords(date)}, ${finHm}`]] : []), ['Last record sent to KoBo', `${dayWords(sentDay)}, ${sentHm}`], ...(waitMin != null ? [['Wait between finishing and sending', spanWords(waitMin)]] : []), ...(next ? [[`Next school that day`, `${nextName}: first test started ${hms(next[1])} (phone clock), ${gap >= 0 ? spanWords(gap) + ' after sending' : spanWords(-gap) + ' before sending'}`]] : [])];
  const held = next && gap >= -10 && gap <= 60; // sent at about the time the next school began: the records waited until the team was elsewhere
  const night = !held && sentHm < '06:00'; // sent after midnight: a different calendar day, though not a long wait
  const lead = held ? 'The records were sent only about when the next school was starting. ' : night ? 'The records were sent after midnight, so they count as the next day. ' : '';
  // One rule, asked one way: records go out on the day of the test. Where the team was at the time is not the question.
  return { text, timing, held, since: sentDay > LATE_CLOCK_FROM ? sentDay : LATE_CLOCK_FROM, hint: `${lead}Please explain: why were these records not sent on ${dayWords(date)}, the day of the test? Where was the phone when they were sent on ${dayWords(sentDay)}? Poor signal is a real problem, so say what was tried (a place with better signal, a hotspot, sending from home that evening) and what will be done so it does not repeat. The rule is simple: records are sent on the day of the test. Turn on auto send in KoBo Collect so nothing waits on the phone.`, normal: 'sent on the day of the test' };
}
export function summarize(Y, { year, bands, today, owners = {}, practice = false }) {
  const UNI = practice ? PRACTICE_BY_ID : SCHOOL_BY_ID; // the schools and regions this run covers
  const RLIST = practice ? [PRACTICE_REGION] : REGIONS;
  const schools = {};
  const admins = {};
  const flags = [];
  const integrity = { repeated_entries: 0 };
  const daily = {}; // date -> region -> tests
  const mkSchool = (s) => ({
    id: s.id, name: s.name, region: s.region, lga: s.lga, ward: s.ward, arm: s.arm, mne: s.mne,
    g: { 1: { n: 0, av: 0, att: null }, 2: { n: 0, av: 0, att: null }, 3: { n: 0, av: 0, att: null } },
    dates: [], dayAdmins: {}, admins: [], maxTeam: 0, tf: 0, res: { 1: { r: [0, 0], a: [0, 0] }, 2: { r: [0, 0], a: [0, 0] }, 3: { r: [0, 0], a: [0, 0] } }, tch: null, done: false, started: false, last: null, first: null,
  });
  for (const s of Object.values(UNI)) schools[s.id] = mkSchool(s);

  const canon = (n) => (n ? staffForKoboName(n)?.name || n : n); // one person, one name: every spelling in KoBo maps to the roster name
  const adminOf = (name) => {
    const a = (admins[name] ||= {
      name, staff: staffForKoboName(name), n: 0, tn: 0, ts: 0, days: new Set(), schools: new Set(),
      fast: 0, slow: 0, late: 0, far: 0, notList: 0, dup: 0, zero: 0, byGrade: { 1: { tn: 0, ts: 0 }, 2: { tn: 0, ts: 0 }, 3: { tn: 0, ts: 0 } },
      gp: 0, gk: 0, gn: 0, gv: 0, samp: 0, tf: 0, inBand: 0, listChecked: 0, sb: [0, 0, 0, 0, 0, 0, 0], sbs: [0, 0, 0, 0, 0, 0, 0],
    });
    return a;
  };

  const dayPeople = {}; // school|date -> { names, devs }
  const dayDev = {};    // date|device -> { names, school }
  const devReg = {};    // device -> { names: {name: n}, days, schools, n }
  const noteDev = (dev, who, schoolId, date, n, fromTests = false) => {
    if (!dev) return;
    const dp = (dayPeople[schoolId + '|' + date] ||= { names: new Set(), devs: new Set(), tdevs: new Set(), per: {} }); dp.devs.add(dev); if (fromTests) { dp.tdevs.add(dev); dp.per[dev] = (dp.per[dev] || 0) + (n || 0); } if (who) dp.names.add(who);
    const dd = (dayDev[date + '|' + dev + '|' + schoolId] ||= new Set()); if (who) dd.add(who);
    const r = (devReg[dev] ||= { names: {}, days: new Set(), schools: new Set(), n: 0 });
    if (who) r.names[who] = (r.names[who] || 0) + n; r.days.add(date); r.schools.add(schoolId); r.n += n;
  };
  // one person's phones: who sent tests from which phone, on which days, at which schools (field days only: the pilot day is a training day when everyone used spare phones)
  const pdev = {};      // person -> device -> { n, days: Set, schools: Set }
  const pdevDay = {};   // person -> date -> device -> { schools, tests }
  const phoneUsers = {}; // device -> person -> tests
  const notePersonDev = (who, dev, date, schoolId, n) => {
    if (!who || !dev || date === PILOT_DAY) return;
    const a = ((pdev[who] ||= {})[dev] ||= { n: 0, days: new Set(), schools: new Set() }); a.n += n; a.days.add(date); a.schools.add(schoolId);
    const dd = (((pdevDay[who] ||= {})[date] ||= {})[dev] ||= { s: new Set(), n: 0 }); dd.s.add(schoolId); dd.n += n;
    const u = (phoneUsers[dev] ||= {}); u[who] = (u[who] || 0) + n;
  };
  const apEx = {}, mmEx = {}; // person -> exemplar tests with no mixed answer block / a grade that disagrees with the typed answer, so a check can point at the exact submissions
  const dayMap = {}; // admin -> date -> { schools, tested, h0, h1 }
  const work = {}; // admin -> recent rows [date, school, grade, tested, avg_min]
  const hasSampling = Boolean(Y.nsamp);
  const visitTeam = {}; // school|date -> Set(enumerator)
  const cellN = {}; // date|school|grade|person -> records, so a check can say how many records it touches
  for (const [key, c] of Object.entries(Y.cells)) {
    const [date, schoolId, grade, enumRaw] = key.split('|'); const enumerator = canon(enumRaw);
    const sc = schools[schoolId];
    if (!sc) continue; // submissions for a school outside the 325-school list
    sc.g[grade].n += c.n;
    sc.g[grade].av += c.av;
    if (!sc.dates.includes(date)) sc.dates.push(date);
    if (enumerator && !sc.admins.includes(enumerator)) sc.admins.push(enumerator);
    if (enumerator) { const da = (sc.dayAdmins[date] ||= []); if (!da.includes(enumerator)) da.push(enumerator); }
    if (enumerator && c.av > 0) { const dg = ((sc.dayGrade ||= {})[date] ||= {}); const gl = (dg[grade] ||= []); if (!gl.includes(enumerator)) gl.push(enumerator); }
    (visitTeam[schoolId + '|' + date] ||= new Set()).add(enumerator);
    cellN[`${date}|${schoolId}|${grade}|${enumerator}`] = (cellN[`${date}|${schoolId}|${grade}|${enumerator}`] || 0) + c.n;
    const d = ((daily[date] ||= {})[sc.region] = (daily[date][sc.region] || 0) + c.av);
    void d;

    const b = bands[grade];
    const fast = below(c.h, b.p3);
    const slow = above(c.h, b.p99);
    const inBand = c.tn - fast - slow;
    const a = adminOf(enumerator);
    a.n += c.n; a.tn += c.tn; a.ts += c.ts; a.days.add(date); a.schools.add(schoolId);
    a.fast += fast; a.slow += slow; a.late += c.late; a.far += c.far; a.inBand += inBand; a.gp += c.gp || 0; a.gk += c.gk || 0; a.gn += c.gn || 0; a.gv += c.gv || 0;
    a.byGrade[grade].tn += c.tn; a.byGrade[grade].ts += c.ts;
    if (c.sb) mergeSb(a.sb, c.sb);
    if (c.ed) flags.push({ sev: 'warn', type: 'edited', school: schoolId, grade: +grade, admin: enumerator, date, recs: c.ex?.ed || [], text: `${c.ed} test record(s) were opened and changed after they were finished and sent`, hint: 'Finish each assessment on the phone before moving on and do not reopen a finished record. If something needs correcting, tell your RC. HQ makes the change in KoBo and it is logged.', normal: 'finish it once, never reopen it' });
    if (c.sb && c.sb[1] + c.sb[2] + c.sb[3] > 0) { const L = sentLater(Y, canon, { c, n: c.n, date, schoolId, grade, who: enumerator, kind: 'tests' }); flags.push(L ? { sev: 'warn', type: 'latesub', school: schoolId, grade: +grade, admin: enumerator, date, text: L.text, hint: L.hint, normal: L.normal, timing: L.timing, since: L.since } : { sev: 'warn', type: 'latesub', school: schoolId, grade: +grade, admin: enumerator, date, text: `${c.sb[1] + c.sb[2] + c.sb[3]} test record(s) were sent after the test day`, hint: 'Records are sent on the day of the test. Turn on auto send in KoBo Collect so nothing waits on the phone.', since: LATE_CLOCK_FROM }); }
    (work[enumerator] ||= []).push([date, schoolId, +grade, c.av, c.tn ? r1(c.ts / c.tn) : null]);
    { const dpx = (dayPeople[schoolId + '|' + date] ||= { names: new Set(), devs: new Set(), tdevs: new Set(), per: {} }); dpx.names.add(enumerator); dpx.tests = (dpx.tests || 0) + (c.n || 0); }
    for (const [dv, cnt] of Object.entries(c.dv || {})) { noteDev(dv, enumerator, schoolId, date, cnt, true); notePersonDev(enumerator, dv, date, schoolId, cnt); }
    if (c.ex?.ap?.length && enumerator) { const L = (apEx[enumerator] ||= []); for (const e of c.ex.ap) L.push([date, schoolId, +grade, ...e]); }
    if (c.ex?.mm?.length && enumerator) { const L = (mmEx[enumerator] ||= []); for (const e of c.ex.mm) L.push([date, schoolId, +grade, ...e]); }
    const dm = ((dayMap[enumerator] ||= {})[date] ||= { s: new Set(), n: 0, h0: 99, h1: -1, tn: 0, ts: 0, fast: 0, slow: 0, late: 0, gp: 0, gk: 0, gn: 0, gv: 0, ar: 0, an: 0 });
    dm.s.add(schoolId); dm.n += c.av; if (c.h0 < dm.h0) dm.h0 = c.h0; if (c.h1 > dm.h1) dm.h1 = c.h1;
    dm.tn += c.tn; dm.ts += c.ts; dm.fast += fast; dm.slow += slow; dm.late += c.late; dm.gp += c.gp || 0; dm.gk += c.gk || 0; dm.gn += c.gn || 0; dm.gv += c.gv || 0; dm.ar += c.ap ? c.ap[0] : 0; dm.an += c.ap ? c.ap[1] : 0;
    { const sg = schools[schoolId]; sg.gp = (sg.gp || 0) + (c.gp || 0); sg.gk = (sg.gk || 0) + (c.gk || 0); sg.gn = (sg.gn || 0) + (c.gn || 0); sg.gv = (sg.gv || 0) + (c.gv || 0); sg.rec = (sg.rec || 0) + (c.n || 0); }
    for (const [pk, pv] of Object.entries(c.ps)) { const dom = pk[0], gg = pk[1]; const slot = sc.res[gg] && sc.res[gg][dom]; if (slot) { slot[0] += pv[0]; slot[1] += pv[1]; } } // results by grade and subject (HQ only downstream)
    let zero = 0;
    for (const v of Object.values(c.st)) zero += v[2];
    a.zero += zero;

    if (fast >= 3) flags.push({ sev: 'bad', type: 'fast', recs: (c.ex.lo || []).filter((e) => e[2] < b.p3), normal: `${r1(b.p3)}-${Math.round(b.p99)} min`, school: schoolId, grade: +grade, admin: enumerator, date, text: `${fast} tests under ${r1(b.p3)} min in Grade ${grade}`, hint: 'Ask for a re-test of the fastest pupils.' });
    if (slow >= 3) flags.push({ sev: 'warn', type: 'slow', recs: (c.ex.hi || []).filter((e) => e[2] > b.p99), normal: `${r1(b.p3)}-${Math.round(b.p99)} min`, school: schoolId, grade: +grade, admin: enumerator, date, text: `${slow} tests over ${Math.round(b.p99)} min in Grade ${grade}`, hint: 'Check the pupil was not left waiting mid-test.' });
    if (c.late >= 2) flags.push({ sev: 'warn', type: 'window', recs: c.ex.late || [], normal: '07:00-14:00', school: schoolId, grade: +grade, admin: enumerator, date, text: `${c.late} tests started outside 07:00-14:00`, hint: 'Confirm the real test time with the team.' });
    if (c.far >= 1) flags.push({ sev: 'warn', type: 'gps', recs: c.ex.far || [], normal: 'within 500 m', school: schoolId, grade: +grade, admin: enumerator, date, text: `${c.far} test(s) recorded far from the school`, hint: 'Check the GPS reading and where the test took place.' });
  }

  // sampling checks (random-number list, duplicates, attendance mismatch)
  for (const [sgk, sg0] of Object.entries(Y.sg)) {
    const sg = { ...sg0, enum: canon(sg0.enum), devWho: canon(sg0.devWho), rn: uniqueRn(sg0.rn).map((e) => { const p = e.split('~'); p[1] = canon(p[1]); return p.join('~'); }) };
    integrity.repeated_entries += (sg0.rn || []).length - sg.rn.length; // repeats of the same KoBo record that were ignored (should stay 0)
    const [schoolId, grade] = sgk.split('|');
    const sc = schools[schoolId];
    if (!sc) continue;
    if (sg.att !== null) sc.g[grade].att = sg.att;
    if (sg.ed) flags.push({ sev: 'warn', type: 'edited', school: schoolId, grade: +grade, admin: sg.enum || '', date: sg.date, recs: (sg.edr || []).map((id) => ['', '', null, '', '', id]), text: `The sampling form (${sg.ed} record${sg.ed > 1 ? 's' : ''}) was opened and changed after it was finished and sent`, hint: 'Finish each form on the phone before moving on and do not reopen a finished record. If something needs correcting, tell your RC. HQ makes the change in KoBo and it is logged.', normal: 'finish it once, never reopen it' });
    if (sg.dev && sg.date) noteDev(sg.dev, sg.devWho || sg.enum || '', schoolId, sg.date, 1);
    if (sg.enum) { adminOf(sg.enum).samp += 1; if (sg.date) { const da = (sc.dayAdmins[sg.date] ||= []); if (!da.includes(sg.enum)) da.push(sg.enum); } }
    if (sg.sb && sg.enum) mergeSb(adminOf(sg.enum).sbs, sg.sb);
    if (sg.sb && sg.enum && sg.sb[1] + sg.sb[2] + sg.sb[3] > 0) { const L = sg.date && sg.sub ? sentLater(Y, canon, { c: { sb: sg.sb, sub: sg.sub }, n: 1, date: sg.date, schoolId, grade, who: sg.enum, kind: 'form' }) : null; flags.push(L ? { sev: 'warn', type: 'latesub', school: schoolId, grade: +grade, admin: sg.enum, date: sg.date || '', text: L.text, hint: L.hint, normal: L.normal, timing: L.timing, since: L.since } : { sev: 'warn', type: 'latesub', school: schoolId, grade: +grade, admin: sg.enum, date: sg.date || '', text: 'The sampling form was sent after the day of the visit', hint: 'Records are sent on the day of the visit. Turn on auto send in KoBo Collect so nothing waits on the phone.', since: LATE_CLOCK_FROM }); }
    const seen = new Map();
    let notList = 0;
    const byAdmin = {};
    const offRecs = [];
    for (const entry of sg.rn) {
      const [n, who, sid, kid] = entry.split('~');
      const k = +n;
      seen.set(k, (seen.get(k) || 0) + 1);
      if (sg.list && sg.list.length) {
        // the form can draw the same number twice and the tester takes the next pupil, so one either side is allowed
        const ok = sg.list.includes(k) || sg.list.includes(k - 1) || sg.list.includes(k + 1);
        const a = adminOf(who);
        a.listChecked += 1;
        if (!ok) { notList += 1; a.notList += 1; byAdmin[who] = (byAdmin[who] || 0) + 1; offRecs.push([sid || '', k, '', '', '', kid ? +kid : '']); }
      }
    }
    const dupNums = [...seen.entries()].filter(([, v]) => v > 1).map(([k]) => k);
    const dups = dupNums.length;
    if (dups) { // one flag for each person whose record is one of the repeats, so each answers for their own record
      const drec = sg.rn.filter((e) => dupNums.includes(+e.split('~')[0])); const who = [...new Set(drec.map((e) => e.split('~')[1]).filter(Boolean))];
      for (const person of (who.length ? who : [sc.admins[0] || ''])) {
        const mineRecs = drec.filter((e) => !person || e.split('~')[1] === person); const nums = new Set(mineRecs.map((e) => +e.split('~')[0]));
        const withOthers = who.filter((x) => x !== person);
        flags.push({ sev: 'bad', type: 'dup', recs: drec.filter((e) => nums.has(+e.split('~')[0])).slice(0, 10).map((e) => { const p = e.split('~'); return [p[2] || '', +p[0], '', '', '', p[3] ? +p[3] : '']; }), normal: 'each pupil number once', school: schoolId, grade: +grade, admin: person, date: sc.dates.slice(-1)[0], text: `${nums.size} pupil number(s) tested twice in Grade ${grade}${withOthers.length ? ' (the same pupil number was also tested by ' + withOthers.join(' and ') + ')' : ''}`, hint: 'Look for a repeated pupil.' });
      }
    }
    if (hasSampling && notList >= 3) flags.push({ sev: 'warn', type: 'notlist', recs: offRecs.slice(0, 10), normal: 'drawn numbers: ' + (sg.list || []).slice(0, 20).join(', '), school: schoolId, grade: +grade, admin: Object.keys(byAdmin)[0] || '', date: sc.dates.slice(-1)[0], text: `${notList} pupil(s) not on the sampling list in Grade ${grade}`, hint: 'The pupil was not drawn by the app. Replace or explain.' });
  }

  // visits off the calendar, with the reason the forms collected
  const REASON_TEXT = { rain: 'rain or flooded road', transport: 'transport problem', school_closed: 'school closed or exams', permit: 'permit or notice not ready', illness: 'staff illness', team: 'team change', approved: 'calendar changed and approved by HQ', other: 'other' };
  for (const [sgk, sg] of Object.entries(Y.sg)) {
    if (!sg.cal) continue;
    const [schoolId, grade] = sgk.split('|'); const sc = schools[schoolId]; if (!sc) continue;
    const why = sg.cal.reason === 'other' ? 'other: ' + (sg.cal.other || 'no detail') : REASON_TEXT[sg.cal.reason] || 'no reason given';
    const unapproved = sg.cal.approved === 'no';
    flags.push({ sev: unapproved || !sg.cal.reason ? 'bad' : 'warn', type: 'offcal', school: schoolId, grade: +grade, admin: sg.enum || '', date: sg.date || '', text: sg.cal.status === 'none' ? `Sampled a school that is not in the calendar. Reason: ${why}` : `Planned for ${sg.cal.planned}, sampled on ${sg.date}. Reason: ${why}${unapproved ? '. Not yet approved by HQ' : ''}`, hint: 'Check that the coordinator updated the calendar and HQ approved the change.', normal: sg.cal.planned ? 'planned ' + sg.cal.planned : 'not in calendar' });
  }
  for (const [key, c] of Object.entries(Y.cells)) {
    if (!c.cal) continue;
    const [date, schoolId, grade, enumRaw2] = key.split('|'); const enumerator = canon(enumRaw2); if (!schools[schoolId]) continue;
    const unanswered = c.cal.n - c.cal.a - c.cal.b - c.cal.c;
    if (!c.cal.c && !unanswered) continue; // every test was explained by an accepted answer (updated calendar, or finishing a previous day)
    const ans = `${c.cal.a} calendar updated and approved, ${c.cal.b} finishing pupils left from a previous day, ${c.cal.c} other${c.cal.other[0] ? ' (' + c.cal.other[0] + ')' : ''}${unanswered ? ', ' + unanswered + ' no answer' : ''}`;
    flags.push({ sev: unanswered ? 'bad' : 'warn', type: 'offcal', school: schoolId, grade: +grade, admin: enumerator, date, text: `${c.cal.n} test(s) on a day other than the planned ${c.cal.planned || 'date'}. Answer: ${ans}`, hint: 'Confirm the reason with the test admin.', normal: c.cal.planned ? 'planned ' + c.cal.planned : 'not in calendar' });
  }

  // school-level status
  const regions = {};
  for (const r of RLIST) regions[r] = { region: r, schools: [], planned: 0 };
  let nSchoolsDone = 0;
  for (const sc of Object.values(schools)) {
    const reg = regions[sc.region];
    const tpg = targetPerGrade(sc.region);
    let allDone = true;
    for (const g of [1, 2, 3]) {
      const G = sc.g[g];
      G.target = G.att !== null && G.att !== undefined ? Math.min(tpg, G.att) : tpg;
      G.done = G.av >= G.target && G.av > 0;
      if (!G.done) allDone = false;
    }
    sc.started = sc.dates.length > 0;
    sc.done = allDone;
    sc.dates.sort();
    sc.first = sc.dates[0] || null;
    sc.last = sc.dates[sc.dates.length - 1] || null;
    sc.maxTeam = Math.max(0, ...sc.dates.map((d) => (visitTeam[sc.id + '|' + d] || new Set()).size));
    sc.tf = (Y.tf[sc.id] || {}).n || 0;
    if (Y.tf[sc.id]) { const { last, ...tch } = Y.tf[sc.id]; sc.tch = tch; }
    if (sc.done) nSchoolsDone += 1;
    for (const g of [1, 2, 3]) {
      const G = sc.g[g];
      if (G.av > G.target && G.target > 0) flags.push({ sev: 'warn', type: 'over', school: sc.id, grade: g, admin: gradeTesters(sc, g) || sc.admins[0] || '', date: sc.last, text: `Grade ${g}: ${G.av} tested, target ${G.target}`, hint: 'More pupils than the sample. Check for extras.' });
      if (sc.started && sc.last < today && !G.done && G.n > 0) flags.push({ sev: 'warn', type: 'short', school: sc.id, grade: g, admin: gradeTesters(sc, g) || sc.admins[0] || '', date: sc.last, text: `Grade ${g}: ${G.av} of ${G.target} tested, visit already ended`, hint: 'Use the replacement list or revisit.' });
      if (hasSampling && G.n > 0 && G.att === null) flags.push({ sev: 'warn', type: 'nosample', school: sc.id, grade: g, admin: gradeTesters(sc, g) || sc.admins[0] || '', date: sc.last, text: `Grade ${g}: pupils tested but no sampling record found`, hint: 'The sampling form may not have been submitted.' });
    }
    reg.schools.push(sc.id);
  }

  // ---- people and phones: who was physically at the school ----
  const devCode = (d) => { let h = 2166136261; for (let i = 0; i < d.length; i++) { h ^= d.charCodeAt(i); h = Math.imul(h, 16777619); } return 'D-' + (h >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 6); };
  for (const [key, dp] of Object.entries(dayPeople)) {
    const [schoolId, date] = key.split('|'); const sc = schools[schoolId]; if (!sc) continue;
    sc.people = sc.people || {};
    sc.people[date] = [dp.names.size, dp.devs.size, Object.values(dp.per).sort((a, b) => b - a)];
    // team size is judged from the phones that sent tests and how many tests each sent, not from a fixed number of people
    { const phones = dp.tdevs.size || dp.devs.size; const people = Math.max(dp.names.size, phones); const loads = Object.values(dp.per); const top = loads.length ? Math.max(...loads) : 0; const total = loads.reduce((a, b) => a + b, 0);
      // A visit normally has at least 3 people (the RC or ARC and two volunteers), but this is a guide, not a block: fewer is accepted with a reason. Pilot schools normally have more, so they are not checked.
      if (sc.arm !== 'Pilot' && dp.tests > 0) {
        if (people < 3) flags.push({ sev: 'warn', type: 'team', school: schoolId, admin: [...dp.names][0] || '', date, text: `Only ${people} ${people === 1 ? 'person' : 'people'} recorded at this school on this day (${phones || 'no'} phone${phones === 1 ? '' : 's'} sent tests)`, hint: 'A visit normally has at least 3 people: the RC or ARC and two volunteers. Fewer can be fine, for example at a small school. Say what happened.', normal: 'at least 3 people, flexible' });
        else if (phones > 6 || top > 45) flags.push({ sev: 'warn', type: 'team', school: schoolId, admin: [...dp.names][0] || '', date, text: phones > 6 ? `${phones} phones sent records from this school on one day` : `One phone sent ${top} tests on one day (${total} tests from ${phones} phone${phones === 1 ? '' : 's'})`, hint: 'More than 6 phones, or one phone sending more than 45 tests in a day, is unusual. Check who was at the school.', normal: 'up to 6 phones, no phone above 45 tests a day' });
      } }    // only when the TEST records carry phone IDs: sampling phones alone say nothing about how many people tested
    if (dp.tdevs.size && dp.tdevs.size < dp.names.size) flags.push({ sev: 'warn', type: 'headcount', school: schoolId, admin: [...dp.names].join(', '), date, text: `${dp.names.size} test admins recorded by name but only ${dp.tdevs.size} phone(s) sent tests`, hint: 'Someone may have used another person\'s phone or name. Confirm who was at the school.', normal: 'one phone per test admin' });
  }
  for (const [key, names] of Object.entries(dayDev)) {
    const [date, dev, schoolId] = key.split('|'); if (!schools[schoolId]) continue;
    // (more than one name on a phone is now judged for the whole day in analyseDay: type devpeople)
    const ownerId = owners[dev];
    if (ownerId != null) for (const nm of names) { const st = staffForKoboName(nm); if (st && st.id !== ownerId) { const own = STAFF.find((x) => x.id === ownerId); flags.push({ sev: 'bad', type: 'devowner', school: schoolId, admin: nm, date, text: `${nm} submitted from the phone registered to ${own ? own.name : 'another person'} (${devCode(dev)})`, hint: 'Check whether the phone was lent or the wrong name was chosen.', normal: 'own phone' }); } }
  }
  const tlDates = Object.keys(Y.tl || {}).sort();
  for (const d of tlDates) for (const f of analyseDay(d, Y.tl[d].map((e) => { const x = e.slice(); x[5] = canon(x[5]); return x; }))) if (schools[f.school]) flags.push(f);
  const devices = Object.entries(devReg).map(([dev, r]) => {
    const top = Object.entries(r.names).sort((a, b) => b[1] - a[1]);
    const share = top.length ? top[0][1] / r.n : 0;
    const sugg = top.length && r.n >= 5 && share >= 0.7 ? staffForKoboName(top[0][0]) : null;
    return { code: devCode(dev), raw: dev, tests: r.n, days: r.days.size, schools: r.schools.size, names: top.slice(0, 4).map(([n, c]) => [n, c]), suggested: sugg ? sugg.id : null, owner: owners[dev] ?? null, mixed: top.length > 1 && share < 0.9 };
  });

  // admins -> scores
  for (const [nm, n] of Object.entries(Y.tfp || {})) adminOf(canon(nm)).tf = (adminOf(canon(nm)).tf || 0) + n; // teacher and baseline forms sent, by person
  const ansBy = summarizeAnswers(Y.cells, canon);
  // what one person's phones look like over the field days: how many, whether two were used at different schools on the same day, whether a phone is shared
  const phoneProfile = (who) => {
    const devs = pdev[who]; if (!devs) return null;
    const list = Object.entries(devs).sort((x, y) => y[1].n - x[1].n); const total = list.reduce((t, [, d]) => t + d.n, 0);
    let multi = 0, split = 0; const splitDays = []; const prim = [];
    for (const [date, m] of Object.entries(pdevDay[who] || {}).sort()) {
      const ds = Object.entries(m); prim.push(ds.sort((x, y) => y[1].n - x[1].n)[0][0]);
      if (ds.length < 2) continue; multi++;
      let apart = false; // two phones with no school in common on one day: one person cannot be at both
      for (let i = 0; i < ds.length && !apart; i++) for (let j = i + 1; j < ds.length; j++) if (![...ds[i][1].s].some((x) => ds[j][1].s.has(x))) { apart = true; break; }
      if (apart) { split++; if (splitDays.length < 4) splitDays.push(date); }
    }
    let changes = 0; for (let i = 1; i < prim.length; i++) if (prim[i] !== prim[i - 1]) changes++;
    let sharedTests = 0; const withWho = {};
    for (const [dv, d] of list) {
      const u = phoneUsers[dv] || {}; const all = Object.values(u).reduce((t, x) => t + x, 0); const others = all - (u[who] || 0);
      if (others > 0 && others / all >= 0.1) { sharedTests += d.n; for (const [o, n] of Object.entries(u)) if (o !== who && n >= 2) withWho[o] = (withWho[o] || 0) + n; }
    }
    return { n: list.length, tests: total, top: list.slice(0, 3).map(([dv, d]) => [devCodeOf(dv), d.n, d.days.size, d.schools.size]), multi, split, split_days: splitDays, changes, shared_pct: total ? r1((100 * sharedTests) / total) : 0, with: Object.entries(withWho).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([o]) => o) };
  };
  const adminList = Object.values(admins).map((a) => {
    const avgAll = a.tn ? a.ts / a.tn : null;
    const tooFastShare = a.tn ? a.fast / a.tn : 0;
    const inBandShare = a.tn ? a.inBand / a.tn : 1;
    const listShare = a.listChecked ? 1 - a.notList / a.listChecked : 1;
    const cleanShare = a.n ? 1 - Math.min(1, (a.late + a.far) / a.n) : 1;
    const quality = a.n >= 5 ? Math.round(100 * (0.45 * inBandShare + 0.25 * listShare + 0.2 * cleanShare + 0.1 * (a.n ? 1 : 0))) : null;
    return {
      name: a.name,
      staff_id: a.staff ? a.staff.id : null,
      role: a.staff ? a.staff.role : 'unlisted',
      region: a.staff ? a.staff.region : null,
      position: a.staff ? a.staff.position : null,
      tested: a.tn, avg_min: avgAll ? r1(avgAll) : null, days: a.days.size, schools: a.schools.size,
      fast: a.fast, slow: a.slow, late: a.late, far: a.far, not_list: a.notList, zero: a.zero, records: a.n, gp: a.gp, gk: a.gk, gn: a.gn, gv: a.gv,
      by_grade: Object.fromEntries([1, 2, 3].map((g) => [g, a.byGrade[g].tn ? r1(a.byGrade[g].ts / a.byGrade[g].tn) : null])),
      by_grade_n: Object.fromEntries([1, 2, 3].map((g) => [g, a.byGrade[g].tn])),
      quality, fast_share: pct(a.fast, a.tn),
      samp: a.samp, tf: a.tf, sub: subStats(a.sb), subs: subStats(a.sbs), sub_all: subStats(sumSb(a.sb, a.sbs)),
    };
  });

  // Behaviour patterns (answers, phones) are kept apart from the admin rows and day rows that field staff can see. Only the HQ Team patterns page reads this.
  const extra = {};
  for (const a of adminList) {
    const A = ansBy[a.name], ph = phoneProfile(a.name); if (!A && !ph) continue;
    const ad = {}; for (const [d, v] of Object.entries(dayMap[a.name] || {})) if (v.ar) ad[d] = [v.ar, v.an];
    extra[a.name] = {
      ans: A ? (({ days: _d, var: _v, ...rest }) => ({ ...rest, exp: r1(rest.exp), ex: (apEx[a.name] || []).sort((x, y) => (x[0] < y[0] ? 1 : -1)).slice(0, 12), mmx: (mmEx[a.name] || []).sort((x, y) => (x[0] < y[0] ? 1 : -1)).slice(0, 8) }))(A) : null,
      ph, ad,
    };
  }

  // regions
  const days = Object.keys(daily).sort();
  for (const R of RLIST) {
    const reg = regions[R];
    const ss = reg.schools.map((id) => schools[id]);
    reg.total = ss.length;
    reg.done = ss.filter((s) => s.done).length;
    reg.started = ss.filter((s) => s.started).length;
    reg.tested = ss.reduce((a, s) => a + s.g[1].av + s.g[2].av + s.g[3].av, 0);
    reg.target = ss.reduce((a, s) => a + s.g[1].target + s.g[2].target + s.g[3].target, 0);
    reg.series = days.map((d) => [d, (daily[d] || {})[R] || 0]).filter(([, v]) => v > 0);
    // school completion dates for pace
    const doneDates = ss.filter((s) => s.done && s.last).map((s) => s.last).sort();
    const perDay = {};
    for (const d of doneDates) perDay[d] = (perDay[d] || 0) + 1;
    const fieldDays = Object.keys(perDay).sort().slice(-5);
    const pace = fieldDays.length ? fieldDays.reduce((a, d) => a + perDay[d], 0) / fieldDays.length : 0;
    reg.pace = r1(pace);
    const remaining = reg.total - reg.done;
    if (remaining <= 0) reg.projected = 'done';
    else if (pace > 0) reg.projected = addWorkingDays(today, Math.ceil(remaining / pace));
    else reg.projected = null;
    reg.behind = reg.projected && reg.projected !== 'done' && reg.projected > FIELD_END;
    reg.flags_open = flags.filter((f) => UNI[f.school]?.region === R).length;
  }

  const nat = {
    schools: Object.keys(schools).length, done: nSchoolsDone, started: Object.values(schools).filter((s) => s.started).length,
    tested: Object.values(regions).reduce((a, r) => a + r.tested, 0), target: Object.values(regions).reduce((a, r) => a + r.target, 0),
    records: Y.n, flags: flags.length, series: days.map((d) => [d, Object.values(daily[d]).reduce((a, b) => a + b, 0)]),
  };
  const remainingAll = nat.schools - nat.done;
  const paceAll = Object.values(regions).reduce((a, r) => a + r.pace, 0);
  nat.pace = r1(paceAll);
  nat.projected = remainingAll <= 0 ? 'done' : paceAll > 0 ? addWorkingDays(today, Math.ceil(remainingAll / paceAll)) : null;

  // how many pupil records each check touches (0 for checks about a school or a phone rather than records); used by the clean rate
  for (const f of flags) {
    if (['fast', 'slow', 'window', 'gps', 'edited', 'latesub'].includes(f.type)) f.n = cellN[`${f.date}|${f.school}|${f.grade}|${f.admin}`] || 0;
    else if (f.type === 'dup') f.n = (f.recs || []).length || 1; else if (f.type === 'notlist') f.n = parseInt(f.text, 10) || 1; else f.n = 0;
  }
  return { year, integrity, as_of: new Date().toISOString(), today, bands, devices, extra, tl_dates: tlDates, national: nat, regions, schools, admins: adminList, flags: flags.slice(0, 1500), days: Object.fromEntries(Object.entries(dayMap).map(([who, m]) => [who, Object.entries(m).sort().map(([d, v]) => [d, v.s.size, v.n, v.h0 === 99 ? null : v.h0, v.h1 < 0 ? null : v.h1, v.tn, Math.round(v.ts * 10) / 10, v.fast, v.slow, v.late, v.gp, v.gk, v.gn, v.gv])])), work: Object.fromEntries(Object.entries(work).map(([k, v]) => [k, v.sort((x, y) => (x[0] < y[0] ? 1 : -1)).slice(0, 80)])) };
}

export const staffRoster = () => STAFF;
export { workingDaysBetween, isWorkingDay };
