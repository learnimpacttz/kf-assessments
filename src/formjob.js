// Scheduled replacement of the Sampling form in KoBo (pilot form to the standard form), same project, one time.
// Checks before and after, deploys only when every check passes, never touches submissions, and tells HQ by email.
import { kv } from './store.js';
import { koboForm } from './koboforms.js';
import { SAMPLING_STANDARD } from './data/sampling_standard.js';
import { loadRecipients, sendMail } from './digest.js';

const KEY = 'v2:formjob';
// expect_current_rows: the pilot form as first deployed (86), or the pilot form with the corrected draw (326)
const DEFAULT = { armed: true, run_after: '2026-10-16T03:00:00Z', expire_after: '2026-10-18T20:00:00Z', done: null, result: null, expect_current_rows: [86, 326], expect_new_rows: 183, expect_name: 'KF4 Sampling Tool' };
export const loadFormJob = async (env) => ({ ...DEFAULT, ...((await kv(env).get(KEY)) || {}) });
export const saveFormJob = (env, st) => kv(env).put(KEY, st);

async function tellHQ(env, subject, lines) {
  const html = `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:620px;color:#354062"><p><b>AUTOMATED UPDATE</b></p>${lines.map((l) => `<p style="margin:6px 0">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('')}<p style="font-size:12px;color:#5a6478">Sent automatically by the LearnImpact KiuFunza field dashboard.</p></div>`;
  const rec = await loadRecipients(env); const out = [];
  for (const [email, r] of Object.entries(rec)) {
    if (r.role !== 'hq' || r.active === false || r.copy === false) continue;
    try { await sendMail(env, email, { subject, html, text: lines.join('\n') }); out.push(email); } catch { /* the result is also kept in Admin */ }
  }
  return out;
}

// opts: { force, asset (throwaway copy for tests), expectCurrentRows, expectNewRows, xlsx_b64 }
export async function runFormJob(env, opts = {}) {
  const st = await loadFormJob(env);
  const test = Boolean(opts.asset);
  if (!test && st.done && !opts.force) return { skipped: 'already ' + st.done };
  const asset = opts.asset || env.KOBO_ASSET_SAMPLING;
  const expectCur = opts.expectCurrentRows ?? st.expect_current_rows, expectNew = opts.expectNewRows ?? st.expect_new_rows;
  const log = []; const fail = async (why, extra = {}) => {
    const res = { at: new Date().toISOString(), ok: false, why, log, ...extra };
    if (!test) { st.done = 'failed'; st.result = res; await saveFormJob(env, st); await tellHQ(env, 'KiuFunza 4 · Automated update · Sampling form replacement NOT done', ['The scheduled replacement of the Sampling form stopped before anything was deployed: ' + why, 'The pilot form is still live. You can upload the standard form by hand (KF4_Sampling_Tool_EL_2026_CALENDAR_CHECK.xlsx) or run it again from Admin.']); }
    return res;
  };
  try {
    const before = await koboForm(env, { op: 'inspect', asset });
    log.push(`before: ${before.name}, ${before.rows} rows, ${before.submissions} submissions, deployed ${before.deployed_version_id}`);
    if (!test && before.name !== st.expect_name) return await fail(`project name is "${before.name}", expected "${st.expect_name}"`);
    if (before.version_id !== before.deployed_version_id) return await fail('the project has an undeployed draft; someone is editing it');
    const curOk = [].concat(expectCur).includes(before.rows);
    if (!curOk) return await fail(`the live form has ${before.rows} rows, not the ${[].concat(expectCur).join(' or ')} of the pilot form; it was changed by hand`);
    const imp = await koboForm(env, { op: 'import', asset, filename: SAMPLING_STANDARD.filename, xlsx_b64: opts.xlsx_b64 || SAMPLING_STANDARD.xlsx_b64 });
    log.push('imported: ' + imp.import);
    const mid = await koboForm(env, { op: 'inspect', asset });
    log.push(`after import: ${mid.name}, ${mid.rows} rows, ${mid.submissions} submissions`);
    const problems = [];
    if (mid.name !== st.expect_name) problems.push(`name became "${mid.name}"`);
    if (mid.submissions !== before.submissions) problems.push(`submissions ${before.submissions} to ${mid.submissions}`);
    if (expectNew && mid.rows !== expectNew) problems.push(`rows ${mid.rows}, expected ${expectNew}`);
    if (!/TRAIN/.test(mid.cal_status || '')) problems.push('calendar check formula missing');
    if (mid.names.includes('stuid')) problems.push('student-test questions found');
    if (!mid.names.includes('rnd20') || !mid.names.includes('int20') || mid.names.includes('rnd21')) problems.push('the 20-number draw is missing or wrong');
    for (const f of ['ref_kf4schools.csv', 'ref_calendar.csv', 'logo6.png']) if (!mid.files.includes(f)) problems.push('media file missing: ' + f);
    if (problems.length) return await fail('checks after import failed: ' + problems.join('; '), { draft_version: mid.version_id });
    await koboForm(env, { op: 'deploy', asset });
    const after = await koboForm(env, { op: 'inspect', asset });
    if (after.version_id !== after.deployed_version_id || after.submissions !== before.submissions) return await fail('deploy did not finish cleanly', { draft_version: after.version_id });
    const res = { at: new Date().toISOString(), ok: true, previous_version: before.deployed_version_id, new_version: after.deployed_version_id, rows: after.rows, submissions: after.submissions, log };
    if (!test) {
      st.done = 'done'; st.result = res; await saveFormJob(env, st);
      await tellHQ(env, 'KiuFunza 4 · Automated update · Sampling form replaced with the standard form', [`The Sampling form in KoBo is now the standard (non-pilot) form. ${after.rows} rows, ${after.submissions} submissions kept, media files in place.`, `To roll back, open the project's form history in KoBo and redeploy version ${before.deployed_version_id} (the pilot form).`, 'Please refresh the form on one phone and submit a practice record for TRAINING SCHOOL 1 to confirm.']);
    }
    return res;
  } catch (e) { return await fail('error: ' + String(e.message || e).slice(0, 300)); }
}

// called every minute by the cron
export async function maybeRunFormJob(env) {
  const st = await loadFormJob(env);
  if (!st.armed || st.done) return null;
  const now = Date.now();
  if (now < Date.parse(st.run_after)) return null;
  if (now > Date.parse(st.expire_after)) { st.done = 'expired'; await saveFormJob(env, st); return { skipped: 'expired' }; }
  st.done = 'running'; await saveFormJob(env, st); // never run twice at once
  return runFormJob(env, { force: true });
}
