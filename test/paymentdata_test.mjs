import fs from 'node:fs';
import { addStudents, emptyYear } from '../src/ingest.js';
import { codFromYear } from '../src/paymentdata.js';
const P = process.env.REC || '/Users/michaelkamukulu/kf-tools/pay/records2025.json'; const F = JSON.parse(fs.readFileSync(process.env.FIX || '/Users/michaelkamukulu/kf-tools/pay/fixture2025.json', 'utf8'));
if (!fs.existsSync(P)) { console.log('fixture missing, skipped'); process.exit(0); }
const R = JSON.parse(fs.readFileSync(P, 'utf8')); const state = { yrs: {} }; addStudents(state, R.records); const Y = state.yrs['2025'];
for (const [id, g] of Object.entries(R.att)) for (const [gr, v] of Object.entries(g)) (Y.sg ||= {})[`${id}|${gr}`] = { att: v };
Y.tf = R.tf;
const out = codFromYear(Y, F.previous_infra_winners);
let fail = 0; const ok = (n, c, d = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? ' · ' + d : '')); if (!c) fail++; };
const mine = {}; for (const s of out.schools) for (const c of s.cells) mine[`${s.id}|${c.grade}|${c.subject}`] = c.amount; let md = 0, miss = 0;
for (const c of F.expected.cells) { const v = mine[`${c.school}|${c.grade}|${c.subject}`]; if (v === undefined) miss++; else md = Math.max(md, Math.abs(v - c.amount)); }
ok('dashboard pass counts give the Stata payments for all 1,590 cells (shown in whole TZS)', miss === 0 && md <= 1, `missing ${miss}, largest difference ${md.toFixed(2)} TZS`);
const tot = out.schools.reduce((a, s) => a + s.total, 0); ok('budget fully allocated (to the shilling, after rounding of 265 schools)', Math.abs(tot - 334_400_000) <= 265, String(tot));
ok('pool is 265 schools (260 treatment + 5 pilot)', out.schools.length === 265, String(out.schools.length));
ok('all checks pass on 2025 data', out.checks.every((c) => c.ok), out.checks.filter((c) => !c.ok).map((c) => c.name + ' (' + c.detail + ')').join('; '));
ok('infrastructure winners match 2025', JSON.stringify(out.infra.winners.map((w) => w.school).sort()) === JSON.stringify(F.expected.infra_winners));
console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
