import { fetchKoboPage } from './kobo.js';
import { extractCounts, addPageToCounts } from './aggregate.js';

// Incremental sync — a pass only fetches submissions newer than
// `last_synced_id` (the highest KoBo `_id` already counted), confirmed live
// against the real asset to be a supported query. Historical data is
// append-only in normal operation, so already-synced pages never need to be
// re-walked; each daily pass just picks up wherever the last one left off.
// Still processes exactly ONE page per invocation (state lives in KV,
// advanced by a once-a-minute Cron Trigger) to stay under the free-tier CPU
// limit — a single invocation fetching everything, or a self-chaining
// subrequest loop, both hit problems that this tick-based design avoids.
async function processOnePage(env, cursorUrl) {
  const server = env.KOBO_SERVER || 'kf.kobotoolbox.org';
  const stored = await env.DASHBOARD_KV.get('data', 'json');
  const progress = (await env.DASHBOARD_KV.get('sync_progress', 'json')) || {
    counts: extractCounts(stored),
    pages_done: 0,
    max_id_seen: stored?.last_synced_id || 0,
  };

  const page = await fetchKoboPage(server, env.KOBO_ASSET_ID, env.KOBO_TOKEN, cursorUrl, progress.max_id_seen);
  addPageToCounts(progress.counts, page.results);
  for (const r of page.results) {
    if (typeof r._id === 'number' && r._id > progress.max_id_seen) progress.max_id_seen = r._id;
  }
  progress.pages_done += 1;
  progress.next_cursor = page.next;

  if (page.next) {
    await env.DASHBOARD_KV.put('sync_progress', JSON.stringify(progress));
    return { done: false, pages_done: progress.pages_done };
  }

  const newRecords = progress.counts.total_records - (stored?.total_records || 0);
  await env.DASHBOARD_KV.put(
    'data',
    JSON.stringify({
      status: 'ok',
      fetched_at: new Date().toISOString(),
      last_synced_id: progress.max_id_seen,
      pages_fetched: progress.pages_done, // pages in this sync pass, not all-time
      ...progress.counts,
    })
  );
  await env.DASHBOARD_KV.delete('sync_progress');
  return { done: true, pages_done: progress.pages_done, total_records: progress.counts.total_records, new_records_this_sync: newRecords };
}

// Kicks off a check for new submissions. No-ops if a pass is already
// mid-chain (a minute tick will carry it forward) rather than restarting it.
async function startSync(env) {
  const inProgress = await env.DASHBOARD_KV.get('sync_progress', 'json');
  if (inProgress?.next_cursor) return { already_in_progress: true, pages_done: inProgress.pages_done };
  return processOnePage(env, null);
}

async function continueSync(env) {
  const progress = await env.DASHBOARD_KV.get('sync_progress', 'json');
  if (!progress || !progress.next_cursor) return { skipped: true };
  return processOnePage(env, progress.next_cursor);
}

// Escape hatch for the one case incremental sync can't self-heal: a
// submission getting manually removed from KoBo after already being
// counted. Wipes the watermark and re-walks everything from _id 0 — same
// cost as the old daily-full-refetch design, but now opt-in/rare instead of
// the default.
async function startFullResync(env) {
  await env.DASHBOARD_KV.delete('sync_progress');
  await env.DASHBOARD_KV.delete('data');
  return processOnePage(env, null);
}

// Three tiers of the SAME stored aggregate, filtered by field sensitivity —
// not three separate computations. Public never sees PII (by_enumerator) or
// results (skills); Team sees operational/progress detail but not results;
// HQ sees everything. Access is enforced server-side in this Worker (real
// passphrase check against a Cloudflare secret, not just a hidden UI
// element) — Cloudflare Access/Zero Trust was the other option but requires
// a card on file even on the free tier; this achieves the same real
// server-side enforcement at zero cost, since the data already flows
// through a Worker we control rather than static files.
function filterTier(data, tier) {
  const { total_records, by_year, by_grade, by_region, submissions_by_date, status, fetched_at, pages_fetched } = data;
  const publicView = { status, fetched_at, pages_fetched, total_records, by_year, by_grade, by_region, submissions_by_date };
  if (tier === 'public') return publicView;

  const teamView = { ...publicView, by_enumerator: data.by_enumerator, by_school: data.by_school, dq_flags: data.dq_flags };
  if (tier === 'team') return teamView;

  return { ...teamView, skills: data.skills }; // hq
}

async function getTierData(env, tier) {
  const stored = await env.DASHBOARD_KV.get('data', 'json');
  // Viewers always see the last COMPLETE pass — `stored` only updates once a
  // sync pass finishes, so this never exposes partial/mid-sync counts.
  if (stored) return filterTier(stored, tier);
  const inProgress = await env.DASHBOARD_KV.get('sync_progress', 'json');
  if (inProgress) {
    return {
      status: 'sync_in_progress',
      pages_done: inProgress.pages_done,
      total_records_so_far: inProgress.counts.total_records,
    };
  }
  return {
    status: env.KOBO_ASSET_ID ? 'pending_first_fetch' : 'not_configured',
    total_records: 0,
  };
}

