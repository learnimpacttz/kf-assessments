// Page layouts by role: which pages each role sees and in what order, and which cards show on a page and in what order.
// This only changes what is shown. What each person is ALLOWED to see is decided separately on the server.
import { kv } from './store.js';

const KEY = 'v2:layouts';
const ROLES = ['hq', 'rc', 'volunteer', 'public'];
const clean = (a, n = 60) => [...new Set((Array.isArray(a) ? a : []).map((x) => String(x).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60)).filter(Boolean))].slice(0, n);
const load = async (env) => (await kv(env).get(KEY)) || {};

export async function layoutsFor(env, who, roleKey) {
  const d = await load(env); const isAdmin = who.role === 'hq' && (who.level || 'admin') === 'admin' && !who.viewAs;
  return isAdmin ? { all: d, mine: d[roleKey] || {} } : { mine: d[roleKey] || {} };
}
export async function saveLayout(env, who, b) {
  if (!(who.role === 'hq' && (who.level || 'admin') === 'admin' && !who.viewAs)) return { error: 'Only an HQ Admin can change layouts', status: 403 };
  const role = ROLES.includes(b.role) ? b.role : null; if (!role) return { error: 'Choose who this layout is for' };
  const d = await load(env); const r = (d[role] ||= {});
  if (b.reset) { if (b.tab) { if (r.pages) delete r.pages[String(b.tab).replace(/[^a-z]/g, '')]; } else delete d[role]; }
  else if (b.tab) { (r.pages ||= {})[String(b.tab).replace(/[^a-z]/g, '').slice(0, 14)] = { order: clean(b.order), hidden: clean(b.hidden) }; }
  else if (b.tabs) { r.tabs = { hidden: clean(b.tabs.hidden, 30).filter((t) => !(role === 'hq' && ['admin', 'today'].includes(t))), order: clean(b.tabs.order, 40) }; }
  r.updated_at = new Date().toISOString(); r.updated_by = who.name;
  await kv(env).put(KEY, d); return { ok: true };
}
