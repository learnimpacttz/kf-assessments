// Withdrawing queries raised in error: nothing is deleted, a copy is saved first, the dry run changes nothing, and it is safe to run twice
import { env, mem, ok, done } from './_kit.mjs';
import { withdrawFalseDuplicates, listWithdrawn, loadQueries, flagKey, RECHECK_NOTE } from '../src/queries.js';
const who = { name: 'Admin', role: 'hq', level: 'admin' };
const resp = { text: 'We tested the same pupil twice by mistake and fixed it', by: 'Nuru G. Masawika', at: '2026-10-19T12:00:00Z' };
const reply = (stage, status = 'open') => ({ status, thread: [], wf: { stage, response: resp, history: [{ action: 'submitted' }] } });
const realFlag = { type: 'dup', school: 'PS1', grade: 2, date: '2026-10-19', admin: 'Salimu' };
const store = {
  'dup|PS1|2|2026-10-19|Nuru': reply('hq1'),                         // raised in error, flag is gone: withdraw
  'dup|PS2|1|2026-10-15|Mikael': reply('final', 'resolved'),          // raised in error, resolved: withdraw
  'dup|PS1|2|2026-10-19|Salimu': reply('final'),                      // now a real, smaller check: keep, add a note
  'dup|PS3|1|2026-10-19|Ayubu': reply('hq1'),                         // a deletion was approved at this school: leave
  'dup|PS4|1|2026-10-01|Old': reply('hq1'),                           // before the fault: leave
  'fast|PS5|3|2026-10-19|Hawa': reply('hq1'),                         // another kind of check: untouched
  'dup|PS6|1|2026-10-19|Empty': { status: 'open', thread: [] },       // no activity: nothing to withdraw
};
mem.set('v2:queries', JSON.stringify(store));
const opts = { doneSchools: new Set(['PS3']) };
const dry = await withdrawFalseDuplicates(env, who, [realFlag], { ...opts, apply: false });
ok('a dry run lists what it would do', dry.withdraw.length === 2 && dry.notes.length === 1 && dry.left.length === 2);
ok('a dry run changes nothing', JSON.stringify(await loadQueries(env)) === JSON.stringify(store));
const r = await withdrawFalseDuplicates(env, who, [realFlag], { ...opts, apply: true });
const after = await loadQueries(env);
ok('the two queries raised in error are moved, not lost', !after['dup|PS1|2|2026-10-19|Nuru'] && after['withdrawn|dup|PS1|2|2026-10-19|Nuru'].wf.response.text === resp.text && after['withdrawn|dup|PS2|1|2026-10-15|Mikael'].status === 'resolved');
ok('the withdrawn record says who, when and why', Boolean(after['withdrawn|dup|PS1|2|2026-10-19|Nuru'].withdrawn.reason) && after['withdrawn|dup|PS1|2|2026-10-19|Nuru'].withdrawn.by === 'Admin');
ok('a reply on a real, smaller check stays and gets a note', after['dup|PS1|2|2026-10-19|Salimu'].wf.response.text === resp.text && after['dup|PS1|2|2026-10-19|Salimu'].thread.some((m) => m.text === RECHECK_NOTE && m.role === 'system'));
ok('a school with an approved deletion, an old check and other kinds of check are left alone', JSON.stringify(after['dup|PS3|1|2026-10-19|Ayubu']) === JSON.stringify(store['dup|PS3|1|2026-10-19|Ayubu']) && JSON.stringify(after['dup|PS4|1|2026-10-01|Old']) === JSON.stringify(store['dup|PS4|1|2026-10-01|Old']) && JSON.stringify(after['fast|PS5|3|2026-10-19|Hawa']) === JSON.stringify(store['fast|PS5|3|2026-10-19|Hawa']));
ok('a full copy was saved first', Boolean(r.backup) && mem.get(r.backup) === JSON.stringify(store));
const again = await withdrawFalseDuplicates(env, who, [realFlag], { ...opts, apply: true });
const after2 = await loadQueries(env);
ok('running it again changes nothing more', again.withdraw.length === 0 && again.notes.length === 0 && after2['dup|PS1|2|2026-10-19|Salimu'].thread.filter((m) => m.text === RECHECK_NOTE).length === 1);
ok('the key is free: a new check on the same school, grade, day and person starts clean', !after2['dup|PS1|2|2026-10-19|Nuru']);
const list = await listWithdrawn(env);
ok('the withdrawn list shows who replied and what they wrote', list.length === 2 && list.every((x) => x.replied_by && x.response));
done();
