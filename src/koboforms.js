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
        const hdr = (rows[0] || []).map((h) => h.replace(/^\uFEFF/, '')); info.columns = hdr.length; info.blank_headings = hdr.map((h, i) => (h.trim() === '' ? i : -1)).filter((i) => i >= 0); info.header_names = hdr.slice(0, 14); info.rows = rows.length - 1; info.ragged = rows.slice(1).filter((r) => r.length !== hdr.length).length;
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
  if (b.op === 'edit_probe') { // read only: do any submissions carry an "edited afterwards" trace? (counts and a few ids and times, no names)
    if (!known.includes(b.asset)) throw new Error('Only the KiuFunza projects');
    const q = (o) => encodeURIComponent(JSON.stringify(o)); const out = { asset: b.asset };
    const base = `${srv}/api/v2/assets/${b.asset}/data/?format=json`;
    const cnt = async (query) => { const r = await fetch(`${base}&limit=1&query=${q(query)}`, { headers: H }); const d = await r.json().catch(() => ({})); return r.ok ? d.count : `error ${r.status}`; };
    out.total = await cnt({}); out.with_deprecatedID = await cnt({ 'meta/deprecatedID': { $exists: true } }); out.with_last_edited = await cnt({ _last_edited: { $exists: true, $ne: null } });
    const r = await fetch(`${base}&limit=3&sort=${q({ _id: -1 })}`, { headers: H }); const d = await r.json().catch(() => ({})); const rec = (d.results || [])[0] || {};
    out.field_names_that_mention_edit = Object.keys(rec).filter((k) => /edit|deprecat|version|instance|uuid|submitted_by|validation/i.test(k));
    const s2 = await fetch(`${base}&limit=5&query=${q({ 'meta/deprecatedID': { $exists: true } })}&fields=${encodeURIComponent(JSON.stringify(['_id', 'today', 'start', 'end', '_submission_time', '_last_edited', 'id_data/school', 'end_note_gr/testtime_rounded']))}`, { headers: H }); const e = await s2.json().catch(() => ({}));
    out.sample_edited = (e.results || []).map((x) => ({ id: x._id, day: x.today, start: x.start, end: x.end, sent: x._submission_time, last_edited: x._last_edited, school: x['id_data/school'], mins: x['end_note_gr/testtime_rounded'] }));
    return out;
  }
  if (b.op === 'mafunzo_preview') { // read only: records sent under a Mafunzo (training) school on a given day, and the pilot school each would belong to
    if (!known.includes(b.asset)) throw new Error('Only the KiuFunza projects');
    const day = /^\d{4}-\d\d-\d\d$/.test(b.day || '') ? b.day : ''; if (!day) throw new Error('Choose a day');
    const q = encodeURIComponent(JSON.stringify({ 'id_data/school': { $in: ['TRAIN001', 'TRAIN002', 'TRAIN003'] }, today: day }));
    const fields = encodeURIComponent(JSON.stringify(['_id', 'today', 'start', 'end', '_submission_time', 'id_data/school', 'id_data/grade', 'id_data/enumerator', 'stu_info/rand_nr', 'stuid', 'stu_avail', 'deviceid', 'meta/instanceID']));
    const r = await fetch(`${srv}/api/v2/assets/${b.asset}/data/?format=json&limit=1000&fields=${fields}&query=${q}`, { headers: H }); if (!r.ok) throw new Error('KoBo ' + r.status);
    const d = await r.json(); return { asset: b.asset, day, count: d.count, records: (d.results || []).map((x) => ({ id: x._id, school: x['id_data/school'], grade: x['id_data/grade'], who: x['id_data/enumerator'], at: (x.start || '').slice(11, 16), sent: (x._submission_time || '').slice(11, 16), pupil: x.stuid || x['stu_info/rand_nr'] || '', present: String(x.stu_avail) === '2' ? 'absent' : 'present' })) };
  }
  if (b.op === 'record_compare') { // read only: full records for one person and day (and the fields that differ between two of them), so a correction can be planned exactly
    if (!known.includes(b.asset)) throw new Error('Only the KiuFunza projects');
    const c0 = await (await fetch(`${srv}/api/v2/assets/${b.asset}/data/?format=json&limit=1`, { headers: H })).json(); const total = c0.count || 0; // the newest records sit at the end: read the last few hundred, no heavy query
    const tailR = await fetch(`${srv}/api/v2/assets/${b.asset}/data/?format=json&limit=${b.tail || 500}&start=${Math.max(0, total - (b.tail || 500))}`, { headers: H }); if (!tailR.ok) throw new Error('KoBo ' + tailR.status); const tail = ((await tailR.json()).results || []).filter((x) => String(x.today || x['group_intro/date'] || '').slice(0, 10) === b.day);
    const A = { count: total, results: tail.filter((x) => String(x['id_data/enumerator'] || '') === b.who_a) }, B = { results: b.who_b ? tail.filter((x) => String(x['id_data/enumerator'] || '') === b.who_b) : [] };
    const recA = A.results || [], recB = (B.results || [])[0] || null;
    const mafunzo = recA.filter((x) => /^TRAIN/.test(String(x['id_data/school'] || '')));
    const strip = (x) => Object.fromEntries(Object.entries(x).filter(([k]) => !/^(_|meta|formhub|__)/.test(k)));
    const one = mafunzo[0] ? strip(mafunzo[0]) : null; const ref = recB ? strip(recB) : null; const diff = {};
    if (one && ref) for (const k of new Set([...Object.keys(one), ...Object.keys(ref)])) if (JSON.stringify(one[k]) !== JSON.stringify(ref[k]) && !/(testtime|^k\d|start|end|rand_nr|stuid|today|date|deviceid|_g_|a\d\d\d|set)/i.test(k)) diff[k] = { mafunzo: one[k] ?? null, chihikwi: ref[k] ?? null };
    const target = b.target_school ? tail.filter((x) => x['id_data/school'] === b.target_school && String(x['id_data/grade']) === String(b.target_grade || '1')).map((x) => ({ id: x._id, stuid: x.stuid, rand: x['stu_info/rand_nr'], who: x['id_data/enumerator'] })) : null;
    return { target_records: target, ref_stuid: recB ? recB.stuid : null, ref_keys_sample: recB ? Object.keys(recB).filter((k) => /stuid|rand|age|name|conf/i.test(k)).slice(0, 20) : null, count_a: A.count, mafunzo: mafunzo.map((x) => ({ id: x._id, school: x['id_data/school'], grade: x['id_data/grade'], start: x.start, stuid: x.stuid, rand: x['stu_info/rand_nr'], uuid: x['meta/instanceID'] })), differing_fields: diff, ref_id: recB?._id || null };
  }
  // ---- approved correction (15 Oct 2026): the 7 pilot-day records Evodia Mwashilindi sent under Mafunzo belong to Chihikwi, Dodoma ----
  const FIX_IDS = [894307652, 894307668, 894307682, 894307700, 894307713, 894307725, 894307741]; const FIX_REF = 894250356; // a Chihikwi record from the same day, the model for the school's own fields
  const fixAsset = env.KOBO_ASSET_ID;
  const one = async (asset, id) => { const r = await fetch(`${srv}/api/v2/assets/${asset}/data/${id}/?format=json`, { headers: H }); if (!r.ok) throw new Error(`KoBo ${r.status} reading record ${id}`); return r.json(); };
  const bulk = async (asset, ids, data) => { const r = await fetch(`${srv}/api/v2/assets/${asset}/data/bulk/`, { method: 'PATCH', headers: { ...H, ...J }, body: JSON.stringify({ payload: { submission_ids: ids, data } }) }); const t = await r.text(); return { status: r.status, body: t.slice(0, 400) }; };
  const planFor = (rec, ref) => { const g = String(rec['id_data/grade']); const rl = String(rec.rand_long || ('000' + (rec['stu_info/rand_nr'] || '')).slice(-3));
    const copy = ['id_data/school_name', 'stu_info/schoolname_conf', 'mne_text', 'id_data/cal_planned', 'region_label', 'lga_label', 'mne', 'ward', 'arm', 'latitude', 'longitude', 'gps2'];
    const d = { 'id_data/region': 'DODOMA', 'id_data/lga': 'DODOMA(M)', 'id_data/school': 'PS0302089', stuid: '2026PS0302089' + g + rl }; for (const k of copy) if (ref[k] !== undefined) d[k] = ref[k]; return d; };
  if (b.op === 'fix_backup') { // read only: the 7 originals exactly as they are now (kept on the computer before anything is changed)
    const recs = []; for (const id of FIX_IDS) recs.push(await one(fixAsset, id)); const ref = await one(fixAsset, FIX_REF);
    return { saved_at: new Date().toISOString(), records: recs, reference: ref, plan: Object.fromEntries(recs.map((r) => [r._id, planFor(r, ref)])) };
  }
  if (b.op === 'fix_apply') { // writes ONLY the 7 approved records, with the plan above; b.ids may be a subset (first one first), then verifies by reading back
    if (b.confirm !== 'approved-by-michael-2026-10-15') throw new Error('Not confirmed');
    const ids = (b.ids || []).map(Number); if (!ids.length || ids.some((i) => !FIX_IDS.includes(i))) throw new Error('Only the 7 approved records can be corrected');
    const ref = await one(fixAsset, FIX_REF); const out = [];
    for (const id of ids) {
      const rec = await one(fixAsset, id); if (!/^TRAIN/.test(String(rec['id_data/school'] || '')) && rec['id_data/school'] !== 'PS0302089') throw new Error(`Record ${id} is not a Mafunzo record any more; stopping`);
      const data = planFor(rec, ref); const r = await bulk(fixAsset, [id], data); const after = await one(fixAsset, id);
      const wrong = Object.entries(data).filter(([k, v]) => String(after[k] ?? '') !== String(v)).map(([k, v]) => ({ field: k, wanted: v, got: after[k] ?? null }));
      out.push({ id, patch: r.status, mismatches: wrong, school_now: after['id_data/school'], stuid_now: after.stuid }); if (r.status >= 300 || wrong.length) break; // stop at the first problem
    }
    return { done: out };
  }
  if (b.op === 'fix_rehearse') { // the same calls on a throwaway project with one made-up record shaped like the real ones (some fields empty, some missing)
    const created = await fetch(`${srv}/api/v2/assets/`, { method: 'POST', headers: { ...H, ...J }, body: JSON.stringify({ clone_from: fixAsset, name: 'ZZ_TEST correction rehearsal', asset_type: 'survey' }) }); // a copy of the real Students form
    const t = await created.json().catch(() => ({})); if (!created.ok) throw new Error('create ' + created.status + JSON.stringify(t).slice(0, 200));
    await kv(env).put('v2:kobotest', [...tests, t.uid]); const log = [];
    try {
      const t1 = await get(t.uid); const dp = await fetch(`${srv}/api/v2/assets/${t.uid}/deployment/`, { method: 'POST', headers: { ...H, ...J }, body: JSON.stringify({ active: true, version_id: t1.version_id }) }); log.push('deploy ' + dp.status + ' ' + (dp.status >= 300 ? (await dp.text()).slice(0, 300) : '')); const a = await get(t.uid);
      const kc = (a.deployment__identifier || '').split('/forms/')[0].replace(/\/[^/]+$/, ''); const idStr = (a.deployment__identifier || '').split('/forms/')[1] || a.uid;
      const xml = `<?xml version='1.0' ?><data id="${idStr}" version="${a.deployed_version_id || a.version_id}"><id_data><region>TRAINING</region><lga>TRAINING_LGA</lga><school>TRAIN001</school><school_name>SHULE YA MAFUNZO 1</school_name><enumerator>ZZ Tester</enumerator></id_data><stuid>2026TRAIN0011034</stuid><region_label/><mne_text>PRACTICE</mne_text><meta><instanceID>uuid:${crypto.randomUUID()}</instanceID></meta></data>`; // lga_label is left out on purpose
      const fd = new FormData(); fd.append('xml_submission_file', new Blob([xml], { type: 'text/xml' }), 'sub.xml'); const sr = await fetch(`${srv.replace('kf.', 'kc.')}/submission`, { method: 'POST', headers: H, body: fd }); log.push('submit ' + sr.status);
      await new Promise((x) => setTimeout(x, 4000)); const lr = await fetch(`${srv}/api/v2/assets/${t.uid}/data/?format=json`, { headers: H }); const ld = await lr.json(); const id = (ld.results || [])[0]?._id; log.push('record ' + id); if (!id) return { ok: false, log };
      const data = { 'id_data/region': 'DODOMA', 'id_data/lga': 'DODOMA(M)', 'id_data/school': 'PS0302089', 'id_data/school_name': 'CHIHIKWI', stuid: '2026PS03020891034', region_label: 'DODOMA', lga_label: 'DODOMA(M)', mne_text: 'Pilot school' };
      const pr = await bulk(t.uid, [id], data); log.push('patch ' + pr.status + ' ' + pr.body);
      await new Promise((x) => setTimeout(x, 2000)); const after = await one(t.uid, id); const wrong = Object.entries(data).filter(([k, v]) => String(after[k] ?? '') !== String(v)).map(([k, v]) => ({ field: k, wanted: v, got: after[k] ?? null }));
      return { ok: pr.status < 300 && !wrong.length, mismatches: wrong, edit_trace: { deprecatedID: after['meta/deprecatedID'] || null, last_edited: after._last_edited || null }, log };
    } finally { const d = await fetch(`${srv}/api/v2/assets/${t.uid}/`, { method: 'DELETE', headers: H }); log.push('cleanup ' + d.status); }
  }
  if (b.op === 'record_brief') { // read only: who, which phone, when, for named records (no pupil answers)
    if (!known.includes(b.asset)) throw new Error('Only the KiuFunza projects');
    const out = []; for (const id of (b.ids || []).slice(0, 30)) { const r = await fetch(`${srv}/api/v2/assets/${b.asset}/data/${Number(id)}/?format=json`, { headers: H }); if (!r.ok) { out.push({ id, error: r.status }); continue; } const x = await r.json(); out.push({ id: x._id, enumerator: x['id_data/enumerator'], device: x.deviceid, school: x['id_data/school'], grade: x['id_data/grade'], grade_conf: x['stu_info/grade_conf'], pupil: x['stu_info/rand_nr'], stuid: x.stuid, start: x.start, end: x.end, sent: x._submission_time, testtime: x['end_note_gr/testtime'], submitted_by: x._submitted_by, edited: x['meta/deprecatedID'] || null, avail: x.stu_avail }); }
    return { records: out };
  }
  if (b.op === 'tail_view') { // read only: the newest records of a form for one day, with the fields that show where they belong (no pupil answers)
    if (!known.includes(b.asset)) throw new Error('Only the KiuFunza projects');
    const c0 = await (await fetch(`${srv}/api/v2/assets/${b.asset}/data/?format=json&limit=1`, { headers: H })).json(); const total = c0.count || 0; const n = b.tail || 300;
    const r = await fetch(`${srv}/api/v2/assets/${b.asset}/data/?format=json&limit=${n}&start=${Math.max(0, total - n)}`, { headers: H }); if (!r.ok) throw new Error('KoBo ' + r.status); const sf = (x, k) => { for (const key in x) if (key === k || key.endsWith('/' + k)) return x[key]; return undefined; };
    const rows = ((await r.json()).results || []).filter((x) => String(x.today || sf(x, 'date') || '').slice(0, 10) === b.day && (!b.school || sf(x, 'school') === b.school)).map((x) => { let drawn = 0; for (let i = 1; i <= 40; i++) { const v = sf(x, 'int' + i); if (v !== undefined && v !== null && v !== '') drawn++; } return { id: x._id, school: sf(x, 'school'), school_name: sf(x, 'school_name'), region: sf(x, 'region'), lga: sf(x, 'lga'), grade: sf(x, 'grade_conf') ?? sf(x, 'grade'), who: sf(x, 'enumerator'), att: sf(x, 'att'), drawn, start: (x.start || '').slice(11, 16), sent: (x._submission_time || '').slice(11, 16), edited: Boolean(x['meta/deprecatedID']), cal_status: sf(x, 'cal_status'), ...(b.ints ? { ints: Array.from({ length: 40 }, (_, i) => sf(x, 'int' + (i + 1))).filter((v) => v !== undefined && v !== null && v !== '').map(Number).sort((a, c) => a - c) } : {}) }; });
    return { total, day: b.day, rows };
  }
  if (b.op === 'edit_scan') { // read only: how many records show signs of being opened and changed after they were finished (counts and a few ids)
    if (!known.includes(b.asset)) throw new Error('Only the KiuFunza projects');
    const q = encodeURIComponent(JSON.stringify(b.from ? { today: { $gte: b.from, $lte: b.to || b.from } } : {})); const fields = encodeURIComponent(JSON.stringify(['_id', 'today', 'start', 'end', '_submission_time', 'meta/deprecatedID', 'end_note_gr/testtime_rounded', 'stu_avail']));
    let url = `${srv}/api/v2/assets/${b.asset}/data/?format=json&limit=1000&fields=${fields}` + (b.from ? `&query=${q}` : `&sort=${encodeURIComponent(JSON.stringify({ _id: -1 }))}`); const o = { n: 0, deprecated: 0, end_after_sent: 0, long_window: 0, examples: [] };
    for (let i = 0; i < (b.pages || 6) && url; i++) { const r = await fetch(url, { headers: H }); if (!r.ok) { o.error = r.status; break; } const d = await r.json(); for (const x of d.results || []) { o.n++; const s0 = Date.parse(x.start || ''), e0 = Date.parse(x.end || ''), sub = Date.parse((x._submission_time || '') + 'Z'); const tt = Number(x['end_note_gr/testtime_rounded']); const dep = Boolean(x['meta/deprecatedID']); const after = !Number.isNaN(e0) && !Number.isNaN(sub) && e0 - sub > 5 * 60000; const lw = !Number.isNaN(e0) && !Number.isNaN(s0) && tt > 0 && (e0 - s0) / 60000 - tt > 30; if (dep) o.deprecated++; if (after) o.end_after_sent++; if (lw) o.long_window++; if ((dep || after || lw) && o.examples.length < 6) o.examples.push({ id: x._id, day: x.today, start: x.start, end: x.end, sent: x._submission_time, mins: tt || null, dep, after, lw }); } url = d.next || null; }
    return o;
  }
  if (b.op === 'attach_stats') { // read only: how much space the attachments of a project take, by type (no content, no names)
    const a = await get(b.asset); let url = `${srv}/api/v2/assets/${a.uid}/data/?format=json&limit=500&fields=${encodeURIComponent('["_id","_attachments"]')}`; const by = {}; let n = 0, files = 0, bytes = 0, withAtt = 0; const forms = await (await fetch(`${srv}/api/v2/assets/${a.uid}/files/?format=json`, { headers: H })).json().catch(() => ({}));
    for (let i = 0; i < 12 && url; i++) { const r = await fetch(url, { headers: H }); const d = await r.json(); for (const x of d.results || []) { n++; const at = x._attachments || []; if (at.length) withAtt++; for (const f of at) { const e = (f.mimetype || 'other').split('/')[0]; const k = by[e] ||= { files: 0, bytes: 0 }; k.files++; k.bytes += Number(f.filesize || 0); files++; bytes += Number(f.filesize || 0); } } url = d.next || null; }
    return { name: a.name, submissions_read: n, with_attachments: withAtt, attachments: files, attachment_mb: Math.round(bytes / 1e6), by_type_mb: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { files: v.files, mb: Math.round(v.bytes / 1e6) }])), form_media_files: (forms.results || []).map((f) => ({ name: f.metadata?.filename, mb: Math.round((f.metadata?.filesize || 0) / 1e5) / 10 })), has_deployment: a.has_deployment, deployed: a.deployment__active, count: a.deployment__submission_count, date_modified: a.date_modified };
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
