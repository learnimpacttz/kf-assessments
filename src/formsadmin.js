// Admin "Forms" page: replace a form in a KoBo project safely. Steps: pick the file, rehearse it on a throwaway copy
// (import, compare, deploy, roll back, delete the copy), then deploy to the real project with a typed confirmation.
// Submissions are never touched. Rollback re-deploys the previous version.
import { kv } from './store.js';
import { koboForm } from './koboforms.js';
import { tellHQ } from './formjob.js';

const KEY = 'v2:formdeploys';
const sha = async (b64) => { const u = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', u))].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 16); };
const forms = (env) => [['Students assessment', env.KOBO_ASSET_ID], ['Sampling', env.KOBO_ASSET_SAMPLING], ['Teacher', env.KOBO_ASSET_TEACHER]].filter((x) => x[1]).map(([label, asset]) => ({ label, asset }));
const known = (env, asset) => forms(env).find((f) => f.asset === asset);
const msgs = (m) => (m ? JSON.stringify(m).slice(0, 500) : '');

export async function formsView(env) {
  const hist = (await kv(env).get(KEY)) || [];
  const out = [];
  for (const f of forms(env)) {
    try { const i = await koboForm(env, { op: 'inspect', asset: f.asset }); const reh = (await kv(env).get('v2:formrehearsal:' + f.asset)) || null; out.push({ ...f, name: i.name, rows: i.rows, submissions: i.submissions, deployed_version_id: i.deployed_version_id, draft: i.version_id !== i.deployed_version_id, date_deployed: i.date_deployed, files: i.files, rehearsal: reh }); }
    catch (e) { out.push({ ...f, error: String(e.message || e).slice(0, 200) }); }
  }
  return { forms: out, history: hist.slice(0, 20) };
}

function compare(real, next, skipFiles) {
  const rn = new Set(real.names), nn = new Set(next.names);
  const removed = real.names.filter((n) => !nn.has(n)), added = next.names.filter((n) => !rn.has(n));
  const problems = [], notes = [];
  if (next.name !== real.name) problems.push(`The project name would change from "${real.name}" to "${next.name}".`);
  if (!/TRAIN/.test(next.cal_status || '') && /TRAIN/.test(real.cal_status || '')) problems.push('The calendar check (cal_status) would be lost.');
  const lostFiles = real.files.filter((x) => !next.files.includes(x));
  if (lostFiles.length && !skipFiles) problems.push('Media files missing in the new version: ' + lostFiles.join(', '));
  if (removed.length) notes.push(`${removed.length} question name(s) in the live form are not in the new file: ${removed.slice(0, 12).join(', ')}${removed.length > 12 ? ', …' : ''}. Old submissions keep their data, but check this is intended.`);
  if (added.length) notes.push(`${added.length} new question name(s): ${added.slice(0, 12).join(', ')}${added.length > 12 ? ', …' : ''}.`);
  return { rows_live: real.rows, rows_new: next.rows, added: added.length, removed: removed.length, problems, notes };
}

export async function formsRehearse(env, who, b) {
  const f = known(env, b.asset); if (!f) throw new Error('Unknown project');
  if (!b.xlsx_b64) throw new Error('Choose the XLSX file first');
  const hash = await sha(b.xlsx_b64); const log = []; let cloneId = null;
  const res = { at: new Date().toISOString(), by: who.name, file: b.filename, hash, ok: false, log };
  try {
    const real = await koboForm(env, { op: 'inspect', asset: f.asset });
    const c = await koboForm(env, { op: 'clone', source: f.asset, name: 'rehearsal ' + new Date().toISOString().slice(5, 16) }); cloneId = c.uid; log.push('Made a throwaway copy of the live project.');
    const imp = await koboForm(env, { op: 'import', asset: cloneId, filename: b.filename, xlsx_b64: b.xlsx_b64 });
    log.push('The file imported into the copy: ' + imp.import + '.');
    const next = await koboForm(env, { op: 'inspect', asset: cloneId });
    Object.assign(res, compare(real, next, true));
    res.problems = res.problems.filter((p) => !p.startsWith('The project name')); res.notes.push('The media files (calendar, school list, logo) stay in the live project as they are; the throwaway copy does not carry them.');
    await koboForm(env, { op: 'deploy', asset: cloneId });
    const dep = await koboForm(env, { op: 'inspect', asset: cloneId });
    if (dep.version_id !== dep.deployed_version_id) res.problems.push('The copy did not deploy cleanly.'); else log.push('The copy deployed.');
    const v1 = dep.deployed_version_id;
    await koboForm(env, { op: 'import', asset: cloneId, filename: b.filename, xlsx_b64: b.xlsx_b64 });
    const mid = await koboForm(env, { op: 'inspect', asset: cloneId });
    if (mid.version_id !== v1) {
      await koboForm(env, { op: 'deploy', asset: cloneId });
      await koboForm(env, { op: 'deploy', asset: cloneId, version_id: v1 });
      const back = await koboForm(env, { op: 'inspect', asset: cloneId });
      if (back.deployed_version_id === v1 || back.rows === dep.rows) { log.push('Rollback worked on the copy: the earlier version came back.'); res.rollback_tested = true; } else res.problems.push('Rollback did not work on the copy.');
    } else log.push('Rollback was not tested (the same file makes no new version). The previous version id is kept for a manual rollback.');
    res.ok = res.problems.length === 0;
  } catch (e) { res.problems = [...(res.problems || []), 'Stopped: ' + String(e.message || e).slice(0, 400)]; res.ok = false; }
  finally { if (cloneId) { try { await koboForm(env, { op: 'delete', asset: cloneId }); log.push('The throwaway copy was deleted.'); } catch { log.push('The throwaway copy could not be deleted; delete the project named ZZ_TEST rehearsal in KoBo.'); } } }
  await kv(env).put('v2:formrehearsal:' + b.asset, res);
  return res;
}

export async function formsDeploy(env, who, b) {
  const f = known(env, b.asset); if (!f) throw new Error('Unknown project');
  const reh = await kv(env).get('v2:formrehearsal:' + b.asset); const hash = await sha(b.xlsx_b64 || '');
  if (!reh || !reh.ok || reh.hash !== hash || Date.now() - Date.parse(reh.at) > 3 * 3600e3) throw new Error('Rehearse this exact file first (within the last 3 hours) and fix anything it reports.');
  const before = await koboForm(env, { op: 'inspect', asset: f.asset });
  if (String(b.confirm || '').trim() !== before.name) throw new Error(`Type the project name exactly: ${before.name}`);
  if (before.version_id !== before.deployed_version_id) throw new Error('The project has an undeployed draft; someone is editing it in KoBo. Ask them to finish first.');
  const rec = { at: new Date().toISOString(), by: who.name, asset: f.asset, label: f.label, file: b.filename, hash, previous_version: before.deployed_version_id };
  await koboForm(env, { op: 'import', asset: f.asset, filename: b.filename, xlsx_b64: b.xlsx_b64 });
  const mid = await koboForm(env, { op: 'inspect', asset: f.asset });
  const bad = compare(before, mid).problems; if (mid.submissions !== before.submissions) bad.push('submission count changed');
  if (bad.length) { rec.ok = false; rec.why = bad.join('; '); rec.draft_version = mid.version_id; await pushHist(env, rec); throw new Error('Checks after the import failed, nothing was deployed: ' + rec.why + '. The new version sits as an undeployed draft in KoBo.'); }
  await koboForm(env, { op: 'deploy', asset: f.asset });
  const after = await koboForm(env, { op: 'inspect', asset: f.asset });
  if (after.version_id !== after.deployed_version_id || after.submissions !== before.submissions) { rec.ok = false; rec.why = 'deploy did not finish cleanly'; await pushHist(env, rec); throw new Error('The deploy did not finish cleanly. Check the project in KoBo.'); }
  Object.assign(rec, { ok: true, new_version: after.deployed_version_id, rows_before: before.rows, rows: after.rows, submissions: after.submissions }); await pushHist(env, rec);
  await tellHQ(env, `${'KiuFunza 4 · Automated update · ' + f.label + ' form replaced'}`, [`${who.name} replaced the ${f.label} form in KoBo (${after.rows} rows, ${after.submissions} submissions kept).`, `To roll back, use Admin > Forms > Roll back, or re-deploy version ${before.deployed_version_id} in the project's form history.`]).catch(() => {});
  return rec;
}

export async function formsRollback(env, who, b) {
  const f = known(env, b.asset); if (!f) throw new Error('Unknown project');
  const last = ((await kv(env).get(KEY)) || []).find((h) => h.asset === f.asset && h.ok && h.previous_version);
  if (!last) throw new Error('No earlier version recorded for this project');
  const before = await koboForm(env, { op: 'inspect', asset: f.asset });
  if (String(b.confirm || '').trim() !== before.name) throw new Error(`Type the project name exactly: ${before.name}`);
  await koboForm(env, { op: 'deploy', asset: f.asset, version_id: last.previous_version });
  const after = await koboForm(env, { op: 'inspect', asset: f.asset });
  if (after.version_id !== after.deployed_version_id || after.rows !== last.rows_before || after.submissions !== before.submissions) throw new Error('Rollback did not finish cleanly. Check the project in KoBo.');
  const rec = { at: new Date().toISOString(), by: who.name, asset: f.asset, label: f.label, file: "ROLLBACK", ok: true, rows_before: before.rows, previous_version: before.deployed_version_id, new_version: after.deployed_version_id, rows: after.rows, submissions: after.submissions };
  await pushHist(env, rec); await tellHQ(env, 'KiuFunza 4 · Automated update · ' + f.label + ' form rolled back', [`${who.name} rolled the ${f.label} form back to the earlier version.`]).catch(() => {});
  return rec;
}
async function pushHist(env, rec) { const h = (await kv(env).get(KEY)) || []; h.unshift(rec); await kv(env).put(KEY, h.slice(0, 60)); }
