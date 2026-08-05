import { fetchKoboData } from './kobo.js';

async function refresh(env) {
  if (!env.KOBO_ASSET_ID || !env.KOBO_TOKEN) {
    return { skipped: true, reason: 'missing KOBO_ASSET_ID or KOBO_TOKEN' };
  }
  const server = env.KOBO_SERVER || 'kf.kobotoolbox.org';
  const results = await fetchKoboData(server, env.KOBO_ASSET_ID, env.KOBO_TOKEN);
  await env.DASHBOARD_KV.put(
    'data',
    JSON.stringify({
      status: 'ok',
      total_records: results.length,
      fetched_at: new Date().toISOString(),
      results,
    })
  );
  return { skipped: false, total_records: results.length };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/data') {
      const stored = await env.DASHBOARD_KV.get('data', 'json');
      const data = stored || {
        status: env.KOBO_ASSET_ID ? 'pending_first_fetch' : 'not_configured',
        total_records: 0,
        results: [],
      };

      // Optional ?year=2026 filter — checks common date fields without
      // assuming a specific schema, since the real form's fields aren't
      // fixed in code. Falls back to no filtering if none of these exist.
      const year = url.searchParams.get('year');
      if (year && Array.isArray(data.results)) {
        const filtered = data.results.filter((r) => {
          const candidates = [r.year, r.start, r.end, r._submission_time].filter(Boolean);
          return candidates.some((v) => String(v).startsWith(year));
        });
        return Response.json({ ...data, total_records: filtered.length, results: filtered });
      }

      return Response.json(data);
    }

    // Manual refresh, so we don't have to wait for the next cron tick.
    if (url.pathname === '/api/refresh' && request.method === 'POST') {
      const result = await refresh(env);
      return Response.json(result);
    }

    return env.ASSETS.fetch(request);
  },

  // Cron-triggered. No-op until KOBO_ASSET_ID + KOBO_TOKEN are both set.
  async scheduled(event, env, ctx) {
    try {
      const result = await refresh(env);
      console.log(result.skipped ? result.reason : `refreshed: ${result.total_records} records`);
    } catch (err) {
      console.error(`fetch failed: ${err.message}`);
    }
  },
};
