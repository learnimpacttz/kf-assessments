// HQ people with their own codes and a level each, the platform settings (brand name, targets) and the activity log.
//   Admin:  everything.
//   Editor: read everything; write messages (News), reports and replies to queries; no Admin changes, no plan changes.
//   Viewer: read and download only.
// The shared HQ code (HQ_SECRET) still works as an Admin code until an Admin switches it off.
import { kv } from './store.js';
import { hmacHex, toCode } from './auth.js';
import { TARGETS } from './own.js';
import { eatToday } from './config.js';

export const LEVELS = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };
// A desk is how someone looks at the whole system (their Bridge and menu order). It never grants or removes access.
export const DESKS = { coordination: 'Coordination', management: 'Management', leadership: 'Leadership', systems: 'Systems' };
// What an Advisor (a read-only consultant) does not see. Enforced in the app and, for the pages with their own data, on the server.
export const HIDE_KEYS = ['messages', 'questions', 'notes', 'people', 'phones', 'usage', 'payments', 'clean', 'pilot', 'practice', 'ops'];
export const ADVISOR_HIDE = [...HIDE_KEYS];
const HIDE_PATHS = { messages: ['/api/dm', '/api/talk'], questions: ['/api/ask'], notes: ['/api/hqnotes'], usage: ['/api/usage/report', '/api/usage/explore'], payments: ['/api/payments'], phones: ['/api/phones'], clean: ['/api/corrections', '/api/deletions'], pilot: ['/api/pilot'], practice: ['/api/practice'] };
const SEED_DESK = { h1: 'management', h2: 'coordination', h3: 'systems' };
export const deskOf = (u) => (u && DESKS[u.desk] ? u.desk : u && SEED_DESK[u.id] ? SEED_DESK[u.id] : !u || u.level === 'admin' ? 'systems' : u.level === 'viewer' ? 'leadership' : 'coordination');
const HQKEY = 'v2:hq', SETKEY = 'v2:settings', ACTKEY = 'v2:activity';
const SEED = [
  { id: 'h1', name: 'Chogohe Edwin Mundo', email: 'cmundo@learnimpact.or.tz', level: 'admin', review_level: 3, desk: 'management' },
  { id: 'h2', name: 'Joram Joas', email: 'jjoas@learnimpact.or.tz', level: 'admin', review_level: 2, desk: 'coordination' },
  { id: 'h3', name: 'Michael Kamukulu', email: 'mkamukulu@learnimpact.org', level: 'admin', review_level: 3, desk: 'systems' },
];

