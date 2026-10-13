// COD payment engine (HQ only). The same rules as the Stata run (00_MasterPay to 04_B_InfraBonus), written as plain
// functions so they can be checked against Stata and run on live data. It never holds names or bank details:
// payees are identified by a payee number only.
//
// Rules (2025, same in 2026):
//  - Subject teacher budget: TZS 352,000,000 gross, 5% tax, so 334,400,000 net. The whole budget is paid out.
//  - Head teachers: 20% of the total teacher earnings of their school (so 20% of the net teacher budget overall).
//  - Net budget is split over grades by pupils present on test day, then half Kiswahili and half Arithmetic,
//    then equally across the 4 skills of each subject.
//  - School-grade-skill projected passes = sample pass rate x pupils present. Price per pass = skill budget / all projected passes.
//  - Teachers of a grade and subject share that payment equally; head teachers of a school share equally.
//  - Control schools are outside the pool; pilot schools are inside. Infrastructure: top pass rate per region, earlier winners excluded.

export const RULES = { gross_st: 352_000_000, tax: 0.05, ht_rate: 0.20, infra_each: 5_000_000 };
export const SKILLS = {
  1: { kis: ['k1_letters', 'k1_syllables', 'k1_words', 'k1_sentences'], math: ['a1_nr_recog', 'a1_nr_compare', 'a1_addition', 'a1_subtr'] },
  2: { kis: ['k2_words', 'k2_sentences', 'k2_readspeed', 'k2_read_compr'], math: ['a2_nr_compare', 'a2_nr_miss', 'a2_addition', 'a2_subtr'] },
  3: { kis: ['k3_dict', 'k3_words_mean', 'k3_readspeed', 'k3_read_compr'], math: ['a3_nr_miss', 'a3_addition', 'a3_subtr', 'a3_multiply'] },
};
const SUBJECTS = ['kis', 'math'];

