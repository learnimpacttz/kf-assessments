import fs from 'node:fs';
import { runCod, apportion } from '../src/payments.js';
const F = JSON.parse(fs.readFileSync(process.env.FIX || '/Users/michaelkamukulu/kf-tools/pay/fixture2025.json', 'utf8'));
const r = runCod({ schools: F.schools, teachers: F.teachers, previous_infra_winners: F.previous_infra_winners });
const E = F.expected; let fail = 0; const ok = (name, cond, detail = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' · ' + detail : '')); if (!cond) fail++; };
// 1 cells vs Stata
const mine = Object.fromEntries(r.cells.map((c) => [`${c.school}|${c.grade}|${c.subject}`, c.amount])); let maxd = 0;
for (const c of E.cells) maxd = Math.max(maxd, Math.abs(mine[`${c.school}|${c.grade}|${c.subject}`] - c.amount));
ok('1,590 school-grade-subject payments match Stata', E.cells.length === 1590 && Object.keys(mine).length === 1590 && maxd < 0.5, `largest difference ${maxd.toFixed(3)} TZS`);
// 2 budget exhausted exactly
const st = Object.values(r.teacher_pay).reduce((a, b) => a + b, 0), ht = Object.values(r.head_pay).reduce((a, b) => a + b, 0);
ok('teachers paid exactly 334,400,000', st === 334_400_000, String(st)); ok('head teachers paid exactly 66,880,000', ht === 66_880_000, String(ht));
// 3 per payee vs Stata
let md = 0, miss = 0; for (const [id, v] of Object.entries(E.teacher_earn)) { if (r.teacher_pay[id] === undefined) miss++; else md = Math.max(md, Math.abs(r.teacher_pay[id] - v)); }
ok('1,038 teacher payments match Stata within TZS 15', miss === 0 && Object.keys(r.teacher_pay).length === 1038 && md <= 15, `payees ${Object.keys(r.teacher_pay).length}, missing ${miss}, largest difference ${md}`);
let mh = 0, missh = 0; for (const [id, v] of Object.entries(E.ht_earn)) { if (r.head_pay[id] === undefined) missh++; else mh = Math.max(mh, Math.abs(r.head_pay[id] - v)); }
ok('275 head teacher payments match Stata within TZS 15', missh === 0 && Object.keys(r.head_pay).length === 275 && mh <= 15, `payees ${Object.keys(r.head_pay).length}, missing ${missh}, largest difference ${mh}`);
// 4 infrastructure winners
const w = r.infra.winners.map((x) => x.school).sort(); ok('infrastructure winners match 2025', JSON.stringify(w) === JSON.stringify(E.infra_winners), `${w.length} winners; ties ${r.infra.ties.length}`);
ok('all checks pass', r.checks.every((c) => c.ok), r.checks.filter((c) => !c.ok).map((c) => c.name).join('; '));
// 5 apportion
ok('apportion adds up exactly', apportion([1.5, 2.5, 3.5], 8).reduce((a, b) => a + b, 0) === 8 && apportion([0.2, 0.2, 0.2], 1).reduce((a, b) => a + b, 0) === 1);
// 6 an unassigned grade-subject is reported, not lost silently
const victim = F.teachers.find((t) => t.assign[1].kis); const t2 = F.teachers.map((t) => (t.school === victim.school && t.assign[1].kis ? { ...t, assign: { ...t.assign, 1: { kis: 0, math: t.assign[1].math } } } : t));
const r2 = runCod({ schools: F.schools, teachers: t2, previous_infra_winners: F.previous_infra_winners }); ok('a cell without a teacher is reported, not lost silently', r2.exceptions.some((e) => e.type === 'cells_without_teacher') && !r2.checks[0].ok && r2.unpaid === undefined);
// 7 no minimum payment: a school where nobody passes gets zero, teachers there get zero, and the whole budget is still paid out
const z = JSON.parse(JSON.stringify(F.schools)); const zs = z.find((x) => x.arm !== 'Control' && x.grades[1]); for (const g of Object.values(zs.grades)) for (const k of Object.keys(g.skills)) g.skills[k] = 0;
const r3 = runCod({ schools: z, teachers: F.teachers, previous_infra_winners: F.previous_infra_winners }); const zeroTeachers = F.teachers.filter((t) => t.school === zs.id && t.position === 2).map((t) => r3.teacher_pay[t.id]);
ok('a school with no passes earns zero (no minimum) and the budget is still paid out in full', zeroTeachers.length > 0 && zeroTeachers.every((v) => v === 0) && Object.values(r3.teacher_pay).reduce((a, b) => a + b, 0) === 334_400_000 && Object.values(r3.head_pay).reduce((a, b) => a + b, 0) === 66_880_000);
// 8 infrastructure: one school per region (10 regions plus the Dodoma pilot schools) at TZS 5,000,000
ok('infrastructure: 11 winners (10 regions + Dodoma pilot), TZS 55,000,000', r.infra.winners.length === 11 && r.totals.infra === 55_000_000 && new Set(r.infra.winners.map((w) => w.region)).size === 11);
console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
