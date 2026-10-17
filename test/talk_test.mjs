// Direct messages, questions to HQ, HQ-only notes
import { env, mem, ok, done } from './_kit.mjs';
import { sendDm, dmInbox, dmAck, dmSent, askCreate, askList, askAct, notesList, notesAct } from '../src/talk.js';
import { STAFF } from '../src/config.js';
const vol = STAFF.find((s) => s.active && s.role === 'volunteer' && s.region === 'TANGA'); const vol2 = STAFF.find((s) => s.active && s.role === 'volunteer' && s.region === 'MARA');
const rcT = STAFF.find((s) => s.active && s.role === 'rc' && s.region === 'TANGA'); const rcM = STAFF.find((s) => s.active && s.role === 'rc' && s.region === 'MARA');
const W = (s) => ({ role: s.role, id: s.id, name: s.name, region: s.region, position: s.position });
const hq = { role: 'hq', level: 'admin', name: 'Mundo', id: 'hq:h1', hq_id: 'h1' }; const hqv = { role: 'hq', level: 'viewer', name: 'View', id: 'hq:h8' };
mem.set('v2:hq', JSON.stringify({ users: [{ id: 'h1', name: 'Mundo', level: 'admin', review_level: 3, active: true }, { id: 'h2', name: 'Joram', level: 'admin', review_level: 2, active: true }], shared_enabled: true }));
// direct messages
ok('a volunteer cannot send messages', (await sendDm(env, W(vol), { to: { kind: 'person', id: vol2.id }, text: 'hello there' })).status === 403);
ok('an HQ viewer cannot send messages', (await sendDm(env, hqv, { to: { kind: 'person', id: vol.id }, text: 'hello there' })).status === 403);
ok('an RC cannot message another region', (await sendDm(env, W(rcT), { to: { kind: 'person', id: vol2.id }, text: 'hello there' })).status === 403);
ok('an empty message is refused', Boolean((await sendDm(env, hq, { to: { kind: 'person', id: vol.id }, text: ' ' })).error));
let r = await sendDm(env, W(rcT), { to: { kind: 'person', id: vol.id }, text: 'Please finish your queries today.' }); ok('an RC messages a volunteer in their region', r.ok && r.recipients === 1, JSON.stringify(r));
r = await sendDm(env, hq, { to: { kind: 'region', region: 'TANGA', roles: ['volunteer'] }, text: 'Team message for Tanga volunteers.' }); ok('HQ messages a whole team by role', r.ok && r.recipients === STAFF.filter((s) => s.active && s.region === 'TANGA' && s.role === 'volunteer').length, JSON.stringify(r));
let inbox = await dmInbox(env, W(vol)); ok('the volunteer sees both messages as unread', inbox.items.length === 2 && inbox.unread === 2);
ok('a person outside the team sees nothing', (await dmInbox(env, W(vol2))).items.length === 0);
await dmAck(env, W(vol), inbox.items[0].id); inbox = await dmInbox(env, W(vol)); ok('acknowledging marks it read', inbox.unread === 1);
ok('another person cannot acknowledge it', (await dmAck(env, W(vol2), inbox.items[0].id)).status === 404);
const sent = await dmSent(env, hq); ok('HQ sees who has not read a message', sent.items.length === 2 && sent.items.some((m) => m.unread_names.length > 0));
ok('an RC sees only their own sent messages', (await dmSent(env, W(rcM))).items.length === 0);
// questions
ok('HQ cannot ask a field question', (await askCreate(env, hq, { text: 'a long enough question', cat: 'plan' })).status === 403);
ok('a short question is refused', Boolean((await askCreate(env, W(vol), { text: 'help', cat: 'plan' })).error));
r = await askCreate(env, W(vol), { text: 'My phone shows a form error when I save the sampling form. What do I do?', cat: 'phone' }); ok('a volunteer asks: it goes to their RC first', r.ok && r.owner === 'rc');
let l = await askList(env, W(rcT)); ok('the RC of that region sees it', l.others.length === 1 && l.counts.to_answer === 1);
ok('an RC of another region does not', (await askList(env, W(rcM))).others.length === 0);
const qid = r.id;
ok('another volunteer cannot answer it', (await askAct(env, W(vol2), { id: qid, action: 'answer', text: 'try this' })).status === 404);
r = await askAct(env, W(rcT), { id: qid, action: 'escalate', text: 'Needs a form fix' }); ok('the RC sends it up to HQ', r.ok && r.status === 'escalated');
r = await askAct(env, hq, { id: qid, action: 'answer', text: 'Update the form from the Admin page, then retry.' }); ok('HQ answers', r.ok && r.status === 'answered');
l = await askList(env, W(vol)); ok('the asker sees the answer', l.mine[0].status === 'answered' && l.mine[0].answer.text.includes('Update the form'));
r = await askAct(env, W(vol), { id: qid, action: 'followup', text: 'It still fails after updating.' }); ok('the asker can follow up and it reopens', r.ok && r.status === 'escalated');
r = await askAct(env, W(vol), { id: qid, action: 'close', text: 'Fixed, thanks' }); ok('the asker can close it', r.ok && r.status === 'closed');
// notes
ok('field staff cannot read HQ notes', (await notesList(env, W(rcT), 'school:PS1')).status === 403);
ok('an HQ viewer cannot write notes', (await notesAct(env, hqv, { action: 'add', target: 'school:PS0302023', text: 'note' })).status === 403);
ok('a note needs a real target', Boolean((await notesAct(env, hq, { action: 'add', target: 'nonsense', text: 'note text' })).error));
r = await notesAct(env, hq, { action: 'add', target: 'person:Ashura Waziri', text: 'Ask about the Gr 2 tests before the review.', mentions: ['hq:h2', 'hq:zzz', 'hq:h1'] }); ok('an HQ admin adds a note and tags a colleague', r.ok);
const joram = { role: 'hq', level: 'admin', name: 'Joram', id: 'hq:h2', hq_id: 'h2' };
let n = await notesList(env, joram, 'person:Ashura Waziri'); ok('the note shows for HQ, with only valid tags kept', n.notes.length === 1 && JSON.stringify(n.notes[0].mentions) === '["hq:h2"]');
ok('the tagged person finds it in their mentions', (await notesList(env, joram)).mentions.length === 1);
await notesAct(env, joram, { action: 'seen', id: n.notes[0].id }); ok('seen clears the mention', (await notesList(env, joram)).mentions.length === 0);
const ed = { role: 'hq', level: 'editor', name: 'Ed', id: 'hq:h5', hq_id: 'h5' };
ok('an editor cannot delete someone else\'s note', (await notesAct(env, ed, { action: 'delete', id: n.notes[0].id })).status === 403);
await notesAct(env, joram, { action: 'pin', id: n.notes[0].id }); ok('a note can be pinned', (await notesList(env, joram, 'person:Ashura Waziri')).notes[0].pinned === true);
ok('the author can delete their note', (await notesAct(env, hq, { action: 'delete', id: n.notes[0].id })).ok);
done();
