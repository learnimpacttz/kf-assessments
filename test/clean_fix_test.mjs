// Data cleaning: typed entries survive a redraw, clearer pupil-number messages, no-op edits refused, and slow steps cannot erase each other
import fs from 'node:fs';
import { env as baseEnv, ok, done } from './_kit.mjs';
import { checkEdit } from '../src/edits.js';
import { actOnRequest, findRecords, listRequests } from '../src/deletions.js';
import { SCHOOLS_BY_REGION } from '../src/config.js';

const school = SCHOOLS_BY_REGION.TANGA[0].id;
const rec = (id, rand) => ({ _id: id, year: '2026', today: '2026-10-26', 'id_data/school': school, 'id_data/grade': '1', 'id_data/enumerator': 'Hawa Hussein', stuid: `2026${school}1${String(rand).padStart(3, '0')}`, rand_long: String(rand).padStart(3, '0'), 'stu_info/rand_nr': String(rand), start: '2026-10-26T09:00:00+03:00', _submission_time: '2026-10-26T08:11:00' });
const db = [rec(1, 15), rec(2, 15), rec(3, 5), rec(4, 7), rec(5, 9), rec(6, 11)];
let delay = 0; const patches = [];
globalThis.fetch = async (u, i) => {
  const su = String(u); await new Promise((r) => setTimeout(r, delay));
  if (/\/data\/bulk\/$/.test(su) && i && i.method === 'PATCH') { const b = JSON.parse(i.body).payload; for (const id of b.submission_ids) Object.assign(db.find((x) => x._id === id), b.data); patches.push(b); return new Response('{}', { status: 200 }); }
  const one = /\/data\/(\d+)\/\?/.exec(su); if (one) return new Response(JSON.stringify(db.find((x) => String(x._id) === one[1]) || {}), { status: 200 });
  const q = JSON.parse(new URL(su).searchParams.get('query') || '{}'); let rows = db;
  if (q._id && q._id.$in) rows = rows.filter((x) => q._id.$in.includes(x._id)); if (q.stuid) rows = rows.filter((x) => x.stuid === q.stuid); if (q['id_data/school']) rows = rows.filter((x) => x['id_data/school'] === q['id_data/school']);
  return new Response(JSON.stringify({ results: rows, next: null }), { status: 200 });
};
const env = { ...baseEnv, KOBO_SERVER: 'kobo.test', KOBO_ASSET_ID: 'A1', KOBO_ASSET_SAMPLING: 'A1', KOBO_TOKEN: 'tok' };
const joram = { role: 'hq', level: 'editor', name: 'Joram Joas', id: 'h2', hq_id: 'h2', review_level: 2 };
const mundo = { role: 'hq', level: 'admin', name: 'Chogohe Edwin Mundo', id: 'h1', hq_id: 'h1', review_level: 3 };
const sug = (who, ids, values, why = 'The same pupil number was given to two pupils') => actOnRequest(env, who, { action: 'suggest', kind: 'students', ids, reason: why, type: 'edit', field: 'pupil', value: '', values });

// ---- the messages say what to type
let c = checkEdit({ field: 'pupil', values: { 5: '2026200800412' } }, 'students', joram);
ok('a whole ID typed in the box: the message says to type only the last digits', /last digits/.test(c.error) && /Record 5/.test(c.error), c.error);
c = checkEdit({ field: 'pupil', values: { 5: '0' } }, 'students', joram); ok('zero is refused with the same help', /not a pupil number/.test(c.error));
c = checkEdit({ field: 'pupil', values: { 5: ' ' } }, 'students', joram); ok('a blank box is refused', /not a pupil number/.test(c.error));
c = checkEdit({ field: 'pupil', values: {} }, 'students', joram); ok('no numbers at all: the message says what to do', /No pupil numbers arrived/.test(c.error), c.error);
c = checkEdit({ field: 'pupil', values: { 5: '006' } }, 'students', joram); ok('006 is accepted as 6', c.edit && c.edit.values[5] === 6);

