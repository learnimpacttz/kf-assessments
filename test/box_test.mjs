// Suggestion box: locked on the sender's phone, nothing about the sender stored, readable only by the Executive Director
import { env, mem, ok, done } from './_kit.mjs';
import BoxCrypto from '../public/boxcrypto.js';
import { boxPublic, setBoxKey, setBoxLive, canPreview, submitBox, listBox, markBox, deleteBox, isReader, canWrite, BOX_DAILY_CAP, boxSummary, markSaved, takePending } from '../src/box.js';
import fs from 'node:fs';
const ed = { role: 'hq', level: 'admin', hq_id: 'h3', name: 'Michael Kamukulu' };
const mundo = { role: 'hq', level: 'admin', hq_id: 'h1', name: 'Chogohe Edwin Mundo' };
const joram = { role: 'hq', level: 'editor', hq_id: 'h2', name: 'Joram Joas' };
const vol = { role: 'volunteer', id: 4, name: 'Hawa Hussein', position: 'Volunteer 2', region: 'TANGA' };
const rc = { role: 'rc', id: 1, name: 'Hatibu Lugendo', region: 'TANGA' };

// the lock itself
const keys = await BoxCrypto.genKeys(); const other = await BoxCrypto.genKeys();
const lk = await BoxCrypto.encrypt(keys.spki, { t: 'Tunaomba usafiri wa mapema siku ya Jumanne', c: 'pendekezo', at: '2026-10-22T08:00:00Z' });
ok('a message locked with the key opens with the private key', (await BoxCrypto.decrypt(keys.jwk, lk)).t === 'Tunaomba usafiri wa mapema siku ya Jumanne');
let wrong = false; try { await BoxCrypto.decrypt(other.jwk, lk); } catch { wrong = true; }
ok('another key cannot open it', wrong);
ok('the locked text does not contain the words', !atob(lk.ct).includes('usafiri') && !JSON.stringify(lk).includes('usafiri'));
const short = await BoxCrypto.encrypt(keys.spki, { t: 'a' }), long = await BoxCrypto.encrypt(keys.spki, { t: 'a'.repeat(300) });
ok('short and medium messages look the same length (512-byte steps)', short.ct.length === long.ct.length);
ok('the key code is stable and readable from the private file too', keys.fp === (await BoxCrypto.fingerprintOfJwk(keys.jwk)) && /^([0-9A-F]{4} ){3}[0-9A-F]{4}$/.test(keys.fp));
ok('two messages with the same text are locked differently', (await BoxCrypto.encrypt(keys.spki, { t: 'x' })).ct !== (await BoxCrypto.encrypt(keys.spki, { t: 'x' })).ct);

// who may do what
ok('only the Executive Director is the reader', isReader(ed, env) && !isReader(mundo, env) && !isReader(joram, env) && !isReader(vol, env) && !isReader({ ...ed, viewAs: 'hq:h1' }, env));
ok('the field team writes, HQ does not', canWrite(vol) && canWrite(rc) && !canWrite(ed) && !canWrite(mundo) && !canWrite({ ...vol, viewAs: 'x' }));
ok('nobody but the Executive Director can set the key', (await setBoxKey(env, mundo, { spki: keys.spki, fp: keys.fp })).status === 403 && (await setBoxKey(env, joram, { spki: keys.spki, fp: keys.fp })).status === 403);
ok('a message cannot be sent before the box is open', (await submitBox(env, vol, { v: 1, kfp: keys.fp, ...lk })).status === 503);
ok('a bad key is refused', (await setBoxKey(env, ed, { spki: 'not a key!', fp: 'x' })).status === 422);
ok('saving the key does not open the box: the field team sees nothing and cannot send', (await setBoxKey(env, ed, { spki: keys.spki, fp: keys.fp })).ok === true && (await boxPublic(env, vol)).open === false && !(await boxPublic(env, vol)).spki && (await submitBox(env, vol, { v: 1, kfp: keys.fp, ...lk })).status === 503);
ok('only the Executive Director can preview a hidden box, by viewing as a field user', canPreview({ ...vol, viewAs: true, viewBy: 'h3' }, env) && !canPreview({ ...vol, viewAs: true, viewBy: 'h1' }, env) && !canPreview(vol, env) && (await boxPublic(env, { ...vol, viewAs: true, viewBy: 'h3' })).open === true && (await boxPublic(env, { ...vol, viewAs: true, viewBy: 'h3' })).hidden === true && (await boxPublic(env, { ...vol, viewAs: true, viewBy: 'h1' })).open === false);
ok('only the Executive Director can open or hide it, and only once there is a key', (await setBoxLive(env, mundo, { live: true })).status === 403 && (await setBoxLive(env, vol, { live: true })).status === 403 && (await setBoxLive(env, ed, { live: true })).live === true);
ok('once open, the public key is shown to the field and the reader, and not to guests', (await boxPublic(env, vol)).open === true && (await boxPublic(env, rc)).fp === keys.fp && (await boxPublic(env, ed)).live === true && (await boxPublic(env, ed)).reader === true && (await boxPublic(env, { role: 'guest' })).status === 403);

