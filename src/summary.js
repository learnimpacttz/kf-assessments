// Turns the raw per-day aggregates into everything the dashboards show:
// school progress, test-admin stats, checks/flags, pace and projected finish.
// Computed once per sync (not per request) and stored; the API only slices it.
import { devCode as devCodeOf, PRACTICE_BY_ID, PRACTICE_REGION, SCHOOL_BY_ID, SCHOOLS_BY_REGION, REGIONS, FIELD_END, DEFAULT_BANDS, targetPerGrade, staffForKoboName, addWorkingDays, workingDaysBetween, isWorkingDay, STAFF } from './config.js';
import { HIST_BUCKETS } from './ingest.js';

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

const hms = (t) => `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`;
const sname = (id) => (SCHOOL_BY_ID[id]?.name || PRACTICE_BY_ID[id]?.name || id).trim();

// What one phone did in one day, in time order. Thresholds are deliberately forgiving: a flag means "look", not "wrong".
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
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length && list[j][1] < list[i][2]; j++) if (list[i][2] - list[j][1] > 60 && !(list[i][6] === 's' && list[j][6] === 's')) over.push([list[i], list[j]]);
    if (over.length) add('devoverlap', 'warn', dev, over.slice(0, 4).flat(), `Phone ${code} recorded ${over.length} pair(s) of tests that overlap in time, for example ${hms(over[0][0][1])}-${hms(over[0][0][2])} and ${hms(over[0][1][1])}-${hms(over[0][1][2])}`, 'One phone cannot run two tests at once. Check whether records were edited or entered twice.', 'one test at a time');
    // 2. the phone appears at different schools within a short time
    const trav = [];
    for (let i = 1; i < list.length; i++) if (list[i][3] !== list[i - 1][3]) { const gap = list[i][1] - list[i - 1][2]; if (gap < 30 * 60) trav.push({ a: list[i - 1], b: list[i], gap }); }
    if (trav.length) { const worst = Math.min(...trav.map((t) => t.gap)); add('devtravel', worst < 10 * 60 ? 'bad' : 'warn', dev, trav.slice(0, 3).flatMap((t) => [t.a, t.b]), `Phone ${code} sent tests from ${sname(trav[0].a[3])} at ${hms(trav[0].a[2])} and from ${sname(trav[0].b[3])} at ${hms(trav[0].b[1])}, ${Math.max(0, Math.round(trav[0].gap / 60))} minute(s) apart${trav.length > 1 ? ` (${trav.length} such moves that day)` : ''}`, 'Schools are rarely this close. Check whether the phone was passed between teams or the school was chosen wrongly.', 'at least 30 min between schools'); }
    // 3. jumping back and forth between grades in the same school
    const sw = {};
    for (let i = 2; i < list.length; i++) { const [p2, p1, c] = [list[i - 2], list[i - 1], list[i]]; if (c[3] === p1[3] && p1[3] === p2[3] && c[4] === p2[4] && c[4] !== p1[4] && c[1] - p2[2] < 30 * 60) (sw[c[3]] ||= []).push([p2, p1, c]); }
    for (const [school, runs] of Object.entries(sw)) if (runs.length >= 2) add('devswitch', 'warn', dev, runs.slice(0, 2).flat(), `Phone ${code} went back and forth between grades ${runs.length} times at ${sname(school)}`, 'Each person usually works one class. Ask who was testing which class.', 'one class at a time');
    // 4. several different names on the phone in quick succession
    const nm = [];
    for (let i = 1; i < list.length; i++) if (list[i][5] && list[i - 1][5] && list[i][5] !== list[i - 1][5] && list[i][1] - list[i - 1][2] < 10 * 60) nm.push([list[i - 1], list[i]]);
    if (nm.length >= 2) add('devnames', 'warn', dev, nm.slice(0, 3).flat(), `Phone ${code} was used under different names ${nm.length} times within minutes: ${[...new Set(nm.flat().map((x) => x[5]))].join(', ')}`, 'Each person should use their own phone and their own name.', 'one name per phone');
  }
  // 5. one person on two phones at the same time
  for (const [who, list] of Object.entries(byName)) {
    const devs = [...new Set(list.map((e) => e[0]))];
    if (devs.length < 2) continue;
    list.sort((a, b) => a[1] - b[1]);
    const clash = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length && list[j][1] < list[i][2] + 120; j++) if (list[i][0] !== list[j][0] && list[i][3] !== undefined) clash.push([list[i], list[j]]);
    if (clash.length) add('namedevs', 'warn', who, clash.slice(0, 3).flat(), `${who} sent tests from ${devs.length} different phones (${devs.map(devCodeOf).join(', ')}) with times that run together`, 'A person normally works with one phone. Check whether someone else used this name.', 'one phone per person');
  }
  return flags;
}