// Whole shillings that add up exactly to the target (largest remainder). Ties go to the first in the list, so the result is repeatable.
export function apportion(values, target) {
  const fl = values.map((v) => Math.floor(v + 1e-9)); let left = Math.round(target) - fl.reduce((a, b) => a + b, 0);
  const order = values.map((v, i) => [v - fl[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const out = fl.slice(); for (let k = 0; left > 0 && order.length; k++, left--) out[order[k % order.length][1]]++;
  while (left < 0) { const i = order.length - 1 - ((-left - 1) % order.length); if (out[order[i][1]] > 0) out[order[i][1]]--; left++; }
  return out;
}

// schools: [{ id, arm, region, grades: { '1': { pop, tested, skills: { skillName: passesInSample } } } }]
export function priceTable(schools, rules = RULES) {
  const pool = schools.filter((s) => s.arm !== 'Control');
  const net = (1 - rules.tax) * rules.gross_st;
  const popBy = { 1: 0, 2: 0, 3: 0 }; for (const s of pool) for (const g of [1, 2, 3]) popBy[g] += s.grades[g]?.pop || 0;
  const popAll = popBy[1] + popBy[2] + popBy[3];
  const rows = [];
  for (const g of [1, 2, 3]) {
    const gBudget = popAll ? (net * popBy[g]) / popAll : 0;
    for (const subj of SUBJECTS) for (const skill of SKILLS[g][subj]) {
      let proj = 0; for (const s of pool) { const c = s.grades[g]; const n = c && (c.n?.[skill] ?? c.tested); if (c && n > 0) proj += (c.skills[skill] / n) * c.pop; }
      const budget = gBudget / 2 / SKILLS[g][subj].length;
      rows.push({ grade: g, subject: subj, skill, budget, projected_passes: proj, price_per_pass: proj > 0 ? budget / proj : null });
    }
  }
  return { net, grade_pop: popBy, rows };
}

export function cellPayments(schools, table) {
  const price = Object.fromEntries(table.rows.map((r) => [r.skill, r.price_per_pass]));
  const cells = [];
  for (const s of schools.filter((x) => x.arm !== 'Control')) for (const g of [1, 2, 3]) {
    const c = s.grades[g]; if (!c) continue;
    for (const subj of SUBJECTS) {
      let amount = 0, passes = 0, possible = 0;
      for (const skill of SKILLS[g][subj]) { const n = c.n?.[skill] ?? c.tested; const p = n > 0 ? (c.skills[skill] / n) * c.pop : 0; passes += p; amount += (price[skill] || 0) * p; possible += (price[skill] || 0) * c.pop; }
      cells.push({ school: s.id, region: s.region, grade: g, subject: subj, amount, projected_passes: passes, possible, pupils: c.pop, tested: c.tested });
    }
  }
  return cells;
}

// teachers: [{ id (payee number), school, position (1 head teacher, 2 subject teacher), assign: { '1': { kis: 0|1, math: 0|1 }, ... } }]
export function teacherEarnings(cells, teachers, rules = RULES) {
  const exceptions = []; const net = (1 - rules.tax) * rules.gross_st;
  const by = new Map(); // school|grade|subject -> teacher ids
  const seen = new Set();
  for (const t of teachers) {
    if (seen.has(t.id)) { exceptions.push({ type: 'duplicate_payee', payee: t.id }); continue; } seen.add(t.id);
    for (const g of [1, 2, 3]) for (const subj of SUBJECTS) if (t.assign?.[g]?.[subj]) { const k = `${t.school}|${g}|${subj}`; (by.get(k) || by.set(k, []).get(k)).push(t.id); }
  }
  const earn = new Map(); const school = new Map(); let unpaid = 0; const unpaidCells = [];
  for (const c of cells) {
    const ids = by.get(`${c.school}|${c.grade}|${c.subject}`);
    if (!ids || !ids.length) { unpaid += c.amount; unpaidCells.push({ school: c.school, grade: c.grade, subject: c.subject, amount: c.amount }); continue; }
    for (const id of ids) earn.set(id, (earn.get(id) || 0) + c.amount / ids.length);
    school.set(c.school, (school.get(c.school) || 0) + c.amount);
  }
  if (unpaidCells.length) exceptions.push({ type: 'cells_without_teacher', count: unpaidCells.length, amount: unpaid, cells: unpaidCells });
  const allocated = net - unpaid; // the whole budget is paid out to the teachers assigned
  const ids = [...earn.keys()]; const whole = apportion(ids.map((i) => earn.get(i)), Math.round([...earn.values()].reduce((a, b) => a + b, 0)));
  const teacherPay = Object.fromEntries(ids.map((i, k) => [i, whole[k]]));
  // head teachers: 20% of their school's teacher earnings, shared equally between the head teachers of that school
  const hts = new Map(); for (const t of teachers) if (t.position === 1 && !exceptions.some((e) => e.type === 'duplicate_payee' && e.payee === t.id && false)) (hts.get(t.school) || hts.set(t.school, []).get(t.school)).push(t.id);
  const htRaw = new Map(); let htNoHead = 0; const htNoHeadSchools = [];
  for (const [sid, tot] of school) { const list = [...new Set(hts.get(sid) || [])]; const pot = rules.ht_rate * tot; if (!list.length) { htNoHead += pot; htNoHeadSchools.push({ school: sid, amount: pot }); continue; } for (const h of list) htRaw.set(h, (htRaw.get(h) || 0) + pot / list.length); }
  if (htNoHeadSchools.length) exceptions.push({ type: 'schools_without_head_teacher', count: htNoHeadSchools.length, amount: htNoHead, schools: htNoHeadSchools });
  const hids = [...htRaw.keys()]; const htWhole = apportion(hids.map((i) => htRaw.get(i)), Math.round([...htRaw.values()].reduce((a, b) => a + b, 0)));
  const headPay = Object.fromEntries(hids.map((i, k) => [i, htWhole[k]]));
  return { teacher_pay: teacherPay, head_pay: headPay, unpaid, unpaid_cells: unpaidCells, exceptions, budget_net: net, allocated };
}

// Infrastructure bonus: highest pass rate (passes over all skill tests taken) in each region, earlier winners excluded.
// Ties: more pupils tested wins, then the school id order, and the tie is reported.
export function infraWinners(schools, previousWinners = [], rules = RULES) {
  const prev = new Set(previousWinners); const byRegion = new Map(); const ties = [];
  for (const s of schools.filter((x) => x.arm !== 'Control' && !prev.has(x.id))) {
    let pass = 0, tests = 0, tested = 0; for (const g of [1, 2, 3]) { const c = s.grades[g]; if (!c) continue; pass += SKILLS[g].kis.concat(SKILLS[g].math).reduce((a, k) => a + (c.skills[k] || 0), 0); tests += c.tested * 8; tested += c.tested; }
    if (!tests) continue; (byRegion.get(s.region) || byRegion.set(s.region, []).get(s.region)).push({ school: s.id, region: s.region, rate: pass / tests, tested });
  }
  const winners = [];
  for (const [region, list] of byRegion) {
    list.sort((a, b) => b.rate - a.rate || b.tested - a.tested || (a.school < b.school ? -1 : 1));
    if (list.length > 1 && Math.abs(list[0].rate - list[1].rate) < 1e-12) ties.push({ region, schools: list.filter((x) => Math.abs(x.rate - list[0].rate) < 1e-12).map((x) => x.school) });
    winners.push({ ...list[0], amount: rules.infra_each, runner_up: list[1]?.school || null });
  }
  return { winners, ties };
}

// Everything at once, with the checks that must pass before anything is approved.
export function runCod(input, rules = RULES) {
  const table = priceTable(input.schools, rules); const cells = cellPayments(input.schools, table);
  const t = teacherEarnings(cells, input.teachers || [], rules); const infra = infraWinners(input.schools, input.previous_infra_winners || [], rules);
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const stTotal = sum(t.teacher_pay), htTotal = sum(t.head_pay); const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  add('Teacher budget paid out in full', Math.abs(stTotal - (t.budget_net - t.unpaid)) < 0.5 && t.unpaid < 0.5, `paid ${Math.round(stTotal)} of ${Math.round(t.budget_net)}${t.unpaid >= 0.5 ? `; ${Math.round(t.unpaid)} has no teacher assigned` : ''}`);
  add('Head teachers get 20% of teacher earnings', Math.abs(htTotal - Math.round(rules.ht_rate * stTotal)) <= 1 && !t.exceptions.some((e) => e.type === 'schools_without_head_teacher'), `paid ${Math.round(htTotal)}, expected ${Math.round(rules.ht_rate * stTotal)}`);
  add('Every skill has passes to price', table.rows.every((r) => r.price_per_pass !== null), table.rows.filter((r) => r.price_per_pass === null).map((r) => r.skill).join(', ') || 'all priced');
  add('No payee listed twice', !t.exceptions.some((e) => e.type === 'duplicate_payee'), `${t.exceptions.filter((e) => e.type === 'duplicate_payee').length} repeated`);
  add('No tie for an infrastructure bonus', infra.ties.length === 0, infra.ties.length ? infra.ties.map((x) => x.region).join(', ') : 'none');
  return { table, cells, teacher_pay: t.teacher_pay, head_pay: t.head_pay, exceptions: t.exceptions, infra, checks, totals: { teachers: stTotal, head_teachers: htTotal, infra: infra.winners.length * rules.infra_each, net_teacher_budget: t.budget_net } };
}