// sending
const sent = await submitBox(env, vol, { v: 1, kfp: keys.fp, ...lk });
ok('a volunteer can send', sent.ok === true);
const stored = [...mem.entries()].filter(([k]) => k.startsWith('v2:box:i:')).map(([, v]) => v);
const raw = JSON.stringify([...mem.entries()].filter(([k]) => k.startsWith('v2:box:')));
ok('only the locked text, the day and the key code are stored', stored.length === 1 && Object.keys(JSON.parse(stored[0])).sort().join() === 'ct,day,id,iv,kfp,wk');
ok('nothing about the sender is stored anywhere in the box data', !/Hawa|Hussein|Volunteer|TANGA|"id":4|region|position|name/.test(raw.replace(/"day"/g, '')));
ok('the day is a date only, not a time', /^\d{4}-\d\d-\d\d$/.test(JSON.parse(stored[0]).day));
ok('a message locked with an old key is refused with a clear reason', (await submitBox(env, vol, { v: 1, kfp: 'AAAA AAAA AAAA AAAA', ...lk })).status === 409);
ok('a field user cannot send HQ-style or malformed data', (await submitBox(env, vol, { v: 1, kfp: keys.fp, iv: '!!', ct: 'x', wk: 'y' })).status === 422 && (await submitBox(env, vol, { v: 1, kfp: keys.fp, ...lk, ct: 'A'.repeat(20000) })).status === 413);
ok('HQ people other than the field cannot send', (await submitBox(env, mundo, { v: 1, kfp: keys.fp, ...lk })).status === 403);
const nm = await BoxCrypto.encrypt(keys.spki, { t: 'Nimeshuhudia jambo, naomba kuonana na ED', c: 'mzito', at: 'x', n: { name: 'Hawa Hussein', position: 'Volunteer 2', region: 'TANGA' } });
ok('a named message is also locked: the server still sees no name', (await submitBox(env, vol, { v: 1, kfp: keys.fp, ...nm })).ok && !JSON.stringify([...mem.entries()].filter(([k]) => k.startsWith('v2:box:'))).includes('Hawa'));

// reading
ok('nobody but the Executive Director can list', (await listBox(env, mundo)).status === 403 && (await listBox(env, joram)).status === 403 && (await listBox(env, vol)).status === 403);
const L = await listBox(env, ed, 3);
ok('the Executive Director gets the locked messages and opens them with the key file', L.items.length === 2 && (await Promise.all(L.items.map((it) => BoxCrypto.decrypt(keys.jwk, it)))).some((m) => m.n && m.n.name === 'Hawa Hussein'));
ok('what the server returns is still locked', !JSON.stringify(L).includes('usafiri') && !JSON.stringify(L).includes('Hawa'));
const id = L.items[0].id;
ok('only the reader can mark and delete', (await markBox(env, mundo, { id, status: 'read' })).status === 403 && (await deleteBox(env, mundo, { id })).status === 403);
ok('marking works and shows in the list', (await markBox(env, ed, { id, status: 'board' })).ok && (await listBox(env, ed)).items.find((i) => i.id === id).status === 'board' && (await markBox(env, ed, { id, status: 'bogus' })).status === 422);
ok('deleting removes the message and its mark', (await deleteBox(env, ed, { id })).ok && (await listBox(env, ed)).items.length === 1 && !mem.has('v2:box:i:' + id));

// limits
mem.set('v2:box:cnt:' + new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10), JSON.stringify(BOX_DAILY_CAP));
ok('there is a daily limit for the whole box, not per person', (await submitBox(env, rc, { v: 1, kfp: keys.fp, ...lk })).status === 429);