export function phoneDay(events) {
  const phones = {};
  for (const e of events) { const p = (phones[e[0]] ||= { c: devCodeOf(e[0]), names: {}, schools: new Set(), n: 0, first: 1e9, last: 0 }); if (e[5]) p.names[e[5]] = (p.names[e[5]] || 0) + 1; p.schools.add(e[3]); p.n += 1; p.first = Math.min(p.first, e[1]); p.last = Math.max(p.last, e[2]); }
  return Object.values(phones).map((p) => ({ c: p.c, names: Object.entries(p.names).sort((a, b) => b[1] - a[1]).map(([n]) => n), schools: [...p.schools], n: p.n, first: p.first, last: p.last }));
}

export function summarize(Y, { year, bands, today, owners = {}, practice = false }) {
  const UNI = practice ? PRACTICE_BY_ID : SCHOOL_BY_ID; // the schools and regions this run covers
  const RLIST = practice ? [PRACTICE_REGION] : REGIONS;
  const schools = {};
  const admins = {};
  const flags = [];
  const daily = {}; // date -> region -> tests
  const mkSchool = (s) => ({
    id: s.id, name: s.name, region: s.region, lga: s.lga, ward: s.ward, arm: s.arm, mne: s.mne,
    g: { 1: { n: 0, av: 0, att: null }, 2: { n: 0, av: 0, att: null }, 3: { n: 0, av: 0, att: null } },
    dates: [], admins: [], maxTeam: 0, tf: 0, res: { 1: { r: [0, 0], a: [0, 0] }, 2: { r: [0, 0], a: [0, 0] }, 3: { r: [0, 0], a: [0, 0] } }, tch: null, done: false, started: false, last: null, first: null,
  });
  for (const s of Object.values(UNI)) schools[s.id] = mkSchool(s);

  const adminOf = (name) => {
    const a = (admins[name] ||= {
      name, staff: staffForKoboName(name), n: 0, tn: 0, ts: 0, days: new Set(), schools: new Set(),
      fast: 0, slow: 0, late: 0, far: 0, notList: 0, dup: 0, zero: 0, byGrade: { 1: { tn: 0, ts: 0 }, 2: { tn: 0, ts: 0 }, 3: { tn: 0, ts: 0 } },
      inBand: 0, listChecked: 0,
    });
    return a;
  };

  const dayPeople = {}; // school|date -> { names, devs }
  const dayDev = {};    // date|device -> { names, school }
  const devReg = {};    // device -> { names: {name: n}, days, schools, n }
  const noteDev = (dev, who, schoolId, date, n, fromTests = false) => {
    if (!dev) return;
    const dp = (dayPeople[schoolId + '|' + date] ||= { names: new Set(), devs: new Set(), tdevs: new Set() }); dp.devs.add(dev); if (fromTests) dp.tdevs.add(dev); if (who) dp.names.add(who);
    const dd = (dayDev[date + '|' + dev + '|' + schoolId] ||= new Set()); if (who) dd.add(who);
    const r = (devReg[dev] ||= { names: {}, days: new Set(), schools: new Set(), n: 0 });
    if (who) r.names[who] = (r.names[who] || 0) + n; r.days.add(date); r.schools.add(schoolId); r.n += n;
  };
  const dayMap = {}; // admin -> date -> { schools, tested, h0, h1 }
  const work = {}; // admin -> recent rows [date, school, grade, tested, avg_min]
  const hasSampling = Boolean(Y.nsamp);
  const visitTeam = {}; // school|date -> Set(enumerator)
  for (const [key, c] of Object.entries(Y.cells)) {
    const [date, schoolId, grade, enumerator] = key.split('|');
    const sc = schools[schoolId];
    if (!sc) continue; // submissions for a school outside the 325-school list
    sc.g[grade].n += c.n;
    sc.g[grade].av += c.av;
    if (!sc.dates.includes(date)) sc.dates.push(date);
    if (enumerator && !sc.admins.includes(enumerator)) sc.admins.push(enumerator);
    (visitTeam[schoolId + '|' + date] ||= new Set()).add(enumerator);
    const d = ((daily[date] ||= {})[sc.region] = (daily[date][sc.region] || 0) + c.av);
    void d;

    const b = bands[grade];
    const fast = below(c.h, b.p3);
    const slow = above(c.h, b.p99);
    const inBand = c.tn - fast - slow;
    const a = adminOf(enumerator);
    a.n += c.n; a.tn += c.tn; a.ts += c.ts; a.days.add(date); a.schools.add(schoolId);
    a.fast += fast; a.slow += slow; a.late += c.late; a.far += c.far; a.inBand += inBand;
    a.byGrade[grade].tn += c.tn; a.byGrade[grade].ts += c.ts;
    (work[enumerator] ||= []).push([date, schoolId, +grade, c.av, c.tn ? r1(c.ts / c.tn) : null]);
    (dayPeople[schoolId + '|' + date] ||= { names: new Set(), devs: new Set(), tdevs: new Set() }).names.add(enumerator);
    for (const [dv, cnt] of Object.entries(c.dv || {})) noteDev(dv, enumerator, schoolId, date, cnt, true);
    const dm = ((dayMap[enumerator] ||= {})[date] ||= { s: new Set(), n: 0, h0: 99, h1: -1 });
    dm.s.add(schoolId); dm.n += c.av; if (c.h0 < dm.h0) dm.h0 = c.h0; if (c.h1 > dm.h1) dm.h1 = c.h1;
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
  for (const [sgk, sg] of Object.entries(Y.sg)) {
    const [schoolId, grade] = sgk.split('|');
    const sc = schools[schoolId];
    if (!sc) continue;
    if (sg.att !== null) sc.g[grade].att = sg.att;
    if (sg.dev && sg.date) noteDev(sg.dev, sg.devWho || sg.enum || '', schoolId, sg.date, 1);
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
    if (dups) flags.push({ sev: 'bad', type: 'dup', recs: sg.rn.filter((e) => dupNums.includes(+e.split('~')[0])).slice(0, 10).map((e) => { const p = e.split('~'); return [p[2] || '', +p[0], '', '', '', p[3] ? +p[3] : '']; }), normal: 'each pupil number once', school: schoolId, grade: +grade, admin: sc.admins[0] || '', date: sc.dates.slice(-1)[0], text: `${dups} pupil number(s) tested twice in Grade ${grade}`, hint: 'Look for a repeated pupil.' });
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
    const [date, schoolId, grade, enumerator] = key.split('|'); if (!schools[schoolId]) continue;
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
    // team-size rule: every school visited for assessment (any group, with or without M&E); the Dodoma pilot, where the whole team takes part, is exempt
    if (sc.started && sc.arm !== 'Pilot' && (sc.maxTeam < 2 || sc.maxTeam > 6))
      flags.push({ sev: 'warn', type: 'team', school: sc.id, admin: sc.admins[0] || '', date: sc.last, text: `${sc.arm}${sc.mne === 'M&E' ? ' · M&E' : ''} school visited by ${sc.maxTeam} test admin(s)`, hint: 'An assessment visit normally has the RC or ARC and two volunteers (about 3 people). 2 to 6 is accepted.' });
    for (const g of [1, 2, 3]) {
      const G = sc.g[g];
      if (G.av > G.target && G.target > 0) flags.push({ sev: 'warn', type: 'over', school: sc.id, grade: g, admin: sc.admins[0] || '', date: sc.last, text: `Grade ${g}: ${G.av} tested, target ${G.target}`, hint: 'More pupils than the sample. Check for extras.' });
      if (sc.started && sc.last < today && !G.done && G.n > 0) flags.push({ sev: 'warn', type: 'short', school: sc.id, grade: g, admin: sc.admins[0] || '', date: sc.last, text: `Grade ${g}: ${G.av} of ${G.target} tested, visit already ended`, hint: 'Use the replacement list or revisit.' });
      if (hasSampling && G.n > 0 && G.att === null) flags.push({ sev: 'warn', type: 'nosample', school: sc.id, grade: g, admin: sc.admins[0] || '', date: sc.last, text: `Grade ${g}: pupils tested but no sampling record found`, hint: 'The sampling form may not have been submitted.' });
    }
    reg.schools.push(sc.id);
  }

  // ---- people and phones: who was physically at the school ----
  const devCode = (d) => { let h = 2166136261; for (let i = 0; i < d.length; i++) { h ^= d.charCodeAt(i); h = Math.imul(h, 16777619); } return 'D-' + (h >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 6); };
  for (const [key, dp] of Object.entries(dayPeople)) {
    const [schoolId, date] = key.split('|'); const sc = schools[schoolId]; if (!sc) continue;
    sc.people = sc.people || {};
    sc.people[date] = [dp.names.size, dp.devs.size];
    // only when the TEST records carry phone IDs: sampling phones alone say nothing about how many people tested
    if (dp.tdevs.size && dp.tdevs.size < dp.names.size) flags.push({ sev: 'warn', type: 'headcount', school: schoolId, admin: [...dp.names].join(', '), date, text: `${dp.names.size} test admins recorded by name but only ${dp.tdevs.size} phone(s) sent tests`, hint: 'Someone may have used another person\'s phone or name. Confirm who was at the school.', normal: 'one phone per test admin' });
  }
  for (const [key, names] of Object.entries(dayDev)) {
    const [date, dev, schoolId] = key.split('|'); if (!schools[schoolId]) continue;
    if (names.size >= 2) flags.push({ sev: 'warn', type: 'devshare', school: schoolId, admin: [...names].join(' and '), date, text: `One phone (${devCode(dev)}) was used under ${names.size} names on the same day: ${[...names].join(', ')}`, hint: 'Each person should use their own phone. Confirm who tested.', normal: 'one name per phone' });
    const ownerId = owners[dev];
    if (ownerId != null) for (const nm of names) { const st = staffForKoboName(nm); if (st && st.id !== ownerId) { const own = STAFF.find((x) => x.id === ownerId); flags.push({ sev: 'bad', type: 'devowner', school: schoolId, admin: nm, date, text: `${nm} submitted from the phone registered to ${own ? own.name : 'another person'} (${devCode(dev)})`, hint: 'Check whether the phone was lent or the wrong name was chosen.', normal: 'own phone' }); } }
  }
  const tlDates = Object.keys(Y.tl || {}).sort();
  for (const d of tlDates) for (const f of analyseDay(d, Y.tl[d])) if (schools[f.school]) flags.push(f);
  const devices = Object.entries(devReg).map(([dev, r]) => {
    const top = Object.entries(r.names).sort((a, b) => b[1] - a[1]);
    const share = top.length ? top[0][1] / r.n : 0;
    const sugg = top.length && r.n >= 5 && share >= 0.7 ? staffForKoboName(top[0][0]) : null;
    return { code: devCode(dev), raw: dev, tests: r.n, days: r.days.size, schools: r.schools.size, names: top.slice(0, 4).map(([n, c]) => [n, c]), suggested: sugg ? sugg.id : null, owner: owners[dev] ?? null, mixed: top.length > 1 && share < 0.9 };
  });

  // admins -> scores
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
      fast: a.fast, slow: a.slow, late: a.late, far: a.far, not_list: a.notList, zero: a.zero,
      by_grade: Object.fromEntries([1, 2, 3].map((g) => [g, a.byGrade[g].tn ? r1(a.byGrade[g].ts / a.byGrade[g].tn) : null])),
      quality, fast_share: pct(a.fast, a.tn),
    };
  });

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

  return { year, as_of: new Date().toISOString(), today, bands, devices, tl_dates: tlDates, national: nat, regions, schools, admins: adminList, flags: flags.slice(0, 1500), days: Object.fromEntries(Object.entries(dayMap).map(([who, m]) => [who, Object.entries(m).sort().map(([d, v]) => [d, v.s.size, v.n, v.h0 === 99 ? null : v.h0, v.h1 < 0 ? null : v.h1])])), work: Object.fromEntries(Object.entries(work).map(([k, v]) => [k, v.sort((x, y) => (x[0] < y[0] ? 1 : -1)).slice(0, 80)])) };
}

export const staffRoster = () => STAFF;
export { workingDaysBetween, isWorkingDay };
