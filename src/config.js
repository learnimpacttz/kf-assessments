// Field rules taken from the 2026 Training Manual and the 2026 XLSForms.
import { SCHOOLS } from './data/schools.js';
import { ROSTER } from './data/roster.js';

export const FIELD_START = '2026-10-19';
export const FIELD_END = '2026-12-04';
export const PILOT_DAY = '2026-10-15'; // Dodoma pilot schools (5) are all visited on this training-week day
export const TRAINING_START = '2026-10-12';
export const planWindow = (region) => (region === 'DODOMA' ? [TRAINING_START, FIELD_END] : [FIELD_START, FIELD_END]);
export const CURRENT_YEAR = '2026';

export const TARGET_PER_GRADE = 20; // 20 pupils per grade per school (60 a school)
export const DODOMA_TARGET_PER_GRADE = 40; // Dodoma training region: 40 x 3 = 120
export const MAX_SCHOOLS_PER_DAY = 3; // 2-3 per region per day
export const DODOMA_MAX_SCHOOLS_PER_DAY = 5;
// Protocol: 2 schools a day per region (the coordinator and the assistant each lead one school with 2 volunteers).
// One school (everyone together, for a large school) or three schools (small schools close together) are allowed,
// but the plan must say why.
export const STANDARD_SCHOOLS_PER_DAY = 2;
export const DAY_REASONS = {
  three: { small_schools: 'The schools are small', close_by: 'The schools are close to each other and the roads allow it', other: 'Other (explain)' },
  one: { large_school: 'Large school: the whole team works together', distance: 'Distance or a difficult road', remote: 'Remote school', other: 'Other (explain)' },
};
export const NOTICE_AEK_WORKING_DAYS = 5; // ward education officer
export const NOTICE_HT_WORKING_DAYS = 3; // head teacher
export const FIELD_HOURS = [7, 14]; // from the student form's own time-limit note

export const REGIONS = ['TANGA', 'MANYARA', 'MARA', 'LINDI', 'MTWARA', 'SHINYANGA', 'RUKWA', 'SONGWE', 'SINGIDA', 'KIGOMA', 'DODOMA'];
export const PARTNERS = {
  GEP: ['TANGA', 'MANYARA', 'LINDI', 'MTWARA'],
  KACODA: ['SHINYANGA', 'MARA', 'SINGIDA'],
  FAWOCHIWE: ['KIGOMA', 'RUKWA', 'SONGWE'],
};

export const REASONS = {
  rain: 'Rain or flooded road',
  transport: 'Transport problem',
  school_closed: 'School closed or exams',
  permit: 'Permit or notice not ready',
  illness: 'Staff illness',
  team: 'Team change',
  other: 'Other (write a note)',
};

// Starting limits for the data checks. Overridden at read time by percentiles
// computed from the 2024/2025 test-time histograms once those are loaded.
export const DEFAULT_BANDS = { 1: [3, 8, 14], 2: [4, 10, 18], 3: [5, 13, 24] }; // [too fast below, typical median, too slow above]
export const FAR_FROM_SCHOOL_M = 500;

// KoBo spells a few names differently from the roster sheet.
export const NAME_ALIASES = {
  salimurajabu: 'salimurajabunyaki',
  zainabumussa: 'zainabumussahassani',
  upendobcorneil: 'upendocorneil',
};

export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

export const SCHOOL_BY_ID = Object.fromEntries(
  SCHOOLS.map(([id, region, lga, ward, name, arm, mne]) => [id, { id, region, lga, ward, name: name.trim(), arm, mne }])
);
export const SCHOOLS_BY_REGION = {};
for (const s of Object.values(SCHOOL_BY_ID)) (SCHOOLS_BY_REGION[s.region] ||= []).push(s);

