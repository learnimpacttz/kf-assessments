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
  if (b.op === 'media_check') { // structure of each media file in a project: size, hash, encoding, header, rows, and how many rows have text in the named columns (never the content itself)
    const f = await (await fetch(`${srv}/api/v2/assets/${b.asset}/files/?format=json`, { headers: H })).json().catch(() => ({}));
    const out = [];
    const sha = async (u8) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', u8))].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 16);
    for (const x of (f.results || [])) {
      const name = x.metadata?.filename || ''; const info = { name, uid: x.uid, size: x.metadata?.filesize ?? null };
      if (/\.csv$/i.test(name)) {
        const r = await fetch(x.content, { headers: H }); const buf = new Uint8Array(await r.arrayBuffer()); info.bytes = buf.length; info.sha = await sha(buf);
        let utf8 = true; let text = ''; try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { utf8 = false; text = new TextDecoder('windows-1252').decode(buf); }
        info.utf8 = utf8; info.bom = buf[0] === 0xef && buf[1] === 0xbb; info.crlf = /\r\n/.test(text);
        // minimal CSV reader (quotes, commas, line breaks inside quotes)
        const rows = []; let row = [], cur = '', q = false;
        for (let i = 0; i < text.length; i++) { const c = text[i]; if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c; }
        if (cur || row.length) { row.push(cur); rows.push(row); }
        const hdr = (rows[0] || []).map((h) => h.replace(/^\uFEFF/, '')); info.columns = hdr.length; info.rows = rows.length - 1; info.ragged = rows.slice(1).filter((r) => r.length !== hdr.length).length;
        info.cols = {};
        for (const c of b.columns || []) { const i = hdr.indexOf(c); if (i < 0) { info.cols[c] = 'MISSING'; continue; } const v = rows.slice(1).map((r) => r[i] || ''); info.cols[c] = { filled: v.filter((t) => t.trim()).length, of: v.length, min: Math.min(...v.map((t) => t.length)), max: Math.max(...v.map((t) => t.length)) }; }
        if (b.by_prefix && hdr.includes('testid')) { const ti = hdr.indexOf('testid'); const si = (b.columns || []).map((c) => hdr.indexOf(c)).filter((i) => i >= 0 && i !== ti); const g = {}; for (const r of rows.slice(1)) { const k = (r[ti] || '(blank)').slice(0, 6); const e = (g[k] ||= { rows: 0, story: 0 }); e.rows++; if (si.some((i) => (r[i] || '').trim())) e.story++; } info.by_prefix = g; }
        info.has_testid = hdr.includes('testid'); info.distinct_testid = new Set(rows.slice(1).map((r) => r[hdr.indexOf('testid')])).size;
      }
      out.push(info);
    }
    return { files: out };
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
    const body = JSON.stringify({ active: true, version_id: b.version_id || a.version_id });
    const r = await fetch(`${srv}/api/v2/assets/${a.uid}/deployment/`, { method: a.has_deployment ? 'PATCH' : 'POST', headers: { ...H, ...J }, body });
    const t = await r.json().catch(() => ({}));
    if (!r.ok && b.version_id) { // KoBo only deploys the latest draft: restore the earlier version's content as a new draft, then deploy that
      const vr = await fetch(`${srv}/api/v2/assets/${a.uid}/versions/${b.version_id}/?format=json`, { headers: H }); const v = await vr.json().catch(() => ({})); if (!vr.ok || !v.content) throw new Error(`KoBo ${r.status} deploying and the old version could not be read`);
      const pr = await fetch(`${srv}/api/v2/assets/${a.uid}/`, { method: 'PATCH', headers: { ...H, ...J }, body: JSON.stringify({ content: v.content }) }); if (!pr.ok) throw new Error(`KoBo ${pr.status} restoring the old version`);
      const cur = await get(a.uid); const r2 = await fetch(`${srv}/api/v2/assets/${a.uid}/deployment/`, { method: 'PATCH', headers: { ...H, ...J }, body: JSON.stringify({ active: true, version_id: cur.version_id }) }); if (!r2.ok) throw new Error(`KoBo ${r2.status} deploying the restored version`);
      return { ...brief(await get(a.uid)), restored_from: b.version_id };
    }
    if (!r.ok) throw new Error(`KoBo ${r.status} deploying: ${JSON.stringify(t).slice(0, 400)}`);
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
  if (b.op === 'usage') { // the account's plan limits and use (read only)
    const out = {}; for (const path of ['service_usage/', 'organizations/orgDsa9DB4pAUdqub5Ev53Ct/asset_usage/']) { const r = await fetch(`${srv}/api/v2/${path}?format=json`, { headers: H }); out[path] = { status: r.status, body: (await r.text()).slice(0, 9000) }; } return out;
  }
  if (b.op === 'probe_delete') { // rehearsal of the deletion calls on a ZZ_TEST copy: submit two test records, read them back by id, delete one, check the counts
    const a = await guard(b.asset); if (!isTest(a) || known.includes(a.uid)) throw new Error('Test copies only');
    const kc = (a.deployment__identifier || '').split('/forms/')[0].replace(/\/[^/]+$/, ''); const idStr = (a.deployment__identifier || '').split('/forms/')[1] || a.uid; const log = [];
    for (let i = 1; i <= 2; i++) { const xml = `<?xml version='1.0' ?><data id="${idStr}" version="${a.deployed_version_id || a.version_id}"><id_data><school>ZZTEST</school><grade>1</grade><enumerator>ZZ Tester</enumerator></id_data><stuid>ZZ${i}</stuid><meta><instanceID>uuid:${crypto.randomUUID()}</instanceID></meta></data>`; const fd = new FormData(); fd.append('xml_submission_file', new Blob([xml], { type: 'text/xml' }), 'sub.xml'); const r = await fetch(`${srv.replace('kf.', 'kc.')}/submission`, { method: 'POST', headers: { ...H, 'X-OpenRosa-Version': '1.0' }, body: fd }); log.push(`submit ${i}: ${r.status} ${(await r.text()).replace(/\s+/g, " ").slice(0, 600)}`); }
    await new Promise((x) => setTimeout(x, 3000));
    const list = async (q) => { const r = await fetch(`${srv}/api/v2/assets/${a.uid}/data/?format=json&limit=1000${q ? '&query=' + encodeURIComponent(JSON.stringify(q)) : ''}`, { headers: H }); const d = await r.json().catch(() => ({})); return { status: r.status, count: d.count, ids: (d.results || []).map((x) => x._id) }; };
    const all = await list(null); log.push('list: ' + JSON.stringify(all)); if (!all.ids.length) return { ok: false, log };
    const byId = await list({ _id: { $in: [all.ids[0]] } }); log.push('query by _id: ' + JSON.stringify(byId));
    const bySchool = await list({ 'id_data/school': 'ZZTEST' }); log.push('query by school: ' + JSON.stringify(bySchool));
    const d1 = await fetch(`${srv}/api/v2/assets/${a.uid}/data/${all.ids[0]}/`, { method: 'DELETE', headers: H }); log.push('delete: ' + d1.status);
    const after = await list(null); log.push('after: ' + JSON.stringify(after));
    return { ok: byId.ids.length === 1 && d1.status === 204 && after.count === all.count - 1, log };
  }
  if (b.op === 'delete') {
    const a = await get(b.asset);
    if (!isTest(a) || known.includes(a.uid)) throw new Error('Only ZZ_TEST copies can be deleted');
    const r = await fetch(`${srv}/api/v2/assets/${a.uid}/`, { method: 'DELETE', headers: H });
    return { deleted: r.status };
  }
  throw new Error('Unknown op');
}
