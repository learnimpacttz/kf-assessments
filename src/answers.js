// Answer patterns: does the result of the first question in a block carry through to every later question?
// A test is made of blocks of 5 graded questions (letters, syllables, words, sentences, number recognition, ...). The form stops a
// block once 3 are correct, so an honest block is either "all correct" or "all wrong", or it is mixed. Pupils who sit between two
// levels give mixed blocks, and a tester who only asks the first question and marks the rest the same way never does.
// Arithmetic also stores the typed answer, and the form warns when the grade chosen disagrees with it, so a grade that still disagrees is counted too.
// Only counts are kept (blocks asked, blocks mixed, tests with no mixed block, grades that disagree). Never the answers, never a pupil.
import { staffForKoboName } from './config.js';

// Slot order is fixed: 0-3 reading blocks, 4-7 arithmetic blocks. Grades 2 and 3 have 3 reading blocks (slot 3 stays empty).
const READ = { 1: [[1, 5], [6, 10], [11, 15], [16, 20]], 2: [[1, 5], [6, 10], [16, 20]], 3: [[1, 5], [6, 10], [16, 20]] };
const ARITH = [[1, 5], [6, 10], [11, 15], [16, 20]];
export const SLOTS = 8;
export const MIN_BLOCK = 3; // a block with fewer than 3 questions asked cannot be mixed in any useful sense
export const MIN_FULL = 6;  // a test counts as "full" when at least 6 blocks were asked

// grade results from one record: { 'k101': 1|0|-99, ... } read from fields whose name ends in k/a + grade + 2 digits, wherever they sit in the form groups
function itemsOf(r, grade) {
  const out = {};
  for (const key in r) {
    const m = /(?:^|\/)([ka])([123])(\d\d)$/.exec(key);
    if (!m || m[2] !== String(grade)) continue;
    const n = Number(m[3]); if (n < 1 || n > 20) continue;
    const v = r[key]; if (v === '' || v === null || v === undefined) continue;
    const x = Number(v); if (!Number.isFinite(x)) continue;
    out[m[1] + n] = x;
  }
  return out;
}
// arithmetic: the typed answer and the answer key, per question number
function entriesOf(r, grade) {
  const ent = {}, key = {};
  for (const k in r) {
    const m = /(?:^|\/)a([123])(\d\d)_(entry|ans)$/.exec(k);
    if (!m || m[1] !== String(grade)) continue;
    const v = r[k]; if (v === '' || v === null || v === undefined) continue; const x = Number(v); if (!Number.isFinite(x)) continue;
    (m[3] === 'entry' ? ent : key)[Number(m[2])] = x;
  }
  return { ent, key };
}

// -> null when the record has no graded questions, else { asked: [n x 8], mixed: [0|1 x 8], nb, nm, shape }
export function recordPattern(r, grade) {
  const it = itemsOf(r, grade); if (!Object.keys(it).length) return null;
  const asked = new Array(SLOTS).fill(0), mixed = new Array(SLOTS).fill(0);
  let nb = 0, nm = 0, allc = 0, allw = 0;
  const slots = [...(READ[grade] || []).map((b, i) => ['k', b, i]), ...ARITH.map((b, i) => ['a', b, 4 + i])];
  for (const [p, [lo, hi], slot] of slots) {
    let n = 0, c = 0;
    for (let q = lo; q <= hi; q++) { const v = it[p + q]; if (v === undefined) continue; n++; if (v === 1) c++; }
    if (n < MIN_BLOCK) continue;
    const w = n - c; asked[slot] = 1; nb++;
    if (c > 0 && w > 0) { mixed[slot] = 1; nm++; } else if (c === n) allc++; else allw++;
  }
  if (!nb) return null;
  // graded correct but the typed answer is not the key, or graded wrong when it is: the form warns about this, so what is left is worth a look
  let chk = 0, mm = 0; const { ent, key } = entriesOf(r, grade);
  for (const q in ent) { const g = it['a' + Number(q)]; if (g === undefined || key[q] === undefined) continue; chk++; if ((ent[q] === key[q]) !== (g === 1)) mm++; }
  const full = nb >= MIN_FULL;
  return { asked, mixed, nb, nm, full, chk, mm, shape: !full ? 'short' : nm > 0 ? 'mixed' : allc === nb ? 'allc' : allw === nb ? 'allw' : 'nomix' };
}

// per-cell counters: [full tests, full tests with no mixed block, full tests with every block the same result, then asked/mixed for each of the 8 slots]
export const emptyAp = () => new Array(3 + 2 * SLOTS + 2).fill(0); // ... then arithmetic answers checked, and grades that disagree with the typed answer
export function addPattern(ap, p) {
  if (!p) return ap;
  if (p.full) { ap[0]++; if (p.nm === 0) { ap[1]++; if (p.shape === 'allc' || p.shape === 'allw') ap[2]++; } }
  for (let i = 0; i < SLOTS; i++) { ap[3 + 2 * i] += p.asked[i]; ap[4 + 2 * i] += p.mixed[i]; }
  ap[3 + 2 * SLOTS] += p.chk; ap[4 + 2 * SLOTS] += p.mm;
  return ap;
}