let hqCache = null, hqAt = 0;
export async function loadHq(env, fresh = false) {
  if (!fresh && hqCache && Date.now() - hqAt < 15000) return hqCache;
  let d = await kv(env).get(HQKEY);
  if (!d) { d = { users: SEED.map((u) => ({ ...u, rot: 0, active: true, created_at: new Date().toISOString() })), shared_enabled: true }; await kv(env).put(HQKEY, d); }
  hqCache = d; hqAt = Date.now(); return d;
}
export async function saveHq(env, d) { await kv(env).put(HQKEY, d); hqCache = d; hqAt = Date.now(); }
const memo = new Map();
export async function codeFor(env, u) {
  const k = `${env.AUTH_SALT}|${u.id}|${u.rot || 0}`;
  if (!memo.has(k)) memo.set(k, toCode(await hmacHex(env.AUTH_SALT, `hq:${u.id}:${u.rot || 0}`)));
  return memo.get(k);
}
export async function hqByCode(env, code) {
  if (!env.AUTH_SALT || !code) return null;
  const d = await loadHq(env); const c = String(code).toUpperCase();
  for (const u of d.users) if (u.active !== false && (await codeFor(env, u)) === c) { if (u.expires_at && eatToday() > u.expires_at) return null; return u; }
  return null;
}
export async function hqList(env) {
  const d = await loadHq(env, true);
  return { shared_enabled: d.shared_enabled !== false, users: await Promise.all(d.users.map(async (u) => ({ id: u.id, name: u.name, email: u.email || '', level: u.level, review_level: u.review_level || 0, desk: deskOf(u), hide: Array.isArray(u.hide) ? u.hide : [], expires_at: u.expires_at || '', active: u.active !== false, code: u.active === false ? null : await codeFor(env, u) }))) };
}
const activeAdmins = (d) => d.users.filter((u) => u.active !== false && u.level === 'admin').length;
export async function hqChange(env, who, b) {
  const d = await loadHq(env, true);
  const me = who.hq_id;
  if (b.action === 'add') {
    const name = String(b.name || '').trim().slice(0, 80); if (!name) return { error: 'Write the name' };
    if (!LEVELS[b.level]) return { error: 'Choose a level' };
    const n = Math.max(0, ...d.users.map((u) => Number(String(u.id).slice(1)) || 0)) + 1;
    d.users.push({ id: 'h' + n, name, email: String(b.email || '').trim().toLowerCase().slice(0, 120), level: b.level, desk: DESKS[b.desk] ? b.desk : undefined, hide: b.preset === 'advisor' ? ADVISOR_HIDE : [], expires_at: /^\d{4}-\d\d-\d\d$/.test(b.expires_at || '') ? b.expires_at : '', rot: 0, active: true, created_at: new Date().toISOString() });
  } else if (b.action === 'update') {
    const u = d.users.find((x) => x.id === b.id); if (!u) return { error: 'Not found', status: 404 };
    if (b.name != null) u.name = String(b.name).trim().slice(0, 80) || u.name;
    if (b.email != null) u.email = String(b.email).trim().toLowerCase().slice(0, 120);
    if (b.level != null) { if (!LEVELS[b.level]) return { error: 'Choose a level' }; u.level = b.level; }
    if (b.desk != null) { if (!DESKS[b.desk]) return { error: 'Choose a desk' }; u.desk = b.desk; }
    if (b.preset === 'advisor') { u.level = 'viewer'; u.desk = 'leadership'; u.review_level = 0; u.hide = [...ADVISOR_HIDE]; }
    else if (b.preset === 'full') u.hide = [];
    if (b.expires_at != null) { const x = String(b.expires_at); if (x && !/^\d{4}-\d\d-\d\d$/.test(x)) return { error: 'Use a date' }; u.expires_at = x; }
    if (b.active != null) u.active = Boolean(b.active);
    if (b.review_level != null) { const rl = Number(b.review_level); if (![0, 2, 3].includes(rl)) return { error: 'Choose a review role' }; u.review_level = rl; }
    if (u.level === 'viewer') u.review_level = 0; // a Viewer cannot approve anything
    if (activeAdmins(d) === 0 && d.shared_enabled === false) return { error: 'Keep at least one active Admin, or switch the shared code on first' };
    if (me && u.id === me && (u.level !== 'admin' || u.active === false)) return { error: 'You cannot remove your own Admin access. Ask another Admin.' };
  } else if (b.action === 'reissue') {
    const u = d.users.find((x) => x.id === b.id); if (!u) return { error: 'Not found', status: 404 };
    u.rot = (u.rot || 0) + 1;
  } else if (b.action === 'shared') {
    const on = Boolean(b.enabled);
    if (!on && activeAdmins(d) === 0) return { error: 'Add an Admin with a personal code before switching the shared code off' };
    if (!on && !me) return { error: 'Sign in with your personal code first, then switch the shared code off' };
    d.shared_enabled = on;
  } else return { error: 'Unknown action' };
  await saveHq(env, d); return { ok: true };
}

// ---- who may do what (the server decides; the screens only hide what you cannot use) ----
export function levelGate(who, method, path) {
  if (!who || who.role !== 'hq' || who.viewAs) return null;
  if (Array.isArray(who.hide) && who.hide.length) for (const k of who.hide) for (const pre of HIDE_PATHS[k] || []) if (path === pre || path.startsWith(pre + '/')) return 'This page is not part of your access.';
  const lv = who.level || 'admin'; if (lv === 'admin') return null;
  const read = method === 'GET' || method === 'HEAD';
  if (path.startsWith('/api/admin/')) {
    if (lv === 'editor' && (path === '/api/admin/news' || path === '/api/admin/messages')) return null;
    return 'Admin access is needed for this.';
  }
  if (read) return null;
  if (/^\/api\/(news\/(react|seen)|usage|push\/|assistant|reports\/preview|login)/.test(path)) return null;
  if (lv === 'editor' && /^\/api\/(reports\/(save|delete)|query|deletions|pilot)/.test(path)) return null;
  return lv === 'editor' ? 'Editors can write messages and reports and reply to queries. Ask an Admin for anything else.' : 'Viewers can read and download only.';
}

