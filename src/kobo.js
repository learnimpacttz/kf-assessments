// Single-page fetch — deliberately NOT "fetch everything," so each Worker
// invocation only ever processes one KoBo page (~1000 records) and stays
// well under the free-tier CPU limit. Multi-page refreshes chain across
// separate invocations instead (see index.js).
export async function fetchKoboPage(server, assetId, token, cursorUrl) {
  const url =
    cursorUrl || `https://${server}/api/v2/assets/${assetId}/data/?format=json&limit=1000`;
  const resp = await fetch(url, { headers: { Authorization: `Token ${token}` } });
  if (!resp.ok) {
    throw new Error(`KoBo fetch failed (${resp.status}) for asset ${assetId}`);
  }
  const data = await resp.json();
  return { results: data.results || [], next: data.next || null, count: data.count ?? null };
}
