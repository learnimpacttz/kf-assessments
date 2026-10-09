// Replies to automatic flags ("queries"). A flag is identified by its content, so the
// same check on the same school/grade/day keeps its thread across re-computation.
import { kv } from './store.js';

export const flagKey = (f) => [f.type, f.school, f.grade || 0, f.date || '', f.admin || ''].join('|');
const KEY = 'v2:queries';

export const loadQueries = async (env) => (await kv(env).get(KEY)) || {};

export function decorate(flags, queries) {
  return flags.map((f) => {
    const k = flagKey(f);
    const q = queries[k];
    return { ...f, qk: k, q: q ? { status: q.status, thread: q.thread } : null };
  });
}

export async function postQuery(env, who, { key, text, action }, allowedRegionOf) {
  if (!key) return { error: 'Missing flag', status: 400 };
  const queries = await loadQueries(env);
  const q = (queries[key] ||= { status: 'open', thread: [] });
  if (action === 'resolve') {
    if (who.role === 'volunteer') return { error: 'Only a coordinator can close a query', status: 403 };
    q.status = 'resolved';
    q.thread.push({ by: who.name, role: who.role, text: (text || 'Marked resolved').slice(0, 400), at: new Date().toISOString(), resolved: true });
  } else {
    const t = (text || '').trim();
    if (!t) return { error: 'Write a reply first', status: 422 };
    q.thread.push({ by: who.name, role: who.role, text: t.slice(0, 400), at: new Date().toISOString() });
    if (q.status === 'resolved') q.status = 'open';
  }
  await kv(env).put(KEY, queries);
  return { q };
}
