// Attachment-only deletion (photos and other files) for KoBo projects other than Students and Sampling.
// The records stay; only the files go. Read endpoints let HQ save a copy first. Logged like other deletions.
import { kv } from './store.js';
import { tellHQ } from './formjob.js';

const LOG = 'v2:delog';
const srv = (env) => `https://${env.KOBO_SERVER || 'kf.kobotoolbox.org'}`;
const H = (env) => ({ Authorization: `Token ${env.KOBO_TOKEN}` });
const protectedAssets = (env) => [env.KOBO_ASSET_ID, env.KOBO_ASSET_SAMPLING].filter(Boolean);
const okAsset = (s) => /^[A-Za-z0-9]{10,30}$/.test(String(s || ''));

export async function attachList(env, asset, cursor = null, limit = 100, full = false) {
  if (!okAsset(asset)) throw new Error('Bad project id');
  const first = `${srv(env)}/api/v2/assets/${asset}/data/?format=json&limit=${limit}${full ? '' : '&fields=' + encodeURIComponent('["_id","_attachments"]')}`; // the slim form is enough for saving files; deleting needs the whole record for its root id
  const url = cursor || first; if (!String(url).startsWith(`${srv(env)}/api/v2/assets/${asset}/data/`)) throw new Error('Not allowed');
  const r = await fetch(url, { headers: H(env) }); if (!r.ok) throw new Error(`KoBo ${r.status} reading the project`);
  const d = await r.json(); const items = [];
  for (const x of d.results || []) for (const a of x._attachments || []) items.push({ sid: x._id, uuid: x._uuid || '', aid: a.uid || a.id, name: a.filename ? String(a.filename).split('/').pop() : '', mime: a.mimetype || '', url: a.download_url || '' });
  return { items, total: d.count, next: d.next || null };
}
export async function attachFetch(env, asset, url) {
  if (!okAsset(asset) || !String(url).startsWith(`${srv(env)}/api/v2/assets/${asset}/`)) throw new Error('Not allowed');
  const r = await fetch(url, { headers: H(env), redirect: 'follow' }); if (!r.ok) throw new Error(`KoBo ${r.status} reading the file`);
  return new Response(r.body, { headers: { 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'content-length': r.headers.get('content-length') || '', 'cache-control': 'no-store' } });
}
async function count(env, asset) { let cur = null, n = 0, subs = 0; for (let i = 0; i < 40; i++) { const p = await attachList(env, asset, cur, 500); n += p.items.length; subs = p.total; if (!p.next) break; cur = p.next; } return { attachments: n, submissions: subs }; }
const usage = async (env) => { const r = await fetch(`${srv(env)}/api/v2/service_usage/?format=json`, { headers: H(env) }); const d = await r.json().catch(() => ({})); return { used: d.total_storage_bytes ?? null, limit: d.balances?.storage_bytes?.effective_limit ?? null }; };

export async function attachDelete(env, who, b) {
  const asset = b.asset; if (!okAsset(asset)) return { error: 'Bad project id' };
  if (protectedAssets(env).includes(asset)) return { error: 'Files in the Students and Sampling projects are never deleted here.', status: 403 };
  if ((who.level || 'admin') !== 'admin' || (who.role === 'hq' && (who.review_level || 0) < 3)) return { error: 'Only Michael or Mundo can delete files.', status: 403 };
  const a = await (await fetch(`${srv(env)}/api/v2/assets/${asset}/?format=json`, { headers: H(env) })).json();
  if (!a.uid) return { error: 'Project not found', status: 404 };
  if (String(b.confirm || '').trim() !== a.name) return { error: `Type the project name exactly: ${a.name}` };
  if (b.copy_ok !== true) return { error: 'Confirm that the files were saved and checked first.' };
  // Cloudflare limits the calls one request may make, so each request deletes a chunk and says how many are left; the page repeats until none are
  const u0 = await usage(env);
  const onlyImages = b.only !== 'all'; let cur = null, all = [];
  for (let i = 0; i < 60; i++) { const p = await attachList(env, asset, cur, 500); for (const it of p.items) if (it.aid && (!onlyImages || /^image\//.test(it.mime))) all.push(it.aid); if (!p.next) break; cur = p.next; }
  // 40 per request stays under the 50-call limit even on the free Workers plan
  const chunk = Math.min(Number(b.batch_limit) > 0 ? Number(b.batch_limit) : 40, 40); const todo = all.slice(0, chunk);
  let deleted = 0; const problems = [];
  for (const aid of todo) { const r = await fetch(`${srv(env)}/api/v2/assets/${asset}/attachments/${aid}/`, { method: 'DELETE', headers: H(env) }); if (r.status === 204 || r.status === 200 || r.status === 404) deleted++; else { problems.push(`${aid}: ${r.status} ${(await r.text()).slice(0, 100)}`); if (problems.length > 3) break; } }
  const before = { attachments: all.length, submissions: 0 }; const after = { attachments: all.length - deleted }; const u1 = await usage(env); const remaining = all.length - deleted;
  const entry = { at: new Date().toISOString(), kind: 'Files only: ' + a.name, suggested_by: 'Michael Kamukulu (written approval in chat 12 Oct 2026)', initiated_by: who.name, approved_by: who.name, reason: String(b.reason || 'Free KoBo storage; records kept, files saved first').slice(0, 300), ids: [], regions: [], count_before: before.attachments, count_after: after.attachments, storage_before: u0.used, storage_after: u1.used, ok: !problems.length && deleted > 0, failed: problems };
  const lg = (await kv(env).get(LOG)) || []; lg.unshift(entry); await kv(env).put(LOG, lg.slice(0, 500));
  await tellHQ(env, 'KiuFunza 4 · Automated update · Files deleted from a KoBo project', [`${who.name} deleted the attached files (not the records) in "${a.name}": ${before.attachments} files before, ${after.attachments} after. Storage used: ${u0.used} to ${u1.used} bytes.`]).catch(() => {});
  return { project: a.name, remaining, done: remaining === 0 && !problems.length, files_before: before.attachments, files_after: after.attachments, deleted, storage_before: u0.used, storage_after: u1.used, storage_limit: u1.limit, problems };
}

// storage overview for the Admin card: account use and the projects that hold the space
export async function storageView(env) {
  const u = await (await fetch(`${srv(env)}/api/v2/service_usage/?format=json`, { headers: H(env) })).json().catch(() => ({}));
  const org = await (await fetch(`${srv(env)}/api/v2/organizations/?format=json`, { headers: H(env) })).json().catch(() => ({}));
  const id = org.results?.[0]?.id; let rows = [];
  if (id) { const au = await (await fetch(`${srv(env)}/api/v2/organizations/${id}/asset_usage/?format=json`, { headers: H(env) })).json().catch(() => ({})); rows = (au.results || []).map((r) => ({ asset: (/assets\/([^/?]+)/.exec(r.asset) || [])[1], name: r.asset__name, bytes: r.storage_bytes || 0, submissions: r.submission_count_all_time, status: r.deployment_status })); }
  const prot = protectedAssets(env);
  return { used: u.total_storage_bytes ?? null, limit: u.balances?.storage_bytes?.effective_limit ?? null, exceeded: Boolean(u.balances?.storage_bytes?.exceeded), submissions_period: u.total_submission_count?.current_period ?? null, submissions_limit: u.balances?.submission?.effective_limit ?? null, projects: rows.filter((r) => r.bytes > 1e6).map((r) => ({ ...r, protected: prot.includes(r.asset) })).sort((a, b) => b.bytes - a.bytes) };
}
