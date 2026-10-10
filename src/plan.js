// Whole-field plan: the RC plans every school before field work starts and
// submits it. After submission the plan is locked; a change needs a reason, and
// anything inside 3 working days is marked as a late change. Notices to the
// ward officer (5 working days) and head teacher (3 working days) are tracked
// per visit, and the team is told what is expected at the same time.
import { kv } from './store.js';
import {
  STAFF, SCHOOL_BY_ID, SCHOOLS_BY_REGION, FIELD_START, FIELD_END, PILOT_DAY, planWindow, DAY_REASONS, MAX_SCHOOLS_PER_DAY, DODOMA_MAX_SCHOOLS_PER_DAY, REASONS,
  NOTICE_AEK_WORKING_DAYS, NOTICE_HT_WORKING_DAYS, addWorkingDays, workingDaysBetween, isWorkingDay,
} from './config.js';

const key = (region) => `v2:plan:${region}`;

export async function getPlan(env, region) {
  return (await kv(env).get(key(region))) || { region, status: 'draft', version: 0, visits: [], changes: [], submitted_at: null, submitted_by: null };
}

const uid = () => Math.random().toString(36).slice(2, 8);

// Who leads the school: the RC leads one school and the ARC the other; where both are at the same school the RC leads and the ARC supports.
const coordsOf = (region) => STAFF.filter((s) => s.active && s.region === region && (s.role === 'rc' || s.role === 'arc'));
export function leadOfVisit(v, region) {
  if (v.lead) return v.lead;
  const c = coordsOf(region); const rc = c.find((s) => s.role === 'rc'), arc = c.find((s) => s.role === 'arc');
  const team = v.team || [];
  if (rc && team.includes(rc.name)) return rc.name;
  if (arc && team.includes(arc.name)) return arc.name;
  return null;
}
function leadErrors(region, visits) {
  const errors = []; const c = coordsOf(region); const rc = c.find((s) => s.role === 'rc'), arc = c.find((s) => s.role === 'arc');
  for (const v of visits) {
    const nm = SCHOOL_BY_ID[v.school]?.name || v.school; const team = v.team || [];
    if (v.lead && !c.some((s) => s.name === v.lead)) errors.push(`${nm}: the lead must be the Regional Coordinator or the Assistant Coordinator`);
    else if (v.lead && !team.includes(v.lead)) errors.push(`${nm}: the lead ${v.lead} must also be in the team`);
    if (rc && arc && team.includes(rc.name) && team.includes(arc.name) && v.lead && v.lead !== rc.name) errors.push(`${nm}: when the RC and the ARC are at the same school, the RC leads`);
  }
  return errors;
}
const dayNoteOk = (kind, n) => n && DAY_REASONS[kind][n.code] && String(n.note || '').trim().length >= 8;
function validateVisits(region, visits, dayNotes = {}) {
  const errors = [];
  const ids = new Set((SCHOOLS_BY_REGION[region] || []).map((s) => s.id));
  const cap = region === 'DODOMA' ? DODOMA_MAX_SCHOOLS_PER_DAY : MAX_SCHOOLS_PER_DAY;
  const perDay = {};
  const seen = new Set();
  for (const v of visits) {
    if (!ids.has(v.school)) errors.push(`${v.school} is not a school in ${region}`);
    if (seen.has(v.school)) errors.push(`${SCHOOL_BY_ID[v.school]?.name || v.school} is planned twice`);
    seen.add(v.school);
    if (!/^\d{4}-\d\d-\d\d$/.test(v.date || '')) errors.push(`${SCHOOL_BY_ID[v.school]?.name || v.school}: date missing`);
    else {
      const [w0, w1] = planWindow(region);
      if (v.date < w0 || v.date > w1) errors.push(`${SCHOOL_BY_ID[v.school]?.name}: ${v.date} is outside ${w0} to ${w1}`);
      if (region === 'DODOMA' && v.date !== PILOT_DAY) errors.push(`${SCHOOL_BY_ID[v.school]?.name}: the pilot schools are visited on the pilot day, ${PILOT_DAY}`);
      if (!isWorkingDay(v.date)) errors.push(`${SCHOOL_BY_ID[v.school]?.name}: ${v.date} is a weekend`);
      (perDay[v.date] ||= []).push(v);
    }
  }
  for (const [d, vs] of Object.entries(perDay)) {
    const n = vs.length;
    if (n > cap) errors.push(`${d}: ${n} schools planned, the limit is ${cap} a day`);
    if (region !== 'DODOMA' && n === 3 && !dayNoteOk('three', dayNotes[d])) errors.push(`${d}: 3 schools in one day needs a reason (small schools, close together) and a short explanation of at least 8 characters`);
    if (region !== 'DODOMA' && n === 1 && !dayNoteOk('one', dayNotes[d])) errors.push(`${d}: only 1 school that day needs a reason (large school, distance, remote) and a short explanation of at least 8 characters`);
    if (n >= 2) { // nobody can be at two schools on the same day
      const where = {};
      for (const v of vs) for (const person of v.team || []) { if (where[person] && where[person] !== v.school) errors.push(`${d}: ${person} is in the team of two different schools`); where[person] = v.school; }
    }
  }
  for (const id of ids) if (!seen.has(id)) errors.push(`${SCHOOL_BY_ID[id].name} has no date yet`);
  return errors;
}

