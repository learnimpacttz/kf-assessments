// A finished data change closes the checks it cleared: moved with their replies (nothing deleted), listed on the request, once, and only after the rebuild
import { env, mem, ok, done } from './_kit.mjs';
import { reconcileClosedChecks } from '../src/deletions.js';
import { loadQueries, flagKey } from '../src/queries.js';
const resp = { text: 'The attendance was recorded as 6 but it was 7', by: 'Zaina Omary Mangare', at: '2026-10-20T12:00:00Z' };
const reply = (stage, status = 'open') => ({ status, thread: [], wf: { stage, response: resp, history: [{ action: 'submitted' }] } });
const over = 'over|PS0802151|2|2026-10-20|Zaina';
const store = {
  [over]: reply('hq1'),                                         // cleared by the edit: archive
  'dup|PS0802151|2|2026-10-20|Zaina': reply('team'),            // same school and grade, a kind a data change can clear: archive
  'over|PS0802151|1|2026-10-20|Zaina': reply('team'),           // another grade: leave
  'over|PS9999999|2|2026-10-20|Other': reply('team'),           // another school: leave
  'team|PS0802151|2|2026-10-20|': reply('team'),                // not something a data change clears: leave
  'over|PS0802151|2|2026-10-19|Still': reply('team'),           // still a live flag: leave
  'over|PS0802151|2|2026-10-18|Empty': { status: 'open', thread: [] }, // nothing written: nothing to keep
};
const live = [{ type: 'over', school: 'PS0802151', grade: 2, date: '2026-10-19', admin: 'Still' }];
const req = { id: 'rsvun8z0', type: 'edit', kind: 'sampling', stage: 'done', updated_at: '2026-10-21T14:44:30Z', items: [{ id: 897158501, school: 'PS0802151', grade: '2' }], history: [] };
const later = Date.parse('2026-10-21T14:55:00Z');
mem.set('v2:queries', JSON.stringify(store)); mem.set('v2:delreq', JSON.stringify([JSON.parse(JSON.stringify(req))]));
const reqs = async () => JSON.parse(mem.get('v2:delreq'));

ok('it waits a few minutes after the change', (await reconcileClosedChecks(env, live, Date.parse('2026-10-21T14:46:00Z'))) === 0 && !(await reqs())[0].closed_checked_at);
mem.set('v2:rebuild', JSON.stringify([{ kind: 'sampling', year: '2026' }]));
ok('it waits while the dashboard is still rebuilding', (await reconcileClosedChecks(env, live, later)) === 0 && !(await reqs())[0].closed_checked_at);
mem.delete('v2:rebuild');
const n = await reconcileClosedChecks(env, live, later);
const q = await loadQueries(env); const r = (await reqs())[0];
ok('the two cleared checks are archived', n === 2 && !q[over] && Boolean(q['closed|' + over]) && Boolean(q['closed|dup|PS0802151|2|2026-10-20|Zaina']));
ok('nothing is lost: the reply and its stage are kept, with the request that closed it', q['closed|' + over].wf.response.text === resp.text && q['closed|' + over].closed.request === 'rsvun8z0');
ok('other grades, other schools, other kinds of check, live flags and empty queries are untouched', ['over|PS0802151|1|2026-10-20|Zaina', 'over|PS9999999|2|2026-10-20|Other', 'team|PS0802151|2|2026-10-20|', 'over|PS0802151|2|2026-10-19|Still', 'over|PS0802151|2|2026-10-18|Empty'].every((k) => JSON.stringify(q[k]) === JSON.stringify(store[k])));
ok('the request lists what it closed, with who replied and where it was', r.closed_checks.length === 2 && r.closed_checks.some((c) => c.type === 'over' && c.replied_by === 'Zaina Omary Mangare' && c.stage === 'hq1') && Boolean(r.closed_checked_at));
ok('a full copy of the queries was saved first', Object.keys(Object.fromEntries([...mem.entries()].filter(([k]) => k.startsWith('v2:queries:backup:')))).length === 1);
ok('running it again does nothing more', (await reconcileClosedChecks(env, live, later + 60e3)) === 0 && Object.keys(await loadQueries(env)).filter((k) => k.startsWith('closed|')).length === 2);
ok('the key is free again: a new check with the same key starts clean', !(await loadQueries(env))[over]);
// a request that cleared nothing is still marked as checked, so the card can say so
mem.set('v2:delreq', JSON.stringify([{ ...req, id: 'r2', items: [{ id: 1, school: 'PS1111111', grade: '3' }], updated_at: '2026-10-21T14:40:00Z' }]));
ok('a change that cleared nothing is recorded as checked', (await reconcileClosedChecks(env, live, later)) === 0 && (await reqs())[0].closed_checks.length === 0 && Boolean((await reqs())[0].closed_checked_at));
done();