const r1 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

// Expected mixed blocks for each person. The base is the share for all testers on the same grade and question block. Where other testers tested the same
// grade at the same school, that base is adjusted for how strong that class was: the others' mixed blocks against what the base would give them, taken over
// all question blocks together (so a few tests are enough), shrunk toward 1 when there is little data and kept within 0.4 to 2.5. A school full of pupils
// who all fail every block therefore does not look like a pattern. Where nobody else tested that grade there, the base alone is used.
// cells: { 'date|school|grade|name': { ap } }.  Returns { name: { recs, nomix, whole, asked, mixed, exp, var, team, ... } }
const K_SHRINK = 10, MIN_OTHERS = 40, F_LO = 0.4, F_HI = 2.5;
export function summarizeAnswers(cells, canon = (n) => n) {
  const nat = {}, grp = {}, own = {};
  const rows = [];
  for (const [key, c] of Object.entries(cells)) {
    if (!c.ap) continue; const [date, school, grade, raw] = key.split('|'); const name = canon(raw); if (!name) continue;
    rows.push([date, school, grade, name, c.ap]);
    const g = (grp[school + '|' + grade] ||= Array.from({ length: SLOTS }, () => [0, 0])), mine = (own[name + '|' + school + '|' + grade] ||= Array.from({ length: SLOTS }, () => [0, 0]));
    for (let i = 0; i < SLOTS; i++) {
      const a = c.ap[3 + 2 * i], m = c.ap[4 + 2 * i]; if (!a) continue;
      const nt = (nat[grade + '|' + i] ||= [0, 0]); nt[0] += a; nt[1] += m;
      g[i][0] += a; g[i][1] += m; mine[i][0] += a; mine[i][1] += m;
    }
  }
  const pNat = (grade, i) => { const t = nat[grade + '|' + i]; return t && t[0] ? t[1] / t[0] : 0; };
  const out = {};
  for (const [date, , , name, ap] of rows) {
    const o = (out[name] ||= { recs: 0, nomix: 0, whole: 0, asked: 0, mixed: 0, exp: 0, var: 0, team: 0, mchk: 0, mm: 0, days: {} });
    o.recs += ap[0]; o.nomix += ap[1]; o.whole += ap[2]; o.mchk += ap[3 + 2 * SLOTS]; o.mm += ap[4 + 2 * SLOTS];
    const d = (o.days[date] ||= [0, 0, 0, 0, 0]); d[0] += ap[0]; d[1] += ap[1]; d[2] += ap[2];
    for (let i = 0; i < SLOTS; i++) { d[3] += ap[3 + 2 * i]; d[4] += ap[4 + 2 * i]; }
  }
  // blocks are counted once per person, school and grade, not once per day
  for (const [ok, slots] of Object.entries(own)) {
    const [name, school, grade] = ok.split('|'); const o = out[name]; if (!o) continue; const g = grp[school + '|' + grade];
    let oa = 0, om = 0, oe = 0; for (let i = 0; i < SLOTS; i++) { const a = g[i][0] - slots[i][0], m = g[i][1] - slots[i][1]; oa += a; om += m; oe += a * pNat(grade, i); }
    const viaTeam = oa >= MIN_OTHERS; const F = viaTeam ? Math.min(F_HI, Math.max(F_LO, (om + K_SHRINK) / (oe + K_SHRINK))) : 1;
    for (let i = 0; i < SLOTS; i++) { const [a, m] = slots[i]; if (!a) continue; const p = Math.min(0.97, pNat(grade, i) * F); o.asked += a; o.mixed += m; o.exp += a * p; o.var += a * p * (1 - p); if (viaTeam) o.team += a; }
  }
  for (const o of Object.values(out)) {
    o.nomix_pct = o.recs ? r1((100 * o.nomix) / o.recs) : null; o.whole_pct = o.recs ? r1((100 * o.whole) / o.recs) : null;
    o.mixed_pct = o.asked ? r1((100 * o.mixed) / o.asked) : null; o.exp_pct = o.asked ? r1((100 * o.exp) / o.asked) : null;
    o.ratio = o.exp > 0 ? r2(o.mixed / o.exp) : null; o.z = o.var > 0 ? r1((o.mixed - o.exp) / Math.sqrt(o.var)) : null;
    o.mm_pct = o.mchk ? Math.round((10000 * o.mm) / o.mchk) / 100 : null;
    o.team_share = o.asked ? Math.round((100 * o.team) / o.asked) : 0;
  }
  return out;
}

export const canonOf = (n) => (n ? staffForKoboName(n)?.name || n : n);
