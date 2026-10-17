// Invited guests: board members, collaborators, funders, government and partners. A guest signs in with an emailed code, sees only
// public-facing pages, and cannot change anything. Invitations can expire, be extended, re-issued or revoked.
import { kv } from './store.js';
import { hmacHex, toCode } from './auth.js';
import { sendMail } from './digest.js';
import { logActivity } from './hq.js';

const KEY = 'v2:guests';
export const PROFILES = { board: 'Board', collaborator: 'Collaborator', funder: 'Funder', government: 'Government', partner: 'Partner' };
const uid = () => Math.random().toString(36).slice(2, 10);
const load = async (env) => (await kv(env).get(KEY)) || [];
export async function guestCode(env, g) { return 'G' + toCode(await hmacHex(env.AUTH_SALT, `guest:${g.id}:${g.rot || 0}`)); }
const site = (env) => env.PUBLIC_URL || 'https://kf-assessments.learnimpacttz.workers.dev';

export async function guestByCode(env, code) {
  if (!env.AUTH_SALT || !/^G[A-Z0-9]{6}$/i.test(code)) return null;
  const up = code.toUpperCase();
  for (const g of await load(env)) {
    if (g.revoked) continue; if (up !== (await guestCode(env, g))) continue;
    if (g.expires_at && Date.parse(g.expires_at) < Date.now()) return { expired: true };
    return { role: 'guest', name: g.name, org: g.org || '', profile: g.profile, id: 'g:' + g.id, level: 'viewer', can_download: Boolean(g.can_download), logo: g.logo_url || '', expires_at: g.expires_at || null, region: null };
  }
  return null;
}
export async function touchGuest(env, id) { const d = await load(env); const g = d.find((x) => 'g:' + x.id === id); if (g && (!g.last_seen || Date.now() - Date.parse(g.last_seen) > 600e3)) { g.last_seen = new Date().toISOString(); await kv(env).put(KEY, d); } }

export async function listGuests(env) {
  const d = await load(env); const now = Date.now();
  return { profiles: PROFILES, guests: await Promise.all(d.map(async (g) => ({ id: g.id, name: g.name, email: g.email, org: g.org, profile: g.profile, can_download: g.can_download, logo_url: g.logo_url, created_at: g.created_at, created_by: g.created_by, expires_at: g.expires_at || null, revoked: Boolean(g.revoked), last_seen: g.last_seen || null, sent_at: g.sent_at || null, status: g.revoked ? 'revoked' : g.expires_at && Date.parse(g.expires_at) < now ? 'expired' : 'active', code: g.revoked ? null : await guestCode(env, g) }))) };
}
async function email(env, g) {
  const code = await guestCode(env, g); const link = `${site(env)}/#code=${code}`;
  const until = g.expires_at ? `This invitation is open until ${g.expires_at.slice(0, 10)}.` : 'This invitation has no end date.';
  const html = `<div style="font:15px/1.5 system-ui,sans-serif;color:#243049;max-width:560px"><p>Hello ${g.name.split(' ')[0]},</p><p>LearnImpact invites you to the <b>LearnImpact Command Center</b>, where you can follow the progress of our work in the field.</p><p style="font-size:20px;letter-spacing:2px"><b>${code}</b></p><p><a href="${link}">Open the Command Center</a> and enter this code if it is not filled in for you.</p><p>${until} The pages are view-only.</p><p>LearnImpact</p></div>`;
  await sendMail(env, g.email, { subject: 'Your access to the LearnImpact Command Center', html, text: `Hello ${g.name.split(' ')[0]},\n\nYour access code to the LearnImpact Command Center: ${code}\nOpen: ${link}\n${until} The pages are view-only.\n\nLearnImpact` });
  g.sent_at = new Date().toISOString();
}
export async function guestAction(env, who, b) {
  if (!(who.role === 'hq' && (who.level || 'admin') === 'admin' && !who.viewAs)) return { error: 'Only an HQ Admin can manage guests', status: 403 };
  const d = await load(env); const now = new Date().toISOString();
  if (b.action === 'create') {
    const name = String(b.name || '').trim().slice(0, 80), em = String(b.email || '').trim().slice(0, 120);
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return { error: 'Give a name and a valid email address' };
    if (!PROFILES[b.profile]) return { error: 'Choose a profile' };
    const logo = String(b.logo_url || '').trim(); if (logo && !/^https:\/\//.test(logo)) return { error: 'The logo must be a link that starts with https://' };
    const days = b.days === null || b.days === '' || b.days === undefined || Number(b.days) === 0 ? null : Math.max(1, Math.min(Number(b.days), 730));
    const g = { id: uid(), name, email: em, org: String(b.org || '').trim().slice(0, 80), profile: b.profile, can_download: Boolean(b.can_download), logo_url: logo, created_at: now, created_by: who.name, expires_at: days ? new Date(Date.now() + days * 864e5).toISOString() : null, rot: 0 };
    d.unshift(g);
    if (b.send !== false) { try { await email(env, g); } catch (e) { await kv(env).put(KEY, d); return { error: 'The invitation was saved but the email did not send: ' + String(e.message || e).slice(0, 120) + '. You can copy the code from the list.' }; } }
    await kv(env).put(KEY, d); await logActivity(env, who, `Invited a ${PROFILES[g.profile]} guest`, g.org || g.name); return { ok: true, id: g.id };
  }
  const g = d.find((x) => x.id === b.id); if (!g) return { error: 'Not found', status: 404 };
  if (b.action === 'revoke') g.revoked = true;
  else if (b.action === 'restore') g.revoked = false;
  else if (b.action === 'extend') g.expires_at = new Date(Math.max(Date.now(), g.expires_at ? Date.parse(g.expires_at) : Date.now()) + Math.max(1, Math.min(Number(b.days) || 30, 730)) * 864e5).toISOString();
  else if (b.action === 'noexpiry') g.expires_at = null;
  else if (b.action === 'reissue') g.rot = (g.rot || 0) + 1;
  else if (b.action === 'resend') { try { await email(env, g); } catch (e) { return { error: 'The email did not send: ' + String(e.message || e).slice(0, 120) }; } }
  else if (b.action === 'delete') { await kv(env).put(KEY, d.filter((x) => x.id !== g.id)); await logActivity(env, who, 'Guest deleted', g.org || g.name); return { ok: true }; }
  else if (b.action === 'update') { if (PROFILES[b.profile]) g.profile = b.profile; g.can_download = Boolean(b.can_download); if (typeof b.logo_url === 'string') g.logo_url = /^https:\/\//.test(b.logo_url) ? b.logo_url : ''; }
  else return { error: 'Unknown action' };
  await kv(env).put(KEY, d); await logActivity(env, who, `Guest ${b.action}`, g.org || g.name); return { ok: true };
}