// ---- settings: brand names and targets ----
export const BRAND_DEFAULT = { platform: 'Field Command Center', programme: 'KiuFunza 4 Endline 2026', tagline: 'LearnImpact · A Strong Foundation in Reading, Writing and Arithmetic (3Rs) for Every Child', assistant: '' };
export const BRAND = { ...BRAND_DEFAULT };
export const assistantName = () => (BRAND.assistant && BRAND.assistant.trim()) || `${BRAND.platform} Assistant`;
const TARGET_DEFAULT = Object.fromEntries(Object.entries(TARGETS).map(([k, v]) => [k, { good: v.good, warn: v.warn }]));
let setCache = null, setAt = 0;
export async function loadSettings(env, fresh = false) {
  if (!fresh && setCache && Date.now() - setAt < 15000) return setCache;
  setCache = (await kv(env).get(SETKEY)) || {}; setAt = Date.now(); return setCache;
}
export async function applySettings(env) {
  const s = await loadSettings(env);
  Object.assign(BRAND, BRAND_DEFAULT, s.brand || {});
  for (const k of Object.keys(TARGET_DEFAULT)) { const t = (s.targets || {})[k]; TARGETS[k].good = Number.isFinite(t?.good) ? t.good : TARGET_DEFAULT[k].good; TARGETS[k].warn = Number.isFinite(t?.warn) ? t.warn : TARGET_DEFAULT[k].warn; }
}
export async function settingsView(env) {
  const s = await loadSettings(env, true);
  return { brand: { ...BRAND_DEFAULT, ...(s.brand || {}) }, brand_default: BRAND_DEFAULT, assistant_name: assistantName(), targets: Object.fromEntries(Object.keys(TARGET_DEFAULT).map((k) => [k, { good: TARGETS[k].good, warn: TARGETS[k].warn, text: TARGETS[k].text, default: TARGET_DEFAULT[k] }])) };
}
export async function saveSettings(env, b) {
  const s = await loadSettings(env, true);
  if (b.brand) {
    const clean = (v, n) => String(v ?? '').trim().slice(0, n);
    s.brand = { platform: clean(b.brand.platform, 40) || BRAND_DEFAULT.platform, programme: clean(b.brand.programme, 80) || BRAND_DEFAULT.programme, tagline: clean(b.brand.tagline, 160), assistant: clean(b.brand.assistant, 40) };
  }
  if (b.targets) {
    s.targets = s.targets || {};
    for (const [k, v] of Object.entries(b.targets)) {
      if (!TARGET_DEFAULT[k]) continue; const g = Number(v.good), w = Number(v.warn);
      if (!(g > 0 && g <= 100 && w > 0 && w <= g)) return { error: `${k}: the green level must be 1 to 100 and the amber level at or below it` };
      s.targets[k] = { good: g, warn: w };
    }
  }
  await kv(env).put(SETKEY, s); setCache = s; setAt = Date.now(); await applySettings(env); return { ok: true };
}

// ---- activity log ----
export async function logActivity(env, who, action, detail = '') {
  const log = (await kv(env).get(ACTKEY)) || [];
  log.unshift({ at: new Date().toISOString(), who: who?.name || 'unknown', level: who?.role === 'hq' ? who.level || 'admin' : who?.role || '', region: who?.region || null, action, detail: String(detail).slice(0, 200) });
  await kv(env).put(ACTKEY, log.slice(0, 1500));
}
export async function readActivity(env) { return (await kv(env).get(ACTKEY)) || []; }

