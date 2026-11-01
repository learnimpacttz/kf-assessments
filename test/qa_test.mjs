// QA visits: scoring, the cross-checks against plan, location and records, and that no coordinates are kept
import { ok, done, env, mem } from './_kit.mjs';
import { visitOf, score, qaView, qaAttention, raiseQa, qaRaisedFlags, alertQa, CRITICAL } from '../src/qa.js';
import { STAFF } from '../src/config.js';
import { decorate, flagKey } from '../src/queries.js';
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

// pupil numbers: the number the observer saw is looked up in the tests for that school and grade
put('v2:state:2026', { sg: { [sid + '|2']: { rn: ['7~Tester One~s1~501', '9~Someone Else~s2~502'] } } });
put('v2:qa:visits', [visitOf(raw({ _id: 21, 'grp_a/visit_date': '2026-10-31', rand_p1: '7', rand_p2: '9', rand_p3: '15' }), F)]);
const v2 = (await qaView(env, sum)).visits[0]; const pf = v2.flags.filter((f) => f.t === 'pupil').map((f) => f.text);
ok('a pupil number with a test by the same assessor is fine', !pf.some((t) => /Pupil 1 /.test(t)), pf.join(' | '));
ok('a pupil number tested by someone else is flagged', pf.some((t) => /Pupil 2 .*tested by Someone Else/.test(t)));
ok('a pupil number with no test yet is flagged, gently', pf.some((t) => /Pupil 3 .*no test record/.test(t)) && v2.rands.join() === '7,9,15,');
// the Bridge: recent visits with a serious No
const at = await qaAttention(env, '2026-11-01'); ok('the Bridge hears of a recent visit with a serious item', at.n === 1 && at.list[0].serious === 2, JSON.stringify(at));
put('v2:qa:visits', [visitOf(raw({ _id: 22, 'grp_a/visit_date': '2026-10-10', _submission_time: '2026-10-10T09:00:00' }), F)]); ok('an old visit is not repeated on the Bridge', (await qaAttention(env, '2026-11-01')).n === 0);
put('v2:qa:visits', [visitOf(raw({ _id: 31, 'grp_a/obs_comment': 'TEST please ignore' }), F), visitOf(raw({ _id: 32 }), F)]);
const vt = await qaView(env, sum); ok('a practice submission is shown but not counted', vt.visits.length === 2 && vt.visits.find((x) => x.id === 31).test === true && vt.summary.visits === 1);
ok('a practice submission never reaches the Bridge', (await qaAttention(env, '2026-11-01')).list.every((x) => x.id !== 31));

// HQ sends a finding to the team as a query: it becomes an ordinary "qa" check for the person the visit was about
const who = { role: 'hq', name: 'HQ Tester', level: 'admin' }; const me = STAFF.find((s) => s.active && s.role === 'volunteer');
const FF = { ...F, lists: { ...F.lists, enumerator: { r__x: me.name } } };
put('v2:qa:form', { ...FF, at: new Date().toISOString() });
put('v2:qa:visits', [visitOf(raw({ _id: 41, 'grp_a/obs_comment': '' }), FF), visitOf(raw({ _id: 42, 'grp_a/ass_name': 'r__zz', 'grp_c/c2': '1', 'grp_b/b1': '1', 'grp_g/g3': '1', 'grp_i/i3_p1': '1' }), FF), visitOf(raw({ _id: 43, 'grp_a/obs_comment': 'TEST' }), FF)]);
const r1 = await raiseQa(env, who, { id: 41, note: 'Please explain what happened with consent' });
ok('a finding can be sent to the team as a query', r1.ok === true && /^qa\|/.test(r1.key), JSON.stringify(r1));
const fl = await qaRaisedFlags(env); ok('it becomes a check for the person the visit was about', fl.length === 1 && fl[0].type === 'qa' && fl[0].admin === me.name && fl[0].school === sid && /Please explain/.test(fl[0].text));
ok('the wording is for support, with no score or accusation', !/%|cheat|fraud|fail/i.test(fl[0].text + fl[0].hint), fl[0].text);
const dq = decorate(fl, {}); ok('the normal query chain recognizes it (same key, volunteer is the responder)', dq[0].qk === r1.key && dq[0].vol === true && dq[0].qk === flagKey(fl[0]));
ok('sending the same finding twice is refused', (await raiseQa(env, who, { id: 41 })).status === 409);
ok('a visit about someone not in the people list cannot be sent', /people list/.test((await raiseQa(env, who, { id: 42 })).error || ''));
ok('a practice visit cannot be sent', (await raiseQa(env, who, { id: 43 })).status === 422);
ok('the visit shows who sent it', (await qaView(env, sum)).visits.find((x) => x.id === 41).raised.by === 'HQ Tester');

// phone alert: first run only notes what exists; later a new visit with a serious No sends one alert to HQ (not Advisors), a clean or practice visit sends none
mem.delete('v2:qa:alerted'); const calls = []; const spy = async (e, pred, a) => { calls.push({ pred, a }); };
put('v2:qa:visits', [visitOf(raw({ _id: 51 }), FF)]);
ok('the first run sends nothing, it only notes what is there', (await alertQa(env, spy)).baseline === 1 && calls.length === 0);
put('v2:qa:visits', [visitOf(raw({ _id: 52 }), FF), visitOf(raw({ _id: 53, 'grp_c/c2': '1', 'grp_i/i3_p1': '1', 'grp_i/i3_p2': '1', 'grp_b/b1': '1' }), FF), visitOf(raw({ _id: 54, 'grp_a/obs_comment': 'TEST' }), FF), visitOf(raw({ _id: 51 }), FF)]);
const r5 = await alertQa(env, spy); ok('only the new visit with a serious No sends an alert', r5.sent === 1 && calls.length === 1 && /serious item/.test(calls[0].a.body) && calls[0].a.url === '/#qa', JSON.stringify(r5));
ok('it goes to HQ, not to Advisors or the field', calls[0].pred({ role: 'hq' }) && !calls[0].pred({ role: 'hq', hide: ['messages'] }) && !calls[0].pred({ role: 'volunteer' }) && !calls[0].pred({ role: 'rc' }));
ok('the same visit is never alerted twice', (await alertQa(env, spy)).sent === 0 && calls.length === 1);
ok('the alert carries no assessor name or score', !/%|Tester|Someone/.test(calls[0].a.body + calls[0].a.title));
done();
