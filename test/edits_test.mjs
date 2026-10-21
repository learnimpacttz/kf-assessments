// Edits change labels only (school, grade, tester, district, region, pupil number), never answers or times
import { ok, done } from './_kit.mjs';
import { patchFor, checkEdit, attGuard, describe } from '../src/edits.js';
import { SCHOOL_BY_ID, STAFF } from '../src/config.js';
const rec = { _id: 1, stuid: '2026PS03020232073', rand_long: '073', 'stu_info/rand_nr': '73', 'stu_info/name': '73', 'id_data/grade': '2', 'stu_info/grade_conf': '2', 'id_data/school': 'PS0302023', 'id_data/enumerator': 'Old Name', 'id_data/lga': 'A', 'id_data/region': 'DODOMA', 'end_note_gr/testtime': '450', start: '2026-10-15T09:00:00', 's1/k101': '1', a101_b: '1' };
const keep = (p) => !Object.keys(p).some((k) => /testtime|start|^s1\/|_b$|k1/.test(k));
let p = patchFor('students', 'grade', rec, '3');
ok('grade: label and pupil ID change together', p['id_data/grade'] === '3' && p['stu_info/grade_conf'] === '3' && p.stuid === '2026PS03020233073', JSON.stringify(p));
ok('grade: answers and times are never touched', keep(p));
p = patchFor('students', 'pupil', rec, '85');
ok('pupil number: number, long form and ID change', p['stu_info/rand_nr'] === '85' && p.rand_long === '085' && p.stuid === '2026PS03020232085' && p['stu_info/name'] === '85', JSON.stringify(p));
p = patchFor('students', 'tester', rec, 'New Name'); ok('tester: only the name', Object.keys(p).length === 1 && p['id_data/enumerator'] === 'New Name');
p = patchFor('students', 'region', rec, 'LINDI'); ok('region: only the region label', Object.keys(p).join() === 'id_data/region', JSON.stringify(p));
p = patchFor('students', 'lga', rec, 'B'); ok('district: only the district label', Object.keys(p).join() === 'id_data/lga');
ok('no change when the value is the same', Object.keys(patchFor('students', 'grade', rec, '2')).length === 0);
const adm = { role: 'hq', level: 'admin' }; const rcw = { role: 'rc', region: 'TANGA' };
ok('grade must be 1, 2 or 3', Boolean(checkEdit({ field: 'grade', value: '4' }, 'students', adm).error));
ok('region must be real', Boolean(checkEdit({ field: 'region', value: 'MARS' }, 'students', adm).error));
ok('an RC can only use their own region', Boolean(checkEdit({ field: 'region', value: 'LINDI' }, 'students', rcw).error) && !checkEdit({ field: 'region', value: 'TANGA' }, 'students', rcw).error);
ok('tester must be on the roster', Boolean(checkEdit({ field: 'tester', value: 'Nobody Here' }, 'students', adm).error) && !checkEdit({ field: 'tester', value: STAFF[10].name }, 'students', adm).error);
ok('pupil numbers do not exist in the sampling project', Boolean(checkEdit({ field: 'pupil', values: { 1: 5 } }, 'sampling', adm).error));
ok('pupil number must be 1 to 400', Boolean(checkEdit({ field: 'pupil', values: { 1: 999 } }, 'students', adm).error));
const other = Object.values(SCHOOL_BY_ID).find((s) => s.region !== 'TANGA'); ok('an RC cannot move records to another region', Boolean(checkEdit({ field: 'school', value: other.id }, 'students', rcw).error));

// ---- attendance on a Sampling record: only the attendance answer, only when 20 or fewer were present
const samp = { _id: 9, 'id_data/school': 'PS0302023', 'id_data/grade': '2', 'att_gr/att': '6', 'att_gr/skipint': '0.3', 'att_gr/fj1': '-13', 'att_gr/int1': '0', 'att_gr/int2': '0', 'selection/list1': '', _submission_time: '2026-10-19T10:00:00' };
p = patchFor('sampling', 'att', samp, '7');
ok('attendance: only the attendance answer changes', Object.keys(p).join() === 'att_gr/att' && p['att_gr/att'] === '7', JSON.stringify(p));
ok('attendance: the helper numbers, the draw lists and every other answer are untouched', !Object.keys(p).some((k) => /skipint|fj\d|int\d|list|school|grade/.test(k)));
ok('attendance: no change when the value is the same', Object.keys(patchFor('sampling', 'att', samp, '6')).length === 0);
ok('attendance: only for the Sampling project', Boolean(checkEdit({ field: 'att', value: '7' }, 'students', adm).error) && !checkEdit({ field: 'att', value: '7' }, 'sampling', adm).error);
ok('attendance must be a whole number from 1 to 20', ['0', '21', '7.5', 'abc', ''].every((v) => Boolean(checkEdit({ field: 'att', value: v }, 'sampling', adm).error)) && !checkEdit({ field: 'att', value: '20' }, 'sampling', adm).error && !checkEdit({ field: 'att', value: '1' }, 'sampling', adm).error);
ok('attGuard allows 6 to 7', attGuard(samp, 7) === null);
ok('attGuard blocks a class with more than 20 present (the draw depends on it)', /new draw/.test(attGuard({ ...samp, 'att_gr/att': '34' }, 18)));
ok('attGuard blocks changing to the same number', /already 6/.test(attGuard(samp, 6)));
ok('attGuard blocks a value above 20 and a record without attendance', Boolean(attGuard(samp, 25)) && Boolean(attGuard({ _id: 1 }, 7)));
ok('the request lines read "present 6 to 7"', describe({ field: 'att', value: '7' }, { att: '6' }) === 'Pupils present 6 to 7');
done();
