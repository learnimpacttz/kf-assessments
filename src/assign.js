// Who was assigned and who did the work. Credit always follows the name on the record (the KoBo form).
//  - the same person at a DIFFERENT SCHOOL than planned or placed: a query, the coordinator confirms and describes why
//  - a different grade than placed, a helper who was not on the plan, a planned person with no records: information only
import { STAFF, SCHOOL_BY_ID, PILOT_DAY, REGIONS, staffForKoboName } from './config.js';
import { PILOT_ALLOC, pilotGrades } from './pilot.js';
import { getPlan } from './plan.js';

const list = (a) => a.join(', ') || 'nobody';
export async function assignFlags(env, sum, today) {
  if (!sum || !sum.schools) return { flags: [], info: [] };
  const flags = [], info = []; const gradesPlaced = await pilotGrades(env).catch(() => ({}));
  const plans = Object.fromEntries(await Promise.all(REGIONS.map(async (r) => [r, await getPlan(env, r).catch(() => null)])));
  const sname = (id) => SCHOOL_BY_ID[id]?.name || id;
  const q = (sc, date, admin, text, hint) => flags.push({ sev: 'warn', type: 'assign', school: sc, grade: 0, admin, date, text, hint, normal: 'the person works at the school they were planned for', recs: [], region: SCHOOL_BY_ID[sc]?.region });
  const i = (sc, date, admin, text) => info.push({ school: sc, date, admin, text, region: SCHOOL_BY_ID[sc]?.region });
  // where each person actually sent records, by day
  const at = {}; for (const [sid, s] of Object.entries(sum.schools)) for (const [d, names] of Object.entries(s.dayAdmins || {})) for (const n of names) ((at[n] ||= {})[d] ||= new Set()).add(sid);
  const seenQ = new Set(); const once = (k) => (seenQ.has(k) ? false : (seenQ.add(k), true));
  for (const plan of Object.values(plans)) {
    if (!plan || plan.status !== 'locked') continue;
    for (const v of plan.visits || []) {
      if (!v.date || v.date > today || PILOT_ALLOC[v.school]) continue;
      const day = sum.schools[v.school]?.dayAdmins?.[v.date] || []; const planned = v.team || [];
      for (const n of planned) {
        const where = [...(at[n]?.[v.date] || [])]; if (!where.length || where.includes(v.school)) continue;
        if (once(n + v.date)) q(where[0], v.date, n, `${n} was planned at ${sname(v.school)} on ${v.date} but sent records at ${where.map(sname).join(' and ')}.`, 'Confirm this and describe what happened (changed on the day, asked to help, wrong school chosen in the form).');
      }
      if (!day.length) continue;
      for (const n of day) if (!planned.includes(n) && !Object.values(plans).some((p) => (p?.visits || []).some((x) => x.date === v.date && x.school !== v.school && (x.team || []).includes(n)))) i(v.school, v.date, n, `${n} helped on ${v.date}; not on the planned team (${list(planned)}).`);
      for (const n of planned.filter((x) => staffForKoboName(x)?.role === 'volunteer' && !day.includes(x) && !(at[x]?.[v.date] || new Set()).size)) i(v.school, v.date, n, `${n} was planned for this visit but sent no records.`);
    }
  }
  for (const [sid, regs] of Object.entries(PILOT_ALLOC)) {
    const dg = sum.schools[sid]?.dayGrade?.[PILOT_DAY]; if (!dg) continue;
    const placed = gradesPlaced[sid] || {}; const byName = {};
    for (const [stid, g] of Object.entries(placed)) { const st = STAFF.find((x) => String(x.id) === String(stid)); if (st) byName[st.name] = g; }
    for (const [g, names] of Object.entries(dg)) for (const n of names) {
      const st = staffForKoboName(n); if (!st) continue;
      if (!regs.includes(st.region)) { const home = Object.entries(PILOT_ALLOC).find(([, r]) => r.includes(st.region)); if (home && once(n + PILOT_DAY)) q(sid, PILOT_DAY, n, `${n} (${st.region.charAt(0) + st.region.slice(1).toLowerCase()}) was placed at ${sname(home[0])} on the pilot day but sent records at ${sname(sid)}.`, 'Confirm this and describe what happened.'); continue; }
      if (st.role === 'volunteer' && byName[n] && Number(byName[n]) !== Number(g)) i(sid, PILOT_DAY, n, `${n} was placed in Grade ${byName[n]} and also tested Grade ${g}.`);
    }
    for (const r of regs) {
      const vols = STAFF.filter((x) => x.active && x.region === r && x.role === 'volunteer'); const unplaced = vols.filter((x) => !placed[x.id] && Object.values(dg).some((ns) => ns.includes(x.name)));
      if (unplaced.length) i(sid, PILOT_DAY, STAFF.find((x) => x.active && x.region === r && x.role === 'rc')?.name || '', `${unplaced.length} of ${vols.length} ${r.charAt(0) + r.slice(1).toLowerCase()} volunteers were not placed in a grade on the dashboard but sent records (${list(unplaced.map((x) => x.name).slice(0, 6))}). Placing them on the Pilot day page keeps the plan and the work together.`);
    }
  }
  return { flags, info };
}
