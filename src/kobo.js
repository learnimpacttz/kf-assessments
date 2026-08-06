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
