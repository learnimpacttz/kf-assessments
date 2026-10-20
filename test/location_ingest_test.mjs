// The phone location is turned into counts at ingest and never kept
import { ok, done } from './_kit.mjs';
import { addStudents } from '../src/ingest.js';
import { SCHOOL_COORDS } from '../src/data/school_coords.js';
const id = Object.keys(SCHOOL_COORDS)[3]; const [la, lo] = SCHOOL_COORDS[id];
const rec = (n, geo) => ({ _id: n, year: '2026', today: '2026-10-21', 'group_intro/date': '2026-10-21', 'id_data/school': id, 'id_data/grade': '1', 'id_data/enumerator': 'Test Person', stuid: 'S' + n, 'stu_info/rand_nr': String(n), start: '2026-10-21T09:10:00+03:00', 'end_note_gr/testtime_rounded': '5', stu_avail: '1', _geolocation: geo, _submission_time: '2026-10-21T10:00:00' });
const state = { yrs: {} };
addStudents(state, [rec(1, [la + 0.0005, lo]), rec(2, [la + 0.05, lo]), rec(3, [la + 0.2, lo]), rec(4, [null, null]), { ...rec(5, [0, 0]) }]);
const Y = Object.values(state.yrs)[0]; const c = Object.values(Y.cells)[0];
ok('counts records with a phone point', c.gp === 3, JSON.stringify({ gp: c.gp, gk: c.gk, gn: c.gn, gv: c.gv }));
ok('counts those at the school and very far away', c.gk === 3 && c.gn === 1 && c.gv === 2);
const text = JSON.stringify(state);
ok('no coordinates are stored in the aggregates', !text.includes(String(la).slice(0, 7)) && !text.includes(String(lo).slice(0, 7)));
done();
