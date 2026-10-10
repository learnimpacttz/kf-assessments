// Incremental query — confirmed live against the real KoBo asset (2026-08-06)
// that `query={"_id":{"$gt":N}}` + `sort={"_id":1}` is supported and that
// KoBo's reported `count` reflects the filtered set, not the full dataset.
// Historical submissions are append-only (no edits, only occasional manual
// removal — see index.js's full-resync escape hatch for that case), so a
// monotonic _id watermark is sufficient to avoid ever re-walking already-
// synced pages.
export function buildIncrementalUrl(server, assetId, sinceId) {
  const query = encodeURIComponent(JSON.stringify({ _id: { $gt: sinceId || 0 } }));
  const sort = encodeURIComponent(JSON.stringify({ _id: 1 }));
  return `https://${server}/api/v2/assets/${assetId}/data/?format=json&limit=1000&sort=${sort}&query=${query}`;
}

// Single-page fetch — deliberately NOT "fetch everything," so each Worker
// invocation only ever processes one KoBo page (~1000 records) and stays
// well under the free-tier CPU limit. Multi-page syncs chain across
// separate invocations instead (see index.js). `cursorUrl` (KoBo's `next`
// link) already carries the query/sort params forward — only the first
// page of a pass needs `sinceId` to build its URL from scratch.
export async function fetchKoboPage(server, assetId, token, cursorUrl, sinceId = 0) {
  const url = cursorUrl || buildIncrementalUrl(server, assetId, sinceId);
  const resp = await fetch(url, { headers: { Authorization: `Token ${token}` } });
  if (!resp.ok) {
    throw new Error(`KoBo fetch failed (${resp.status}) for asset ${assetId}`);
  }
  const data = await resp.json();
  return { results: data.results || [], next: data.next || null, count: data.count ?? null };
}

// Mark submissions in KoBo itself (approved / not approved / on hold) so the cleaning decision lives with the data.
const STATUS_UID = { approved: 'validation_status_approved', not_approved: 'validation_status_not_approved', on_hold: 'validation_status_on_hold' };
export async function setValidation(server, assetId, token, ids, status) {
  const uid = STATUS_UID[status];
  if (!uid) throw new Error('Unknown status');
  const resp = await fetch(`https://${server}/api/v2/assets/${assetId}/data/validation_statuses/`, {
    method: 'PATCH',
    headers: { Authorization: `Token ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ payload: { 'validation_status.uid': uid, submission_ids: ids.map(String) } }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`KoBo ${resp.status}: ${text.slice(0, 160)}`);
  return text.slice(0, 200);
}
export async function koboWho(server, assetId, token) {
  const h = { Authorization: `Token ${token}` };
  const me = await (await fetch(`https://${server}/me/?format=json`, { headers: h })).json().catch(() => ({}));
  const asset = await (await fetch(`https://${server}/api/v2/assets/${assetId}/?format=json`, { headers: h })).json().catch(() => ({}));
  return { username: me.username || null, owner: asset.owner__username || null };
}

export async function getValidation(server, assetId, token, id) {
  const r = await fetch(`https://${server}/api/v2/assets/${assetId}/data/${id}/validation_status/?format=json`, { headers: { Authorization: `Token ${token}` } });
  const text = await r.text();
  if (!r.ok) throw new Error(`KoBo ${r.status}: ${text.slice(0, 160)}`);
  try { const j = JSON.parse(text); return j.uid || null; } catch { return null; }
}
export async function clearValidation(server, assetId, token, id) {
  const r = await fetch(`https://${server}/api/v2/assets/${assetId}/data/${id}/validation_status/`, { method: 'DELETE', headers: { Authorization: `Token ${token}` } });
  if (!r.ok && r.status !== 204) throw new Error(`KoBo ${r.status}: ${(await r.text()).slice(0, 160)}`);
}
