import { env, mem, ok, done } from './_kit.mjs';
import { computeBridge, buildUpdate, saveMilestones, getMilestones, fieldInfo } from '../src/bridge.js';
import { SCHOOLS_BY_REGION } from '../src/config.js';
const [a, b, c] = SCHOOLS_BY_REGION.TANGA; const day = '2026-10-27';
const g = (n) => ({ 1: { n, av: n }, 2: { n, av: n }, 3: { n, av: n } });
const sum = { national: { tested: 360, target: 19800, series: [['2026-10-26', 120], ['2026-10-27', 240]] }, regions: { TANGA: { done: 1, total: 32 } }, schools: {
  [a.id]: { id: a.id, region: 'TANGA', done: true, g: g(40) }, [b.id]: { id: b.id, region: 'TANGA', done: true, g: g(40) }, [c.id]: { id: c.id, region: 'TANGA', done: false, g: g(40) } },
  flags: [
    { type: 'slow', sev: 'warn', school: a.id, grade: 2, date: '2026-10-26', admin: 'P One', n: 20, text: 'x', recs: [] },
    { type: 'slow', sev: 'warn', school: a.id, grade: 2, date: '2026-10-26', admin: 'P One', n: 12, text: 'y', recs: [] }, // same person, day and grade: counted once (the larger)
    { type: 'dup', sev: 'bad', school: b.id, grade: 1, date: '2026-10-27', admin: 'P Two', n: 2, text: 'z', recs: [[1], [2]] },
    { type: 'team', sev: 'warn', school: c.id, grade: 0, date: '2026-10-27', admin: 'P Three', n: 0, text: 'team size', recs: [] }] };
const who = { role: 'hq', level: 'admin', name: 'Michael', id: 'hq:h3', review_level: 3 };
const br = await computeBridge(env, who, { sum, queries: {}, today: day, quota: { used: 4310, limit: 5000, per_day: 380, runs_out: '2026-11-10' }, pred: { national: { likely: '2026-12-01', earliest: '2026-11-25', latest: '2026-12-08' }, regions: { TANGA: { remaining: 40, p_on_time: 30, needed_per_day: 2, recent_pace: 1 } }, at_risk: [{}] } });
ok('field day 7 of 35 on Tue 27 Oct', br.field.day === 7 && br.field.total === 35 && br.field.phase === 'during', JSON.stringify(br.field));
ok('records are all student records at real schools', br.clean.records === 360, String(br.clean.records));
ok('the same person, day and grade counts once (larger value), plus the duplicate', br.clean.flagged === 22 && br.clean.not_clean === 22, JSON.stringify({ f: br.clean.flagged }));
ok('clean rate = 1 minus touched records over all records', br.clean.rate === 93.9, String(br.clean.rate));
ok('a school with an open check is not payment ready', br.clean.complete === 2 && br.clean.payment_ready === 0, JSON.stringify([br.clean.complete, br.clean.payment_ready]));
mem.set('v2:delreq', JSON.stringify([{ id: 'r1', stage: 'suggested', ids: [1, 2, 3], items: [{ school: c.id }] }]));
const br2 = await computeBridge(env, who, { sum, queries: {}, today: day, pred: null });
ok('records inside a pending edit or delete request are not clean yet', br2.clean.pending_records === 3 && br2.clean.not_clean === 25, JSON.stringify(br2.clean));
ok('queries open: all four checks wait for a reply', br2.queries.open === 4 && br2.queries.waiting === 4);
ok('Joram\'s level sees the request in needs', (await computeBridge(env, { ...who, review_level: 2, name: 'Joram' }, { sum, queries: {}, today: day })).needs.some((n) => /first HQ review/.test(n.title)));
ok('the quota warning appears when it runs out before field close', br.needs.some((n) => /KoBo submissions/.test(n.title)));
ok('a region below 50% on time is a warning', br.warnings.some((w) => /Tanga is below/.test(w.title)));
ok('the cleaning deadline is 25 Nov and payments 5 Dec by default', br.milestones.find((m) => m.id === 'cleaning').date === '2026-11-25' && br.milestones.find((m) => m.id === 'payments').date === '2026-12-05' && br.milestones.find((m) => m.id === 'reports').date === '2026-12-15');
ok('a note that records arrive after the cleaning deadline', br.warnings.some((w) => /after the cleaning deadline/.test(w.title)));
ok('only an HQ Admin can change milestones', (await saveMilestones(env, { role: 'hq', level: 'editor' }, [])).status === 403 && (await saveMilestones(env, who, [{ label: 'A', date: '2026-11-01' }, { label: 'B', date: '2026-11-02' }])).ok && (await getMilestones(env)).length === 2);
const u = await buildUpdate(env, 'ed', br, sum); ok('the ED update has status, data, targets, risks and asks', /STATUS/.test(u.text) && /DATA/.test(u.text) && /TARGETS AND DATES/.test(u.text) && /RISKS/.test(u.text) && /DECISIONS AND ASKS/.test(u.text));
const uf = await buildUpdate(env, 'funder', br, sum); ok('the funder update is aggregate only: no risks, no queue details, no names', !/RISKS/.test(uf.text) && !/waiting for a reply/.test(uf.text) && !/P One|P Two/.test(uf.text) && /BY REGION/.test(uf.text));
ok('before field work the status says when it starts', fieldInfo('2026-10-17').phase === 'before' && fieldInfo('2026-10-17').to_start === 1);
done();