// the rest of the system must not record who used it
const index = fs.readFileSync('../src/index.js', 'utf8'), box = fs.readFileSync('../src/box.js', 'utf8'), app = fs.readFileSync('../public/app.js', 'utf8'), hq = fs.readFileSync('../src/hq.js', 'utf8');
ok('the box routes do not write to the activity log', !/\/api\/box/.test(hq) && !/logActivity/.test(box));
ok('the app does not count visits to the box pages', app.includes("tab === 'box' || tab === 'boxed') return;"));
ok('the box page is not stored in the usage trail or the sign-in remembered page', !/store\.set\('kf_start[^;]*'box'/.test(app));
ok('the private key page forgets what it decrypted when you leave', app.includes("S.tab === 'boxed' && k !== 'boxed' && S.bx) { S.bx.msgs = null"));
ok('the Executive Director can download the messages as a file, with or without names', app.includes("data-act=\"bxSave\" data-names=\"0\"") && app.includes("data-act=\"bxSave\" data-names=\"1\"") && app.includes('Sanduku_maoni_'));

// automation: counts, saved marks and the once-a-day number (the text is never needed for any of it)
const S0 = await boxSummary(env, ed);
ok('the reader sees counts only: total, not yet marked, not yet saved', S0.total === 1 && S0.new === 1 && S0.unsaved === 1 && Object.keys(S0).sort().join() === 'new,total,unsaved');
ok('nobody else can read the counts', (await boxSummary(env, mundo)).status === 403 && (await boxSummary(env, vol)).status === 403);
const idNow = (await listBox(env, ed)).items[0].id;
ok('saving marks a message as saved, and only the reader can say so', (await markSaved(env, mundo, { ids: [idNow] })).status === 403 && (await markSaved(env, ed, { ids: [idNow, 'bad id!'] })).n === 1 && (await boxSummary(env, ed)).unsaved === 0 && (await listBox(env, ed)).items[0].saved === true);
ok('a new message is unsaved until it is saved', await (async () => { mem.set('v2:box:cnt:' + new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10), JSON.stringify(0)); await submitBox(env, vol, { v: 1, kfp: keys.fp, ...await BoxCrypto.encrypt(keys.spki, { t: 'ujumbe mpya' }) }); return (await boxSummary(env, ed)).unsaved === 1; })());
const pend = await takePending(env);
ok('the daily alert has a number to report, and then starts again from zero', pend >= 1 && (await takePending(env)) === 0);
ok('the alert carries a number only, never the text', index.includes("`${n} new message${n > 1 ? 's' : ''} in the suggestion box`") && index.includes("hhmm === '14:30'"));
ok('the saved marks are backed up and cleaned up with the message', fs.readFileSync('../src/backup.js', 'utf8').includes('v2:box:saved') && box.includes('delete sv[id]'));
ok('the page saves new messages by itself and reminds on every page until they are saved', app.includes('async function boxAutoSave') && app.includes('const boxBanner') && app.includes('remBanner() + boxBanner()') && app.includes('The system cannot save for you when your key is not open'));
ok('the box is easy to find once it is open: top of the home pages, an icon in the top bar, a link on the main pages and in the account menu', app.includes("ph.insertAdjacentElement('afterend', d)") && app.includes('id="boxBtn"') && app.includes('const boxStrip') && app.includes("data-tab=\"box\">Sanduku la maoni · Suggestion box</button>") && app.includes('Mpya · New'));
ok('nothing is shown to the field team until the Executive Director has opened the box', app.includes('!S.bxOpen || S.tab ===') && app.includes('boxField() && S.bxOpen ?'));
ok('only the field team sees the sender card and icon, not HQ', app.includes("['volunteer', 'rc', 'arc'].includes(S.who.role)"));
ok('a preview (HQ viewing as a volunteer) can read the public key but cannot send', (await boxPublic(env, { ...vol, viewAs: true })).open === true && (await submitBox(env, { ...vol, viewAs: true }, { v: 1, kfp: keys.fp, ...lk })).status === 403 && (await listBox(env, { ...vol, viewAs: true })).status === 403);
ok('the preview says it is a preview and turns Send off', app.includes('<b>Preview.</b> You are viewing as') && app.includes('B.sending || boxPreview() ? \'disabled\''));
ok('hiding it again stops sending at once and keeps what was sent', (await setBoxLive(env, ed, { live: false })).live === false && (await boxPublic(env, vol)).open === false && (await submitBox(env, vol, { v: 1, kfp: keys.fp, ...lk })).status === 503 && (await listBox(env, ed)).items.length >= 1);
ok('a new key never opens a hidden box by itself, and keeps an open one open', await (async () => { const k2 = await BoxCrypto.genKeys(); await setBoxKey(env, ed, { spki: k2.spki, fp: k2.fp }); const hidden = (await boxPublic(env, vol)).open === false; await setBoxLive(env, ed, { live: true }); await setBoxKey(env, ed, { spki: keys.spki, fp: keys.fp }); return hidden && (await boxPublic(env, vol)).open === true; })());
ok('the page has an open and hide switch for the Executive Director, and the key button no longer says open', app.includes('data-act="bxLive"') && app.includes('Hidden from the field team') && app.includes('I saved the file, save my key') && !app.includes('I saved the file, open the box'));
done();
