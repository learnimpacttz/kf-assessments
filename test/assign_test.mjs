// Assigned versus who did the work: other school = a query; extra grade, helper, absent = information only
import { env, mem, ok, done } from './_kit.mjs';
import { assignFlags } from '../src/assign.js';
import { STAFF, SCHOOLS_BY_REGION, PILOT_DAY } from '../src/config.js';
const [s1, s2] = SCHOOLS_BY_REGION['TANGA']; const t = STAFF.filter((s) => s.active && s.region === 'TANGA' && s.role === 'volunteer');
const day = '2026-10-20';
mem.set('v2:plan:TANGA', JSON.stringify({ region: 'TANGA', status: 'locked', visits: [{ id: 'a', school: s1.id, date: day, team: [t[0].name, t[1].name] }, { id: 'b', school: s2.id, date: day, team: [t[2].name, t[3].name] }] }));
const sum = { schools: { [s1.id]: { dayAdmins: { [day]: [t[0].name, t[2].name, 'Someone Else'] } }, [s2.id]: { dayAdmins: { [day]: [t[3].name] } } } };
const r = await assignFlags(env, sum, '2026-10-21');
ok('a planner at school A who sent records at school B raises a confirm query', r.flags.some((f) => f.admin === t[2].name && f.type === 'assign' && f.school === s1.id), JSON.stringify(r.flags.map((f) => f.admin)));
ok('a helper not planned anywhere is information only', r.info.some((x) => x.admin === 'Someone Else') && !r.flags.some((f) => f.admin === 'Someone Else'));
ok('a planned volunteer with no records anywhere is information only', r.info.some((x) => x.admin === t[1].name) && !r.flags.some((f) => f.admin === t[1].name));
ok('nobody is flagged for working where they were planned', !r.flags.some((f) => f.admin === t[0].name || f.admin === t[3].name));
// pilot: grade differences are information, never a query
const pil = STAFF.find((s) => s.active && s.region === 'LINDI' && s.role === 'volunteer');
mem.set('v2:pilot', JSON.stringify({ grades: { PS0302023: { [pil.id]: 1 } }, lead: {}, support: {}, sampling: {}, samplers: {}, sampling_lead: {}, log: [] }));
const sum2 = { schools: { PS0302023: { dayAdmins: { [PILOT_DAY]: [pil.name] }, dayGrade: { [PILOT_DAY]: { 2: [pil.name] } } } } };
const r2 = await assignFlags(env, sum2, '2026-10-21');
ok('pilot: placed in Grade 1 but tested Grade 2 is information only', r2.info.some((x) => x.admin === pil.name && /Grade 1/.test(x.text)) && !r2.flags.length, JSON.stringify(r2.flags));
done();
