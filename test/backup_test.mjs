import { env, mem, ok, done } from './_kit.mjs';
import { sealBuf, openBuf, buildBackup, restoreBackup } from '../src/backup.js';
const e2 = { ...env, BACKUP_PASSPHRASE: 'a long test passphrase' };
const plain = new TextEncoder().encode('hello backup').buffer;
const sealed = await sealBuf(e2, plain);
ok('sealed bytes differ from the plain text', new TextDecoder().decode(sealed).indexOf('hello backup') < 0 && new Uint8Array(sealed)[0] === 75);
ok('the right passphrase opens it', new TextDecoder().decode(await openBuf(e2, sealed)) === 'hello backup');
let bad = false; try { await openBuf({ ...env, BACKUP_PASSPHRASE: 'wrong' }, sealed); } catch { bad = true; } ok('a wrong passphrase is refused', bad);
ok('without a passphrase the data stays plain', (await sealBuf(env, plain)) === plain);
// a backup carries the newer state and restores it
mem.set('v2:guests', JSON.stringify([{ id: 'g1', name: 'G' }])); mem.set('v2:layouts', JSON.stringify({ rc: {} })); mem.set('v2:delreq', JSON.stringify([{ id: 'r1' }])); mem.set('v2:delcopy:r1', JSON.stringify({ n: 3 }));
const b = await buildBackup(env, true);
ok('the backup includes guests, layouts and the saved originals', b.extra['v2:guests'] && b.extra['v2:layouts'] && b.copies['v2:delcopy:r1'].n === 3);
mem.delete('v2:guests'); mem.delete('v2:delcopy:r1'); const r = await restoreBackup(env, b, {});
ok('a restore brings them back', r.ok && JSON.parse(mem.get('v2:guests'))[0].id === 'g1' && JSON.parse(mem.get('v2:delcopy:r1')).n === 3, JSON.stringify(r.restored));
done();
