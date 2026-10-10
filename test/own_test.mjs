// Unit check of the coordinators' own-work numbers with a plan whose visits are in the past.
import { ownWork, teamBlock } from '../src/own.js';
import { STAFF, SCHOOLS_BY_REGION } from '../src/config.js';
const region = 'MARA';
const rc = STAFF.find((s) => s.region === region && s.role === 'rc'), arc = STAFF.find((s) => s.region === region && s.role === 'arc');
const vols = STAFF.filter((s) => s.region === region && s.role === 'volunteer');
const sch = SCHOOLS_BY_REGION[region].slice(0, 6);
const day = (n) => `2026-10-${String(19 + n).padStart(2, '0')}`;
const visits = sch.map((s, i) => ({ id: 'v' + i, school: s.id, date: day(Math.floor(i / 2)), start: '08:00', team: i % 2 ? [arc.name, vols[2].name, vols[3].name] : [rc.name, vols[0].name, vols[1].name], lead: i % 2 ? arc.name : rc.name,
  notices: i < 4 ? { aek: { at: '2026-10-10T08:00:00Z', by: rc.name }, ht: { at: i === 3 ? '2026-10-20T08:00:00Z' : '2026-10-12T08:00:00Z', by: rc.name }, ...(i < 3 ? { team: { at: '2026-10-15T08:00:00Z', by: rc.name } } : {}) } : {}, status: 'planned' }));
const plan = { region, status: 'locked', version: 1, visits, changes: [{ by: rc.name, late: true }, { by: arc.name, late: false }], submitted_at: '2026-10-10T07:00:00Z' };
const schools = {}; // two schools visited as planned, one on another day, one missed
const mk = (i, dates, people) => { schools[sch[i].id] = { id: sch[i].id, dates, dayAdmins: Object.fromEntries(dates.map((d) => [d, people])) }; };
mk(0, [day(0)], [rc.name, vols[0].name]); mk(1, [day(0)], [arc.name, vols[2].name, vols[3].name]); mk(2, [day(2)], [rc.name]); mk(3, [], []);
const admins = [
  { name: rc.name, staff_id: rc.id, tested: 90, samp: 3, schools: 2, days: 2, avg_min: 8.1, quality: 94, tf: 12, sub_all: { n: 90, same: 80, same_pct: 89, avg_h: 1.2, max_h: 20 } },
  { name: arc.name, staff_id: arc.id, tested: 60, samp: 1, schools: 1, days: 1, avg_min: 7.7, quality: 80, tf: 0, sub_all: { n: 60, same: 60, same_pct: 100, avg_h: 0.5, max_h: 1 } },
];
const flags = [{ type: 'slow', school: sch[0].id, date: '2026-10-19', q: null }, { type: 'dup', school: sch[1].id, date: '2026-10-25', q: null }];
const queries = { [`slow|${sch[0].id}|1||x`]: { status: 'open', thread: [{ by: rc.name, text: 'ok', at: 'z' }, { by: rc.name, text: 'closed', at: 'z', resolved: true }] } };
const ctx = { sum: { schools, admins }, plan, queries, flags, today: '2026-10-26' };
const own = ownWork(ctx, rc), arcOwn = ownWork(ctx, arc), team = teamBlock(ctx, region);
const show = (o) => o.rows.map((r) => `${r.label}: ${r.display} [${r.status}]`).join('\n  ');
console.log('RC\n  ' + show(own)); console.log('RC led', own.led, 'responsible for ARC:', own.responsible_for_arc === arc.name, '| queries', own.queries, '| baseline forms', own.baseline.forms);
console.log('ARC reports to RC:', arcOwn.reports_to === rc.name); console.log('TEAM\n  ' + show(team));
