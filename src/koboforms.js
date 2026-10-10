// Form deployment helper: imports an XLSForm into a KoBo project, redeploys it and uploads media files.
// Only the three configured projects and throwaway test copies (name starts with ZZ_TEST) can be touched,
// and nothing here reads or deletes submissions.
import { kv } from './store.js';
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const J = { 'content-type': 'application/json' };

export async function koboForm(env, b) {
  const srv = `https://${env.KOBO_SERVER || 'kf.kobotoolbox.org'}`;
  const H = { Authorization: `Token ${env.KOBO_TOKEN}` };
  const known = [env.KOBO_ASSET_ID, env.KOBO_ASSET_SAMPLING, env.KOBO_ASSET_TEACHER].filter(Boolean);
  const get = async (uid) => { const r = await fetch(`${srv}/api/v2/assets/${uid}/?format=json`, { headers: H }); if (!r.ok) throw new Error(`KoBo ${r.status} reading ${uid}`); return r.json(); };
  const brief = (a) => ({ uid: a.uid, name: a.name, version_id: a.version_id, deployed_version_id: a.deployed_version_id, deployed: a.has_deployment, active: a.deployment__active, submissions: a.deployment__submission_count, date_modified: a.date_modified, date_deployed: a.date_deployed });
  const tests = (await kv(env).get('v2:kobotest')) || [];
  const isTest = (a) => tests.includes(a.uid) || String(a.name || '').startsWith('ZZ_TEST');
  const guard = async (uid) => { const a = await get(uid); if (!known.includes(uid) && !isTest(a)) throw new Error('Only the KiuFunza projects and ZZ_TEST copies can be changed here'); return a; };

  if (b.op === 'info') { const a = await get(b.asset); const f = await (await fetch(`${srv}/api/v2/assets/${b.asset}/files/?format=json`, { headers: H })).json().catch(() => ({})); const c = a.content || {}; const calc = (c.survey || []).find((q) => q.name === 'cal_status')?.calculation || null; const train = (c.choices || []).filter((x) => String(x.name).startsWith('TRAIN')).map((x) => x.name);
    return { ...brief(a), cal_status: calc, practice_choices: train, files: (f.results || []).map((x) => ({ uid: x.uid, name: x.metadata?.filename, type: x.file_type, size: x.metadata?.filesize })) }; }
  if (b.op === 'inspect') { // what a project holds right now: for checks before and after a replacement
    const a = await get(b.asset); const c = a.content || {}; const survey = c.survey || [];
    const f = await (await fetch(`${srv}/api/v2/assets/${b.asset}/files/?format=json`, { headers: H })).json().catch(() => ({}));
    return { ...brief(a), links: a.deployment__links || null, rows: survey.length, names: survey.map((q) => q.name || q.$autoname).filter(Boolean), cal_status: (survey.find((q) => q.name === 'cal_status') || {}).calculation || null, files: (f.results || []).map((x) => x.metadata?.filename) };
  }
  if (b.op === 'clone') {
    if (!known.includes(b.source)) throw new Error('Unknown source');
    const r = await fetch(`${srv}/api/v2/assets/`, { method: 'POST', headers: { ...H, ...J }, body: JSON.stringify({ clone_from: b.source, name: 'ZZ_TEST ' + String(b.name || 'copy').slice(0, 60), asset_type: 'survey' }) });
    const t = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`KoBo ${r.status} cloning: ${JSON.stringify(t).slice(0, 300)}`);
    await kv(env).put('v2:kobotest', [...tests, t.uid]);
    return brief(t);
  }
  if (b.op === 'adopt') { // mark an empty, undeployed copy as a throwaway so it can be deployed for rehearsal and deleted
    const a = await get(b.asset);
    if (known.includes(a.uid) || a.has_deployment || a.deployment__submission_count) throw new Error('Only empty, undeployed copies can be adopted');
    await kv(env).put('v2:kobotest', [...tests, a.uid]); return brief(a);
  }
  if (b.op === 'import') {
    const a = await guard(b.asset);
    const fd = new FormData();
    fd.append('destination', `${srv}/api/v2/assets/${a.uid}/`);
    fd.append('file', new Blob([b64(b.xlsx_b64)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), b.filename || 'form.xlsx');
    const r = await fetch(`${srv}/api/v2/imports/`, { method: 'POST', headers: H, body: fd });
    const t = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`KoBo ${r.status} importing: ${JSON.stringify(t).slice(0, 400)}`);
    let st = t;
    for (let i = 0; i < 20 && !['complete', 'error'].includes(st.status); i++) { await new Promise((x) => setTimeout(x, 1500)); st = await (await fetch(`${srv}/api/v2/imports/${t.uid}/?format=json`, { headers: H })).json(); }
    if (st.status !== 'complete') throw new Error('Import did not finish: ' + JSON.stringify(st).slice(0, 500));
    return { import: st.status, messages: st.messages || null, asset: brief(await get(a.uid)) };
  }
  if (b.op === 'deploy') {
    const a = await guard(b.asset);
    const body = JSON.stringify({ active: true, version_id: a.version_id });
    const r = await fetch(`${srv}/api/v2/assets/${a.uid}/deployment/`, { method: a.has_deployment ? 'PATCH' : 'POST', headers: { ...H, ...J }, body });
    const t = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`KoBo ${r.status} deploying: ${JSON.stringify(t).slice(0, 400)}`);
    return brief(await get(a.uid));
  }
  if (b.op === 'media') {
    const a = await guard(b.asset);
    const old = await (await fetch(`${srv}/api/v2/assets/${a.uid}/files/?format=json`, { headers: H })).json().catch(() => ({}));
    for (const f of (old.results || [])) if (f.metadata?.filename === b.filename) await fetch(`${srv}/api/v2/assets/${a.uid}/files/${f.uid}/`, { method: 'DELETE', headers: H });
    const bytes = b.text != null ? new TextEncoder().encode(b.text) : b64(b.content_b64);
    let bin = ''; for (const c of bytes) bin += String.fromCharCode(c);
    const mime = /\.png$/.test(b.filename) ? 'image/png' : 'text/csv';
    const r = await fetch(`${srv}/api/v2/assets/${a.uid}/files/`, { method: 'POST', headers: { ...H, ...J }, body: JSON.stringify({ description: b.description || b.filename, file_type: 'form_media', metadata: { filename: b.filename }, base64Encoded: `data:${mime};base64,${btoa(bin)}` }) });
    const t = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`KoBo ${r.status} uploading: ${JSON.stringify(t).slice(0, 400)}`);
    return { uploaded: b.filename, uid: t.uid };
  }
  if (b.op === 'delete') {
    const a = await get(b.asset);
    if (!isTest(a) || known.includes(a.uid)) throw new Error('Only ZZ_TEST copies can be deleted');
    const r = await fetch(`${srv}/api/v2/assets/${a.uid}/`, { method: 'DELETE', headers: H });
    return { deleted: r.status };
  }
  throw new Error('Unknown op');
}
