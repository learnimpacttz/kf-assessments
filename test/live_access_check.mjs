// Checks the LIVE system's access gates: who can and cannot reach what. Works on Windows, Mac and Linux: `npm run check:live`.
// Needs an HQ Admin code in the environment variable KF_HQ_CODE (never typed into a file or chat).
//   PowerShell:  $env:KF_HQ_CODE = "YOURCODE"; npm run check:live
//   Mac/Linux:   KF_HQ_CODE=YOURCODE npm run check:live
const B = process.env.KF_URL || 'https://kf-assessments.learnimpacttz.workers.dev';
const hq = (process.env.KF_HQ_CODE || '').trim();
if (!hq) { console.log('Set KF_HQ_CODE to an HQ Admin code first.'); process.exit(2); }
const call = async (path, code, method = 'GET', body) => {
  const h = {}; if (code) h['x-access-code'] = code; if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(B + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const codes = (await call('/api/admin/codes', hq)).json.codes || [];
if (!codes.length) { console.log('Could not read the code list. Is the HQ code an Admin code?'); process.exit(2); }
const pick = (pos) => (codes.find((c) => String(c.position).startsWith(pos)) || {}).code;
const who = { none: null, volunteer: pick('Volunteer'), rc: pick('RC'), arc: pick('ARC') };
const adminGet = ['/api/admin/status', '/api/admin/codes', '/api/admin/roster', '/api/admin/settings', '/api/admin/guests', '/api/admin/activity', '/api/admin/hq-users', '/api/usage/report', '/api/corrections'];
const adminPost = [['/api/admin/push-field', { kind: 'finalize' }], ['/api/admin/guests', { action: 'create' }], ['/api/layouts', { role: 'hq' }], ['/api/admin/roster', { action: 'remove', id: 1 }], ['/api/admin/recompute', {}]];
let bad = 0;
for (const [k, c] of Object.entries(who)) {
  for (const p of adminGet) { const s = (await call(p, c)).status; if (![401, 403].includes(s)) { console.log('OPEN GATE', k, 'GET', p, s); bad++; } }
  for (const [p, b] of adminPost) { const s = (await call(p, c, 'POST', b)).status; if (![401, 403].includes(s)) { console.log('OPEN GATE', k, 'POST', p, s); bad++; } }
}
console.log('gates checked, open gates:', bad);
process.exit(bad ? 1 : 0);
