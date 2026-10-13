// Turns the dashboard's stored year (per school and grade pass counts, test-day attendance, teacher counts)
// into input for the payment engine, and builds the school-level view for the Payments page (HQ only).
// Payees are not known here (no names, no bank details): per-teacher figures are school averages.
import { SKILLS_BY_GRADE } from './aggregate.js';
import { SCHOOL_BY_ID, isPracticeSchool } from './config.js';
import { RULES, priceTable, cellPayments, infraWinners, SKILLS } from './payments.js';

const PS_KEY = {}; // engine skill -> key in the stored pass counts
for (const g of [1, 2, 3]) for (const dom of ['reading', 'arithmetic']) for (const [field, label] of SKILLS_BY_GRADE[g][dom]) PS_KEY[field.replace('_g_', '_')] = `${dom[0]}${g}:${label}`;

export function inputFromYear(Y) {
  const per = {}; // school|grade -> { skill: [pass, n] }
  for (const [key, c] of Object.entries(Y.cells || {})) {
    const [, school, grade] = key.split('|'); const a = (per[`${school}|${grade}`] ||= {});
    for (const [k, v] of Object.entries(c.ps || {})) { const x = (a[k] ||= [0, 0]); x[0] += v[0]; x[1] += v[1]; }
  }
  const schools = [];
  for (const s of Object.values(SCHOOL_BY_ID)) {
    if (isPracticeSchool(s.id)) continue;
    const grades = {};
    for (const g of [1, 2, 3]) {
      const sg = Y.sg?.[`${s.id}|${g}`]; const ps = per[`${s.id}|${g}`]; if (!ps && !sg) continue;
      const skills = {}, n = {}; let tested = 0;
      for (const skill of SKILLS[g].kis.concat(SKILLS[g].math)) { const v = ps?.[PS_KEY[skill]] || [0, 0]; skills[skill] = v[0]; n[skill] = v[1]; tested = Math.max(tested, v[1]); }
      grades[g] = { pop: sg?.att ?? 0, tested, skills, n, has_attendance: sg?.att != null };
    }
    schools.push({ id: s.id, name: s.name, arm: s.arm, region: s.region, lga: s.lga, grades });
  }
  return { schools };
}

// One row per school for the page: projected payment per grade and subject, teachers sharing, and averages per teacher and head teacher.
export function schoolRows(input, Y, rules = RULES) {
  const table = priceTable(input.schools, rules); const cells = cellPayments(input.schools, table); const by = new Map();
  for (const c of cells) (by.get(c.school) || by.set(c.school, []).get(c.school)).push(c);
  const rows = [];
  for (const s of input.schools.filter((x) => x.arm !== 'Control')) {
    const cs = by.get(s.id) || []; const tf = Y.tf?.[s.id]; let total = 0; const cellOut = []; let missingTeach = 0;
    for (const c of cs) { const k = tf ? tf.teach?.[c.grade]?.[c.subject === 'kis' ? 'r' : 'a'] || 0 : null; total += c.amount; if (k === 0 || k === null) missingTeach += c.amount > 0 ? 1 : 0; cellOut.push({ grade: c.grade, subject: c.subject, amount: Math.round(c.amount), teachers: k, each: k ? Math.round(c.amount / k) : null, passes: Math.round(c.projected_passes * 10) / 10, pupils: c.pupils, tested: c.tested }); }
    const heads = tf?.head || 0; const pot = rules.ht_rate * total;
    let pass = 0, tests = 0; for (const g of [1, 2, 3]) { const c = s.grades[g]; if (!c) continue; for (const k of SKILLS[g].kis.concat(SKILLS[g].math)) { pass += c.skills[k] || 0; tests += c.n?.[k] ?? c.tested ?? 0; } }
    const gradesOk = [1, 2, 3].filter((g) => s.grades[g]?.has_attendance && s.grades[g].tested > 0).length;
    rows.push({ id: s.id, name: s.name, region: s.region, lga: s.lga, arm: s.arm, total: Math.round(total), ht_pot: Math.round(pot), head_teachers: heads, ht_each: heads ? Math.round(pot / heads) : null, pass_rate: tests ? pass / tests : null, grades_ready: gradesOk, teacher_data: Boolean(tf), cells_without_teacher: tf ? cellOut.filter((c) => c.teachers === 0 && c.amount > 0).length : null, cells: cellOut });
  }
  return { table, cells, rows };
}

export function codFromYear(Y, previousWinners = [], rules = RULES) {
  const input = inputFromYear(Y); const { table, cells, rows } = schoolRows(input, Y, rules);
  const infra = infraWinners(input.schools, previousWinners, rules);
  const regions = {}; for (const r of rows) { const x = (regions[r.region] ||= { region: r.region, schools: 0, ready: 0, total: 0, ht_pot: 0 }); x.schools++; x.total += r.total; x.ht_pot += r.ht_pot; if (r.grades_ready === 3) x.ready++; }
  const readyAll = rows.filter((r) => r.grades_ready === 3).length; const sum = cells.reduce((a, c) => a + c.amount, 0);
  const checks = [
    { name: 'The whole teacher budget is allocated to cells', ok: Math.abs(sum - table.net) < 1, detail: `${Math.round(sum).toLocaleString('en-GB')} of ${Math.round(table.net).toLocaleString('en-GB')}` },
    { name: 'Every skill has passes to price', ok: table.rows.every((r) => r.price_per_pass !== null), detail: table.rows.filter((r) => r.price_per_pass === null).map((r) => r.skill).join(', ') || 'all 24 priced' },
    { name: 'Test-day attendance and tests for all 3 grades', ok: readyAll === rows.length, detail: `${readyAll} of ${rows.length} schools complete` },
    { name: 'Teacher data for every school', ok: rows.every((r) => r.teacher_data), detail: `${rows.filter((r) => r.teacher_data).length} of ${rows.length} schools` },
    { name: 'Every grade and subject has a teacher', ok: rows.every((r) => !r.cells_without_teacher), detail: `${rows.reduce((a, r) => a + (r.cells_without_teacher || 0), 0)} grade-subject cells without a teacher` },
    { name: 'Every school has a head teacher', ok: rows.every((r) => r.head_teachers > 0), detail: `${rows.filter((r) => !r.head_teachers).length} schools without` },
    { name: 'No tie for an infrastructure bonus', ok: infra.ties.length === 0, detail: infra.ties.length ? infra.ties.map((x) => x.region).join(', ') : 'none' },
  ];
  return { rules, net: table.net, ht_net: rules.ht_rate * table.net, price_table: table.rows, grade_pop: table.grade_pop, schools: rows, regions: Object.values(regions).sort((a, b) => a.region.localeCompare(b.region)), infra, checks };
}
