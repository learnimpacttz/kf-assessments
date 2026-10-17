// Backups of everything that cannot be re-read from KoBo: field plans and their change history, queries and
// replies, the roster, email recipients. A full backup (Sundays) also carries the stored year aggregates, which
// matters once old data is removed from KoBo. Sent by email as a compressed attachment (R2 is not enabled on
// this account), and downloadable by HQ at any time.
import { kv } from './store.js';
import { REGIONS } from './config.js';
import { getPlan } from './plan.js';
import { loadYear, stateYears, saveYear } from './sync.js';
import { loadRecipients, sendMail, saveRecipients } from './digest.js';
import { setRoster } from './config.js';

const b64 = (buf) => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
// ---- encryption: with the BACKUP_PASSPHRASE secret set, every stored, emailed or downloaded backup is sealed (AES-GCM, key from PBKDF2) ----
const MAGIC = new TextEncoder().encode('KF4E1'); const ITER = 100000;
const dkey = async (pass, salt) => { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']); return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); };
export async function sealBuf(env, buf) {
  if (!env.BACKUP_PASSPHRASE) return buf;
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await dkey(env.BACKUP_PASSPHRASE, salt), buf));
  const out = new Uint8Array(MAGIC.length + 28 + ct.length); out.set(MAGIC, 0); out.set(salt, MAGIC.length); out.set(iv, MAGIC.length + 16); out.set(ct, MAGIC.length + 28); return out.buffer;
}
export async function openBuf(env, buf) {
  const u = new Uint8Array(buf); const sealed = MAGIC.every((b, i) => u[i] === b); if (!sealed) return buf;
  if (!env.BACKUP_PASSPHRASE) throw new Error('This backup is encrypted and no passphrase is set');
  const salt = u.slice(MAGIC.length, MAGIC.length + 16), iv = u.slice(MAGIC.length + 16, MAGIC.length + 28), ct = u.slice(MAGIC.length + 28);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await dkey(env.BACKUP_PASSPHRASE, salt), ct);
}
// everything else the system keeps that cannot be re-read from KoBo
const EXTRA_KEYS = ['v2:pilot', 'v2:narr', 'v2:layouts', 'v2:guests', 'v2:hq', 'v2:settings', 'v2:news', 'v2:msgs', 'v2:msgs:builtin', 'v2:reports', 'v2:delreq', 'v2:delog', 'v2:corrections', 'v2:approvededits', 'v2:activity', 'v2:usage:users', 'v2:usage:daily', 'v2:devowners', 'v2:calsync', 'v2:dm', 'v2:askq', 'v2:hqnotes'];
export async function gzip(str) { return new Response(new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(); }

export async function buildBackup(env, full) {
  const plans = {};
  (await Promise.all(REGIONS.map((r) => getPlan(env, r)))).forEach((p, k) => { plans[REGIONS[k]] = p; });
  const out = { format: 'kf4-backup-1', at: new Date().toISOString(), full: Boolean(full), plans, queries: (await kv(env).get('v2:queries')) || {}, roster: (await kv(env).get('v2:roster')) || null, recipients: await loadRecipients(env), calendar: (await kv(env).get('v2:calcsv:last')) || null };
  out.extra = {}; for (const k of EXTRA_KEYS) { const v = await kv(env).get(k); if (v !== null && v !== undefined) out.extra[k] = v; }
  if (full) { out.copies = {}; for (const r of out.extra['v2:delreq'] || []) { const c = await kv(env).get('v2:delcopy:' + r.id); if (c) out.copies['v2:delcopy:' + r.id] = c; } for (const l of out.extra['v2:corrections'] || []) { const c = await kv(env).get('v2:corr:' + l.id); if (c) out.copies['v2:corr:' + l.id] = c; } }
  if (full) { out.states = {}; for (const y of await stateYears(env)) out.states[y] = await loadYear(env, y); }
  return out;
}

// Every night the backup is stored inside Cloudflare (Workers KV, kept apart from the live store, 21 days for daily
// copies and about 4 months for Sunday full copies). Once a week, with the Sunday full copy, it is also emailed.
export async function runBackup(env, { full = false, email = false, testTo = null } = {}) {
  const data = await buildBackup(env, full);
  const json = JSON.stringify(data);
  const gz = await sealBuf(env, await gzip(json));
  const day = data.at.slice(0, 10);
  const key = `bk:${day}${full ? '-full' : ''}`;
  const meta = { at: data.at, key, bytes: json.length, gz_bytes: gz.byteLength, full: Boolean(full), items: { plans: Object.values(data.plans).filter((p) => p.status === 'locked').length, queries: Object.keys(data.queries).length, years: data.states ? Object.keys(data.states).length : 0 } };
  let stored = false;
  if (env.DASHBOARD_KV && gz.byteLength < 24 * 1024 * 1024) { await env.DASHBOARD_KV.put(key, gz, { expirationTtl: (full ? 120 : 21) * 86400, metadata: { at: data.at, full: Boolean(full), gz_bytes: gz.byteLength, plans: meta.items.plans, queries: meta.items.queries, years: meta.items.years } }); stored = true; }
  let emailed = false, to = null, cc = [];
  if (false && email && env.EMAIL_ENABLED === 'true' && env.EMAIL_FROM && env.RESEND_API_KEY && gz.byteLength < 30 * 1024 * 1024) {
    const rec = Object.entries(await loadRecipients(env)).filter(([, r]) => r.active !== false);
    to = testTo || rec.find(([, r]) => r.backup === 'to')?.[0] || env.BACKUP_TO || null;
    cc = testTo ? [] : rec.filter(([, r]) => r.backup === 'cc').map(([e]) => e); // a test goes only to the address given
    if (to) {
      await sendMail(env, to, {
        cc,
        subject: `${testTo ? '[TEST] ' : ''}KiuFunza 4 · Automated weekly backup · ${day}`,
        html: `<p><b>AUTOMATED BACKUP · NO REPLY NEEDED</b></p><p>Weekly full backup of the field dashboard: field plans and their changes (${meta.items.plans} submitted), queries and replies (${meta.items.queries}), the roster, email recipients and the stored data for ${meta.items.years} year(s). A copy is also kept inside Cloudflare every night. Please keep this file somewhere safe. HQ can restore from it in the Admin tab.</p>`,
        text: `AUTOMATED BACKUP - no reply needed\nKiuFunza 4 weekly backup ${day}. Keep the attachment safe.`,
        attachments: [{ filename: `kf4-backup-${day}-full.json.gz${env.BACKUP_PASSPHRASE ? '.enc' : ''}`, content: b64(gz) }],
      });
      emailed = true;
    }
  }
  await kv(env).put('v2:backup:last', { ...meta, stored, emailed, to, cc });
  return { ...meta, stored, emailed, to, cc };
}

export async function listBackups(env) {
  if (!env.DASHBOARD_KV) return [];
  const out = [];
  let cursor;
  do { const r = await env.DASHBOARD_KV.list({ prefix: 'bk:', cursor }); for (const k of r.keys) out.push({ key: k.name, ...(k.metadata || {}) }); cursor = r.list_complete ? null : r.cursor; } while (cursor);
  return out.sort((a, b) => (a.key < b.key ? 1 : -1));
}
export async function readStoredBackup(env, key) {
  if (!/^bk:\d{4}-\d\d-\d\d(-full)?$/.test(key || '')) return null;
  const buf = await env.DASHBOARD_KV.get(key, 'arrayBuffer');
  if (!buf) return null;
  return JSON.parse(await new Response(new Blob([await openBuf(env, buf)]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}
export async function rawStoredBackup(env, key) {
  if (!/^bk:\d{4}-\d\d-\d\d(-full)?$/.test(key || '')) return null;
  return env.DASHBOARD_KV.get(key, 'arrayBuffer');
}

// Nightly at 21:00 EAT: a copy into Cloudflare (a full one on Sundays). Monday 07:00 EAT, in office hours: the Sunday full
// copy is emailed to the backup recipient with the copy list in cc.
export async function maybeRunScheduledBackup(env) {
  const now = new Date();
  const hhmm = now.toISOString().slice(11, 16);
  const day = now.toISOString().slice(0, 10);
  const ran = (await kv(env).get('v2:backup:ran')) || {};
  if (hhmm === '18:00' && ran.day !== day) {
    await kv(env).put('v2:backup:ran', { ...ran, day });
    return runBackup(env, { full: now.getUTCDay() === 0 });
  }
  if (hhmm === '04:00' && now.getUTCDay() === 1 && ran.mailed !== day) { // Monday 07:00 EAT
    await kv(env).put('v2:backup:ran', { ...ran, mailed: day });
    return emailLatestFull(env);
  }
  return null;
}

export async function emailLatestFull(env, { testTo = null } = {}) {
  const list = (await listBackups(env)).filter((b) => b.full);
  let key = list[0]?.key;
  if (!key) { const r = await runBackup(env, { full: true }); key = r.key; }
  const gz = await rawStoredBackup(env, key);
  if (!gz) return { emailed: false, error: 'no stored copy' };
  const day = key.slice(3, 13);
  const rec = Object.entries(await loadRecipients(env)).filter(([, r]) => r.active !== false);
  const to = testTo || rec.find(([, r]) => r.backup === 'to')?.[0] || env.BACKUP_TO || null;
  const cc = testTo ? [] : rec.filter(([, r]) => r.backup === 'cc').map(([e]) => e);
  if (!to || !(env.EMAIL_ENABLED === 'true' && env.EMAIL_FROM && env.RESEND_API_KEY)) return { emailed: false, key, error: 'email is not set up' };
  await sendMail(env, to, {
    cc,
    subject: `${testTo ? '[TEST] ' : ''}KiuFunza 4 · Automated weekly backup · copy of ${day}`,
    html: '<p><b>AUTOMATED BACKUP · NO REPLY NEEDED</b></p><p>Weekly full backup of the field dashboard (taken Sunday night): field plans and their changes, queries and replies, the roster, email recipients and the stored data for earlier years. A copy is also kept inside Cloudflare every night. Please keep this file somewhere safe. HQ can restore from it in the Admin tab.</p>',
    text: `AUTOMATED BACKUP - no reply needed\nKiuFunza 4 weekly backup, copy of ${day}. Keep the attachment safe.`,
    attachments: [{ filename: `kf4-backup-${day}-full.json.gz${env.BACKUP_PASSPHRASE ? '.enc' : ''}`, content: b64(gz) }],
  });
  await kv(env).put('v2:backup:mailed', { at: new Date().toISOString(), key, to, cc });
  return { emailed: true, key, to, cc };
}

// Restores plans, queries, roster and recipients. Year aggregates are restored only if asked and present.
export async function restoreBackup(env, data, { states = false } = {}) {
  if (!data || data.format !== 'kf4-backup-1') return { error: 'This is not a KiuFunza backup file' };
  const done = { plans: 0 };
  for (const [region, plan] of Object.entries(data.plans || {})) { if (REGIONS.includes(region) && plan && plan.region === region) { await kv(env).put(`v2:plan:${region}`, plan); done.plans++; } }
  if (data.queries) { await kv(env).put('v2:queries', data.queries); done.queries = Object.keys(data.queries).length; }
  if (data.roster) { await kv(env).put('v2:roster', data.roster); setRoster(data.roster.staff, data.roster.aliases); done.roster = data.roster.staff.length; }
  if (data.recipients) { await saveRecipients(env, Object.entries(data.recipients).map(([email, r]) => ({ email, ...r }))); done.recipients = Object.keys(data.recipients).length; }
  if (data.extra) { done.extra = 0; for (const [k, v] of Object.entries(data.extra)) if (EXTRA_KEYS.includes(k)) { await kv(env).put(k, v); done.extra++; } }
  if (data.copies) { done.copies = 0; for (const [k, v] of Object.entries(data.copies)) if (/^v2:(delcopy|corr):[A-Za-z0-9-]+$/.test(k)) { await kv(env).put(k, v); done.copies++; } }
  if (states && data.states) { for (const [y, Y] of Object.entries(data.states)) if (Y) { await saveYear(env, y, Y); done.years = (done.years || 0) + 1; } }
  return { ok: true, restored: done };
}