// ---- a request that changes nothing is refused; one where only one record changes is fine (keep one at 15, move the other)
let r = await sug(joram, [3], { 3: '5' }); ok('the same number on the only record: nothing would change', /Nothing would change/.test(r.error), r.error);
r = await sug(joram, [1, 2], { 1: '15', 2: '17' }); ok('keep one at 15 and move the other to 17: accepted and goes to Mundo', r.ok && r.stage === 'initiated', JSON.stringify(r));
const keepId = r.id;

// ---- a record in an open request says whose request it is and where it waits
const found = await findRecords(env, mundo, { kind: 'students', school });
const f2 = found.records.find((x) => x.id === 2);
ok('the search shows the request that holds a record', f2.pending && f2.pending_in && f2.pending_in.id === keepId && /Joram/.test(f2.pending_in.by) && /Mundo/.test(f2.pending_in.stage_label), JSON.stringify(f2.pending_in));
ok('a record not in a request has no such note', !found.records.find((x) => x.id === 4).pending_in);
r = await sug(joram, [2], { 2: '19' }); ok('a second request for that record is refused with a pointer to the list', /open request/.test(r.error) && /whose request/.test(r.error), r.error);

// ---- two identical suggestions sent together while KoBo is slow (the page was pressed twice): one request, no duplicate
delay = 40;
const [a, b] = await Promise.all([sug(joram, [4], { 4: '8' }), sug(joram, [4], { 4: '8' })]);
ok('pressed twice at once: exactly one goes through', [a, b].filter((x) => x.ok).length === 1 && [a, b].filter((x) => x.error).length === 1, JSON.stringify([a, b]));
ok('and only one request exists for that record', (await listRequests(env, mundo)).requests.filter((x) => x.ids.includes(4)).length === 1);

// ---- Mundo applies a request (slow) while Joram sends another: neither is lost
delay = 60;
const applying = actOnRequest(env, mundo, { action: 'apply', id: keepId, confirm: 2 });
await new Promise((rs) => setTimeout(rs, 20));
const second = await sug(joram, [5], { 5: '10' }, 'A different pupil was given the wrong number by mistake');
const applied = await applying; delay = 0;
ok('Mundo\'s apply finished and changed the record in KoBo', applied.ok && db.find((x) => x._id === 2).stuid.endsWith('017'), JSON.stringify(applied));
const all = (await listRequests(env, mundo)).requests;
ok('Joram\'s request sent during the apply is still there', second.ok && all.some((x) => x.id === second.id), JSON.stringify(all.map((x) => x.id + ':' + x.stage)));
ok('the applied request shows as applied', all.find((x) => x.id === keepId).stage === 'done');

// ---- the page: guards in the source
const app = fs.readFileSync('../public/app.js', 'utf8');
ok('the page keeps typed entries across a redraw (keep before, restore after)', /const kept = keepDrafts\(\);\n\s+\$\('#app'\)\.innerHTML/.test(app) && /restoreDrafts\(kept\);/.test(app));
ok('the kept fields include the pupil numbers, the value, the reason, the confirm number and the notes', /DRAFT_SEL = '#dfValue, #dfReason, \[data-dpn\], \[id\^="dcf-"\], \[id\^="dtx-"\]'/.test(app));
ok('a successful send clears what was typed, a failed one keeps it', /dropDrafts\('\*'\)/.test(app) && /if \(a === 'dlAct'\) dropDrafts\('dcf-'/.test(app));
ok('a second press while a step runs is ignored', /if \(C\.sending && \(a === 'dlSuggest' \|\| a === 'dlAct'\)\) return;/.test(app));
ok('the row says whose request holds a record, with a way to open it', /data-act="dlGo"/.test(app) && /pending_in/.test(app));
ok('what happens to a request (done, stopped, a wrong confirm number) is shown on that request\'s card, not beside the search button', /const cardMsgHtml/.test(app) && /C\.cardMsg = \{ id, text: r\.ok/.test(app) && !/C\.msg = \{ initiate/.test(app));
ok('the pupil box tells what to type', /last digits of the pupil ID/.test(app) && /data-dpv=/.test(app));
done();
