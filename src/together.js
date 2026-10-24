// The page every team shares: how each region is doing, and for every person how many queries they have and how fast they reply, across all regions.
// The aim is to learn from each other: ask the fastest repliers how they work, and help the colleagues who have queries waiting.
// Built from what the system already keeps (summary, queries, plans). Read-only, no pupil details.
import { SCHOOL_BY_ID, STAFF, REGIONS, PARTNERS, staffForKoboName, workingDaysBetween } from './config.js';
import { decorate, overdueQueries } from './queries.js';
import { planCounts } from './progress.js';

const eatDay = (iso) => (iso ? new Date(Date.parse(iso) + 3 * 3600e3).toISOString().slice(0, 10) : null);
const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
const r1 = (x) => Math.round(x * 10) / 10;
export const TOGETHER = { minTests: 20, minReplies: 2, top: 5 };

// working days from the visit to the first response (0 = the same day), or null when nobody has replied
export function replyDays(f) {
  const at = f.q && f.q.wf && f.q.wf.response && f.q.wf.response.at; if (!at || !f.date) return null;
  const d = eatDay(at); return d < f.date ? 0 : Math.min(30, workingDaysBetween(f.date, d));
}
const roll = (a) => { const v = a.filter((x) => x != null); return v.length ? r1(v.reduce((t, x) => t + x, 0) / v.length) : null; };

export function togetherBoard({ sum, queries, plans, today }) {
  const flags = decorate((sum.flags || []).filter((f) => SCHOOL_BY_ID[f.school]), queries || {});
  const isOpen = (f) => !(f.q && f.q.status === 'resolved');
  // regions
  const regions = REGIONS.filter((r) => sum.regions && sum.regions[r]).map((R) => {
    const g = sum.regions[R]; const mine = flags.filter((f) => SCHOOL_BY_ID[f.school].region === R); const open = mine.filter(isOpen);
    const records = Object.values(sum.schools || {}).filter((s) => s.region === R).reduce((t, s) => t + [1, 2, 3].reduce((a, k) => a + (s.g[k].n || 0), 0), 0);
    const touched = open.reduce((t, f) => t + (f.n || 0), 0); const pc = planCounts((plans || {})[R], sum, today);
    return { region: R, partner: Object.entries(PARTNERS).find(([, rs]) => rs.includes(R))?.[0] || null, schools: { done: g.done, total: g.total }, pupils: { tested: g.tested, target: g.target, pct: pct(g.tested, g.target) }, pace: g.pace, behind_finish: Boolean(g.behind),
      plan: pc, queries: { total: mine.length, open: open.length, overdue: overdueQueries(open, today).length, answered: mine.filter((f) => f.q && f.q.wf && f.q.wf.response).length, reply_days: roll(mine.map(replyDays)) }, clean_pct: records ? 100 - pct(Math.min(records, touched), records) : null };
  }).sort((a, b) => (b.pupils.pct ?? 0) - (a.pupils.pct ?? 0));
  // people, across every region
  const by = {}; for (const f of flags) { const st = f.admin ? staffForKoboName(f.admin) : null; if (st) (by[st.id] ||= []).push(f); }
  const people = STAFF.filter((s) => s.active && ['volunteer', 'rc', 'arc'].includes(s.role)).map((s) => {
    const a = (sum.admins || []).find((x) => x.staff_id === s.id) || null; const mine = by[s.id] || []; const open = mine.filter(isOpen); const tests = a ? a.tested : 0;
    const days = mine.map(replyDays).filter((x) => x != null);
    return { id: s.id, name: s.name, region: s.region, role: s.role, position: s.position, tested: tests, quality: a ? a.quality : null, queries: mine.length, open: open.length, overdue: overdueQueries(open, today).length, answered: days.length, reply_days: roll(days), per100: tests >= TOGETHER.minTests ? r1((100 * mine.length) / tests) : null };
  }).filter((p) => p.tested > 0 || p.queries > 0);
  const top = (arr, f, n = TOGETHER.top) => arr.slice().sort(f).slice(0, n);
  const ranked = people.filter((p) => p.tested >= TOGETHER.minTests), repliers = people.filter((p) => p.answered >= TOGETHER.minReplies && p.reply_days != null);
  const sorted = repliers.map((p) => p.reply_days).sort((a, b) => a - b), med = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : 0;
  const highlights = {
    most_open: top(people.filter((p) => p.open > 0), (a, b) => b.open - a.open || b.overdue - a.overdue),
    fewest: top(ranked, (a, b) => a.per100 - b.per100 || b.tested - a.tested),
    fastest: top(repliers.filter((p) => p.reply_days <= med), (a, b) => a.reply_days - b.reply_days || b.answered - a.answered),
    slowest: top(repliers.filter((p) => p.reply_days > med), (a, b) => b.reply_days - a.reply_days || b.answered - a.answered), // nobody is on both lists
  };
  const all = flags.filter(isOpen); const done = flags.map(replyDays);
  return { today, regions, people, highlights, national: { queries: flags.length, open: all.length, overdue: overdueQueries(all, today).length, reply_days: roll(done), people: people.length } };
}
