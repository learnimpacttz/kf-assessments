// Per-person access codes, derived from a server-side salt so nothing about a
// person's code is stored. HQ uses HQ_SECRET directly. Nothing is checked in the
// browser; every API call sends the code and the Worker decides what it may see.
import { STAFF } from './config.js';

const enc = new TextEncoder();
let codeCache = null;
let cacheSalt = null;

async function hmacHex(salt, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Unambiguous characters only (no 0/O, 1/I)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function toCode(hex) {
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[parseInt(hex.slice(i * 2, i * 2 + 2), 16) % ALPHABET.length];
  return out;
}

export async function staffCodes(env) {
  if (!env.AUTH_SALT) return null;
  if (codeCache && cacheSalt === env.AUTH_SALT) return codeCache;
  const map = {};
  for (const s of STAFF) map[toCode(await hmacHex(env.AUTH_SALT, 'staff:' + s.id))] = s;
  codeCache = map;
  cacheSalt = env.AUTH_SALT;
  return map;
}

function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Returns { role, name, region, id } or null. Roles: hq, rc, arc, volunteer.
export async function identify(request, env) {
  const code = (request.headers.get('x-access-code') || '').trim();
  if (!code) return null;
  if (env.HQ_SECRET && safeEqual(code, env.HQ_SECRET)) return { role: 'hq', name: 'HQ', region: null, id: 0 };
  const map = await staffCodes(env);
  const s = map && map[code.toUpperCase()];
  return s ? { role: s.role, name: s.name, region: s.region, id: s.id, position: s.position } : null;
}

export const canSeeRegion = (who, region) => who && (who.role === 'hq' || who.region === region);