const mkStaff = (s) => ({ id: s.id, region: s.region, position: s.position, role: s.position === 'RC' ? 'rc' : s.position === 'ARC' ? 'arc' : 'volunteer', name: s.name, key: norm(s.name), rot: s.rot || 0, active: s.active !== false });
// The roster starts from the file and can be changed by HQ in the dashboard (stored in the Durable Object).
// STAFF is edited in place so every module that imported it sees the change.
export const STAFF = ROSTER.map(([id, region, position, name]) => mkStaff({ id, region, position, name }));
export const rosterState = { version: 0, aliases: {} };
let STAFF_BY_KEY = {};
let STAFF_BY_ID = {};
function reindex() {
  STAFF_BY_KEY = Object.fromEntries(STAFF.map((s) => [s.key, s]));
  STAFF_BY_ID = Object.fromEntries(STAFF.map((s) => [s.id, s]));
}
reindex();
export function setRoster(list, aliases = {}) {
  STAFF.length = 0;
  for (const s of list) STAFF.push(mkStaff(s));
  rosterState.aliases = aliases || {};
  rosterState.version += 1;
  reindex();
}
export const rosterForSave = () => STAFF.map(({ id, region, position, name, rot, active }) => ({ id, region, position, name, rot, active }));
export function staffForKoboName(n) {
  const k = norm(n);
  const viaAlias = rosterState.aliases[k] != null ? STAFF_BY_ID[rosterState.aliases[k]] : null;
  return viaAlias || STAFF_BY_KEY[k] || STAFF_BY_KEY[NAME_ALIASES[k]] || null;
}

export function targetPerGrade(region) {
  return region === 'DODOMA' ? DODOMA_TARGET_PER_GRADE : TARGET_PER_GRADE;
}

// ---- dates (East Africa Time, UTC+3, no DST) ----
export function eatNow(now = new Date()) {
  return new Date(now.getTime() + 3 * 3600 * 1000);
}
export function eatToday(now) {
  return eatNow(now).toISOString().slice(0, 10);
}
export function isWorkingDay(iso) {
  const d = new Date(iso + 'T00:00:00Z').getUTCDay();
  return d !== 0 && d !== 6;
}
export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function addWorkingDays(iso, n) {
  const step = n < 0 ? -1 : 1;
  let left = Math.abs(n);
  let cur = iso;
  while (left > 0) {
    cur = addDays(cur, step);
    if (isWorkingDay(cur)) left--;
  }
  return cur;
}
export function workingDaysBetween(fromIso, toIso) {
  // number of working days after fromIso up to and including toIso (negative if toIso is earlier)
  if (toIso === fromIso) return 0;
  const sign = toIso > fromIso ? 1 : -1;
  let cur = fromIso;
  let n = 0;
  while (cur !== toIso && n < 400) {
    cur = addDays(cur, sign);
    if (isWorkingDay(cur)) n += sign;
  }
  return n;
}

// Phones are shown by a short code, never by the raw KoBo device ID.
export function devCode(d) { let h = 2166136261; for (let i = 0; i < String(d).length; i++) { h ^= String(d).charCodeAt(i); h = Math.imul(h, 16777619); } return 'D-' + (h >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 6); }

// Practice (training) schools: submitted from the same forms, kept completely apart from the real numbers.
export const PRACTICE_REGION = 'TRAINING';
export const PRACTICE_SCHOOLS = [['TRAIN001', 'TRAINING SCHOOL 1', 'M&E'], ['TRAIN002', 'TRAINING SCHOOL 2', 'No-M&E'], ['TRAIN003', 'TRAINING SCHOOL 3', 'M&E']].map(([id, name, mne]) => ({ id, region: PRACTICE_REGION, lga: 'TRAINING LGA', ward: 'TRAINING', name, arm: 'Practice', mne, practice: true }));
export const PRACTICE_BY_ID = Object.fromEntries(PRACTICE_SCHOOLS.map((s) => [s.id, s]));
export const isPracticeSchool = (id) => String(id || '').startsWith('TRAIN');
