import { env, mem, ok, done } from './_kit.mjs';
import { saveLayout, layoutsFor } from '../src/layouts.js';
import { guestAction, guestByCode, listGuests, guestCode } from '../src/guests.js';
import { recordUsage, usageReport } from '../src/usage.js';
import { isBlocked, recordFail } from '../src/ratelimit.js';
const admin = { role: 'hq', level: 'admin', name: 'Admin', id: 'hq:h9' }; const viewer = { role: 'hq', level: 'viewer', name: 'View', id: 'hq:h8' }; const rc = { role: 'rc', name: 'RC', region: 'TANGA', id: 5 };
// layouts
ok('only an HQ admin can save a layout', (await saveLayout(env, rc, { role: 'rc', tab: 'region', order: ['a'] })).error && (await saveLayout(env, viewer, { role: 'rc', tab: 'region', order: ['a'] })).error);
ok('an admin can save a page layout', (await saveLayout(env, admin, { role: 'rc', tab: 'region', order: ['kpis', 'brief'], hidden: ['x'] })).ok);
ok('HQ cannot hide its own Admin or Today page', (await saveLayout(env, admin, { role: 'hq', tabs: { hidden: ['admin', 'today', 'news'], order: [] } })).ok && !(await layoutsFor(env, admin, 'hq')).mine.tabs.hidden.includes('admin') && (await layoutsFor(env, admin, 'hq')).mine.tabs.hidden.includes('news'));
ok('an RC sees only their own role layout', !(await layoutsFor(env, rc, 'rc')).all && (await layoutsFor(env, rc, 'rc')).mine.pages.region.order[0] === 'kpis');
// guests
ok('only an admin manages guests', (await guestAction(env, rc, { action: 'create' })).error && (await guestAction(env, viewer, { action: 'create' })).error);
ok('an invite needs a valid email and a profile', (await guestAction(env, admin, { action: 'create', name: 'G', email: 'bad', profile: 'funder', send: false })).error && (await guestAction(env, admin, { action: 'create', name: 'G', email: 'g@x.org', profile: 'nope', send: false })).error);
const c = await guestAction(env, admin, { action: 'create', name: 'Funder One', email: 'f@x.org', profile: 'funder', days: 1, send: false });
const g = (await listGuests(env)).guests[0]; ok('a guest is created with a code', c.ok && /^G[A-Z0-9]{6}$/.test(g.code), g.code);
const w = await guestByCode(env, g.code); ok('the code signs the guest in as a view-only guest', w && w.role === 'guest' && w.level === 'viewer' && !w.can_download);
ok('a wrong code does not sign in', (await guestByCode(env, 'GAAAAAA')) === null);
await guestAction(env, admin, { action: 'revoke', id: g.id }); ok('a revoked guest is refused', (await guestByCode(env, g.code)) === null);
await guestAction(env, admin, { action: 'restore', id: g.id }); await guestAction(env, admin, { action: 'reissue', id: g.id }); ok('a new code replaces the old one', (await guestByCode(env, g.code)) === null && (await guestByCode(env, await guestCode(env, { id: g.id, rot: 1 }))) !== null);
const raw = JSON.parse(mem.get('v2:guests')); raw[0].expires_at = new Date(Date.now() - 1000).toISOString(); mem.set('v2:guests', JSON.stringify(raw)); ok('an expired guest is told the invitation ended', (await guestByCode(env, await guestCode(env, { id: g.id, rot: 1 }))).expired === true);
// usage
await recordUsage(env, rc, { tab: 'region', open: true, dev: 'm', ms: 5000 }); await recordUsage(env, rc, { tab: 'allq', dev: 'm' });
const u = await usageReport(env, admin); ok('usage counts opens and pages', u.tabs.find((x) => x[0] === 'region') && u.device.m >= 2, JSON.stringify(u.tabs));
ok('only HQ sees usage', (await usageReport(env, rc)).error === 'HQ only');
ok('a preview session is not counted', (await recordUsage(env, { ...rc, viewAs: true }, { tab: 'news' })).ok && !(await usageReport(env, admin)).tabs.find((x) => x[0] === 'news'));
// rate limit
for (let i = 0; i < 29; i++) await recordFail(env, '1.2.3.4'); ok('29 wrong codes do not block', !(await isBlocked(env, '1.2.3.4')));
await recordFail(env, '1.2.3.4'); ok('30 wrong codes block that network', await isBlocked(env, '1.2.3.4') && !(await isBlocked(env, '9.9.9.9')));
done();