// what a write request means in words; null = not worth logging
export function activityLabel(path, body) {
  const a = body?.action;
  const L = [
    [/^\/api\/plan$/, () => ({ submit: 'Submitted the field plan', draft: 'Saved a plan draft', change: 'Changed a planned visit', notice: `Marked a ${body.kind || ''} notice as sent` }[a] || 'Changed the plan'), () => body.visit_id ? 'visit ' + body.visit_id : ''],
    [/^\/api\/query$/, () => (a === 'resolve' ? 'Closed a query' : 'Replied to a query'), () => String(body.key || '').split('|').slice(0, 2).join(' ')],
    [/^\/api\/admin\/roster$/, () => 'Changed the staff roster (' + (a || 'edit') + ')', () => body.name || body.kobo_name || ''],
    [/^\/api\/admin\/recipients$/, () => 'Saved the email list', () => (body.rows || []).length + ' people'],
    [/^\/api\/admin\/attach$/, () => 'Deleted files from a KoBo project (records kept)', () => body.asset || ''],
    [/^\/api\/pilot$/, () => (a === 'spread' ? 'Spread test admins over the pilot grades' : 'Set a pilot grade'), () => String(body.school || '')],
    [/^\/api\/deletions$/, () => ({ suggest: 'Suggested deleting records', initiate: 'Initiated a deletion request', delete: 'DELETED records from KoBo', reject: 'Rejected a deletion request', send_back: 'Sent back a deletion request', resubmit: 'Resubmitted a deletion request', withdraw: 'Withdrew a deletion request', comment: 'Commented on a deletion request' }[a] ?? 'Changed a deletion request'), () => (body.ids ? body.ids.length + ' records' : body.id || '')],
    [/^\/api\/admin\/messages$/, () => ({ job_send: 'Sent a message', job_save: 'Saved or scheduled a message', job_run: 'Sent a scheduled message now', job_pause: 'Paused a message', job_resume: 'Resumed a message', job_approve: 'Approved a repeating message', job_delete: 'Deleted a message', template_save: 'Saved a message template', template_delete: 'Deleted a template', builtin_save: 'Changed a built-in email', test: 'Sent a test email', polish: null, view: null, count: null, preview: null }[a] ?? 'Changed messages'), () => body.subject || body.name || body.id || ''],
    [/^\/api\/admin\/news$/, () => ({ send: 'Sent a message', publish: 'Sent a message', save: 'Saved a message', delete: 'Deleted a message', pin: 'Pinned a message', polish: null }[a] ?? 'Changed a message'), () => body.title || ''],
    [/^\/api\/admin\/calsync$/, () => 'Calendar file: ' + (a || ''), () => ''],
    [/^\/api\/admin\/formjob$/, () => 'Sampling form job: ' + (a || ''), () => ''],
    [/^\/api\/admin\/kobo-form$/, () => ['info', 'inspect'].includes(body.op) ? null : 'KoBo form: ' + body.op, () => body.asset || ''],
    [/^\/api\/admin\/hq-users$/, () => 'HQ team: ' + (a || ''), () => body.name || body.id || ''],
    [/^\/api\/admin\/settings$/, () => 'Changed settings', () => Object.keys(body || {}).join(', ')],
    [/^\/api\/admin\/(backup|restore)$/, () => 'Backup: ' + path.split('/').pop(), () => ''],
    [/^\/api\/admin\/(practice-clear|full-resync|resync|recompute)$/, () => 'Admin tool: ' + path.split('/').pop(), () => body.kind || ''],
    [/^\/api\/admin\/devices$/, () => 'Assigned a phone to a person', () => body.code || ''],
    [/^\/api\/reports\/(save|delete)$/, () => (path.endsWith('delete') ? 'Deleted a report' : 'Saved a report'), () => body.title || ''],
    [/^\/api\/admin\/(digest-run|reminders|onboarding|hq-onboarding|team-note)$/, () => (body.dry === true ? null : 'Sent emails: ' + path.split('/').pop()), () => ''],
  ];
  for (const [re, what, det] of L) if (re.test(path)) { const w = what(); return w ? { action: w, detail: det() } : null; }
  return null;
}
