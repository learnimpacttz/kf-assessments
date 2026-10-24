// Per-person access codes, derived from a server-side salt so nothing about a
// person's code is stored. HQ uses HQ_SECRET directly. Nothing is checked in the
// browser; every API call sends the code and the Worker decides what it may see.
import { STAFF, rosterState, PARTNERS, REGIONS, leadOrgOf } from './config.js';
import { loadHq, hqByCode, deskOf } from './hq.js';
import { guestByCode, PROFILES } from './guests.js';

const enc = new TextEncoder();
let codeCache = null;
let cacheSalt = null;
let cacheVersion = -1;

export async function hmacHex(salt, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Unambiguous characters only (no 0/O, 1/I)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function toCode(hex) {
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[parseInt(hex.slice(i * 2, i * 2 + 2), 16) % ALPHABET.length];
  return out;
}

export async function staffCodes(env) {
  if (!env.AUTH_SALT) return null;
  if (codeCache && cacheSalt === env.AUTH_SALT && cacheVersion === rosterState.version) return codeCache;
  const map = {};
  // a person's code changes only when HQ re-issues it (rot goes up); everyone else keeps theirs
  for (const s of STAFF) if (s.active) map[toCode(await hmacHex(env.AUTH_SALT, s.rot ? `staff:${s.id}:${s.rot}` : 'staff:' + s.id))] = s;
  codeCache = map;
  cacheSalt = env.AUTH_SALT;
  cacheVersion = rosterState.version;
  return map;
}

function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Returns { role, name, region, id } or null. Roles: hq, rc, arc, volunteer.
// what the app and the API know about a signed-in staff member; a Lead Coordinator also carries the organization and its regions
export function whoOfStaff(s, extra = {}) {
  const org = leadOrgOf(s);
  return { role: s.role, name: s.name, region: s.region, id: s.id, position: s.position, ...(org ? { lead: org, regions: PARTNERS[org].slice(), title: 'Lead Coordinator (LC)' } : {}), ...extra };
}
export async function identify(request, env) {
  const code = (request.headers.get('x-access-code') || '').trim();
  if (!code) return null;
  let hqWho = null;
  if (env.HQ_SECRET && safeEqual(code, env.HQ_SECRET) && (await loadHq(env)).shared_enabled !== false) hqWho = { role: 'hq', level: 'admin', name: 'HQ (shared code)', desk: 'systems', region: null, id: 0, hq_id: null, review_level: 0 }; // the shared code cannot approve: approvals need a named person
  else { const u = await hqByCode(env, code); if (u) hqWho = { role: 'hq', level: u.level, name: u.name, region: null, id: 'hq:' + u.id, hq_id: u.id, review_level: u.level === 'viewer' ? 0 : (u.review_level || 0), desk: deskOf(u), hide: Array.isArray(u.hide) ? u.hide : [] }; }
  if (hqWho) {
    // HQ can preview the app as any person (training and support). The preview is read-only: see index.js.
    const as = /^staff:(\d+)$/.exec(request.headers.get('x-view-as') || '');
    if (as) { const s = STAFF.find((x) => x.id === Number(as[1])); if (s) return whoOfStaff(s, { viewAs: true, viewBy: hqWho.hq_id }); }
    const hv = /^hq:(\w+)$/.exec(request.headers.get('x-view-as') || '');
    if (hv && hqWho.desk === 'systems' && (hqWho.level || 'admin') === 'admin') { const u = (await loadHq(env)).users.find((x) => x.id === hv[1] && x.active !== false); if (u) return { role: 'hq', level: u.level, name: u.name, region: null, id: 'hq:' + u.id, hq_id: u.id, review_level: u.level === 'viewer' ? 0 : (u.review_level || 0), desk: deskOf(u), hide: Array.isArray(u.hide) ? u.hide : [], viewAs: true }; }
    const ga = /^guest:(\w+)$/.exec(request.headers.get('x-view-as') || ''); if (ga && PROFILES[ga[1]]) return { role: 'guest', name: 'Preview: ' + PROFILES[ga[1]], org: '', profile: ga[1], id: 'g:preview', level: 'viewer', can_download: false, logo: '', viewAs: true, region: null };
    return hqWho;
  }
  const map = await staffCodes(env);
  const s = map && map[code.toUpperCase()];
  if (s) return whoOfStaff(s);
  return await guestByCode(env, code);
}

// the regions a person may look at: HQ all, a Lead Coordinator the regions of their organization, everyone else their own
export const regionsOf = (who) => (!who ? [] : who.role === 'hq' ? REGIONS : who.regions && who.regions.length ? who.regions : who.region ? [who.region] : []);
export const canSeeRegion = (who, region) => Boolean(who) && (who.role === 'hq' || regionsOf(who).includes(region));
// the region a request is about: the one asked for when this person may see it, otherwise their own (HQ: the one asked for, or none)
export function pickRegion(who, asked) {
  const r = String(asked || '').toUpperCase();
  if (who && who.role === 'hq') return r || null;
  return r && canSeeRegion(who, r) ? r : (who && who.region) || null;
}
