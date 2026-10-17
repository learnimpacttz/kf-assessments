// The assistant: answers HQ questions from the live numbers and drafts text. It can only READ. Anything it proposes
// (a News draft, report wording, a screen to open) comes back as a button that a person presses, under their own name.
import { kv } from './store.js';
import { REGIONS, SCHOOL_BY_ID, STAFF, FIELD_START, FIELD_END, PILOT_DAY } from './config.js';
import { buildReport, TEMPLATES } from './reports.js';
import { ownWork } from './own.js';
import { decorate, overdueQueries } from './queries.js';
import { planProgress } from './plan.js';
import { BRAND, assistantName } from './hq.js';

const MODEL = 'claude-sonnet-5-5';
const DAILY_LIMIT = 80;
const cap = (o, n = 7000) => { const s = JSON.stringify(o); return s.length > n ? s.slice(0, n) + '…(cut: ask for a narrower question)' : s; };

const TOOLS = [
  { name: 'get_overview', description: 'National progress, region list with progress, plan status, the number of overdue queries, and when the data was last updated. Start here for general questions.', input_schema: { type: 'object', properties: {} } },
  { name: 'list_reports', description: 'The report types that can be built, with their ids and what each contains.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_report', description: 'Build one report from the live numbers and return its columns and rows (first `limit`). Use it for tables: progress by region, schools, test admins, submission timing, queries, notices and plan compliance, coordinators\' own work, daily field summary, phones.', input_schema: { type: 'object', properties: { template: { type: 'string', description: 'report id from list_reports' }, region: { type: 'string', description: 'region in capitals, e.g. TANGA (optional)' }, from: { type: 'string', description: 'YYYY-MM-DD (queries, notices_plan)' }, to: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD (daily_summary)' }, limit: { type: 'integer', description: 'rows to return, default 30, at most 80' } }, required: ['template'] } },
  { name: 'find_school', description: 'Look up a school by name or code: group, visit dates, pupils tested by grade against the sample, people who tested, open checks.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'find_person', description: 'Look up a staff member by name: tests, quality, timing of submissions, and for coordinators their own-work targets.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'propose_news_draft', description: 'Propose a News message for HQ to review. It is NOT sent: the person sees a button to save it as a draft.', input_schema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, kind: { type: 'string', enum: ['announcement', 'goodwill', 'reminder', 'congrats', 'update'] }, to: { type: 'string', enum: ['all', 'coordinators', 'volunteers', 'hq'] } }, required: ['title', 'body'] } },
  { name: 'propose_open', description: 'Suggest opening a screen in the dashboard (a button for the person).', input_schema: { type: 'object', properties: { tab: { type: 'string', enum: ['hq', 'regions', 'plan', 'people', 'allq', 'phones', 'compare', 'reports', 'explore', 'news'] }, label: { type: 'string' } }, required: ['tab', 'label'] } },
];

function runTool(name, input, ctx, actions) {
  const { sum, plans, queries, today } = ctx;
  if (!sum && !['list_reports', 'propose_news_draft', 'propose_open'].includes(name)) return { error: 'There is no data yet.' };
  if (name === 'get_overview') {
    const flags = decorate(sum.flags, queries);
    return { today, data_as_of: sum.as_of, year: ctx.year, rehearsal_data: Boolean(ctx.rehearsal), field_window: `${FIELD_START} to ${FIELD_END}`, pilot_day: PILOT_DAY, national: sum.national, regions: REGIONS.map((r) => { const R = sum.regions[r]; return R && { region: r, schools: R.total, complete: R.done, tested: R.tested, sample: R.target, pace: R.pace, projected: R.projected, plan: plans[r]?.status || 'draft' }; }).filter(Boolean), open_checks: flags.filter((f) => !(f.q && f.q.status === 'resolved')).length, overdue_queries: overdueQueries(flags, today).length };
  }
  if (name === 'list_reports') return TEMPLATES.map((t) => ({ id: t.id, title: t.title, about: t.desc, filters: t.params }));
  if (name === 'get_report') {
    const t = TEMPLATES.find((x) => x.id === input.template); if (!t) return { error: 'Unknown report id', ids: TEMPLATES.map((x) => x.id) };
    const r = buildReport(input.template, ctx, { region: input.region, from: input.from, to: input.to, date: input.date }, null);
    const n = Math.max(1, Math.min(80, Number(input.limit) || 30));
    return { title: r.title, kpis: r.kpis, columns: r.columns.map((c) => c.label), total_rows: r.rows.length, showing: Math.min(n, r.rows.length), rows: r.rows.slice(0, n).map((row) => r.columns.map((c) => row[c.k] ?? '')) };
  }
  if (name === 'find_school') {
    const q = String(input.query || '').toLowerCase(); const hits = Object.values(sum.schools).filter((s) => s.id.toLowerCase() === q || String(s.name).toLowerCase().includes(q)).slice(0, 4);
    const flags = decorate(sum.flags, queries);
    return hits.length ? hits.map((s) => ({ id: s.id, name: String(s.name).trim(), region: s.region, lga: s.lga, group: `${s.arm}${s.mne === 'M&E' ? ' · M&E' : ''}`, status: s.done ? 'complete' : s.started ? 'started' : 'not started', first_visit: s.first, last_visit: s.last, grades: { 1: s.g[1], 2: s.g[2], 3: s.g[3] }, people: s.admins, open_checks: flags.filter((f) => f.school === s.id && !(f.q && f.q.status === 'resolved')).map((f) => ({ type: f.type, text: f.text, date: f.date })) })) : { error: 'No school matches' };
  }
  if (name === 'find_person') {
    const q = String(input.query || '').toLowerCase(); const hits = sum.admins.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 3);
    return hits.length ? hits.map((a) => { const st = STAFF.find((s) => s.id === a.staff_id); let own = null; if (st && (st.role === 'rc' || st.role === 'arc')) { const flags = decorate(sum.flags.filter((f) => SCHOOL_BY_ID[f.school]?.region === st.region), queries); const o = ownWork({ sum, plan: plans[st.region], queries, flags, today }, st); own = o.rows.map((r) => ({ what: r.label, value: r.display, status: r.status })); } return { name: a.name, role: a.position || a.role, region: a.region, tested: a.tested, avg_test_minutes: a.avg_min, quality: a.quality, sampling_forms: a.samp, teacher_forms: a.tf, submission_timing: a.sub_all, coordinator_targets: own }; }) : { error: 'No person matches' };
  }
  if (name === 'propose_news_draft') { actions.push({ type: 'news_draft', title: String(input.title || '').slice(0, 120), body: String(input.body || '').slice(0, 2000), kind: input.kind || 'announcement', to: input.to || 'all' }); return { ok: true, note: 'Shown to the person as a button. Not sent.' }; }
  if (name === 'propose_open') { actions.push({ type: 'open', tab: input.tab, label: String(input.label || '').slice(0, 60) }); return { ok: true }; }
  return { error: 'Unknown tool' };
}