export async function submitPlan(env, who, region, visits, dayNotes = {}) {
  const cur = await getPlan(env, region);
  if (cur.status === 'locked') return { error: 'The plan is already submitted. Use a change with a reason.', status: 409 };
  const clean = visits.map((v) => ({ id: v.id || uid(), school: v.school, date: v.date, start: v.start || '08:00', team: (v.team || []).slice(0, 8), lead: v.lead || null, notices: {}, status: 'planned' }));
  const notes = Object.fromEntries(Object.entries(dayNotes || {}).map(([d, n]) => [d, { code: n.code, note: String(n.note || '').slice(0, 300) }]));
  const errors = [...validateVisits(region, clean, notes), ...leadErrors(region, clean)];
  if (errors.length) return { error: 'The plan has problems', errors, status: 422 };
  const plan = { region, status: 'locked', version: 1, visits: clean, day_notes: notes, changes: [], submitted_at: new Date().toISOString(), submitted_by: who.name };
  await kv(env).put(key(region), plan);
  return { plan };
}

export async function saveDraft(env, region, visits, dayNotes = {}) {
  const cur = await getPlan(env, region);
  if (cur.status === 'locked') return { error: 'Plan is locked', status: 409 };
  const draft = { ...cur, day_notes: dayNotes || {}, visits: visits.map((v) => ({ id: v.id || uid(), school: v.school, date: v.date || null, start: v.start || '08:00', team: v.team || [], lead: v.lead || null, notices: {}, status: 'planned' })) };
  await kv(env).put(key(region), draft);
  return { plan: draft };
}

export async function changeVisit(env, who, region, { visit_id, new_date, new_start, new_team, new_lead, reason_code, note }, today) {
  const plan = await getPlan(env, region);
  if (plan.status !== 'locked') return { error: 'Submit the plan first', status: 409 };
  const v = plan.visits.find((x) => x.id === visit_id);
  if (!v) return { error: 'Visit not found', status: 404 };
  if (!REASONS[reason_code]) return { error: 'Choose a reason from the list', status: 422 };
  if (reason_code === 'other' && !(note || '').trim()) return { error: 'Write a short note for "Other"', status: 422 };
  const date = new_date || v.date;
  const [w0, w1] = planWindow(region);
  if (date < w0 || date > w1 || !isWorkingDay(date)) return { error: `Pick a working day between ${w0} and ${w1}`, status: 422 };
  const cap = region === 'DODOMA' ? DODOMA_MAX_SCHOOLS_PER_DAY : MAX_SCHOOLS_PER_DAY;
  if (plan.visits.filter((x) => x.date === date && x.id !== v.id).length >= cap) return { error: `That day already has ${cap} schools`, status: 422 };
  const lead = workingDaysBetween(today, date);
  const oldLead = workingDaysBetween(today, v.date);
  const late = lead < NOTICE_HT_WORKING_DAYS || (date !== v.date && oldLead < NOTICE_HT_WORKING_DAYS);
  plan.changes.push({
    at: new Date().toISOString(), by: who.name, visit_id, school: v.school,
    from: { date: v.date, start: v.start, team: v.team }, to: { date, start: new_start || v.start, team: new_team || v.team },
    reason_code, reason: REASONS[reason_code], note: (note || '').slice(0, 300), late,
  });
  if (date !== v.date) { v.notices = {}; v.status = 'moved'; }
  plan.day_notes ||= {};
  const dayNote = { code: 'change', note: `${REASONS[reason_code]}${note ? ': ' + String(note).slice(0, 200) : ''} (changed by ${who.name})` };
  plan.day_notes[date] = plan.day_notes[date] || dayNote;
  if (date !== v.date) plan.day_notes[v.date] = plan.day_notes[v.date] || dayNote;
  v.date = date;
  v.start = new_start || v.start;
  if (new_team) v.team = new_team.slice(0, 8);
  if (new_lead) { const le = leadErrors(region, [{ ...v, lead: new_lead }]); if (le.length) return { error: le[0], status: 422 }; v.lead = new_lead; }
  plan.version += 1;
  await kv(env).put(key(region), plan);
  return { plan };
}

export async function markNotice(env, who, region, { visit_id, kind }) {
  const plan = await getPlan(env, region);
  const v = plan.visits.find((x) => x.id === visit_id);
  if (!v || !['aek', 'ht', 'team'].includes(kind)) return { error: 'Not found', status: 404 };
  v.notices[kind] = { at: new Date().toISOString(), by: who.name };
  await kv(env).put(key(region), plan);
  return { plan };
}

// Decorates each visit with notice deadlines/state, and (when data exists) what happened.
export function withNotices(plan, today, schoolVisits) {
  return {
    ...plan,
    visits: plan.visits.map((v) => {
      const aekDue = addWorkingDays(v.date, -NOTICE_AEK_WORKING_DAYS);
      const htDue = addWorkingDays(v.date, -NOTICE_HT_WORKING_DAYS);
      const state = (done, due) => (done ? 'sent' : today > due ? 'late' : today === due ? 'due' : 'upcoming');
      const dates = (schoolVisits && schoolVisits[v.school]) || [];
      let outcome = null;
      if (v.date <= today) outcome = dates.includes(v.date) ? 'visited' : dates.length ? 'visited_other_day' : v.date < today ? 'missed' : 'today';
      return {
        ...v, lead_name: leadOfVisit(v, plan.region), school_name: SCHOOL_BY_ID[v.school]?.name, lga: SCHOOL_BY_ID[v.school]?.lga, mne: SCHOOL_BY_ID[v.school]?.mne,
        aek_due: aekDue, ht_due: htDue,
        aek_state: state(v.notices?.aek, aekDue), ht_state: state(v.notices?.ht, htDue), team_state: state(v.notices?.team, htDue),
        outcome,
      };
    }),
  };
}

// Which regions have submitted their whole-field plan
export async function planProgress(env, regions) {
  const plans = await Promise.all(regions.map((r) => getPlan(env, r)));
  const missing = regions.filter((r, k) => plans[k].status !== 'locked');
  return { total: regions.length, submitted: regions.length - missing.length, missing };
}