// Constant-time-ish comparison isn't critical here (this isn't defending
// against a timing side-channel attacker with API-level access), but
// checking length first avoids the trivial early-exit-on-first-char case.
function passphraseMatches(submitted, expected) {
  if (!expected) return false; // secret not set yet — fail closed, not open
  if (!submitted || submitted.length !== expected.length) return false;
  return submitted === expected;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/public') return Response.json(await getTierData(env, 'public'));

    if (url.pathname === '/api/team') {
      const p = url.searchParams.get('p') || request.headers.get('x-passphrase');
      if (!passphraseMatches(p, env.TEAM_PASSPHRASE)) {
        return Response.json({ error: 'invalid passphrase' }, { status: 403 });
      }
      return Response.json(await getTierData(env, 'team'));
    }

    if (url.pathname === '/api/hq') {
      const p = url.searchParams.get('p') || request.headers.get('x-passphrase');
      if (!passphraseMatches(p, env.HQ_PASSPHRASE)) {
        return Response.json({ error: 'invalid passphrase' }, { status: 403 });
      }
      return Response.json(await getTierData(env, 'hq'));
    }

    if (url.pathname === '/api/peek-csv') {
      if (!env.KOBO_ASSET_ID || !env.KOBO_TOKEN) {
        return Response.json({ error: 'not configured' }, { status: 400 });
      }
      const server = env.KOBO_SERVER || 'kf.kobotoolbox.org';
      const resp = await fetch(
        `https://${server}/api/v2/assets/${env.KOBO_ASSET_ID}/data/?format=csv`,
        { headers: { Authorization: `Token ${env.KOBO_TOKEN}` } }
      );
      const text = await resp.text();
      return new Response(
        JSON.stringify({ ok: resp.ok, status: resp.status, first_2000_chars: text.slice(0, 2000), total_length: text.length }),
        { headers: { 'content-type': 'application/json' } }
      );
    }

    if (url.pathname === '/api/peek') {
      if (!env.KOBO_ASSET_ID || !env.KOBO_TOKEN) {
        return Response.json({ error: 'not configured' }, { status: 400 });
      }
      const server = env.KOBO_SERVER || 'kf.kobotoolbox.org';
      const resp = await fetch(
        `https://${server}/api/v2/assets/${env.KOBO_ASSET_ID}/data/?format=json&limit=3`,
        { headers: { Authorization: `Token ${env.KOBO_TOKEN}` } }
      );
      if (!resp.ok) return Response.json({ error: `KoBo ${resp.status}` }, { status: 502 });
      const data = await resp.json();
      return Response.json({
        total_count_reported_by_kobo: data.count,
        sample_records: (data.results || []).slice(0, 3),
      });
    }

    // Starts an incremental sync pass (processes page 1 immediately — only
    // submissions newer than the last watermark). The once-a-minute cron
    // tick takes it from there if more than one page of new data exists.
    if (url.pathname === '/api/refresh' && request.method === 'POST') {
      if (!env.KOBO_ASSET_ID || !env.KOBO_TOKEN) {
        return Response.json({ error: 'not configured' }, { status: 400 });
      }
      const result = await startSync(env);
      return Response.json({ started: true, ...result });
    }

    // Manually advance one page — mainly useful for testing without
    // waiting for the next minute's tick.
    if (url.pathname === '/api/refresh-tick' && request.method === 'POST') {
      const result = await continueSync(env);
      return Response.json(result);
    }

    // Rare manual escape hatch — re-walks everything from scratch. Only
    // needed if a submission was deleted from KoBo after being counted,
    // since incremental sync has no way to detect that on its own.
    if (url.pathname === '/api/full-resync' && request.method === 'POST') {
      if (!env.KOBO_ASSET_ID || !env.KOBO_TOKEN) {
        return Response.json({ error: 'not configured' }, { status: 400 });
      }
      const result = await startFullResync(env);
      return Response.json({ started: true, full_resync: true, ...result });
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    if (!env.KOBO_ASSET_ID || !env.KOBO_TOKEN) return;
    try {
      if (event.cron === '0 4 * * *') {
        const result = await startSync(env);
        console.log(`daily sync check: ${JSON.stringify(result)}`);
      } else {
        const result = await continueSync(env);
        if (result.skipped) return;
        console.log(
          result.done
            ? `sync finished: +${result.new_records_this_sync} new records (${result.total_records} total) across ${result.pages_done} pages`
            : `tick: page ${result.pages_done} done, more to sync`
        );
      }
    } catch (err) {
      console.error(`scheduled run failed (${event.cron}): ${err.message}`);
    }
  },
};
