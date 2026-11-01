// QA visits: scoring, the cross-checks against plan, location and records, and that no coordinates are kept
import { ok, done, env, mem } from './_kit.mjs';
import { visitOf, score, qaView, CRITICAL } from '../src/qa.js';
import { SCHOOL_BY_ID, eatToday } from '../src/config.js';
import { SCHOOL_COORDS } from '../src/data/school_coords.js';

const sid = Object.keys(SCHOOL_COORDS).find((k) => SCHOOL_BY_ID[k] && SCHOOL_BY_ID[k].arm !== 'Pilot'); const S = SCHOOL_BY_ID[sid]; const here = SCHOOL_COORDS[sid];
const F = { items: { c2: { label: 'Consent was read', sec: 'c' }, b1: { label: 'Notice was given', sec: 'b' }, i3: { label: 'Answer graded correctly', sec: 'i' } }, lists: { observer: { obs_a: 'Observer A' }, enumerator: { r__x: 'Tester One (RC)' }, leader: {} }, version: 'v1', name: 'QA' };
const raw = (over = {}) => ({ _id: 11, _submission_time: '2026-11-02T08:00:00', 'grp_a/observer': 'obs_a', 'grp_a/visit_date': '2026-10-30', 'grp_a/region': S.region, 'grp_a/school': sid, 'grp_a/ass_name': 'r__x', 'grp_a/ass_grade': '2',
  'grp_b/b1': '1', 'grp_c/c2': '0', 'grp_i/i3_p1': '0', 'grp_i/i3_p2': '1', 'grp_i/i1_p1': '99', 'grp_g/g2a': '31', _geolocation: [here[0], here[1]], ...over });

const v = visitOf(raw(), F);
ok('keys in groups are read by their last part', v.school === sid && v.observer === 'Observer A' && v.date === '2026-10-30' && v.grade === 2);
ok('the (RC) tag is dropped from names', v.ass === 'Tester One');
ok('answers are kept as numbers; not applicable stays out of the score', v.ans.c2 === 0 && v.ans.i3_p2 === 1 && v.ans.i1_p1 === 99);
const sc = score(v, F);
ok('score counts Yes over answered items', sc.answered === 4 && sc.pct === 50, JSON.stringify(sc));
ok('a No on a serious item is counted and labeled', sc.critical === 2 && sc.fails.some((f) => f.k === 'c2' && f.critical) && sc.fails.some((f) => f.k === 'i3' && f.pupil === 1 && f.label === 'Answer graded correctly'));
ok('the serious list is the proposed one', ['c2', 'g1', 'g2', 'g3', 'g5', 'g6', 'i3', 'i4'].every((k) => CRITICAL.has(k)) && CRITICAL.size === 8);
ok('numeric fields are not scored as items', !('g2a' in v.ans) && v.reg === 31);
ok('only the distance from the school is stored, never the point', v.gps_m != null && v.gps_m < 5 && !JSON.stringify(v).includes(String(here[0]).slice(0, 6)));

// the view: plan, records, register, location, repeat
const put = (k, x) => mem.set(k, JSON.stringify(x));
const today = eatToday();
put('v2:qa:form', { ...F, at: new Date().toISOString() }); put('v2:qa:sync', { at: new Date().toISOString(), ok: true, n: 3 });
put('v2:plan:' + S.region, { region: S.region, visits: [{ school: sid, date: '2026-11-05', team: ['Someone Else'] }] });
const far = [here[0] + 0.1, here[1]]; // about 11 km away
put('v2:qa:visits', [visitOf(raw({ _id: 12, _geolocation: far }), F), visitOf(raw({ _id: 11 }), F), visitOf(raw({ _id: 13, 'grp_a/visit_date': '2099-01-01', _geolocation: null }), F)]);
const sum = { schools: { [sid]: { dayAdmins: {}, g: { 2: { att: 40 } } } } };
const view = await qaView(env, sum); const byId = Object.fromEntries(view.visits.map((x) => [x.id, x])); const kinds = (id) => byId[id].flags.map((f) => f.t);
ok('a visit on a day the plan does not have is flagged', kinds(11).includes('plan'));
ok('a far-away QA form is flagged, a close one is not', kinds(12).includes('gps') && !kinds(11).includes('gps'));
ok('a missing location is flagged', kinds(13).includes('gps'));
ok('a future date is flagged', kinds(13).includes('date'));
ok('no records by that person that day is flagged', kinds(11).includes('records'));
ok('a different register count is flagged', kinds(11).includes('register'));
ok('the same visit twice: the later record is the repeat', kinds(12).includes('dup') && !kinds(11).includes('dup'));
ok('a role in brackets is dropped from any name label', visitOf(raw({ 'grp_a/ass_name': 'r__y' }), { ...F, lists: { ...F.lists, enumerator: { r__y: 'Tester Two (Volunteer)' } } }).ass === 'Tester Two');
ok('roll-ups add up', view.summary.visits === 3 && view.summary.schools === 1 && view.summary.sections.c.pct === 0 && view.summary.top_fails[0].fails >= 1);
ok('the output carries no coordinates', !/"gps":|_geolocation/.test(JSON.stringify(view)) && !/-?\d{1,2}\.\d{5,}/.test(JSON.stringify(view)));
ok('wording is support-first, not accusing', !/cheat|fraud|lying|suspicious/i.test(JSON.stringify(view.visits.map((x) => x.flags))));
done();
