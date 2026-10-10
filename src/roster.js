// HQ-editable roster: add or replace people, fix names, re-issue a lost code, and map KoBo names that do not
// match the roster. Stored in the Durable Object; the file in src/data is only the starting point.
import { kv } from './store.js';
import { STAFF, setRoster, rosterForSave, rosterState, norm, REGIONS } from './config.js';

const KEY = 'v2:roster';
let loadedAt = 0;
let lastSeen = null;

export async function ensureRoster(env, force = false) {
  if (!force && Date.now() - loadedAt < 15000) return;
  const saved = await kv(env).get(KEY);
  loadedAt = Date.now();
  if (saved && saved.v !== lastSeen) { setRoster(saved.staff, saved.aliases); lastSeen = saved.v; }
}

async function save(env) {
  const v = Date.now();
  await kv(env).put(KEY, { v, staff: rosterForSave(), aliases: rosterState.aliases });
  lastSeen = v; loadedAt = Date.now();
}

const POSITIONS = ['RC', 'ARC', 'Volunteer 1', 'Volunteer 2', 'Volunteer 3', 'Volunteer 4', 'Volunteer 5', 'Volunteer 6'];
export const rosterOptions = () => ({ positions: POSITIONS, regions: REGIONS });

export async function changeRoster(env, body) {
  await ensureRoster(env, true);
  const list = rosterForSave();
  const byId = (id) => list.find((s) => s.id === Number(id));
  const name = String(body.name || '').trim().slice(0, 80);
  if (body.action === 'add') {
    if (!name || !REGIONS.includes(body.region) || !POSITIONS.includes(body.position)) return { error: 'Give a name, a region and a position' };
    if (list.some((s) => s.active && s.region === body.region && s.position === body.position)) return { error: `${body.region} already has an active ${body.position}. Remove that person first, or choose another position.` };
    list.push({ id: Math.max(0, ...list.map((s) => s.id)) + 1, region: body.region, position: body.position, name, rot: 0, active: true });
  } else if (body.action === 'update') {
    const s = byId(body.id); if (!s) return { error: 'Person not found' };
    if (name) s.name = name;
    if (body.region && REGIONS.includes(body.region)) s.region = body.region;
    if (body.position && POSITIONS.includes(body.position)) s.position = body.position;
  } else if (body.action === 'remove') {
    const s = byId(body.id); if (!s) return { error: 'Person not found' };
    s.active = false; // kept so that their earlier tests still show under their name
  } else if (body.action === 'restore') {
    const s = byId(body.id); if (!s) return { error: 'Person not found' };
    s.active = true;
  } else if (body.action === 'reissue') {
    const s = byId(body.id); if (!s) return { error: 'Person not found' };
    s.rot = (s.rot || 0) + 1; // the old code stops working, a new one is derived
  } else if (body.action === 'alias') {
    const s = byId(body.staff_id); if (!s || !norm(body.kobo_name)) return { error: 'Choose a person and a KoBo name' };
    rosterState.aliases[norm(body.kobo_name)] = s.id;
  } else if (body.action === 'unalias') {
    delete rosterState.aliases[norm(body.kobo_name)];
  } else return { error: 'Unknown action' };
  setRoster(list, rosterState.aliases);
  await save(env);
  return { ok: true };
}
