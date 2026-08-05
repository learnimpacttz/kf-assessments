import { fetchKoboPage } from './kobo.js';
import { emptyCounts, addPageToCounts } from './aggregate.js';

// Processes exactly ONE page per invocation. State (counts + where to
// resume) lives entirely in KV, advanced by a once-a-minute Cron Trigger —
// each tick is a fresh invocation with its own CPU budget, which is what
// actually fits this within the free-tier limit. (Both a single invocation
// fetching everything at once, AND a Worker-calls-itself subrequest chain,
// hit problems — this tick-based design avoids both.)
async function processOnePage(env, cursorUrl) {
  const server = env.KOBO_SERVER || 'kf.kobotoolbox.org';
  const page = await fetchKoboPage(server, env.KOBO_ASSET_ID, env.KOBO_TOKEN, cursorUrl);

  const progress = (await env.DASHBOARD_KV.get('refresh_progress', 'json')) || {
    counts: emptyCounts(),
    pages_done: 0,
  };
  addPageToCounts(progress.counts, page.results);
  progress.pages_done += 1;
  progress.next_cursor = page.next;

  if (page.next) {
    await env.DASHBOARD_KV.put('refresh_progress', JSON.stringify(progress));
    return { done: false, pages_done: progress.pages_done };
  }

  await env.DASHBOARD_KV.put(
    'data',
    JSON.stringify({
      status: 'ok',
      fetched_at: new Date().toISOString(),
      pages_fetched: progress.pages_done,
      ...progress.counts,
    })
  );
  await env.DASHBOARD_KV.delete('refresh_progress');
  return { done: true, pages_done: progress.pages_done, total_records: progress.counts.total_records };
}

async function startRefresh(env) {
  await env.DASHBOARD_KV.delete('refresh_progress');
  return processOnePage(env, null);
}

async function continueRefresh(env) {
  const progress = await env.DASHBOARD_KV.get('refresh_progress', 'json');
  if (!progress || !progress.next_cursor) return { skipped: true };
  return processOnePage(env, progress.next_cursor);
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
  const inProgress = await env.DASHBOARD_KV.get('refresh_progress', 'json');
  if (stored) return filterTier(stored, tier);
  if (inProgress) {
    return {
      status: 'refresh_in_progress',
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

    // Starts a fresh run (processes page 1 immediately). The once-a-minute
    // cron tick takes it from there — no self-chaining fetch involved.
    if (url.pathname === '/api/refresh' && request.method === 'POST') {
      if (!env.KOBO_ASSET_ID || !env.KOBO_TOKEN) {
        return Response.json({ error: 'not configured' }, { status: 400 });
      }
      const result = await startRefresh(env);
      return Response.json({ started: true, ...result });
    }

    // Manually advance one page — mainly useful for testing without
    // waiting for the next minute's tick.
    if (url.pathname === '/api/refresh-tick' && request.method === 'POST') {
      const result = await continueRefresh(env);
      return Response.json(result);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    if (!env.KOBO_ASSET_ID || !env.KOBO_TOKEN) return;
    try {
      if (event.cron === '0 4 * * *') {
        const result = await startRefresh(env);
        console.log(`daily refresh started: page 1, ${result.pages_done} pages so far`);
      } else {
        const result = await continueRefresh(env);
        if (result.skipped) return;
        console.log(
          result.done
            ? `refresh finished: ${result.total_records} records across ${result.pages_done} pages`
            : `tick: page ${result.pages_done} done`
        );
      }
    } catch (err) {
      console.error(`scheduled run failed (${event.cron}): ${err.message}`);
    }
  },
};
