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
async function gzip(str) { return new Response(new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(); }

export async function buildBackup(env, full) {
  const plans = {};
  (await Promise.all(REGIONS.map((r) => getPlan(env, r)))).forEach((p, k) => { plans[REGIONS[k]] = p; });
  const out = { format: 'kf4-backup-1', at: new Date().toISOString(), full: Boolean(full), plans, queries: (await kv(env).get('v2:queries')) || {}, roster: (await kv(env).get('v2:roster')) || null, recipients: await loadRecipients(env), calendar: (await kv(env).get('v2:calcsv:last')) || null };
  if (full) { out.states = {}; for (const y of await stateYears(env)) out.states[y] = await loadYear(env, y); }
  return out;
}

export async function runBackup(env, { full = false, to } = {}) {
  const data = await buildBackup(env, full);
  const json = JSON.stringify(data);
  const gz = await gzip(json);
  const day = data.at.slice(0, 10);
  const meta = { at: data.at, bytes: json.length, gz_bytes: gz.byteLength, full: Boolean(full), items: { plans: Object.values(data.plans).filter((p) => p.status === 'locked').length, queries: Object.keys(data.queries).length, years: data.states ? Object.keys(data.states).length : 0 } };
  let emailed = false;
  const target = to || env.BACKUP_TO || 'mkamukulu@learnimpact.org';
  if (env.EMAIL_ENABLED === 'true' && env.EMAIL_FROM && env.RESEND_API_KEY && gz.byteLength < 30 * 1024 * 1024) {
    await sendMail(env, target, {
      subject: `KiuFunza 4 · Automated backup · ${day}${full ? ' (full)' : ''}`,
      html: `<p><b>AUTOMATED BACKUP · NO REPLY NEEDED</b></p><p>Field plans and their changes (${meta.items.plans} submitted), queries and replies (${meta.items.queries}), the roster and email recipients${full ? ', and the stored data for ' + meta.items.years + ' year(s)' : ''}. Keep this file somewhere safe. HQ can restore from it in the Admin tab.</p>`,
      text: `AUTOMATED BACKUP - no reply needed\nKiuFunza 4 backup ${day}${full ? ' (full)' : ''}. Keep the attachment safe.`,
      attachments: [{ filename: `kf4-backup-${day}${full ? '-full' : ''}.json.gz`, content: b64(gz) }],
    });
    emailed = true;
  }
  await kv(env).put('v2:backup:last', { ...meta, emailed, to: emailed ? target : null });
  return { ...meta, emailed };
}

export async function maybeRunScheduledBackup(env) {
  const now = new Date();
  if (now.toISOString().slice(11, 16) !== '18:00') return null; // 21:00 East Africa Time
  const day = now.toISOString().slice(0, 10);
  const ran = (await kv(env).get('v2:backup:ran')) || {};
  if (ran.day === day) return null;
  await kv(env).put('v2:backup:ran', { day });
  return runBackup(env, { full: now.getUTCDay() === 0 });
}

// Restores plans, queries, roster and recipients. Year aggregates are restored only if asked and present.
export async function restoreBackup(env, data, { states = false } = {}) {
  if (!data || data.format !== 'kf4-backup-1') return { error: 'This is not a KiuFunza backup file' };
  const done = { plans: 0 };
  for (const [region, plan] of Object.entries(data.plans || {})) { if (REGIONS.includes(region) && plan && plan.region === region) { await kv(env).put(`v2:plan:${region}`, plan); done.plans++; } }
  if (data.queries) { await kv(env).put('v2:queries', data.queries); done.queries = Object.keys(data.queries).length; }
  if (data.roster) { await kv(env).put('v2:roster', data.roster); setRoster(data.roster.staff, data.roster.aliases); done.roster = data.roster.staff.length; }
  if (data.recipients) { await saveRecipients(env, Object.entries(data.recipients).map(([email, r]) => ({ email, ...r }))); done.recipients = Object.keys(data.recipients).length; }
  if (states && data.states) { for (const [y, Y] of Object.entries(data.states)) if (Y) { await saveYear(env, y, Y); done.years = (done.years || 0) + 1; } }
  return { ok: true, restored: done };
}
