// Who was assigned and who did the work. Credit always follows the name on the record (the KoBo form); these checks only
// show where that differs from the plan, so reports stay accurate and nobody is credited for another person's tests.
import { STAFF, SCHOOLS_BY_REGION, SCHOOL_BY_ID, PILOT_DAY, REGIONS, staffForKoboName } from './config.js';
import { PILOT_ALLOC, pilotGrades } from './pilot.js';
import { getPlan } from './plan.js';

const list = (a) => a.join(', ') || 'nobody';
export async function assignFlags(env, sum, today) {
  if (!sum || !sum.schools) return [];
  const flags = []; const gradesPlaced = await pilotGrades(env).catch(() => ({}));
  const plans = Object.fromEntries(await Promise.all(REGIONS.map(async (r) => [r, await getPlan(env, r).catch(() => null)])));
  const mk = (sc, date, admin, text, hint, extra = {}) => ({ sev: 'warn', type: 'assign', school: sc, grade: extra.grade || 0, admin, date, text, hint, normal: 'the people who did the work match the plan, or the change is explained', recs: [], ...extra });
  // regular schools: the planned team for the visit against the people who sent records that day
  for (const [region, plan] of Object.entries(plans)) {
    if (!plan || plan.status !== 'locked') continue;
    for (const v of plan.visits || []) {
      if (!v.date || v.date > today || PILOT_ALLOC[v.school]) continue;
      const day = sum.schools[v.school]?.dayAdmins?.[v.date]; if (!day || !day.length) continue;
      const planned = (v.team || []).slice(); const plannedVol = planned.filter((n) => staffForKoboName(n)?.role === 'volunteer');
      const extra = day.filter((n) => !planned.includes(n)); const absent = plannedVol.filter((n) => !day.includes(n));
      for (const n of extra) flags.push(mk(v.school, v.date, n, `${n} sent records here on ${v.date} but was not on the planned team. Planned team: ${list(planned)}. Who sent records: ${list(day)}.`, 'If this person helped, say so in your reply. The tests stay credited to the person who sent them.'));
      for (const n of absent) flags.push(mk(v.school, v.date, n, `${n} was planned for this visit but sent no records. Who sent records: ${list(day)}.`, 'Say why (sick, moved to another school, only supported). The plan is not changed by this reply.'));
    }
  }
  // pilot day: the grade each volunteer was placed in against the grade they tested
  for (const [sid, regs] of Object.entries(PILOT_ALLOC)) {
    const dg = sum.schools[sid]?.dayGrade?.[PILOT_DAY]; if (!dg) continue;
    const placed = gradesPlaced[sid] || {}; const byName = {};
    for (const [stid, g] of Object.entries(placed)) { const st = STAFF.find((x) => String(x.id) === String(stid)); if (st) byName[st.name] = g; }
    for (const [g, names] of Object.entries(dg)) for (const n of names) {
      const st = staffForKoboName(n); const want = byName[n];
      if (st?.role === 'volunteer' && want && Number(want) !== Number(g)) flags.push(mk(sid, PILOT_DAY, n, `${n} was placed in Grade ${want} but tested Grade ${g}.`, 'Say why the grade changed. Credit stays with the person who sent the records.', { grade: Number(g) }));
    }
    for (const r of regs) {
      const vols = STAFF.filter((x) => x.active && x.region === r && x.role === 'volunteer'); const unplaced = vols.filter((x) => !placed[x.id]);
      const tested = unplaced.filter((x) => Object.values(dg).some((ns) => ns.includes(x.name)));
      if (unplaced.length && tested.length) { const rc = STAFF.find((x) => x.active && x.region === r && x.role === 'rc'); flags.push(mk(sid, PILOT_DAY, rc?.name || '', `${unplaced.length} of the ${vols.length} volunteers from ${r.charAt(0) + r.slice(1).toLowerCase()} were never placed in a grade on the dashboard (${list(unplaced.map((x) => x.name).slice(0, 6))}${unplaced.length > 6 ? '…' : ''}), but ${tested.length} of them sent records.`, 'Place each volunteer in the grade they tested, on the Pilot day page, so the plan matches the work.', { region_wide: true })); }
    }
  }
  return flags.map((f) => ({ ...f, region: SCHOOL_BY_ID[f.school]?.region }));
}
