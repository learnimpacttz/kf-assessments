// Daily briefing. The facts are always computed by rules from the data, so the
// briefing is correct without any AI. If ANTHROPIC_API_KEY is set, Claude turns
// those same facts into short English and Kiswahili text; it never sees names
// of pupils (there are none in the data) and is told to use only the facts given.
import { kv } from './store.js';
import { REGIONS, FIELD_START, FIELD_END, SCHOOL_BY_ID, addWorkingDays, workingDaysBetween } from './config.js';
import { getPlan, withNotices } from './plan.js';

const title = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export async function buildBrief(env, sum, today, region = null) {
  const tomorrow = addWorkingDays(today, 1);
  const tomorrowMap = {};
  const regs = region ? [region] : REGIONS;
  const planned = {};
  const notices = [];
  const plansArr = await Promise.all(regs.map((r) => getPlan(env, r)));
  for (const [pi, r] of regs.entries()) {
    const plan = plansArr[pi];
    planned[r] = plan.status === 'locked';
    if (plan.status === 'locked') {
      const dec = withNotices(plan, today, null);
      for (const v of dec.visits) {
        if (v.date === tomorrow) (tomorrowMap[r] ||= []).push(v.school_name);
        if (v.date > today && v.aek_state !== 'sent' && (v.aek_state === 'late' || v.aek_state === 'due')) notices.push({ region: r, school: v.school_name, who: 'ward officer', state: v.aek_state, date: v.date });
        if (v.date > today && v.ht_state !== 'sent' && (v.ht_state === 'late' || v.ht_state === 'due')) notices.push({ region: r, school: v.school_name, who: 'head teacher', state: v.ht_state, date: v.date });
      }
    }
  }
  const out = [];
  if (today < FIELD_START) {
    const missing = regs.filter((r) => !planned[r] && r !== 'DODOMA'); // Dodoma is the pilot region: every staff member joins its 5 school visits
    const days = workingDaysBetween(today, FIELD_START);
    if (missing.length) out.push({ sev: days <= 3 ? 'bad' : 'warn', kind: 'plan', text: `${missing.length} region(s) have not submitted the field plan, ${days} working day(s) before field work starts: ${missing.map(title).join(', ')}.` });
    else out.push({ sev: 'good', kind: 'plan', text: 'All field plans are submitted.' });
  }
  if (sum) {
    for (const r of regs) {
      const R = sum.regions[r];
      if (!R) continue;
      if (today >= FIELD_START && !R.started && r !== 'DODOMA') out.push({ sev: 'bad', kind: 'quiet', text: `${title(r)}: no submissions yet.` });
      else if (R.behind) out.push({ sev: 'bad', kind: 'behind', text: `${title(r)} is projected to finish ${R.projected}, after the ${FIELD_END} close. Pace is ${R.pace} schools a day with ${R.total - R.done} schools left.` });
    }
    const flags = sum.flags.filter((f) => !region || SCHOOL_BY_ID[f.school]?.region === region);
    const bad = flags.filter((f) => f.sev === 'bad');
    if (bad.length) {
      const byType = {};
      bad.forEach((f) => (byType[f.type] = (byType[f.type] || 0) + 1));
      out.push({ sev: 'bad', kind: 'flags', text: `${bad.length} serious flag(s) open: ${Object.entries(byType).map(([t, n]) => `${n} ${t}`).join(', ')}.` });
    } else if (flags.length) out.push({ sev: 'warn', kind: 'flags', text: `${flags.length} flag(s) open, none serious.` });
    else if (sum.national.records) out.push({ sev: 'good', kind: 'flags', text: 'No open flags.' });
  }
  if (notices.length) {
    const late = notices.filter((n) => n.state === 'late').length;
    out.push({ sev: late ? 'bad' : 'warn', kind: 'notice', text: `${notices.length} notice(s) to send: ${late} late. ${notices.slice(0, 3).map((n) => `${n.school} (${n.who})`).join('; ')}${notices.length > 3 ? '…' : ''}.` });
  }
  return { today, tomorrow, items: out, tomorrow_schools: tomorrowMap };
}

export async function aiBrief(env, brief, scope) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const cacheKey = `v2:aibrief:${scope}:${brief.today}:${brief.items.map((i) => i.text).join('|').length}`;
  const cached = await kv(env).get(cacheKey);
  if (cached) return cached;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-5-5', max_tokens: 900,
      system: 'You write the morning briefing for the KiuFunza 4 endline field team in Tanzania. Use ONLY the facts given. Be specific, calm and practical. Output JSON only: {"en":["..."],"sw":["..."]} with 3 to 5 short bullets each. Kiswahili must be natural and simple, matching the English meaning.',
      messages: [{ role: 'user', content: JSON.stringify({ scope, today: brief.today, facts: brief.items, tomorrow_schools: brief.tomorrow_schools }) }],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const txt = (data.content || []).map((c) => c.text || '').join('');
  try {
    const parsed = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    await kv(env).put(cacheKey, parsed);
    return parsed;
  } catch {
    return null;
  }
}