async function claude(env, body) {
  const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, ...body }) });
  if (!res.ok) throw new Error('The AI service did not answer (' + res.status + ')');
  return res.json();
}

async function useQuota(env, who) {
  const day = new Date().toISOString().slice(0, 10); const key = 'v2:ai:count:' + day; const c = (await kv(env).get(key)) || {};
  const id = String(who.hq_id || who.name); if ((c[id] || 0) >= DAILY_LIMIT) return false; c[id] = (c[id] || 0) + 1; await kv(env).put(key, c); return true;
}

export async function ask(env, who, messages, ctx) {
  if (!env.ANTHROPIC_API_KEY) return { error: 'The assistant is not set up (no AI key).' };
  if (!(await useQuota(env, who))) return { error: `Today's limit of ${DAILY_LIMIT} questions is used. It resets tomorrow.` };
  const name = assistantName();
  const system = `You are ${name}, the assistant of the ${BRAND.platform} for ${BRAND.programme}, run by LearnImpact in Tanzania. You help the HQ team understand the field work and prepare their work. Today is ${ctx.today} (East Africa Time). Field work runs ${FIELD_START} to ${FIELD_END}; the Dodoma pilot day is ${PILOT_DAY}.
Rules: Use ONLY facts returned by your tools; never guess a number. Say when the data was last updated (data_as_of) when you give figures, and say if the data is rehearsal data from an earlier year. If a tool has no answer, say so. You can only read: you cannot change anything. When you suggest a message, use propose_news_draft; to point to a screen use propose_open. The system holds no pupil names, no teacher names, no phone numbers and no bank details, so never ask for or invent them. "Treatment" and "Control" are the study groups; "M&E" is an add-on label for some schools. A query is overdue when it has had no reply within 2 working days. Be short, calm and practical: a direct answer first, then the few figures that matter, in plain words. Use Kiswahili if the person writes in Kiswahili. Round sensibly and name the region or person each figure belongs to.`;
  const msgs = (messages || []).slice(-12).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 3000) }));
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return { error: 'Ask a question first.' };
  const actions = []; let text = '';
  for (let i = 0; i < 6; i++) {
    const r = await claude(env, { max_tokens: 1300, system, tools: TOOLS, messages: msgs });
    const blocks = r.content || []; text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    const uses = blocks.filter((b) => b.type === 'tool_use');
    if (r.stop_reason !== 'tool_use' || !uses.length) break;
    msgs.push({ role: 'assistant', content: blocks });
    msgs.push({ role: 'user', content: uses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, content: cap(runTool(u.name, u.input || {}, ctx, actions)) })) });
    if (i === 5) text = text || 'I needed more steps than allowed. Ask a narrower question.';
  }
  const log = (await kv(env).get('v2:ai:log')) || [];
  log.unshift({ at: new Date().toISOString(), who: who.name, q: String(messages[messages.length - 1].content).slice(0, 300), a: text.slice(0, 400) }); await kv(env).put('v2:ai:log', log.slice(0, 300));
  return { text: text || 'I could not find an answer.', actions: actions.slice(0, 4) };
}

// wording for a report: headline and notes drafted from the table the person sees (the numbers stay as they are)
export async function draftReportText(env, who, b) {
  if (!env.ANTHROPIC_API_KEY) return { error: 'The assistant is not set up (no AI key).' };
  if (!(await useQuota(env, who))) return { error: `Today's limit of ${DAILY_LIMIT} questions is used.` };
  const rows = (b.rows || []).slice(0, 60); const cols = (b.columns || []).slice(0, 14);
  const r = await claude(env, { max_tokens: 700, system: 'You write the opening lines of a short field-work report for the HQ team of a Tanzanian education program. Use ONLY the figures in the table and key numbers given. Reply with JSON only: {"headline":"one or two plain sentences stating the main finding","notes":"two to four short lines: what stands out and what to follow up"}. No pupil or teacher names. Do not invent causes.', messages: [{ role: 'user', content: JSON.stringify({ report: b.title, filters: b.params || {}, key_numbers: b.kpis || [], columns: cols, rows: rows.map((x) => cols.map((c) => x[c] ?? '')), total_rows: (b.rows || []).length }) }] });
  const txt = (r.content || []).map((c) => c.text || '').join('');
  try { const p = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)); return { headline: String(p.headline || '').slice(0, 1200), notes: String(p.notes || '').slice(0, 3000) }; } catch { return { error: 'Could not read the answer. Try again.' }; }
}
