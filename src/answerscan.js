// Read-only answer-pattern scan: reads ONE page (up to 1,000) of student records straight from KoBo, works out the answer counts
// with the same code the sync uses, and returns them. Nothing is written to the store, so it cannot change any total, list or query.
// Call it again with `after` set to the last_id it returned until `done` is true. Counts and record ids only: no answers, no pupils.
import { addStudents } from './ingest.js';

export async function answerScan(env, who, p) {
  if (who.role !== 'hq' || (who.level || 'admin') !== 'admin') return { error: 'The answer scan is for HQ Admin only', status: 403 };
  const asset = env.KOBO_ASSET_ID; if (!asset) return { error: 'The student project is not connected', status: 422 };
  const year = /^20\d\d$/.test(p.year || '') ? p.year : '2026';
  const after = Math.max(0, Number(p.after) || 0);
  // only this year's records, in id order, so earlier seasons in the same project are never read
  const query = { _id: { $gt: after }, _submission_time: { $gte: `${year}-01-01` } };
  const url = `https://${env.KOBO_SERVER || 'kf.kobotoolbox.org'}/api/v2/assets/${asset}/data/?format=json&limit=1000&sort=${encodeURIComponent(JSON.stringify({ _id: 1 }))}&query=${encodeURIComponent(JSON.stringify(query))}`;
  const r = await fetch(url, { headers: { Authorization: `Token ${env.KOBO_TOKEN}` } }); if (!r.ok) return { error: `KoBo ${r.status} reading records`, status: 502 };
  const d = await r.json(); const page = { results: d.results || [], next: d.next || null };
  const scratch = { yrs: {} }; // thrown away at the end of the request
  addStudents(scratch, page.results);
  const Y = scratch.yrs[year]; const cells = {};
  if (Y) for (const [k, c] of Object.entries(Y.cells)) if (c.ap) cells[k] = { n: c.n, ap: c.ap, ex: (c.ex?.ap || []).map((e) => ['', '', ...e.slice(2)]), mm: c.ex?.mm || [] }; // the pupil id and number are dropped
  const last = page.results.reduce((m, r) => (Number(r._id) > m ? Number(r._id) : m), after);
  return { year, from: after, last_id: last, records: page.results.length, done: !page.next, cells };
}
