// KiuFunza 4 Field Command Centre: one page, tabs depend on who signed in.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { ph: null, phDate: null, phRegion: null, phErr: null, daysCache: {}, koboConfirm: null, restoreData: null, rosterMsg: null, daysRows: null, exTab: 'assess', tch: null, linked: null, exErr: null, real: null, viewAs: null, staffList: [], pred: null, brief: null, qOpen: null, cfg: null, code: null, who: null, tab: null, ov: null, pub: null, cmp: null, plan: null, year: null, explore: { q: '', lga: '', sub: 'schools' }, planRegion: null, selVisit: null, adm: null };
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (S.code && S.viewAs !== 'public') headers['x-access-code'] = S.code;
  if (S.viewAs && S.viewAs !== 'public') headers['x-view-as'] = 'staff:' + S.viewAs;
  if (opts.body) headers['content-type'] = 'application/json';
  const res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
  return data;
}

// Treatment / Control is what the programme cares about; M&E (baseline school and teacher survey, surprise visits) is added only to the schools that carry it
const armLabel = (s) => `${s.arm || ''}${s.mne === 'M&E' ? ' · M&E' : ''}`;
const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString('en-GB'));
const pc = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const nextLabel = (d, t) => (new Date(d + 'T00:00:00Z') - new Date(t + 'T00:00:00Z') === 864e5 ? 'Tomorrow' : 'Next school day');
const dayName = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortDate = (iso) => (iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '–');
const title = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const FLAG_LABEL = { assign: 'Assigned vs who did the work', fast: 'Test too fast', slow: 'Test too slow', window: 'Outside school hours', gps: 'Far from school', skilltime: 'Skills skipped', dup: 'Pupil tested twice', notlist: 'Not on sampling list', latesub: 'Sent late', team: 'Team size', over: 'Over the sample', short: 'Short of the sample', nosample: 'No sampling record', offcal: 'Visited off the calendar', headcount: 'Fewer phones than people', devshare: 'One phone, several names', devowner: 'Someone else\'s phone', devoverlap: 'Tests overlap on one phone', devtravel: 'Phone at two schools too fast', devswitch: 'Phone jumping between grades', devnames: 'Names changing on one phone', namedevs: 'One person, several phones', nameoverlap: 'Same person, tests overlap', devpeople: 'One phone, several people', edited: 'Record changed after it was sent' };

// ---------- shared pieces ----------
const kpi = (l, v, s = '', go = '') => `<div class="kpi${go ? ' click' : ''}"${go ? ` data-tab="${go}" title="Open"` : ''}><div class="l">${l}</div><div class="v num">${v}</div><div class="s">${s}</div></div>`;
const bar = (p, color) => `<div class="bar"><i style="width:${Math.min(100, p)}%;${color ? 'background:' + color : ''}"></i></div>`;
const statusPill = (s) => (s.done ? '<span class="pill good">Complete</span>' : s.started ? '<span class="pill warn">In progress</span>' : '<span class="pill mute">Not started</span>');

function regionState(r) {
  if (r.total && r.done >= r.total) return 'good';
  if (!r.started) return 'mute';
  const fp = S.pred?.regions?.[r.region];
  if (fp && S.pred.status !== 'waiting') return fp.level;
  if (r.behind) return 'bad';
  return r.pace > 0 ? 'good' : 'warn';
}
function tiles(regions) {
  const word = { good: 'on track', warn: 'slow', bad: 'at risk', mute: 'not started' };
  return `<div class="tiles">${regions.map((r) => { const st = regionState(r); return `<div class="tile ${st}" ${S.who ? `data-open="region:${esc(r.region)}"` : ""} style="${S.who ? "cursor:pointer" : ""}"><b>${esc(r.region)}</b><div class="n num">${r.done}<small>/${r.total}</small></div><small>${word[st]}</small></div>`; }).join('')}</div>
  <div class="legend"><span><i style="background:#2f8f5b"></i>on track</span><span><i style="background:#a87400"></i>slow</span><span><i style="background:#b8432a"></i>projected to miss the close date</span></div>`;
}

function barChart(series, { need, label = 'tests' } = {}) {
  const data = series.slice(-14);
  if (!data.length) return '<div class="empty">No tests yet.</div>';
  const W = 400, H = 170, p = { l: 34, r: 8, t: 12, b: 22 };
  const max = Math.max(10, ...data.map((d) => d[1]), need || 0) * 1.1;
  const iw = W - p.l - p.r, ih = H - p.t - p.b;
  const x = (i) => p.l + ((i + 0.5) * iw) / data.length, y = (v) => p.t + ih - (v / max) * ih;
  const bw = Math.min(26, iw / data.length - 6);
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = (max * k) / 4; g += `<line class="gl" x1="${p.l}" x2="${W - p.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${p.l - 5}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`; }
  const bars = data.map((d, i) => `<rect x="${x(i) - bw / 2}" y="${y(d[1])}" width="${bw}" height="${p.t + ih - y(d[1])}" rx="3" fill="var(--teal)"><title>${shortDate(d[0])}: ${d[1]} ${label}</title></rect>`).join('');
  const lab = data.map((d, i) => (i % Math.ceil(data.length / 7) === 0 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${shortDate(d[0])}</text>` : '')).join('');
  const line = need ? `<line x1="${p.l}" x2="${W - p.r}" y1="${y(need)}" y2="${y(need)}" stroke="var(--gold)" stroke-width="2" stroke-dasharray="5 4"/><text x="${W - p.r}" y="${y(need) - 5}" text-anchor="end">needed ${Math.round(need)}/day</text>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Tests per day">${g}${bars}${line}${lab}</svg>`;
}

const isOpen = (f) => !f.q || f.q.status !== 'resolved';
const fmtAt = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
// ---- the approval chain on a query: response, team review, first HQ review, final approval ----
const STAGE_IX = { open: 0, rework: 0, team: 1, hq1: 2, final: 3, approved: 4 };
const STAGE_TXT = { open: 'Waiting for the response', rework: 'Sent back for rework', team: 'Team review (RC or ARC)', hq1: 'First HQ review', final: 'Final approval', approved: 'Approved and closed' };
const ACT_TXT = { submitted: 'wrote the response', resubmitted: 'sent the response again', approved: 'approved', edited_approved: 'edited and approved', rejected: 'sent it back', skipped: 'skipped', closed: 'closed it' };
const wfOf = (f) => (f.q && f.q.wf) || { stage: 'open', history: [] };
function qAbility(f) {
  const w = wfOf(f), me = S.who || {}, st = w.stage || 'open', H = w.history || []; const out = { respond: false, review: false, remind: false };
  if (S.viewAs || !me.role) return out;
  if (st === 'open' || st === 'rework') { out.respond = me.role === 'volunteer' ? Boolean(f.admin) && f.admin === me.name : (me.role === 'rc' || me.role === 'arc') && !f.vol; out.remind = (me.role === 'rc' || me.role === 'arc') && Boolean(f.vol); }
  else if (st === 'team') out.review = (me.role === 'rc' || me.role === 'arc') && !(w.response && w.response.by_id === me.id);
  else if (st === 'hq1') out.review = me.role === 'hq' && (me.review_level || 0) >= 2 && !/mundo/i.test(me.name || '');
  else if (st === 'final') out.review = me.role === 'hq' && (me.review_level || 0) >= 3 && !H.some((h) => h.level === 'hq1' && h.action !== 'rejected' && h.by_id === me.hq_id);
  return out;
}
function chainHtml(f) {
  const w = wfOf(f), st = w.stage || 'open', H = w.history || [], ix = STAGE_IX[st];
  const lastOf = (lvl) => [...H].reverse().find((h) => h.level === lvl && h.action !== 'skipped');
  const rej = st === 'rework' ? [...H].reverse().find((h) => h.action === 'rejected') : null;
  const steps = [['responder', 'Response'], ['team', 'Team review'], ['hq1', 'First HQ review'], ['final', 'Final approval']].map(([k, label], i) => {
    let cls = 'pending', sub = '';
    if (k === 'responder') { if (w.response && ix > 0) { cls = 'done'; sub = `${esc(w.response.by.split(' ')[0])} · ${fmtAt(w.response.at)}`; } else if (st === 'rework') { cls = 'cur'; sub = 'rework needed'; } else { cls = 'cur'; sub = 'waiting'; } }
    else if (rej && rej.level === k) { cls = 'bad'; sub = `sent back by ${esc(rej.by.split(' ')[0])}`; }
    else if (k === 'team' && H.some((h) => h.level === 'team' && h.action === 'skipped')) { cls = 'skip'; sub = 'not needed'; }
    else if (ix > i) { const h = lastOf(k); cls = 'done'; sub = h ? `${esc(h.by.split(' ')[0])} · ${fmtAt(h.at)}${h.action === 'edited_approved' ? ' · edited' : ''}` : ''; }
    else if (ix === i && st !== 'approved') { cls = 'cur'; sub = 'waiting'; }
    return `<div class="cs ${cls}"><b>${label}</b><small>${sub}</small></div>`;
  }).join('<i>›</i>');
  const resp = w.response ? `<div class="resp"><b>Response</b> by ${esc(w.response.by)}${w.response.on_behalf_of ? ' for ' + esc(w.response.on_behalf_of) : ''} · ${fmtAt(w.response.at)}${w.response.edited_by ? ` · <span class="pill warn">edited by ${esc(w.response.edited_by)}</span>` : ''}<br>${esc(w.response.text)}</div>` : '';
  const back = st === 'rework' && w.rework_note ? `<div class="resp bad"><b>Sent back:</b> ${esc(w.rework_note)}</div>` : '';
  const hist = H.length ? `<details class="fd"><summary>History (${H.length})</summary>${H.map((h) => `<div class="hrow"><b>${esc(h.by)}</b> <span class="m">${esc(h.role || '')} · ${fmtAt(h.at)}</span> ${esc(ACT_TXT[h.action] || h.action)}${h.on_behalf_of ? ' for ' + esc(h.on_behalf_of) : ''}${h.text ? `<div class="m">${esc(h.text)}</div>` : ''}${h.before ? `<div class="m">Was: ${esc(h.before)}</div>` : ''}</div>`).join('')}${S.who && S.who.role === 'hq' && hqLevel() === 'admin' && !/mundo|joram/i.test(S.who.name || '') && st !== 'approved' ? `<button class="btn sm ghost" data-act="qClose" data-k="${esc(f.qk)}">Close without the chain (Admin)</button>` : ''}</details>` : '';
  return `<div class="chain" title="${esc(STAGE_TXT[st])}">${steps}</div><div class="m" style="margin:4px 0"><b>${esc(STAGE_TXT[st])}</b></div>${resp}${back}${hist}`;
}
function qActions(f) {
  const a = qAbility(f); if (f.qk && a.remind) return `<div class="note" style="margin-top:6px">Waiting for ${esc(f.vol_name || f.admin)} to write the first response. You review it after.</div><button class="btn sm sec" data-act="qRemind" data-k="${esc(f.qk)}" style="margin-top:6px">Remind ${esc((f.vol_name || f.admin).split(' ')[0])}</button>`;
  if (!f.qk || (!a.respond && !a.review)) return '';
  const k = esc(f.qk), w = wfOf(f);
  if (S.qOpen === f.qk) {
    const mode = S.qMode || 'respond'; const pre = mode === 'edit' ? esc(w.response?.text || '') : mode === 'respond' && w.stage === 'rework' ? esc(w.response?.text || '') : '';
    const ph = mode === 'reject' ? 'Why are you sending it back? What should change?' : mode === 'edit' ? 'The corrected response' : 'What happened, and what was done? A sentence or two is enough.';
    const go = { respond: 'Submit for review', edit: 'Save and approve', reject: 'Send back' }[mode];
    return `<div class="qbox"><textarea id="qText" placeholder="${ph}">${pre}</textarea><div style="display:flex;gap:6px;margin-top:6px"><button class="btn sm" data-act="qSubmit" data-k="${k}" data-m="${mode}">${go}</button><button class="btn sm sec" data-act="qOpen" data-k="">Cancel</button></div></div>`;
  }
  if (a.respond) return `<button class="btn sm" data-act="qOpen" data-k="${k}" data-m="respond" style="margin-top:6px">${w.stage === 'rework' ? 'Rewrite the response' : 'Write the response'}</button>`;
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><button class="btn sm" data-act="qApprove" data-k="${k}">Approve</button><button class="btn sm sec" data-act="qOpen" data-k="${k}" data-m="edit">Edit and approve</button><button class="btn sm ghost" data-act="qOpen" data-k="${k}" data-m="reject">Send back</button></div>`;
}
const PHONE_HELP = {
  devoverlap: { what: 'One phone recorded two tests, by different people, during the same minutes. For example, Amina\'s test from 10:05 to 10:12 and Juma\'s from 10:08 to 10:15 on the same phone.', why: 'A phone can only test one pupil at a time. Overlapping times can mean a record was typed in afterwards, copied, or edited.', ok: 'Two pupils tested together on one phone by mistake, or the phone clock was wrong.', todo: 'Ask the test admin how the tests were done. If a record was entered later or edited, write it in your response.', sw: 'Simu moja imerekodi vipimo viwili kwa wakati mmoja. Eleza ilivyokuwa.' },
  devtravel: { what: 'The same phone sent tests from two different schools, and the time between them was too short to travel.', why: 'Schools are normally more than 30 minutes apart. It may mean the phone was passed to someone else, or the wrong school was chosen on the form.', ok: 'The wrong school was picked in the form, or the two schools are really next to each other.', todo: 'Ask who held the phone and which school each test was done at. Say it in your response.', sw: 'Simu moja ilituma vipimo kutoka shule mbili kwa muda mfupi sana.' },
  devswitch: { what: 'One phone kept jumping back and forth between two grades at the same school (for example Grade 1, then Grade 2, then Grade 1 again).', why: 'Each person normally works with one class at a time. Jumping around can mean two people shared the phone, or the grade was chosen wrongly.', ok: 'The test admin finished a group in one class and went back for a missing pupil.', todo: 'Ask who tested which class and write what happened.', sw: 'Simu ilihama mara kwa mara kati ya madarasa mawili. Eleza kwa nini.' },
  nameoverlap: { what: 'The same person has two tests running at the same time. For example, pupil A from 10:05 to 10:12 and pupil B from 10:08 to 10:15, both under one name.', why: 'One person can test only one child at a time. Overlapping times can mean a record was typed in afterwards, copied, or another person used this name.', ok: 'Two children finished the same task together by mistake, or the phone clock was wrong.', todo: 'Ask the person how the tests were done. If a record was entered later, or someone else tested under this name, write it in your response.', sw: 'Mtu mmoja ana vipimo viwili kwa wakati mmoja. Eleza ilivyokuwa.' },
  devpeople: { what: 'One phone was used under more than one name on the same day, in the morning and afternoon or at any time.', why: 'Each person should use their own phone and their own name. When people swap, we cannot tell who tested which child.', ok: 'One phone was lent because another was broken, lost or flat.', todo: 'Say who used the phone, when, and why. Each person uses their own name from now on.', sw: 'Simu moja ilitumika na majina tofauti siku moja. Kila mtu atumie simu na jina lake.' },
  devnames: { what: 'Different names were typed on the same phone within a few minutes.', why: 'Each person should use their own phone and their own name. When names change on one phone, we cannot tell who really did the test.', ok: 'Two people took turns on one phone because one phone was broken or flat.', todo: 'Find out who used the phone and why. The next time, each person uses their own name and phone.', sw: 'Majina tofauti yaliandikwa kwenye simu moja. Kila mtu atumie simu na jina lake.' },
  namedevs: { what: 'The same person sent tests from more than one phone, and the times ran together.', why: 'One person cannot test on two phones at once. It may mean another person used this name.', ok: 'The phone ran out of battery and the person continued on a second phone.', todo: 'Ask the person which phones they used and why. If someone else used their name, say who.', sw: 'Mtu mmoja alituma vipimo kutoka simu zaidi ya moja kwa wakati mmoja.' },
  devshare: { what: 'Two or more names were used on one phone on the same day.', why: 'We want to know who did each test. Sharing phones hides that. It also means one person may not have had a phone.', ok: 'One phone was lent because another was broken, lost or flat.', todo: 'Say who shared the phone and why. If a phone is missing, tell your RC.', sw: 'Majina mawili au zaidi yametumika kwenye simu moja siku moja.' },
  headcount: { what: 'More test admins were named at the school than phones that sent tests.', why: 'Each test admin should send their own records from their own phone. A missing phone can mean someone worked on another person\'s phone or name.', ok: 'A person only helped with the children or the register and did not run tests.', todo: 'Confirm who was at the school and who tested. Write the names.', sw: 'Watu waliotajwa ni wengi kuliko simu zilizotuma vipimo.' },
  devowner: { what: 'A phone that is registered to one person was used under another person\'s name.', why: 'Each phone is assigned to its owner, so we can trust who did the test and who is responsible for the phone.', ok: 'The phone was lent for the day, or the wrong name was chosen in the form.', todo: 'Check if the phone was lent. Write who had it, and fix the owner in Phones and people if it changed for good.', sw: 'Simu ya mtu mmoja ilitumika kwa jina la mtu mwingine.' },
};
function phoneHelp(f) {
  const h = PHONE_HELP[f.type]; if (!h) return '';
  return `<details class="fd ph"><summary>What does this mean?</summary><div class="phbox"><p><b>What we saw.</b> ${esc(h.what)}</p><p><b>Why we check.</b> ${esc(h.why)}</p><p><b>It may be harmless if.</b> ${esc(h.ok)}</p><p><b>What to do.</b> ${esc(h.todo)}</p><p class="sw"><b>Kwa kifupi.</b> ${esc(h.sw)}</p></div></details>`;
}
// Where to go to put the problem right: each query type links to the page that holds the real fix
const PHONE_T = new Set(['devoverlap', 'devshare', 'devowner', 'devtravel', 'devswitch', 'devnames', 'namedevs', 'nameoverlap', 'devpeople', 'headcount']);
function fixLinks(f) {
  const has = (tab) => (TABS[roleKey()] || []).some((t) => t[0] === tab) && tabAllowed(tab); const out = [];
  const clean = (mode, kind, label) => { if (has('clean') && S.who.role !== 'volunteer' && !S.viewAs) out.push(`<button class="btn sm sec" data-act="fixClean" data-mode="${mode}" data-kind="${kind}" data-school="${esc(f.school)}" data-date="${esc(f.date || '')}" data-grade="${esc(f.grade || '')}" data-stu="${esc(((f.recs || [])[0] || [])[0] || '')}">${label}</button>`); };
  const tab = (k, label) => { if (has(k)) out.push(`<button class="btn sm ghost" data-tab="${k}">${label}</button>`); };
  if (f.type === 'dup') { clean('edit', 'students', 'Suggest correcting the pupil number'); clean('delete', 'students', 'Suggest deleting one record'); tab('pupils', 'Open the pupil records'); }
  else if (f.type === 'nosample') { clean('delete', 'sampling', 'Look at the sampling records'); }
  else if (f.type === 'assign') { tab(PILOT_IDS.has(f.school) ? 'pilot' : 'plan', PILOT_IDS.has(f.school) ? 'Open the pilot day page' : 'Open the plan'); }
  else if (f.type === 'offcal' || f.type === 'team') tab('plan', 'Open the plan and calendar');
  else if (PHONE_T.has(f.type) || f.type === 'devtravel') tab('phones', 'Open the phones page');
  else if (['fast', 'slow', 'skilltime', 'window', 'gps', 'notlist', 'edited'].includes(f.type)) tab('pupils', 'Open the pupil records');
  return out.length ? `<div class="fixrow" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><span class="m" style="align-self:center">Fix it:</span>${out.join('')}</div>` : '';
}
const PILOT_IDS = new Set(['PS0302005', 'PS0302057', 'PS0302041', 'PS0302023', 'PS0302089']);
function flagList(all, { limit = 8, names = true, closed = false } = {}) {
  const flags = closed ? all.slice() : all.filter(isOpen);
  if (!flags.length) return '<div class="empty">No open flags. Nothing needs a call right now.</div>';
  const canResolve = S.who && S.who.role !== 'volunteer';
  const one = (f) => {
    const thread = f.q && f.q.thread.length ? `<div class="thread">${f.q.thread.map((m) => `<div><b>${esc(m.by)}</b> <span>${fmtAt(m.at)}</span><br>${esc(m.text)}</div>`).join('')}</div>` : '';
    const box = qActions(f);
    return `<div class="flag ${isOpen(f) ? 'openq' : 'doneq'}"><i class="st ${f.sev}"></i><div style="min-width:0;flex:1"><b>${lk('school', f.school, f.school_name || f.school)} · ${esc(FLAG_LABEL[f.type] || f.type)}${isOpen(f) && f.qk ? (() => { const ab = qAbility(f); return ab.review ? ' <span class="pill good">I review</span>' : ab.respond ? ' <span class="pill warn">I respond</span>' : ''; })() : ''}</b><span>${esc(f.region ? title(f.region) + ' · ' : '')}${esc(f.lga ? title(f.lga) + ' · ' : '')}${f.grade ? 'Grade ' + f.grade + ' · ' : ''}${esc(f.text)}${names && f.admin ? ' · ' + String(f.admin).split(' and ').map((n) => lk('person', n, n)).join(' and ') : ''}${f.date ? ' · ' + shortDate(f.date) : ''}</span>${f.hint ? `<span class="ft">${esc(f.hint)}</span>` : ''}${fixLinks(f)}${phoneHelp(f)}${thread}<details class="fd"><summary>Details to find the records</summary>${flagDetail(f)}</details>${f.qk ? chainHtml(f) : ''}${f.qk ? box : ''}</div></div>`;
  };
  return flags.slice(0, limit).map(one).join('') + (flags.length > limit ? `<div class="note">+ ${flags.length - limit} more in the data explorer.</div>` : '');
}

function briefCard(title0 = "Today's briefing") {
  const b = S.brief; if (!b) return '';
  const items = b.items.length ? b.items.map((i) => `<div class="flag"><i class="st ${i.sev}"></i><div><span style="color:var(--ink);font-size:14px">${esc(i.text)}</span></div></div>`).join('') : '<div class="empty">Nothing to report yet.</div>';
  const ai = b.ai ? `<div class="aiwrap"><div class="ai-col"><h4>English</h4><ul>${(b.ai.en || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div><div class="ai-col"><h4>Kiswahili</h4><ul>${(b.ai.sw || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>` : '';
  const tm = Object.entries(b.tomorrow_schools || {}).map(([r, s]) => `<div class="m"><b>${esc(title(r))}</b>: ${s.map(esc).join(', ')}</div>`).join('');
  return `<div class="card brief"><h3>${title0}</h3><div class="sub">Worked out from the data and the plans. ${b.ai ? 'Wording by AI from the same facts.' : ''}</div>${items}${ai}${tm ? `<h4 style="margin:12px 0 4px">${nextLabel(b.tomorrow, b.today)}, ${dayName(b.tomorrow)}</h4>${tm}` : ''}</div>`;
}

function dataBanner() {
  const o = S.ov || S.pub; if (!o) return '';
  const years = o.years || [];
  const sel = years.length > 1 ? `<select id="yearSel" aria-label="Round">${years.map((y) => `<option value="${y}" ${y === o.year ? 'selected' : ''}>${y}${y === (S.cfg && S.cfg.year) ? '' : ' (archive)'}</option>`).join('')}</select>` : '';
  const warn = o.rehearsal ? `<div class="banner"><b>Rehearsal.</b> No 2026 endline data yet, so you are looking at ${esc(o.year)} data. Use it to practise. Live numbers appear after the first 2026 submission.</div>` : '';
  return `${warn}<div class="sel" style="margin-top:10px">${sel}${S.stale ? '<span class="pill warn">Showing the last update, refreshing…</span>' : ''}<span class="pill mute">Updated ${o.as_of ? new Date(o.as_of).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '–'}</span></div>`;
}

// ---------- views ----------
function viewProgress() {
  const o = S.pub; if (!o || o.status === 'waiting') return waiting();
  const n = o.national;
  return `${dataBanner()}<div class="pagehead"><div><h2>KiuFunza 4 · Endline ${esc(o.year)}</h2><p>Progress across ${o.regions.length} regions. Aggregate only: no names, no school results.</p></div></div>
  <div class="grid kpis">${kpi('Schools complete', `${fmt(n.done)}<small> / ${fmt(n.schools)}</small>`, pc(n.done, n.schools) + '% of schools')}${kpi('Pupils tested', fmt(n.tested), 'of ' + fmt(n.target) + ' sampled')}${kpi('Schools started', fmt(n.started), '')}${kpi('Projected finish', n.projected === 'done' ? 'Done' : n.projected ? shortDate(n.projected) : '–', 'at the last 5 days\' pace')}</div>
  <div class="grid two" style="margin-top:14px"><div class="card"><h3>Regions</h3><div class="sub">Schools complete out of planned</div>${tiles(o.regions)}</div>
  <div class="card"><h3>Tests per day</h3><div class="sub">All regions</div>${barChart(n.series)}</div></div>`;
}

const dShort = (d) => (d ? shortDate(d) : 'after 4 Dec');
function forecastCard(regionOnly) {
  const P = S.pred; if (!P || P.status === 'waiting' || !P.regions) return '';
  const regs = Object.entries(P.regions).filter(([r]) => !regionOnly || r === regionOnly);
  const risk = (P.at_risk || []).filter((x) => !regionOnly || x.region === regionOnly);
  const rows = regs.sort((a, b) => a[1].p_on_time - b[1].p_on_time).map(([r, f]) => `<tr class="click" data-open="region:${esc(r)}"><td><b>${esc(title(r))}</b></td><td class="r num">${f.remaining}</td><td class="r num">${f.needed_per_day}</td><td class="r num">${f.recent_pace ?? '–'}</td><td class="r">${chip(f.p_on_time + '%', f.level)}</td><td>${f.remaining ? esc(dShort(f.likely)) : 'done'}</td><td class="hide-s">${f.remaining ? esc(dShort(f.earliest)) + ' – ' + esc(dShort(f.latest)) : ''}</td></tr>`).join('');
  const nat = !regionOnly ? `<p style="margin:0 0 10px">All regions: <b>${P.national.p_on_time}%</b> chance of finishing by ${shortDate(P.close)}. Most likely <b>${esc(dShort(P.national.likely))}</b>, range ${esc(dShort(P.national.earliest))} to ${esc(dShort(P.national.latest))}.</p>` : '';
  const rk = risk.length ? `<h4 style="margin:14px 0 4px">Schools to chase</h4>${risk.slice(0, 8).map((x) => `<div class="flag"><i class="st ${x.kind === 'missed' ? 'bad' : 'warn'}"></i><div><b>${lk('school', x.school, x.name)}</b><span>${esc(title(x.lga))} · planned ${shortDate(x.planned)} · ${x.kind === 'missed' ? 'not visited' : 'started, not finished'} · ${x.days_overdue} day(s) ago</span></div></div>`).join('')}` : '';
  return `<div class="card"><h3>Forecast</h3><div class="sub">${P.pre_field ? 'Before field work: if 2026 repeats the ' + esc(P.baseline_year || 'earlier') + ' daily pattern.' : 'From each region\'s recent days and last round\'s daily pattern, 1,500 simulated runs.'} The chance is of finishing by ${shortDate(P.close)}.</div>${nat}<div class="tbl"><table><thead><tr><th>Region</th><th class="r">Left</th><th class="r">Need/day</th><th class="r">Pace</th><th class="r">On time</th><th>Likely</th><th class="hide-s">Range</th></tr></thead><tbody>${rows}</tbody></table></div>${rk}</div>`;
}
function waiting() { return `<div class="empty"><h3>Waiting for data</h3><p>The first numbers appear a few minutes after the first submissions reach KoBo.</p></div>`; }

function viewRegion() {
  const o = S.ov; if (!o || o.status === 'waiting') return waiting();
  const m = o.mine, r = m.region, schools = m.schools;
  const flags = m.flags.filter(isOpen);
  const tpg = r.region === 'DODOMA' ? 40 : 20;
  const remaining = r.total - r.done;
  const rows = schools.slice().sort((a, b) => (a.done - b.done) || (b.started - a.started) || a.name.localeCompare(b.name)).map((s) => {
    const t = s.g[1].av + s.g[2].av + s.g[3].av, tg = s.g[1].target + s.g[2].target + s.g[3].target;
    return `<tr class="click" data-open="school:${esc(s.id)}"><td><b>${esc(s.name)}</b></td><td class="hide-s">${esc(title(s.lga))}</td><td class="hide-s">${esc(armLabel(s))}</td><td class="num hide-s">${s.g[1].av}/${s.g[1].target}</td><td class="num hide-s">${s.g[2].av}/${s.g[2].target}</td><td class="num hide-s">${s.g[3].av}/${s.g[3].target}</td><td>${bar(pc(t, tg))}</td><td>${statusPill(s)}</td></tr>`;
  }).join('');
  const neededPerDay = remaining > 0 ? remaining / Math.max(1, workingLeft(o.today)) : 0;
  return `${dataBanner()}<div class="pagehead"><div><h2>Habari, ${esc((S.who.name || '').split(' ')[0])}</h2><p>${esc(S.who.role === 'arc' ? 'Assistant Regional Coordinator' : 'Regional Coordinator')} · ${esc(title(r.region))} · ${dayName(o.today)} · ${r.total} schools · target ${tpg} pupils per grade per school</p></div></div>
  <div class="grid kpis">${kpi('Schools complete', `${r.done}<small> / ${r.total}</small>`, pc(r.done, r.total) + '%')}${kpi('Pupils tested', fmt(r.tested), 'of ' + fmt(r.target))}${kpi('Open flags', flags.length, flags.filter((f) => f.sev === 'bad').length + ' need a call', 'allq')}${kpi('Pace', r.pace + ' / day', 'schools per field day, last 5 days')}${kpi('Projected finish', r.projected === 'done' ? 'Done' : r.projected ? shortDate(r.projected) : '–', r.behind ? 'after the 4 Dec close' : 'before the 4 Dec close')}</div>
  ${ownSection()}
  <div class="grid two" style="margin-top:14px"><div class="card"><h3>Schools in ${esc(title(r.region))}</h3><div class="sub">Pupils tested against sample, by grade</div><div class="tbl"><table><thead><tr><th>School</th><th class="hide-s">LGA</th><th class="hide-s">Type</th><th class="hide-s">Gr 1</th><th class="hide-s">Gr 2</th><th class="hide-s">Gr 3</th><th>Progress</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div></div>
  <div style="display:grid;gap:14px;align-content:start">${briefCard()}${forecastCard(r.region)}<div class="card"><h3>Needs your call</h3><div class="sub">Checked after every submission</div>${flagList(flags)}</div>
  <div class="card"><h3>Tests per day</h3><div class="sub">Dashed line is the daily pace needed to finish by 4 Dec</div>${barChart(r.series, { need: neededPerDay * (tpg * 3 / 1) })}</div></div></div>`;
}
function workingLeft(today) {
  let n = 0, d = new Date(today + 'T00:00:00Z'); const end = new Date(S.cfg.field.end + 'T00:00:00Z');
  while (d < end) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w && w < 6) n++; }
  return Math.max(1, n);
}

function bandsText() { const b = S.ov?.bands; return b ? [1, 2, 3].map((g) => `Gr ${g}: ${b[g].p3.toFixed(1)}-${b[g].p99.toFixed(0)} min`).join(' · ') : ''; }

// ----- test admin screens -----
function viewDay() {
  const o = S.ov; if (!o || o.status === 'waiting') return waiting();
  const plan = S.plan?.plan;
  const today = o.today;
  const me = S.who;
  const mine = (plan?.visits || []).filter((v) => !v.team?.length || v.team.includes(me.name));
  const todays = mine.filter((v) => v.date === today);
  const next = mine.filter((v) => v.date > today).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 4);
  const sch = Object.fromEntries((o.mine.schools || []).map((s) => [s.id, s]));
  const card = (v) => { const s = sch[v.school]; const g = s?.g; return `<div class="sch"><h4>${lk('school', v.school, v.school_name)}</h4><div class="m">${esc(title(v.lga))} · ${esc(armLabel(v))} · starts ${esc(v.start)}</div>${g ? `<div class="gr">${[1, 2, 3].map((k) => `<div><b>${g[k].av}/${g[k].target}</b><small>Darasa ${k}</small></div>`).join('')}</div>` : ''}${s?.done ? '<div class="note" style="margin-top:8px">Shule imekamilika · School complete</div>' : ''}</div>`; };
  const mf = o.mine.flags.filter(isOpen).length;
  const lead = (o.mine.staff || []).filter((x) => x.role === 'rc' || x.role === 'arc'); const team = lead.length ? lead.map((x) => esc(x.name.split(' ')[0]) + ' (' + x.role.toUpperCase() + ')').join(', ') : '';
  return `${dataBanner()}<div class="pagehead"><div><h2>Habari, ${esc(me.name.split(' ')[0])}</h2><p>${esc(/^volunteer/i.test(me.position || '') || !me.position ? 'Test admin' + (me.position ? ' (' + me.position + ')' : '') : me.position)} · ${esc(title(me.region))} · ${dayName(today)}${team ? ' · ' + team : ''} · ${todays.length ? todays.length + ' school' + (todays.length > 1 ? 's' : '') + ' today' : 'no school today'}</p></div></div>
  ${mf ? `<div class="banner bad">You have <b>${mf}</b> query(ies) to look at. Open "My queries".</div>` : ''}
  <h3 style="margin:14px 0 8px">Leo · Today</h3>${todays.length ? todays.map(card).join('') : '<div class="note">No school in the plan for you today. Check with your RC.</div>'}
  <h3 style="margin:18px 0 8px">Zinazofuata · Coming up</h3>${next.length ? next.map((v) => `<div class="sch"><h4>${esc(v.school_name)}</h4><div class="m">${dayName(v.date)} · ${esc(v.start)} · ${esc(title(v.lga))}</div></div>`).join('') : '<div class="note">Nothing planned yet.</div>'}`;
}
// One row per day, school and grade. Tap it to open everything sent for that school and day: the sampling forms and every pupil file (numbers only).
S.wkOpen = S.wkOpen || {}; S.wkf = S.wkf || {};
const wkKey = (name, w) => [name, w[1], w[0]].join('|');
function workRowsHtml(name, rows, o = {}) {
  const seen = new Set();
  return rows.map((w) => {
    const k = wkKey(name, w), open = S.wkOpen[k], first = !seen.has(k); seen.add(k);
    const row = `<tr class="click wkx ${open ? 'open' : ''}" data-act="wkx" data-name="${esc(name)}" data-school="${esc(w[1])}" data-date="${esc(w[0])}"><td><span class="car">${open ? '▾' : '▸'}</span> ${shortDate(w[0])}</td><td>${esc(o.schoolName ? o.schoolName(w[1]) : schoolName(w[1]))}</td><td class="r">${w[2]}</td><td class="num r">${w[3]}</td><td class="num r">${w[4] ?? '–'}</td></tr>`;
    return row + (open && first ? `<tr class="wkd"><td colspan="5">${workDetail(k, w)}</td></tr>` : '');
  }).join('');
}
function workDetail(k, w) {
  const d = S.wkf[k]; if (!d) return '<div class="m">Loading the files…</div>'; if (d.err) return `<div class="need-l">${esc(d.err)}</div>`;
  const smp = d.sampling.length ? `<div class="tbl"><table><thead><tr><th>Grade</th><th class="r">On register</th><th class="r">Drawn</th><th class="r">Started</th><th>Sent</th></tr></thead><tbody>${d.sampling.map((x) => `<tr><td>Gr ${esc(x.grade)}</td><td class="num r">${x.register ?? '–'}</td><td class="num r">${x.drawn || 'all'}</td><td class="num r">${esc(x.at)}</td><td>${esc(x.sub.slice(5))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="m">No sampling form from you for this school and day.</div>';
  const pup = d.pupils.length ? `<div class="tbl"><table><thead><tr><th>Pupil no.</th><th>Grade</th><th class="r">Started</th><th class="r">Min</th><th>Here</th><th>Sent</th></tr></thead><tbody>${d.pupils.map((x) => `<tr><td class="num">${esc(String(x.pupil))}</td><td>Gr ${esc(x.grade)}</td><td class="num r">${esc(x.at)}</td><td class="num r">${x.mins ?? '–'}</td><td class="${x.present === 'absent' ? 'need-l' : ''}">${x.present === 'absent' ? 'Absent' : 'Yes'}</td><td>${esc(x.sub.slice(5))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="m">No pupil files from you for this school and day.</div>';
  return `<div class="wkbox"><h4>Sampling forms (${d.sampling.length})</h4>${smp}<h4>Pupil files (${d.pupils_total}${d.pupils_total ? ` · ${d.present} here, ${d.absent} absent` : ''})</h4>${pup}<p class="m"><a href="#" class="lk" data-open="school:${esc(w[1])}">Open the school</a> · Pupils appear as numbers only.</p></div>`;
}
async function workToggle(t) {
  const w = [t.dataset.date, t.dataset.school]; const k = wkKey(t.dataset.name, w); S.wkOpen[k] = !S.wkOpen[k];
  if (S.wkOpen[k] && !S.wkf[k]) { render(); try { S.wkf[k] = await api('/api/work/files?name=' + encodeURIComponent(t.dataset.name) + '&school=' + encodeURIComponent(t.dataset.school) + '&date=' + encodeURIComponent(t.dataset.date)); } catch (e) { S.wkf[k] = { err: e.message }; } }
  render(); if (S.cur && !document.getElementById('drawer')?.hidden) openDetail(S.cur, false);
}
function viewWork() {
  const rows = workRowsHtml(S.ov.mine.me?.name || S.who.name, S.ov.mine.work || []);
  return `<div class="pagehead"><div><h2>My work</h2><p>Everything you tested, by day and school. Tap a row to open your sampling forms and every pupil file for that day. Pupils appear as numbers only.</p></div></div><div class="card"><div class="tbl"><table><thead><tr><th>Day</th><th>School</th><th class="r">Grade</th><th class="r">Tested</th><th class="r">Avg min</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">Nothing recorded yet.</td></tr>'}</tbody></table></div></div>`;
}
function schoolName(id) { const s = (S.ov.mine?.schools || []).find((x) => x.id === id); return s ? s.name : schoolNameOf(id); }
function viewQueries() {
  const f = S.ov.mine.flags;
  return `<div class="pagehead"><div><h2>My queries</h2><p>Automatic checks on your records. Write a short, honest response to each one. Your RC or ARC reviews it, then HQ reviews and approves it. You see every step here, and the history stays.</p></div></div><div class="card">${flagList(f.map((x) => ({ ...x, school_name: schoolName(x.school) })), { limit: 50, names: false, closed: true })}</div>`;
}
function viewStats() {
  const me = S.ov.mine.me, b = S.ov.bands;
  if (!me) return `<div class="empty"><h3>No tests yet</h3><p>Your numbers appear after your first submission.</p></div>`;
  const band = (g) => { const lo = b[g].p3, hi = b[g].p99, v = me.by_grade[g]; if (v == null) return ''; const span = hi * 1.3; const left = (lo / span) * 100, width = ((hi - lo) / span) * 100, pos = Math.min(100, (v / span) * 100); return `<div class="m" style="margin-top:8px">Grade ${g}: your average ${v} min · normal ${lo.toFixed(1)}–${hi.toFixed(0)} min</div><div class="band"><i style="left:${left}%;width:${width}%"></i><b style="left:${pos}%"></b></div>`; };
  return `<div class="pagehead"><div><h2>My stats</h2><p>${esc(me.name)}</p></div></div>
  <div class="grid kpis">${kpi('Pupils tested', fmt(me.tested))}${kpi('Avg test time', (me.avg_min ?? '–') + ' min')}${kpi('Quality', me.quality ?? '–', 'out of 100')}${kpi('School days', me.days, me.schools + ' schools')}</div>
  <div class="card" style="margin-top:14px"><h3>Test speed</h3><div class="sub">Your average against the normal range for each grade, from earlier rounds</div>${[1, 2, 3].map(band).join('')}</div>
  <div class="card" style="margin-top:14px"><h3>My submissions</h3><div class="sub">Sending the same day keeps your records safe and helps the team close the school on time.</div>${me.sub_all ? `<div class="grid kpis">${kpi('Sent the same day', me.sub_all.same_pct + '%', me.sub_all.n + ' records')}${kpi('Usual delay', lagText(me.sub_all.avg_h), 'form finished to sent')}${kpi('Longest wait', lagText(me.sub_all.max_h))}${kpi('Your place', S.ov.mine.sub_rank ? S.ov.mine.sub_rank.pos + ' of ' + S.ov.mine.sub_rank.of : '–', 'earliest first, in your region')}</div>` : '<div class="empty">Appears after your first records are sent.</div>'}</div>
  <div class="card" style="margin-top:14px"><h3>What makes up your quality score</h3><div class="sub">Tests in the normal time range, pupils from the sampling list, clean records</div><div class="m">Too fast: <b>${me.fast}</b> · Too slow: <b>${me.slow}</b> · Outside school hours: <b>${me.late}</b> · Not on sampling list: <b>${me.not_list}</b></div></div>`;
}

// ----- compare -----
function viewCompare() {
  const c = S.cmp; if (!c || c.status === 'waiting') return waiting();
  const reg = c.regions.map((r, i) => `<div class="rank ${S.who?.region === r.region ? 'me' : ''}" ${S.who ? `data-open="region:${esc(r.region)}"` : ''}><span class="p">${i + 1}</span><span class="nm">${esc(title(r.region))}</span>${bar(r.tested_pct, r.behind ? 'var(--bad)' : 'var(--teal)')}<span class="num" style="width:44px;text-align:right">${r.tested_pct}%</span></div>`).join('');
  const ppl = (c.people || []).map((p) => `<div class="rank ${p.you ? 'me' : ''}"><span class="p">${p.rank}</span><span class="nm">${esc(p.name)}${p.region ? ' · ' + esc(title(p.region)) : ''}</span><span class="num">${p.quality}</span></div>`).join('');
  return `<div class="pagehead"><div><h2>Compare and keep pace</h2><p>See what is happening elsewhere. Pupils tested against the sample.</p></div></div>
  <div class="grid three"><div class="card"><h3>Regions</h3><div class="sub">Share of sampled pupils tested</div>${reg}</div>
  ${S.who ? `<div class="card"><h3>${S.who.role === 'hq' ? 'Top test admins' : 'Test admins in my region'}</h3><div class="sub">Quality score out of 100. ${S.who.role === 'volunteer' ? 'The top five are named; you always see your own place.' : ''}</div>${ppl || '<div class="empty">Ranks appear after tests are submitted.</div>'}</div>` : ''}</div>`;
}

// ----- plan & calendar -----
const planFrom = (region) => (region === 'DODOMA' ? S.cfg.training_start : S.cfg.field.start);
function workDays(from, to) { const out = []; let d = new Date(from + 'T00:00:00Z'); const e = new Date(to + 'T00:00:00Z'); for (; d <= e; d.setUTCDate(d.getUTCDate() + 1)) { const w = d.getUTCDay(); if (w && w < 6) out.push(d.toISOString().slice(0, 10)); } return out; }
function suggest(schools, region, staff) {
  if (region === 'DODOMA') return schools.map((s) => ({ school: s.id, date: S.cfg.pilot_day, start: '07:00', team: [] })); // the pilot timetable has the teams at the schools from 07:00
  const days = workDays(S.cfg.field.start, S.cfg.field.end);
  const sorted = schools.slice().sort((a, b) => a.lga.localeCompare(b.lga) || a.name.localeCompare(b.name));
  // Protocol: 2 schools a day. The RC leads one school with 2 volunteers, the ARC leads the other with 2 volunteers.
  const rc = staff.find((p) => p.position === 'RC'), arc = staff.find((p) => p.position === 'ARC'), vols = staff.filter((p) => /^Volunteer/.test(p.position)).map((p) => p.name);
  const teams = [[rc?.name, ...vols.slice(0, 2)].filter(Boolean), [arc?.name, ...vols.slice(2, 4)].filter(Boolean)];
  return sorted.map((s, i) => ({ school: s.id, date: days[Math.floor(i / 2)], start: '08:00', team: teams[i % 2], lead: teams[i % 2][0] || null }));
}
function dayCountsOf(draft) { const per = {}; for (const v of draft) if (v.date) (per[v.date] ||= []).push(v.school); return per; }
function readDraftFromDom() {
  S.draft = S.plan.schools.map((s) => ({ school: s.id, date: document.querySelector(`[data-pl="date"][data-s="${s.id}"]`)?.value || null, start: document.querySelector(`[data-pl="start"][data-s="${s.id}"]`)?.value || '08:00', team: [...document.querySelectorAll(`[data-pt="${s.id}"]:checked`)].map((c) => c.value), lead: document.querySelector(`[data-pl="lead"][data-s="${s.id}"]`)?.value || null }));
}
function dayReasonPanel(region, draft) {
  if (region === 'DODOMA') return '';
  const per = dayCountsOf(draft); const dates = Object.keys(per).sort();
  const c1 = dates.filter((d) => per[d].length === 1), c3 = dates.filter((d) => per[d].length === 3), c2 = dates.filter((d) => per[d].length === 2);
  const row = (d, kind) => { const n = S.dayNotes[d] || {}; const opts = Object.entries(S.cfg.day_reasons[kind]); return `<tr><td><b>${dayName(d)}</b>${per[d].map((id) => `<div class="m">${esc(SCH(id))}</div>${enrolLine(((S.plan && S.plan.schools) || []).find((x) => x.id === id)?.enrol)}`).join('')}</td><td><select data-dn="code" data-d="${d}"><option value="">Choose a reason</option>${opts.map(([k, t]) => `<option value="${k}" ${n.code === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></td><td><input data-dn="note" data-d="${d}" value="${esc(n.note || '')}" placeholder="${kind === 'three' ? 'Which schools, how far apart, why three is possible' : 'Why only one school this day'}" style="width:100%;min-width:200px"></td></tr>`; };
  return `<div class="card" style="margin-top:12px;border-left:4px solid var(--gold)"><h3>The plan: ${c2.length} day(s) with the standard 2 schools · ${c3.length} with 3 · ${c1.length} with 1</h3><div class="sub">The protocol is 2 schools a day: the Regional Coordinator leads one school and the Assistant leads the other, each with 2 volunteers. Everyone may work in one large school. Three schools in a day is only for small schools that are close together. Any day that is not 2 schools needs a reason, so that the plan shows why.</div>
  ${c3.length ? `<h4 style="margin:10px 0 4px">Days with 3 schools</h4><div class="tbl"><table><tbody>${c3.map((d) => row(d, 'three')).join('')}</tbody></table></div>` : ''}
  ${c1.length ? `<h4 style="margin:10px 0 4px">Days with 1 school</h4><div class="tbl"><table><tbody>${c1.map((d) => row(d, 'one')).join('')}</tbody></table></div>` : ''}
  ${!c1.length && !c3.length ? '<div class="note">Every day has the standard 2 schools. No reasons are needed.</div>' : ''}</div>`;
}
function viewPlan() {
  const P = S.plan; if (!P) return `<div class="banner bad">${S.planErr ? esc(S.planErr) : 'The plan could not be loaded.'} <button class="btn sm sec" data-act="retryPlan">Try again</button></div>`;
  const plan = P.plan, region = S.planRegion || S.who.region;
  const canEdit = S.who.role !== 'volunteer';
  const head = `<div class="pagehead"><div><h2>Plan and calendar · ${esc(title(region))}</h2><p>The whole field period is planned up front. After you submit, changes need a reason and the team is told.</p></div>${S.who.role === 'hq' ? `<div class="sel"><select id="planRegion">${S.cfg.regions.map((r) => `<option ${r === region ? 'selected' : ''} value="${r}">${title(r)}</option>`).join('')}</select></div>` : ''}</div>`;
  if (plan.status !== 'locked') return head + planBuilder(P, canEdit, region);
  const today = P.today;
  const days = workDays(planFrom(region), S.cfg.field.end);
  const byDate = {}; plan.visits.forEach((v) => (byDate[v.date] ||= []).push(v));
  const weeks = []; for (let i = 0; i < days.length; i += 5) weeks.push(days.slice(i, i + 5));
  const slotCls = (v) => (v.outcome === 'visited' ? 'done' : v.outcome === 'missed' ? 'miss' : v.outcome === 'visited_other_day' || v.status === 'moved' ? 'moved' : '');
  const cal = weeks.map((w, wi) => `<h4 style="margin:14px 0 6px">Week ${wi + 1}</h4><div class="cal">${w.map((d) => `<div class="day ${d === today ? 'today' : ''}"><h5>${dayName(d)}<span title="${esc(plan.day_notes?.[d] ? plan.day_notes[d].note : '')}">${(byDate[d] || []).length || ''}${plan.day_notes?.[d] && (byDate[d] || []).length !== 2 ? ' ⓘ' : ''}</span></h5>${(byDate[d] || []).map((v) => `<button class="slot ${slotCls(v)}" data-act="selVisit" data-id="${v.id}"><b>${esc(v.school_name)}</b>${esc(title(v.lga))} · ${esc(v.start)}${v.status === 'moved' ? ' · moved' : ''}</button>`).join('')}</div>`).join('')}</div>`).join('');
  const notice = (st) => ({ sent: '<span class="pill good">sent</span>', late: '<span class="pill bad">late</span>', due: '<span class="pill warn">due today</span>', upcoming: '<span class="pill mute">upcoming</span>' }[st]);
  const nrows = plan.visits.filter((v) => v.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, S.nAll ? 999 : 14).map((v) => `<tr class="click" data-open="school:${esc(v.school)}"><td><b>${esc(v.school_name)}</b>${enrolLine(v.enrol)}${plan.changes.some((c) => c.visit_id === v.id) ? ' <span class="pill warn">changed</span>' : ''}${v.lead_name ? ` <span class="pill mute">${v.lead_name === S.who?.name ? 'led by you' : 'lead: ' + esc(v.lead_name.split(' ')[0])}</span>` : ''}<br><span class="m" style="font-size:12px;color:var(--ink3)">${dayName(v.date)}</span></td><td>${notice(v.aek_state)} <span style="font-size:12px;color:var(--ink3)">by ${shortDate(v.aek_due)}</span>${canEdit && !v.notices.aek ? ` <button class="btn sm ghost" data-act="copyNotice" data-kind="aek" data-id="${v.id}">Copy message</button> <button class="btn sm sec" data-act="notice" data-kind="aek" data-id="${v.id}">Mark sent</button>` : ''}</td><td>${notice(v.ht_state)} <span style="font-size:12px;color:var(--ink3)">by ${shortDate(v.ht_due)}</span>${canEdit && !v.notices.ht ? ` <button class="btn sm ghost" data-act="copyNotice" data-kind="ht" data-id="${v.id}">Copy message</button> <button class="btn sm sec" data-act="notice" data-kind="ht" data-id="${v.id}">Mark sent</button>` : ''}</td><td>${notice(v.team_state)}${canEdit && !v.notices.team ? ` <button class="btn sm sec" data-act="notice" data-kind="team" data-id="${v.id}">Mark told</button>` : ''}</td></tr>`).join('');
  const changes = plan.changes.slice().reverse().slice(0, 8).map((c) => `<div class="flag"><i class="st ${c.late ? 'bad' : 'warn'}"></i><div><b>${esc(SCH(c.school))} · ${shortDate(c.from.date)} → ${shortDate(c.to.date)}${c.late ? ' · late change' : ''}</b><span>${esc(c.reason)}${c.note ? ': ' + esc(c.note) : ''} · ${esc(c.by)}</span></div></div>`).join('') || '<div class="empty">No changes yet.</div>';
  const v = plan.visits.find((x) => x.id === S.selVisit);
  const editor = v && canEdit ? `<div class="card" style="margin-top:14px"><h3>Change ${esc(v.school_name)}</h3><div class="sub">Planned ${dayName(v.date)} at ${esc(v.start)}. The team and the ward and head teacher notices are re-sent for a new date.</div><div class="f"><label>New date<input type="date" id="chDate" value="${v.date}" min="${planFrom(region)}" max="${S.cfg.field.end}"></label><label>Start<input type="time" id="chStart" value="${esc(v.start)}"></label><label>Reason<select id="chReason">${Object.entries(S.cfg.reasons).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label><textarea id="chNote" placeholder="Short note (required for Other)"></textarea></div><div style="margin-top:10px;display:flex;gap:8px"><button class="btn" data-act="applyChange" data-id="${v.id}">Save change</button><button class="btn sec" data-act="selVisit" data-id="">Cancel</button></div><div id="chErr" class="banner bad" hidden></div></div>` : '';
  const n = plan.visits.length;
  const done = plan.visits.filter((x) => x.outcome === 'visited').length, past = plan.visits.filter((x) => x.date <= today && x.date < today).length;
  return `${head}<div class="grid kpis">${kpi('Schools planned', n, 'submitted ' + (plan.submitted_at ? shortDate(plan.submitted_at.slice(0, 10)) : '') + ' by ' + esc(plan.submitted_by || ''))}${kpi('Changes', plan.changes.length, plan.changes.filter((c) => c.late).length + ' late')}${kpi('On plan so far', past ? pc(done, past) + '%' : '–', done + ' of ' + past + ' visits due')}${kpi('Plan version', 'v' + plan.version)}</div>
  <div class="card" style="margin-top:14px"><h3>Calendar</h3><div class="sub">Planned (grey), done (green), moved (amber), missed (red). Tap a school to change it.</div>${cal}</div>${dayNotesList(plan, byDate)}${editor}
  <div class="grid two" style="margin-top:14px"><div class="card"><h3>Notice tracker</h3><div class="sub">Ward officer 5 working days before, head teacher 3 working days before, team told at the same time. The app does not send the messages: tap Copy message, send it by SMS or WhatsApp (or read it out on a call), then tap Mark sent so the reminders stop.${S.noticeMsg ? ` <b>${esc(S.noticeMsg)}</b>` : ''}${plan.visits.filter((v) => v.date >= today).length > 14 ? ` <button class="btn sm ghost" data-act="noticeAll">${S.nAll ? 'Show fewer' : 'Show all ' + plan.visits.filter((v) => v.date >= today).length}</button>` : ''}</div><div class="tbl"><table><thead><tr><th>Visit</th><th>Ward officer</th><th>Head teacher</th><th>Team</th></tr></thead><tbody>${nrows || '<tr><td colspan="4" class="empty">No upcoming visits.</td></tr>'}</tbody></table></div></div>
  <div class="card"><h3>Changes and reasons</h3><div class="sub">Every change is recorded with who made it and why</div>${changes}</div></div>`;
}
function dayNotesList(plan, byDate) {
  const odd = Object.keys(byDate).filter((d) => byDate[d].length !== 2 && plan.region !== 'DODOMA').sort();
  if (!odd.length) return '<div class="note" style="margin-top:12px">Every planned day has the standard 2 schools.</div>';
  return `<div class="card" style="margin-top:14px"><h3>Days that are not 2 schools, and why</h3>${odd.map((d) => `<div class="flag"><i class="st ${byDate[d].length === 3 ? 'warn' : 'good'}"></i><div><b>${dayName(d)} · ${byDate[d].length} school(s)</b><span>${esc(byDate[d].map((v) => v.school_name).join(', '))}</span><span>${esc(plan.day_notes?.[d]?.note || 'No reason recorded')}</span></div></div>`).join('')}</div>`;
}
const SCH = (id) => (S.plan?.schools || []).find((s) => s.id === id)?.name || id;
const enrolLine = (e) => (e ? `<div class="m" style="font-size:12px">Enrolment: ${[1, 2, 3].map((g) => (e[g] ? `Gr${g} <b>${e[g][2]}</b>` : '')).filter(Boolean).join(' · ')}</div>` : '<div class="m" style="font-size:12px">Enrolment: not in the baseline yet</div>');
function planBuilder(P, canEdit, region) {
  if (!canEdit) return '<div class="note">The plan has not been submitted yet.</div>';
  const cur = S.draft || (P.plan.visits.length ? P.plan.visits : suggest(P.schools, region, P.staff));
  S.draft = cur;
  if (!S.dayNotes) S.dayNotes = { ...(P.plan.day_notes || {}) };
  const byId = Object.fromEntries(cur.map((v) => [v.school, v]));
  const people = P.staff.map((p) => p.name);
  const leads = P.staff.filter((p) => /^(RC|ARC)$/.test(p.position)).map((p) => p.name);
  const rows = P.schools.map((s) => { const v = byId[s.id] || { school: s.id, date: '', start: '08:00', team: [] }; return `<tr><td><b>${esc(s.name)}</b>${enrolLine(s.enrol)}</td><td class="hide-s">${esc(title(s.lga))}</td><td class="hide-s">${esc(armLabel(s))}</td><td><input type="date" data-pl="date" data-s="${s.id}" value="${esc(v.date)}" min="${planFrom(region)}" max="${S.cfg.field.end}"></td><td><input type="time" data-pl="start" data-s="${s.id}" value="${esc(v.start)}"></td><td><select data-pl="lead" data-s="${s.id}" title="Who leads this school"><option value="">Lead: auto</option>${leads.map((n) => `<option value="${esc(n)}" ${(v.lead || '') === n ? 'selected' : ''}>Lead: ${esc(n.split(' ')[0])}</option>`).join('')}</select><details class="teamd"><summary>${(v.team || []).length ? esc((v.team || []).map((n) => n.split(' ')[0]).join(', ')) : 'Choose team'}</summary><div class="teamlist">${people.map((n) => `<label><input type="checkbox" data-pt="${s.id}" data-pl="team" data-s="${s.id}" value="${esc(n)}" ${(v.team || []).includes(n) ? 'checked' : ''}> ${esc(n)}</label>`).join('')}</div></details></td></tr>`; }).join('');
  return `<div class="banner">Not submitted yet. The dates and teams below follow the protocol: 2 schools a day, the Regional Coordinator and the Assistant each leading one school with 2 volunteers. The Lead is the RC or the ARC; where both are at one school the RC leads. Change what does not fit. After you submit the plan locks.</div>
  <div class="card" style="margin-top:12px"><div class="tbl"><table><thead><tr><th>School</th><th class="hide-s">LGA</th><th class="hide-s">Type</th><th>Date</th><th>Start</th><th>Team</th></tr></thead><tbody>${rows}</tbody></table></div>
  <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn sec" data-act="resuggest">Re-suggest dates and teams</button></div></div>
  ${dayReasonPanel(region, cur)}
  <div class="card" style="margin-top:12px"><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sec" data-act="saveDraft">Save draft</button><button class="btn" data-act="submitPlan">Submit plan</button></div><div id="plErr" class="banner bad" hidden></div></div>`;
}

// ----- HQ -----
function viewHQ() {
  const o = S.ov; if (!o || o.status === 'waiting') return waiting();
  const openF = o.flags.filter(isOpen);
  const n = o.national, bad = openF.filter((f) => f.sev === 'bad').length;
  const atRisk = o.regions.filter((r) => regionState(r) === 'bad').length;
  const byType = {}; openF.forEach((f) => (byType[f.type] = (byType[f.type] || 0) + 1));
  const types = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const mx = Math.max(1, ...types.map((t) => t[1]));
  return `${dataBanner()}<div class="pagehead"><div><h2>HQ command centre</h2><p>All regions · ${esc(o.year)}</p></div></div>
  <div class="grid kpis">${kpi('Schools complete', `${fmt(n.done)}<small> / ${fmt(n.schools)}</small>`, pc(n.done, n.schools) + '%', 'regions')}${kpi('Pupils tested', fmt(n.tested), 'of ' + fmt(n.target), 'compare')}${kpi('Open flags', fmt(openF.length), bad + ' serious', 'allq')}${kpi('Regions at risk', atRisk, 'projected after 4 Dec', 'regions')}${kpi('Projected finish', n.projected === 'done' ? 'Done' : n.projected ? shortDate(n.projected) : '–', 'at current pace')}</div>
  ${S.brief ? '<div style="margin-top:14px">' + briefCard() + '</div>' : ''}<div style="margin-top:14px">${forecastCard()}</div><div class="card" style="margin-top:14px"><h3>Regions</h3><div class="sub">Schools complete out of ${fmt(n.schools)}</div>${tiles(o.regions)}</div>
  <div class="grid two" style="margin-top:14px"><div class="card"><h3>Flags to act on</h3><div class="sub">Newest checks across all regions</div>${flagList(openF.slice().sort((a, b) => (a.sev === 'bad' ? 0 : 1) - (b.sev === 'bad' ? 0 : 1)), { limit: 12 })}</div>
  <div style="display:grid;gap:14px;align-content:start"><div class="card"><h3>Checks running</h3><div class="sub">Open flags by type</div>${types.map(([t, c]) => `<div style="display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)"><span style="flex:1">${esc(FLAG_LABEL[t] || t)}</span>${bar(pc(c, mx))}<span class="num" style="width:34px;text-align:right">${c}</span></div>`).join('') || '<div class="empty">No flags.</div>'}</div>
  <div class="card"><h3>Tests per day</h3><div class="sub">All regions</div>${barChart(n.series)}</div></div></div>`;
}
function viewRegionsHQ() {
  const o = S.ov;
  const rows = o.regions.map((r) => { const p = o.plans[r.region] || {}; return `<tr class="click" data-open="region:${esc(r.region)}"><td><b>${esc(title(r.region))}</b> <span class="pill mute">${esc(r.partner || '')}</span></td><td class="num r">${r.done}/${r.total}</td><td class="num r">${fmt(r.tested)}/${fmt(r.target)}</td><td>${bar(pc(r.tested, r.target))}</td><td class="num r">${r.pace}</td><td>${r.projected === 'done' ? 'Done' : r.projected ? shortDate(r.projected) : '–'}</td><td>${p.status === 'locked' ? `<span class="pill good">submitted</span> <span style="font-size:12px;color:var(--ink3)">${p.changes} changes${p.late_changes ? ', ' + p.late_changes + ' late' : ''}</span>` : '<span class="pill bad">not submitted</span>'}</td></tr>`; }).join('');
  return `${dataBanner()}<div class="pagehead"><div><h2>Regions and plans</h2><p>Progress, pace and whether each coordinator has submitted the field plan</p></div></div><div class="card"><div class="tbl"><table><thead><tr><th>Region</th><th class="r">Schools</th><th class="r">Pupils</th><th>Progress</th><th class="r">Pace/day</th><th>Finish</th><th>Field plan</th></tr></thead><tbody>${rows}</tbody></table></div></div>${calendarChangesCard(o.calendar_changes || [])}`;
}
function calendarChangesCard(list) {
  const rows = list.length ? list.map((c) => `<div class="flag click" data-open="school:${esc(c.school)}"><i class="st ${c.late ? 'bad' : 'warn'}"></i><div><b>${esc(title(c.region))} · ${esc(c.school_name ? c.school_name.trim() : c.school)}</b> · ${c.from ? shortDate(c.from) : '?'} → ${c.to ? shortDate(c.to) : '?'}${c.late ? ' <span class="pill bad">late change</span>' : ''}<div class="sub">${esc(c.reason || '')}${c.note ? ': ' + esc(c.note) : ''} · ${esc(c.by)} · ${new Date(c.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Dar_es_Salaam' })}</div></div></div>`).join('') : '<div class="empty">No calendar changes since plans were submitted.</div>';
  return `<div class="card" style="margin-top:14px"><h3>Calendar changes</h3><div class="sub">Every change an RC makes after submitting, with who, why and when. Late = inside the notice period. Phones use the calendar file, which HQ refreshes from these plans.</div>${rows}</div>`;
}
// ----- data explorer -----
// ----- HQ admin -----
function readinessCard(a) {
  const R = a.ready; if (!R) return '';
  const bad = R.checks.filter((c) => !c.ok).length;
  const pil = R.pilot;
  return `<div class="card" style="margin-bottom:14px;border-left:4px solid var(${bad ? '--gold' : '--good'})"><h3>Go-live readiness ${bad ? `<span class="chip c-warn">${bad} to fix</span>` : '<span class="chip c-good">all clear</span>'}</h3><div class="sub">Checked live. Pilot day is ${esc(R.pilot_day)}: ${pil.with_tests} of ${pil.schools} pilot schools have tests, ${pil.tested} of ${pil.target} pupils.</div>${R.checks.map((c) => `<div class="flag"><i class="st ${c.ok ? 'good' : 'warn'}"></i><div><b>${esc(c.label)}</b><span>${esc(c.detail)}${c.fix ? ' · <b>' + esc(c.fix) + '</b>' : ''}</span></div></div>`).join('')}</div>`;
}
function rosterCard(a) {
  const R = a.roster; if (!R) return '';
  const opt = (list, cur, region) => list.map((x) => `<option value="${esc(x)}" ${x === cur ? 'selected' : ''}>${esc(region ? title(x) : x)}</option>`).join('');
  const sorted = R.staff.slice().sort((x, y) => x.region.localeCompare(y.region) || x.position.localeCompare(y.position));
  const rows = sorted.map((s) => `<tr class="${s.active ? '' : 'sk'}"><td><input data-rs="name" data-id="${s.id}" value="${esc(s.name)}" style="width:100%;min-width:150px"></td><td><select data-rs="region" data-id="${s.id}">${opt(R.options.regions, s.region, true)}</select></td><td><select data-rs="position" data-id="${s.id}">${opt(R.options.positions, s.position)}</select></td><td style="white-space:nowrap"><button class="btn sm" data-act="rosterSave" data-id="${s.id}">Save</button> ${s.active ? `<button class="btn sm sec" data-act="rosterReissue" data-id="${s.id}">New code</button> <button class="btn sm sec" data-act="rosterRemove" data-id="${s.id}">Remove</button>` : `<span class="pill mute">removed</span> <button class="btn sm sec" data-act="rosterRestore" data-id="${s.id}">Restore</button>`}</td></tr>`).join('');
  const act = R.staff.filter((s) => s.active);
  const un = R.unlisted.map((n) => `<tr><td><b>${esc(n)}</b></td><td><select data-ra="${esc(n)}"><option value="">Choose person</option>${act.map((s) => `<option value="${s.id}">${esc(title(s.region))} · ${esc(s.position)} · ${esc(s.name)}</option>`).join('')}</select></td><td><button class="btn sm" data-act="rosterAlias" data-n="${esc(n)}">Assign</button></td></tr>`).join('');
  const alias = Object.entries(R.aliases || {}).map(([k, id]) => { const s = R.staff.find((x) => x.id === id); return `<tr><td>${esc(k)}</td><td>${s ? esc(s.name) : '?'}</td><td><button class="btn sm sec" data-act="rosterUnalias" data-n="${esc(k)}">Undo</button></td></tr>`; }).join('');
  return `<div class="card" style="margin-top:14px"><h3>People and roster</h3><div class="sub">Add or replace people, fix a name or region, and give someone a new code if they lose theirs. A new code stops the old one working. Removed people keep their earlier tests under their name.</div>${S.rosterMsg ? `<div class="banner">${esc(S.rosterMsg)}</div>` : ''}
  <div class="tbl dt-wrap"><table class="dt"><thead><tr><th>Name</th><th>Region</th><th>Position</th><th>Actions</th></tr></thead><tbody>${rows}
  <tr><td><input id="newName" placeholder="New person's name" style="width:100%;min-width:150px"></td><td><select id="newRegion">${opt(R.options.regions, 'TANGA', true)}</select></td><td><select id="newPos">${opt(R.options.positions, 'Volunteer 1')}</select></td><td><button class="btn sm" data-act="rosterAdd">Add person</button></td></tr></tbody></table></div>
  ${un ? `<h4 style="margin:14px 0 6px">Names in KoBo that are not in the roster</h4><div class="sub">Choose who each one is. Their tests are then counted under that person.</div><div class="tbl"><table><tbody>${un}</tbody></table></div>` : ''}
  ${alias ? `<h4 style="margin:14px 0 6px">Names already matched</h4><div class="tbl"><table><tbody>${alias}</tbody></table></div>` : ''}</div>`;
}
function devicesCard(a) {
  const D = a.devices; if (!D) return '';
  const act = (a.roster?.staff || []).filter((s) => s.active);
  const nameOf = (id) => act.find((s) => s.id === id)?.name;
  const rows = D.devices.slice(0, 120).map((d) => `<tr><td class="num"><b>${esc(d.code)}</b></td><td class="r num">${d.tests}</td><td class="r num">${d.days}</td><td>${d.names.map(([n, c]) => `${esc(n)} <span class="m">(${c})</span>`).join(', ')} ${d.mixed ? chip('several names', 'warn') : ''}</td><td>${d.owner != null ? chip(esc(nameOf(d.owner) || 'assigned'), 'good') : d.suggested != null ? `<span class="m">looks like ${esc(nameOf(d.suggested) || '')}</span>` : '<span class="m">not clear yet</span>'}</td><td><select data-dv="${esc(d.code)}"><option value="">Not assigned</option>${act.map((s) => `<option value="${s.id}" ${(d.owner ?? d.suggested) === s.id ? 'selected' : ''}>${esc(title(s.region))} · ${esc(s.position)} · ${esc(s.name)}</option>`).join('')}</select> <button class="btn sm" data-act="devAssign" data-c="${esc(d.code)}">Save</button></td></tr>`).join('');
  return `<div class="card" style="margin-top:14px"><h3>Phones and people</h3><div class="sub">Each phone sends an ID with the sampling form, and with the test form once the updated form is installed. A phone is shown by a short code, never the raw ID. Assigning a phone to its owner switches on the check that raises "Someone else's phone" when another name is used on it. "Several names" means more than one name has used the same phone.</div><div class="tbl dt-wrap"><table class="dt"><thead><tr><th>Phone</th><th class="r">Records</th><th class="r">Days</th><th>Names used on it</th><th>Owner</th><th>Assign</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">No phone IDs yet. They appear with the first sampling records.</td></tr>'}</tbody></table></div></div>`;
}
function backupDaysCard(a) {
  const D = S.daysRows;
  return `<div class="card" style="margin-top:14px"><h3>Days worked</h3><div class="sub">For payments. A day counts when at least one test was submitted. Training days, travel days and days without tests are not included.</div><div class="f"><label>From<input type="date" id="dwFrom" value="${S.dwFrom || S.cfg.pilot_day}"></label><label>To<input type="date" id="dwTo" value="${S.dwTo || S.cfg.field.end}"></label></div><div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-act="daysShow">Show totals</button><button class="btn sm sec" data-act="daysCsv">Download detail (CSV)</button></div>
  ${D ? `<div class="tbl" style="margin-top:10px"><table><thead><tr><th>Name</th><th>Region</th><th>Position</th><th class="r">Days</th><th class="r">Schools</th><th class="r">Pupils</th><th>First</th><th>Last</th></tr></thead><tbody>${D.people.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(title(p.region))}</td><td>${esc(p.position)}</td><td class="r num">${p.days}</td><td class="r num">${p.schools}</td><td class="r num">${p.pupils}</td><td>${shortDate(p.first)}</td><td>${shortDate(p.last)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No tests in that period.</td></tr>'}</tbody></table></div>` : ''}</div>
  <div class="card" style="margin-top:14px"><h3>Backup and restore</h3><div class="sub">Every night at 21:00 a copy is stored inside Cloudflare (separate from the live data): daily copies are kept 3 weeks, Sunday full copies about 4 months. On Monday at 07:00 the Sunday full copy is emailed to the backup recipient with the copy list in cc (set in the recipients list below).</div>${a.backups ? `<div class="m">${a.backups.last ? `Last backup: ${new Date(a.backups.last.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}, ${Math.round(a.backups.last.gz_bytes / 1024)} KB${a.backups.last.emailed ? `, emailed to ${esc(a.backups.last.to)}${a.backups.last.cc?.length ? ' (cc ' + a.backups.last.cc.length + ')' : ''}` : ''}.` : 'No backup yet.'}</div><div class="tbl" style="margin-top:8px"><table><thead><tr><th>Copy</th><th>Kind</th><th class="r">Size</th><th></th></tr></thead><tbody>${a.backups.backups.slice(0, 12).map((b) => `<tr><td>${esc(b.key.slice(3))}</td><td>${b.full ? chip('full', 'teal') : chip('daily', 'mute')}</td><td class="r num">${b.gz_bytes ? Math.round(b.gz_bytes / 1024) + ' KB' : '–'}</td><td><button class="btn sm sec" data-act="backupGet" data-key="${esc(b.key)}">Download</button> <button class="btn sm sec" data-act="backupPick" data-key="${esc(b.key)}">Restore…</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">No copies yet.</td></tr>'}</tbody></table></div>` : ''}<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn sm" data-act="backupDownload">Download a full backup now</button><button class="btn sm sec" data-act="backupNow">Make a copy now</button><button class="btn sm sec" data-act="backupMail">Make a copy and email it now</button></div>${S.pickKey ? `<div class="note" style="margin-top:10px">Restore <b>${esc(S.pickKey.slice(3))}</b> (replaces plans, queries, roster and recipients now in use).<div class="f"><label>Type RESTORE to confirm<input id="restoreConfirmKey"></label></div><button class="btn sm" data-act="restoreKey" style="margin-top:8px">Restore this copy</button> <button class="btn sm sec" data-act="backupPick" data-key="">Cancel</button></div>` : ''}${S.backupMsg ? `<p class="m" style="margin-top:8px">${esc(S.backupMsg)}</p>` : ''}
  <h4 style="margin:14px 0 6px">Restore from a backup file</h4><input type="file" id="restoreFile" accept=".json,.gz">${S.restoreData ? `<p class="m" style="margin-top:8px">File from ${esc(S.restoreData.at)}: ${Object.values(S.restoreData.plans || {}).filter((p) => p.status === 'locked').length} submitted plans, ${Object.keys(S.restoreData.queries || {}).length} queries, ${S.restoreData.roster ? S.restoreData.roster.staff.length : 0} people${S.restoreData.states ? ', stored data for ' + Object.keys(S.restoreData.states).length + ' year(s)' : ''}. This replaces what is there now.</p><div class="f"><label>Type RESTORE to confirm<input id="restoreConfirm"></label></div><button class="btn sm" data-act="restoreRun" style="margin-top:8px">Restore</button>` : ''}</div>
  <div class="card" style="margin-top:14px"><h3>KoBo write access</h3><div class="sub">Needed to mark submissions as approved, not approved or on hold from a query.</div><button class="btn sm sec" data-act="koboCheck">Check access</button>${S.koboWho ? `<p class="m" style="margin-top:8px">${esc(S.koboWho)}</p>` : ''}</div>`;
}
const eatTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Dar_es_Salaam' }) : '–');
// ---- what emails go out automatically ----
const EMAIL_STATUS = { scheduled: 'good', sent: 'good', finished: 'mute', 'sending is off': 'bad', 'no recipients': 'warn' };
function hqTeamCard(a) {
  const H = a.hqUsers; if (!H) return '';
  const me = S.who.hq_id;
  const rows = H.users.map((u) => `<tr class="${u.active ? '' : 'paused'}"><td><input data-hq="${u.id}" data-f="name" value="${esc(u.name)}"></td><td><input data-hq="${u.id}" data-f="email" type="email" value="${esc(u.email)}" placeholder="email"></td><td><select data-hq="${u.id}" data-f="level">${Object.entries(LEVEL_TXT).map(([k, t]) => `<option value="${k}" ${u.level === k ? 'selected' : ''}>${t}</option>`).join('')}</select></td><td><select data-hq="${u.id}" data-f="review_level" ${u.level === 'viewer' ? 'disabled' : ''}><option value="0" ${!u.review_level ? 'selected' : ''}>No</option><option value="2" ${u.review_level === 2 ? 'selected' : ''}>First review</option><option value="3" ${u.review_level === 3 ? 'selected' : ''}>Final approval</option></select></td><td class="num"><b>${u.code ? esc(u.code) : '–'}</b>${me === u.id ? ' <span class="pill mute">you</span>' : ''}</td><td class="c"><input type="checkbox" data-hq="${u.id}" data-f="active" ${u.active ? 'checked' : ''}></td><td style="white-space:nowrap"><button class="btn sm ghost" data-act="hqReissue" data-id="${u.id}">New code</button> <button class="btn sm ghost" data-act="hqEmail" data-id="${u.id}">Email code</button></td></tr>`).join('');
  return `<div class="card" style="margin-top:14px"><h3>HQ team and access levels</h3><div class="sub"><b>Admin</b> does everything. <b>Editor</b> reads everything and writes messages and reports and replies to queries. <b>Viewer</b> reads and downloads only. Each person has their own code, and every change is recorded under their name. <b>Query review</b> sets who reviews responses to queries: First review is the first HQ step, Final approval the last. The same person cannot do both steps on one query, and the shared code cannot approve.</div>
  <div class="tbl rectbl"><table class="dt"><thead><tr><th>Name</th><th>Email</th><th>Level</th><th title="Who reviews query responses">Query review</th><th>Code</th><th class="c">On</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
  <div class="f" style="margin-top:10px;display:flex;gap:8px;align-items:end;flex-wrap:wrap"><label>Add a person<input id="hqName" placeholder="Name"></label><label>Email<input id="hqEmail" type="email" placeholder="name@example.org"></label><label>Level<select id="hqLevel"><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Admin</option></select></label><button class="btn sm" data-act="hqAdd">Add</button></div>
  <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line)"><b>The shared HQ code</b> ${H.shared_enabled ? '<span class="pill warn">still works (Admin level)</span>' : '<span class="pill good">switched off</span>'}<div class="m" style="margin:4px 0 8px">Once everyone in HQ has signed in with their personal code, switch the shared code off so that nobody can use it any more.</div>${H.shared_enabled ? `<button class="btn sm ghost" data-act="hqShared" data-on="">${me ? 'Switch the shared code off' : 'Sign in with your personal code to switch it off'}</button>` : '<button class="btn sm ghost" data-act="hqShared" data-on="1">Switch it back on</button>'}</div>${S.hqMsg ? `<p class="m" style="margin-top:8px">${esc(S.hqMsg)}</p>` : ''}</div>`;
}
function settingsCard(a) {
  const T = a.settings; if (!T) return '';
  const b = T.brand;
  const tr = Object.entries(T.targets).map(([k, t]) => `<tr><td>${esc({ visits: 'Visits on the planned day (%)', notices: 'Notices sent on time (%)', sameday: 'Records sent the same day (%)', quality: 'Test quality score' }[k] || k)}<div class="m" style="font-size:11.5px;color:var(--ink3)">${esc(t.text)}</div></td><td><input type="number" min="1" max="100" data-tg="${k}" data-f="good" value="${t.good}"></td><td><input type="number" min="1" max="100" data-tg="${k}" data-f="warn" value="${t.warn}"></td><td class="m">${t.default.good} / ${t.default.warn}</td></tr>`).join('');
  return `<div class="card" style="margin-top:14px"><h3>Settings: name and targets</h3><div class="sub">Changes apply everywhere at once (screens, emails, alerts).</div>
  <div class="f"><label>Platform name<input id="stPlatform" maxlength="40" value="${esc(b.platform)}"></label><label>Programme shown beside it<input id="stProgramme" maxlength="80" value="${esc(b.programme)}"></label><label style="grid-column:1/-1">Tagline<input id="stTagline" maxlength="160" value="${esc(b.tagline)}"></label><label>Assistant name<input id="stAssistant" maxlength="40" value="${esc(b.assistant)}" placeholder="${esc(T.assistant_name)}"></label></div>
  <h4 style="margin:14px 0 4px">Targets (green at or above the first number, amber at or above the second)</h4><div class="tbl rectbl"><table class="dt"><thead><tr><th>Target</th><th>Green</th><th>Amber</th><th>Standard</th></tr></thead><tbody>${tr}</tbody></table></div>
  <div style="margin-top:10px"><button class="btn sm" data-act="stSave">Save settings</button></div>${S.stMsg ? `<p class="m" style="margin-top:8px">${esc(S.stMsg)}</p>` : ''}</div>`;
}
function activityCard(a) {
  const L = a.activity; if (!L) return '';
  const rows = L.log.slice(0, 200).map((x) => `<tr data-q="${esc((x.who + ' ' + x.action + ' ' + x.detail).toLowerCase())}"><td>${esc(new Date(x.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Dar_es_Salaam' }))}</td><td><b>${esc(x.who)}</b> <span class="m">${esc(x.level || '')}</span></td><td>${esc(x.action)}</td><td class="m">${esc(x.detail)}</td></tr>`).join('');
  return `<div class="card" style="margin-top:14px"><h3>Activity log</h3><div class="sub">Who did what and when. The last 200 changes.</div><div class="recbar"><input id="actQ" placeholder="Search a person or an action" autocomplete="off"></div><div class="tbl rectbl"><table class="dt"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">Nothing recorded yet.</td></tr>'}</tbody></table></div></div>`;
}
function emailScheduleCard(a) {
  const E = a.emailSched; if (!E) return '';
  const when = (t) => (t ? `${dayName(t.slice(0, 10))}, ${t.slice(11)}` : '–');
  const rows = E.emails.map((x) => `<div class="emrow"><div><b>${esc(x.name)}</b>${x.once ? ' <span class="pill mute">one-off</span>' : ''}<div class="m" style="font-size:12.5px;color:var(--ink3)">${esc(x.contents)}</div></div><div class="emmeta"><div><span>Goes to</span>${esc(x.to)}</div><div><span>When</span>${esc(x.when)}</div><div><span>Last sent</span>${x.last ? dayName(x.last) : 'not yet'}</div><div><span>Next</span>${x.next ? '<b>' + esc(when(x.next)) + '</b>' : 'none'}</div></div><div>${chip(esc(x.status), EMAIL_STATUS[x.status] || 'mute')}</div></div>`).join('');
  return `<div class="card" style="margin-top:14px"><h3>Automatic emails</h3><div class="sub">Everything the system sends by itself, to whom, and when. Times are East Africa Time. ${E.sending_on ? '<span class="pill good">sending is on</span>' : '<span class="pill bad">sending is OFF: nothing is going out</span>'} Now: ${esc(E.now_eat)}.</div>${rows}</div>`;
}
// ---- email recipients as a table ----
const REC_ROLES = [['hq', 'HQ'], ['rc', 'RC'], ['arc', 'ARC']];
function recInit(rec) {
  const order = { hq: 0, rc: 1, arc: 2 };
  S.recRows = Object.entries((rec && rec.recipients) || {}).map(([email, r]) => ({ email, name: r.name || '', role: r.role || 'rc', region: r.region || '', copy: Boolean(r.copy), backup: r.backup || '', from: r.from || '', active: r.active !== false }))
    .sort((x, y) => (order[x.role] - order[y.role]) || (x.region || '').localeCompare(y.region || '') || x.name.localeCompare(y.name));
  S.recDirty = false;
}
function recipientsTable(a) {
  if (!S.recRows) recInit(a.rec);
  const regs = S.cfg?.regions || [];
  const n = S.recRows.length, act = S.recRows.filter((x) => x.active).length;
  const cnt = (role) => S.recRows.filter((x) => x.role === role).length;
  const body = S.recRows.map((r, i) => `<tr data-ri="${i}" data-q="${esc((r.name + ' ' + r.email + ' ' + r.role + ' ' + r.region).toLowerCase())}" class="${r.active ? '' : 'paused'}">
    <td><input data-rr="${i}" data-f="name" value="${esc(r.name)}" placeholder="Name"></td>
    <td><input data-rr="${i}" data-f="email" type="email" value="${esc(r.email)}" placeholder="name@example.org"></td>
    <td><select data-rr="${i}" data-f="role">${REC_ROLES.map(([k, t]) => `<option value="${k}" ${r.role === k ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
    <td><select data-rr="${i}" data-f="region"><option value="">All (HQ)</option>${regs.map((g) => `<option value="${g}" ${r.region === g ? 'selected' : ''}>${esc(title(g))}</option>`).join('')}</select></td>
    <td class="c"><input type="checkbox" data-rr="${i}" data-f="copy" ${r.copy ? 'checked' : ''} title="Gets a copy for information only"></td>
    <td><select data-rr="${i}" data-f="backup"><option value="">No</option><option value="to" ${r.backup === 'to' ? 'selected' : ''}>To</option><option value="cc" ${r.backup === 'cc' ? 'selected' : ''}>Cc</option></select></td>
    <td><input data-rr="${i}" data-f="from" type="date" value="${esc(r.from)}" title="Emails start on this day (empty = now)"></td>
    <td class="c"><input type="checkbox" data-rr="${i}" data-f="active" ${r.active ? 'checked' : ''} title="Untick to pause"></td>
    <td><button class="btn sm ghost" data-act="recDel" data-i="${i}" title="Remove">✕</button></td></tr>`).join('');
  return `<div class="recbar"><input id="recQ" placeholder="Search name, email, role or region" autocomplete="off"><span class="m"><b>${n}</b> people · ${act} active · ${cnt('hq')} HQ · ${cnt('rc')} RC · ${cnt('arc')} ARC ${S.recDirty ? '<span class="pill warn">unsaved changes</span>' : ''}</span><button class="btn sm sec" data-act="recAdd">+ Add a person</button></div>
  <div class="tbl rectbl"><table class="dt"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Region</th><th class="c" title="Copy for information only">Copy</th><th title="Weekly backup email">Backup</th><th title="Emails start on this day">Starts</th><th class="c" title="Untick to pause">On</th><th></th></tr></thead><tbody>${body || '<tr><td colspan="9" class="empty">No recipients yet.</td></tr>'}</tbody></table></div>
  <div class="m" style="margin-top:6px">Copy = gets a copy for information only. Backup = takes part in the Monday 07:00 backup email (To or Cc). Starts = no emails before this day. On = untick to pause without deleting.</div>`;
}
function autoCards(a) {
  const c = a.calsync, f = a.formjob; let out = '';
  if (c) {
    const l = c.last;
    out += `<div class="card" style="margin-top:14px"><h3>Calendar file on the phones (automatic)</h3><div class="sub">When on, the file <b>ref_calendar.csv</b> in the Students and Sampling KoBo projects is replaced about 5 minutes after a plan is submitted or changed. It only uploads once every region has submitted its plan. When it uploads, the calendar check switches on for every school in the file, so switch it on only when you are ready. Nothing is deleted from KoBo except the old calendar file.</div>
    <p style="margin:8px 0">${c.enabled ? '<span class="pill good">ON</span>' : '<span class="pill mute">OFF</span>'} Plans submitted: <b>${c.current.regions_submitted} of ${c.current.regions_total}</b> · schools in the file: <b>${c.current.rows}</b> · version <b>${esc(c.current.version)}</b> ${c.pending ? '<span class="pill warn">changes not yet on phones</span>' : '<span class="pill good">up to date</span>'}</p>
    <p class="m">${l ? (l.skipped ? 'Last check: ' + esc(l.skipped) : 'Last upload ' + eatTime(l.at) + ' · ' + esc(l.version) + ' · ' + l.rows + ' schools · ' + (l.ok ? 'ok' : '<b>FAILED</b>: ' + esc(JSON.stringify(l.results)))) : 'No upload yet.'}</p>
    <p style="margin-top:8px">${c.enabled ? '<button class="btn sm ghost" data-act="calsyncOff">Switch off</button>' : '<button class="btn sm" data-act="calsyncOn">Switch on</button>'} <button class="btn sm ghost" data-act="calsyncRun">Upload now</button></p>${S.calSyncMsg ? `<p class="m">${esc(S.calSyncMsg)}</p>` : ''}</div>`;
  }
  if (f) {
    const r = f.result;
    out += `<div class="card" style="margin-top:14px"><h3>Scheduled replacement of the Sampling form</h3><div class="sub">On ${eatTime(f.run_after)} (EAT) the Sampling project in KoBo is replaced with the standard (non-pilot) form, in the same project. It first checks the live form is the pilot form with no draft, imports, checks the name, question count, calendar check, media files and that the number of submissions is unchanged, and only then deploys. If any check fails, nothing is deployed and HQ gets an email. Submissions are never touched.</div>
    <p style="margin:8px 0">${f.done === 'done' ? '<span class="pill good">done</span>' : f.done === 'failed' ? '<span class="pill bad">stopped, nothing deployed</span>' : f.done === 'expired' ? '<span class="pill mute">expired</span>' : f.armed ? '<span class="pill warn">scheduled</span>' : '<span class="pill mute">cancelled</span>'}</p>
    ${r ? `<p class="m">${eatTime(r.at)} · ${r.ok ? 'replaced: ' + r.rows + ' rows, ' + r.submissions + ' submissions kept. Previous version (for rollback): <b>' + esc(r.previous_version) + '</b>' : '<b>' + esc(r.why) + '</b>'}</p>` : ''}
    <p style="margin-top:8px">${f.armed && !f.done ? '<button class="btn sm ghost" data-act="formJobCancel">Cancel the schedule</button>' : !f.done || f.done === 'failed' || f.done === 'expired' ? '<button class="btn sm" data-act="formJobArm">Schedule it</button>' : ''} ${f.done !== 'done' ? '<button class="btn sm ghost" data-act="formJobRun">Run now</button>' : ''}</p>${S.formJobMsg ? `<p class="m">${esc(S.formJobMsg)}</p>` : ''}</div>`;
  }
  return out;
}
function viewAdmin() {
  const a = S.adm; if (!a) return '<div class="empty">Loading…</div>';
  const sync = Object.entries(a.status.sync).map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${v.configured ? '<span class="pill good">connected</span>' : '<span class="pill bad">not set</span>'}</td><td class="num r">${fmt(v.records_last_pass)}</td><td>${v.in_progress ? `<span class="pill warn">syncing · page ${v.pages}</span>` : '<span class="pill good">idle</span>'}</td><td>${v.last_done ? new Date(v.last_done).toLocaleString('en-GB') : '–'}</td></tr>`).join('');
  const codes = a.codes ? a.codes.codes.map((c) => `<tr><td>${esc(title(c.region))}</td><td>${esc(c.position)}</td><td>${esc(c.name)}</td><td class="num"><b>${esc(c.code)}</b></td></tr>`).join('') : '';
  const SECTIONS = [['health', 'Health'], ['people', 'People & access'], ['messages', 'Messages'], ['forms', 'KoBo & forms'], ['safety', 'Data safety'], ['settings', 'Settings']];
  const cur = SECTIONS.some((x) => x[0] === S.admSub) ? S.admSub : (store.get('kf_admsub') || 'health');
  const part = {
    health: () => `${readinessCard(a)}<div class="card"><h3>Data connections</h3><div class="sub">Student tests, sampling and teacher forms are read from KoBo every 5 minutes in field hours</div><div class="tbl"><table><thead><tr><th>Form</th><th>Status</th><th class="r">Records read</th><th>State</th><th>Last complete</th></tr></thead><tbody>${sync}</tbody></table></div></div>
  ${S.ov.unlisted?.length ? `<div class="banner" style="margin-top:14px"><b>Names in KoBo that are not in the staff roster:</b> ${S.ov.unlisted.map(esc).join(', ')}. Their tests still count, but they have no region or access code.</div>` : ''}
${storageCard()}${activityCard(a)}`,
    people: () => `${rosterCard(a)}${hqTeamCard(a)}${devicesCard(a)}  <div class="card" style="margin-top:14px"><h3>Access codes</h3><div class="sub">One code per person. Send each person their own code; do not share this list. HQ code stays with you.</div><div class="tbl"><table><thead><tr><th>Region</th><th>Role</th><th>Name</th><th>Code</th></tr></thead><tbody>${codes}</tbody></table></div></div>`,
    messages: () => `${emailScheduleCard(a)}  <div class="card" style="margin-top:14px"><h3>Email list</h3><div class="sub">Who is on the lists. Changes apply after you press Save. This does not send anything.</div>
  ${recipientsTable(a)}
  <div style="margin-top:10px"><button class="btn sm" data-act="saveRec">Save the email list</button></div></div>
  <div class="card" style="margin-top:14px"><h3>Preview and test</h3><div class="sub"><b>Nothing here is sent to people.</b> A preview only shows what an email would look like today, with today's numbers. To check how it arrives, send a test to your own address.</div>
  <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm sec" data-act="prevMail" data-kind="morning" data-region="">Preview: HQ morning brief</button><button class="btn sm sec" data-act="fuPrev">Preview: onboarding follow-up (QR and install)</button><button class="btn sm sec" data-act="prevMail" data-kind="morning" data-region="TANGA">Preview: coordinator morning update (Tanga)</button><button class="btn sm sec" data-act="prevMail" data-kind="evening" data-region="">Preview: end-of-day check</button><button class="btn sm sec" data-act="prevRem" data-region="TANGA">Preview: notice reminder (Tanga)</button></div>
  ${a.preview ? `<div class="banner" style="margin-top:12px;background:var(--warn-bg)"><b>PREVIEW, NOT SENT.</b> Subject: ${esc(a.preview.subject)}</div><iframe sandbox title="Email preview" style="width:100%;height:420px;border:1px solid var(--line);border-radius:8px;background:#fff;margin-top:6px" srcdoc="${esc(a.preview.html)}"></iframe>` : ''}
  <div class="f" style="margin-top:12px;display:flex;gap:8px;align-items:end;flex-wrap:wrap"><label>Send a test of the HQ morning brief to<input id="testTo" type="email" placeholder="your address" value="${esc(store.get('kf_test_to') || '')}"></label><button class="btn sm" data-act="sendTest">Send test (marked [TEST])</button><button class="btn sm sec" data-act="fuTest">Send the follow-up test to this address</button></div><div class="f" style="margin-top:10px"><button class="btn sm" style="background:var(--bad,#b8432a);color:#fff" data-act="fuSend">Send the onboarding follow-up to all coordinators (copy to Michael, Mundo and Joram)</button></div>${S.testMsg ? `<p class="m">${esc(S.testMsg)}</p>` : ''}</div>
  <div class="card" style="margin-top:14px"><h3>Phone alerts</h3><div class="sub">${a.push?.ready ? '<span class="pill good">server ready</span>' : '<span class="pill warn">not set up</span>'} ${a.push ? a.push.devices + ' device(s) subscribed' : ''}${a.push && a.push.devices ? ' (' + Object.entries(a.push.by_role).map(([k, v]) => v + ' ' + k).join(', ') + ')' : ''}. Each person turns alerts on from the header button on their own phone. On iPhone the page must be on the home screen first.</div><button class="btn sm" data-act="pushTest">Send a test alert to HQ devices</button></div>\n`,
    forms: () => `${formsCard()}  <div class="card" style="margin-top:14px"><h3>Calendar for the KoBo forms: manual backup</h3><div class="sub">The standard way is the automatic update below: switch it on once and the file on the phones follows the plans by itself. This is the manual backup if the automatic update is off or fails. <b>Download</b> the file, then in KoBo open each project (Students and Sampling) > Form > Settings > Media and replace <b>ref_calendar.csv</b>. Never delete the file without replacing it: the forms look it up. <b>Download the last automatic copy</b> gives you exactly what the system last uploaded.</div><button class="btn sm" data-act="calCsv">Download the calendar built from today's plans</button> <button class="btn sm ghost" data-act="calCsvLast">Download the last automatic copy</button>${S.calMsg ? `<p class="m" style="margin-top:8px">${esc(S.calMsg)}</p>` : ''}</div>\n${autoCards(a)}`,
    safety: () => `${backupDaysCard(a)}`,
    settings: () => `${settingsCard(a)}`,
  };
  const nav = `<div class="sel admnav" style="margin:6px 0 12px;flex-wrap:wrap">${SECTIONS.map(([k, t]) => `<button class="btn sm ${k === cur ? '' : 'sec'}" data-act="admSub" data-v="${k}">${t}</button>`).join('')}</div>`;
  return `<div class="pagehead"><div><h2>Admin</h2><p>Readiness, data connections, people, access codes and backups</p></div><button class="btn" data-act="refreshNow">Sync now</button></div>
  ${nav}${(part[cur] || part.health)()}`;
}


// ---------- reusable table: search, filter, sort, click-to-open ----------
S.tbl = {};
const memKey = (id) => 'kf_view:' + (S.who ? S.who.id ?? S.who.name : 'x') + ':' + id;
function tblLoad(id, def) { try { const v = JSON.parse(store.get(memKey('t:' + id)) || 'null'); return v ? { ...def, sort: v.sort ?? def.sort, dir: v.dir ?? def.dir, f: v.f || {} } : def; } catch { return def; } }
function tblSave(id) { const T = S.tbl[id]; if (T) store.set(memKey('t:' + id), JSON.stringify({ sort: T.sort, dir: T.dir, f: T.f })); }
function dataTable(id, cols, rows, opts = {}) {
  const T = (S.tbl[id] ||= tblLoad(id, { q: '', sort: opts.sort || null, dir: opts.dir ?? -1, f: {} }));
  const filters = opts.filters || [];
  const q = T.q.toLowerCase();
  let list = rows.filter((r) => (!q || cols.some((c) => c.search && String(c.search(r) ?? '').toLowerCase().includes(q))) && filters.every((f) => !T.f[f.k] || String(f.get(r)) === T.f[f.k]));
  const sc = cols.find((c) => c.k === T.sort);
  if (sc) list = list.slice().sort((x, y) => { const a = sc.val(x), b = sc.val(y); if (a == null && b == null) return 0; if (a == null) return 1; if (b == null) return -1; return (typeof a === 'string' ? a.localeCompare(b) : a - b) * T.dir; });
  const dirty = Boolean(T.q) || Object.values(T.f).some(Boolean); const tool = `<div class="toolbar"><input data-tq="${id}" type="search" placeholder="${esc(opts.placeholder || 'Search')}" value="${esc(T.q)}" aria-label="Search">${filters.map((f) => `<select data-tf="${id}:${f.k}" aria-label="${esc(f.label)}"><option value="">${esc(f.label)}: all</option>${f.options(rows).map((o) => `<option value="${esc(o[0])}" ${T.f[f.k] === String(o[0]) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`).join('')}${dirty ? `<button class="btn sm ghost" data-act="tblReset" data-id="${id}">Reset</button>` : ''}<span class="count">${list.length} of ${rows.length}</span></div>`;
  const head = cols.map((c) => `<th class="${c.cls || ''} ${c.small ? 'hide-s' : ''} ${c.val ? 'sortable' : ''} ${T.sort === c.k ? 'sorted' : ''}" ${c.val ? `data-ts="${id}:${c.k}"` : ''}>${c.label}${T.sort === c.k ? (T.dir < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('');
  const body = list.slice(0, opts.limit || 300).map((r) => `<tr class="${opts.open && opts.open(r) ? 'click' : ''}" ${opts.open && opts.open(r) ? `data-open="${esc(opts.open(r))}"` : ''}>${cols.map((c) => `<td class="${c.cls || ''} ${c.small ? 'hide-s' : ''}">${c.html(r)}</td>`).join('')}</tr>`).join('');
  return `${tool}<div class="tbl dt-wrap"><table class="dt"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}" class="empty">Nothing matches. Clear the search or filters.</td></tr>`}</tbody></table></div>`;
}
const chip = (txt, cls) => `<span class="chip c-${cls}">${txt}</span>`;
const qChip = (v) => (v == null ? chip('–', 'mute') : chip(v, v >= 90 ? 'good' : v >= 75 ? 'warn' : 'bad'));
function speedChip(v, g) {
  if (v == null) return chip('–', 'mute');
  const b = S.ov?.bands?.[g]; if (!b) return chip(v, 'teal');
  return chip(v, v < b.p3 || v > b.p99 ? 'bad' : v < b.p10 || v > b.p90 ? 'warn' : 'good');
}
const partnerOf = (r) => Object.entries(S.cfg.partners).find(([, rs]) => rs.includes(r))?.[0] || '';
const roleLabel = (a) => (a.position || (a.role === 'unlisted' ? 'Not in roster' : a.role));

// ---------- links and the detail panel ----------
const isVol = () => S.who && S.who.role === 'volunteer';
const lk = (kind, id, text) => (kind === 'person' && isVol() && S.ov?.mine?.me?.name !== id ? esc(text) : `<a href="#" class="lk" data-open="${esc(kind)}:${esc(id)}">${esc(text)}</a>`);
const schoolsAll = () => [...(S.who?.role === 'hq' ? S.allSchools || [] : S.ov?.mine?.schools || []), ...(S.pr?.schools || [])];
const adminsAll = () => (S.who?.role === 'hq' ? S.ov.admins : S.ov?.mine?.admins || (S.ov?.mine?.me ? [S.ov.mine.me] : []));
const flagsAll = () => (S.who?.role === 'hq' ? S.ov.flags : S.ov?.mine?.flags || []);
const workOf = (name) => S.workCache[name] || (S.ov?.mine?.work_all || {})[name] || (S.ov?.mine?.me?.name === name ? S.ov.mine.work : []) || [];
S.stack = []; S.cur = null;

function openDetail(spec, push = true) {
  if (push && S.cur) S.stack.push(S.cur);
  S.cur = spec;
  const [kind, ...rest] = spec.split(':'); const id = rest.join(':');
  const body = kind === 'person' ? personCard(id) : kind === 'school' ? schoolCard(id) : kind === 'region' ? regionCard(id) : kind === 'phone' ? phoneCard(id) : '<p>Not found.</p>';
  $('#drawerBody').innerHTML = `<div class="dnav">${S.stack.length ? '<button class="btn sm sec" data-act="dBack">‹ Back</button>' : ''}<button class="btn sm sec" data-act="dClose" style="margin-left:auto">Close ✕</button></div>${body}`;
  $('#drawer').hidden = false; if (push !== false || !$('#drawerBody').scrollTop) $('#drawerBody').scrollTop = 0;
  if (kind === 'person' && S.who?.role !== 'volunteer') loadWork(id);
  if ((kind === 'region' || kind === 'school') && S.who?.role === 'hq' && !S.allSchools) ensureSchools();
}
function closeDetail() { $('#drawer').hidden = true; S.cur = null; S.stack = []; }

function phoneCard(code) {
  const P = S.ph; const p = P && (P.phones || []).find((x) => x.c === code);
  if (!p) return `<h2>Phone ${esc(code)}</h2><p class="m">Open the Phones tab for the day to see this phone.</p>`;
  const hm = (t) => `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`;
  const flags = (P.flags || []).filter((f) => (f.text || '').includes(code));
  const ev = (P.events || []).filter((e) => e.c === code);
  return `<h2>Phone ${esc(code)}</h2><p class="m">${esc(dayName(P.date))} · ${p.n} records · active ${hm(p.first)} to ${hm(p.last)}</p>
  <h3 style="margin:14px 0 4px">Names used on it</h3><p>${p.names.length ? p.names.map((n) => lk('person', n, n)).join(' · ') : '<span class="m">none recorded</span>'}</p>
  <h3 style="margin:14px 0 4px">Schools</h3><p>${p.schools.map((s) => lk('school', s.id, s.name)).join(' · ') || '<span class="m">none</span>'}</p>
  <h3 style="margin:14px 0 4px">Checks on this phone (${flags.length})</h3>${flags.length ? flagList(flags, { limit: 20 }) : '<div class="note">Nothing to look at.</div>'}
  <h3 style="margin:14px 0 4px">What it did</h3>${timelineChart({ ...P, events: ev })}`;
}
function personCard(name) {
  const a = adminsAll().find((x) => x.name === name);
  if (!a) return `<h2>${esc(name)}</h2><p class="m">No tests recorded for this year yet.</p>`;
  const b = S.ov.bands, flags = flagsAll().filter((f) => f.admin === name && isOpen(f));
  const speed = [1, 2, 3].map((g) => { const v = a.by_grade[g]; const span = b[g].p99 * 1.25; return `<div class="m" style="margin-top:8px">Grade ${g}: ${v ?? '–'} min average ${speedChip(v, g)} · normal ${b[g].p3.toFixed(1)}–${b[g].p99.toFixed(0)} min</div><div class="band"><i style="left:${(b[g].p3 / span) * 100}%;width:${((b[g].p99 - b[g].p3) / span) * 100}%"></i>${v != null ? `<b style="left:${Math.min(100, (v / span) * 100)}%"></b>` : ''}</div>`; }).join('');
  const rows = workRowsHtml(name, workOf(name).slice(0, 25), { schoolName: schoolNameOf });
  return `<h2>${esc(a.name)}</h2><p class="m">${esc(roleLabel(a))}${a.region ? ' · ' + lk('region', a.region, title(a.region)) + ' · ' + esc(partnerOf(a.region)) : ''}</p>
  <div class="grid kpis" style="margin-top:12px">${kpi('Pupils tested', fmt(a.tested))}${kpi('Avg test time', (a.avg_min ?? '–') + ' min')}${kpi('Quality', a.quality ?? '–', 'out of 100')}${kpi('Days · schools', a.days + ' · ' + a.schools)}</div>
  <h3 style="margin:16px 0 4px">Test speed</h3>${speed}
  <h3 style="margin:16px 0 4px">What counts against the score</h3><div class="m">Too fast <b>${a.fast}</b> · too slow <b>${a.slow}</b> · outside school hours <b>${a.late}</b> · not on sampling list <b>${a.not_list}</b> · far from school <b>${a.far}</b></div>
  <h3 style="margin:16px 0 4px">Open queries (${flags.length})</h3>${flags.length ? flagList(flags, { limit: 20, names: false }) : '<div class="note">No open queries.</div>'}
  ${S.daysCache[name]?.length ? `<h3 style="margin:16px 0 4px">Days worked</h3><div class="m"><b>${S.daysCache[name].length}</b> day(s) with tests · first ${shortDate(S.daysCache[name][0][0])} · latest ${shortDate(S.daysCache[name].slice(-1)[0][0])} · ${fmt(S.daysCache[name].reduce((t, d) => t + d[2], 0))} pupils tested. A day counts when at least one test was submitted.</div>` : ''}
  <h3 style="margin:16px 0 4px">Recent work</h3><div class="tbl"><table><thead><tr><th>Day</th><th>School</th><th class="r">Gr</th><th class="r">Tested</th><th class="r">Avg min</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">No work recorded.</td></tr>'}</tbody></table></div>`;
}
const schoolNameOf = (id) => schoolsAll().find((x) => x.id === id)?.name || S.plan?.schools?.find((x) => x.id === id)?.name || (S.pil?.data?.schools || []).find((x) => x.school === id)?.name || id;
function schoolInfo(id) { return infoBlock(id); }
function schoolCard(id) {
  const s = schoolsAll().find((x) => x.id === id);
  if (!s) return `<h2>School</h2><p class="m">Details are not available for ${esc(id)}.</p>`;
  const flags = [...flagsAll(), ...(S.pr?.flags || [])].filter((f) => f.school === id && isOpen(f));
  const rows = [1, 2, 3].map((g) => `<tr><td>Grade ${g}</td><td class="r num">${s.g[g].att ?? '–'}</td><td class="r num">${s.g[g].target}</td><td class="r num">${s.g[g].av}</td><td>${s.g[g].done ? '<span class="pill good">complete</span>' : s.g[g].n ? '<span class="pill warn">in progress</span>' : '<span class="pill mute">not started</span>'}</td></tr>`).join('');
  return `<h2>${esc(s.name)}</h2>${schoolInfo(id)}<p class="m">${s.region ? lk('region', s.region, title(s.region)) + ' · ' : ''}${esc(title(s.lga))} LGA · ${esc(title(s.ward || ''))} ward · ${esc(s.id)}</p>
  <p style="margin:8px 0">${statusPill(s)} <span class="pill mute">${esc(s.arm)}</span> ${s.mne === 'M&E' ? '<span class="pill mute">M&amp;E</span>' : ''}</p>
  <div class="grid kpis">${kpi('Visit', s.first ? shortDate(s.first) + (s.last && s.last !== s.first ? ' – ' + shortDate(s.last) : '') : 'not yet')}${kpi('People by name', s.max_team || '–', 'test admins recorded')}${kpi('Phones', s.max_devices || '–', 'different phones that sent tests')}${kpi('Teacher forms', s.teacher_forms)}${kpi('Test admins', s.admins.length)}</div>
  <h3 style="margin:16px 0 4px">Pupils by grade</h3><div class="tbl"><table><thead><tr><th>Grade</th><th class="r">Attended</th><th class="r">Sample</th><th class="r">Tested</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
  ${s.people && Object.keys(s.people).length ? `<h3 style="margin:16px 0 4px">People at the school, by day</h3><div class="tbl"><table><thead><tr><th>Day</th><th class="r">Names</th><th class="r">Phones</th><th>Tests per phone</th><th></th></tr></thead><tbody>${Object.entries(s.people).sort().map(([d, [nn, dd, per]]) => `<tr><td>${shortDate(d)}</td><td class="r num">${nn}</td><td class="r num">${dd || '–'}</td><td class="num">${(per || []).length ? esc((per || []).join(' · ')) : '–'}</td><td>${dd && dd < nn ? chip('fewer phones than names', 'warn') : dd && dd > nn ? chip('more phones than names', 'mute') : dd ? chip('matches', 'good') : chip('no phone data', 'mute')}</td></tr>`).join('')}</tbody></table></div><div class="m" style="margin-top:4px">Teams are not always the same size. The count here is by phone: how many phones sent records, against how many names were recorded, and how many tests each phone sent. Each person should use their own phone.</div>` : ''}
  <h3 style="margin:16px 0 4px">Who tested here</h3><p>${s.admins.length ? s.admins.map((n) => lk('person', n, n)).join(' · ') : '<span class="m">Nobody yet.</span>'}</p>
  <h3 style="margin:16px 0 4px">Open queries (${flags.length})</h3>${flags.length ? flagList(flags, { limit: 20 }) : '<div class="note">No open queries.</div>'}`;
}
function regionCard(r) {
  const R = (S.ov.regions || []).find((x) => x.region === r); if (!R) return `<h2>${esc(title(r))}</h2>`;
  const schools = schoolsAll().filter((s) => s.region === r || !s.region).slice().sort((a, b) => a.done - b.done || a.name.localeCompare(b.name));
  const p = S.ov.plans?.[r];
  return `<h2>${esc(title(r))}</h2><p class="m">${esc(partnerOf(r) || 'Training region')}</p>
  <div class="grid kpis" style="margin-top:12px">${kpi('Schools complete', `${R.done}<small> / ${R.total}</small>`)}${kpi('Pupils tested', fmt(R.tested), 'of ' + fmt(R.target))}${kpi('Pace', R.pace + ' / day')}${kpi('Projected finish', R.projected === 'done' ? 'Done' : R.projected ? shortDate(R.projected) : '–')}</div>
  ${p ? `<p style="margin-top:10px">Field plan: ${p.status === 'locked' ? `<span class="pill good">submitted</span> ${p.changes} change(s), ${p.late_changes} late` : '<span class="pill bad">not submitted</span>'}</p>` : ''}
  <h3 style="margin:16px 0 4px">Tests per day</h3>${barChart(R.series)}
  <h3 style="margin:16px 0 4px">Schools</h3><div class="tbl"><table><thead><tr><th>School</th><th>LGA</th><th>Status</th></tr></thead><tbody>${schools.map((s) => `<tr><td>${lk('school', s.id, s.name)}</td><td>${esc(title(s.lga))}</td><td>${statusPill(s)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Open the Data explorer to load schools.</td></tr>'}</tbody></table></div>`;
}

function flagDetail(f) {
  const s = SCHOOL_INFO(f.school);
  const recs = (f.recs || []).map((r) => `<tr><td class="num">${esc(r[0] || '–')}</td><td class="r num">${esc(r[1] === '' ? '–' : r[1])}</td><td class="r num">${r[2] === '' ? '–' : esc(r[2])}</td><td class="r num">${esc(r[3] || '–')}</td><td class="r num">${esc(r[4] === '' || r[4] == null ? '–' : r[4])}</td><td class="r num">${esc(r[5] === '' ? '–' : r[5])}</td></tr>`).join('');
  return `<div class="fdetail"><table class="kv"><tbody>
  <tr><th>Region</th><td>${f.region ? lk('region', f.region, title(f.region)) : '–'}</td><th>LGA</th><td>${esc(title(f.lga || s.lga || ''))}</td></tr>
  <tr><th>Ward</th><td>${esc(title(f.ward || s.ward || ''))}</td><th>School</th><td>${lk('school', f.school, f.school_name || s.name || f.school)} <span class="m">(${esc(f.school)})</span></td></tr>
  <tr><th>Grade</th><td>${f.grade ? 'Grade ' + f.grade : 'All grades'}</td><th>Test admin</th><td>${f.admin ? lk('person', f.admin, f.admin) : '–'}</td></tr>
  <tr><th>Test date</th><td>${f.date ? dayName(f.date) : '–'}</td><th>Normal</th><td>${esc(f.normal || '–')}</td></tr></tbody></table>
  ${recs ? `<div class="tbl"><table class="dt"><thead><tr><th>Pupil ID</th><th class="r">Pupil no.</th><th class="r">Test min</th><th class="r">Started</th><th class="r">Test set</th><th class="r">KoBo ID</th></tr></thead><tbody>${recs}</tbody></table></div>` : '<div class="note">Pupil-level detail is shown for newly submitted data. Older records list only the school, grade, admin and date.</div>'}
  ${f.evs ? `<div class="tbl"><table class="dt"><thead><tr><th>Start</th><th>End</th><th>Phone</th><th>Name</th><th>School</th><th class="r">Grade</th><th>Form</th></tr></thead><tbody>${f.evs.map((r) => `<tr><td class="num">${esc(r[0])}</td><td class="num">${esc(r[1])}</td><td class="num">${esc(r[2])}</td><td>${esc(r[3])}</td><td>${esc(r[4])}</td><td class="r">${esc(r[5])}</td><td>${r[6] === 's' ? 'Sampling' : 'Test'}</td></tr>`).join('')}</tbody></table></div>` : ''}
  ${koboButtons(f)}
  <div class="note" style="margin-top:8px">To find these in KoBo: open the student form's data table, filter on <b>school</b> ${esc(f.school)}, <b>grade</b> ${esc(f.grade || '')}, <b>date</b> ${esc(f.date || '')}, then look up the Pupil ID (stuid) or the KoBo ID (_id). Pupil names are never shown here.</div></div>`;
}
function koboButtons(f) {
  const ids = (f.recs || []).map((r) => Number(r[5])).filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length || !S.who || S.who.role === 'volunteer' || S.viewAs) return '';
  const lbl = { on_hold: 'Needs re-test (on hold)', not_approved: 'Not approved', approved: 'Approved' };
  const asking = S.koboConfirm && S.koboConfirm.startsWith(f.qk + '|');
  const btn = (st) => { const key = `${f.qk}|${st}`; const sure = S.koboConfirm === key; return `<button class="btn sm ${sure ? '' : 'sec'}" data-act="koboStatus" data-k="${esc(key)}" data-status="${st}" data-ids="${ids.join(',')}">${sure ? 'Click again to confirm' : esc(lbl[st])}</button>`; };
  return `<div class="note" style="margin-top:8px"><b>Mark these ${ids.length} submission(s) in KoBo</b> so the decision stays with the data. Pupils are not affected.<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${btn('on_hold')}${btn('not_approved')}${btn('approved')}</div>${S.koboMsg && S.koboMsg.k === f.qk ? `<div class="m" style="margin-top:6px">${esc(S.koboMsg.t)}</div>` : ''}</div>`;
}
const SCHOOL_INFO = (id) => schoolsAll().find((x) => x.id === id) || {};

// ---------- People (HQ) and My team (coordinator) ----------
// ---- notices to schools: ready-to-send messages (Kiswahili first, then English) ----
const SW_DAYS = ['Jumapili', 'Jumatatu', 'Jumanne', 'Jumatano', 'Alhamisi', 'Ijumaa', 'Jumamosi'];
const SW_MONTHS = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];
function swDate(iso) { const d = new Date(iso + 'T00:00:00Z'); return `${SW_DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${SW_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
function swTime(hhmm) { const [h, m] = (hhmm || '08:00').split(':').map(Number); const hs = ((h + 6) % 12) || 12; const per = h >= 6 && h < 12 ? 'asubuhi' : h >= 12 && h < 16 ? 'mchana' : h >= 16 && h < 20 ? 'jioni' : 'usiku'; return `saa ${hs}${m ? ':' + String(m).padStart(2, '0') : ''} ${per}`; }
function noticeMessage(kind, v, region) {
  const school = (v.school_name || '').trim(), ward = title(v.ward || ''), when = swDate(v.date), time = swTime(v.start), en = dayName(v.date), t24 = v.start || '08:00';
  const lead = v.lead_name || 'Timu ya KiuFunza 4', from = v.lead_name ? `${v.lead_name}, KiuFunza 4 (${title(region)})` : `Timu ya KiuFunza 4 (${title(region)})`;
  if (kind === 'aek') return `Habari Afisa Elimu Kata${ward ? ' wa ' + ward : ''}. Tunakuarifu kuwa timu ya KiuFunza 4 itatembelea Shule ya ${school}${ward ? ', kata ya ' + ward : ''}, ${when}, kuanzia ${time}, kwa ajili ya upimaji wa umahiri wa wanafunzi wa darasa la I hadi III (kwa kibali cha halmashauri). Tunaomba ushirikiano wako. Asante sana.\n— ${from}\n\nGood day, Ward Education Officer${ward ? ' of ' + ward : ''}. The KiuFunza 4 team will visit ${school} Primary School on ${en} at ${t24} to assess the reading, writing and arithmetic skills of Grade 1 to 3 pupils (with the council's permission). We ask for your support. Thank you.\n— ${from}`;
  return `Habari Mwalimu Mkuu wa Shule ya ${school}. Timu ya KiuFunza 4 itatembelea shule yako ${when}, kuanzia ${time}. Tafadhali:\n1) Wajulishe walimu kuhusu ziara hii.\n2) Walimu wa darasa la I, II na III wahakikishe vitabu vya mahudhurio vimesasishwa.\n3) Walimu wachukue mahudhurio asubuhi mapema siku hiyo, kabla timu haijafika.\n4) Muandae vyumba vitatu, kimoja kwa kila darasa, kwa ajili ya upimaji.\n5) Msiandae chakula wala vinywaji kwa timu.\nAsante sana kwa ushirikiano wako.\n— ${from}\n\nGood day, Head Teacher of ${school}. The KiuFunza 4 team will visit your school on ${en} from ${t24}. Please:\n1) Tell the teachers about the visit.\n2) Grade 1, 2 and 3 class teachers update the attendance registers.\n3) Take the attendance early that morning, before the team arrives.\n4) Prepare three rooms, one for each grade, for the testing.\n5) Do not prepare food or drinks for the team.\nThank you for your cooperation.\n— ${from}`;
}
async function copyNotice(t) {
  const plan = S.plan?.plan; const v = plan?.visits.find((x) => x.id === t.dataset.id); if (!v) return;
  const text = noticeMessage(t.dataset.kind, v, plan.region || S.planRegion || S.who.region);
  try { await navigator.clipboard.writeText(text); S.noticeMsg = 'Message copied. Paste it into SMS or WhatsApp, send it, then tap Mark sent.'; } catch { window.prompt('Copy this message, send it, then tap Mark sent:', text); S.noticeMsg = ''; }
  render();
}
// ---- coordinators' own work and the regional team block ----
const STATUS_TXT = { good: 'on target', warn: 'close', bad: 'behind' };
function ownRows(rows) {
  return rows.map((x) => `<div class="orow"><div>${esc(x.label)}${x.target ? `<small>Target: ${esc(x.target)}</small>` : ''}</div><div class="v">${esc(x.display)}</div><div>${x.status ? chip(STATUS_TXT[x.status], x.status) : ''}</div></div>`).join('');
}
function ownCard(o, title, sub) {
  if (!o) return '';
  const a = o.assessment, l = o.led;
  const today = (o.today || []).map((t) => `<div class="m"><b>${esc(t.name)}</b> · ${esc(t.start)} · team ${esc((t.team || []).map((n) => n.split(' ')[0]).join(', ') || 'not set')}${t.present.length ? ` · here so far: ${esc(t.present.map((n) => n.split(' ')[0]).join(', '))}` : ''}</div>`).join('');
  return `<div class="card"><h3>${esc(title)}</h3><div class="sub">${esc(sub)}</div>
  <div class="grid kpis" style="margin:8px 0">${kpi('Pupils tested', fmt(a.tested), a.sampling + ' sampling forms')}${kpi('Schools led', l.planned, l.done + ' on the planned day')}${kpi('Teacher forms', fmt(o.baseline.forms), 'baseline and M&E')}${kpi('Plan changes', o.plan.changes, o.plan.late_changes + ' late')}</div>
  ${today ? `<h4 style="margin:10px 0 4px">Today</h4>${today}` : ''}
  <h4 style="margin:12px 0 4px">What is expected</h4>${ownRows(o.rows)}
  <div class="m" style="margin-top:8px">Queries: ${o.queries.replies} replies and ${o.queries.closed} closed by you; ${o.queries.open} open in the region, ${o.queries.overdue} overdue.</div></div>`;
}
function teamBlockCard(tb, title) {
  if (!tb) return '';
  return `<div class="card"><h3>${esc(title || 'Regional coordination team')}</h3><div class="sub">${esc(tb.people.map((p) => p.name + ' (' + p.position + ')').join(' · '))}. The RC is responsible for all of this work, the ARC's included.</div>
  <div class="grid kpis" style="margin:8px 0">${kpi('Pupils tested by the two', fmt(tb.tested), tb.sampling + ' sampling forms')}${kpi('Visits', tb.visits.planned, tb.visits.done + ' on the planned day')}${kpi('Notices', tb.notices.due ? tb.notices.pct + '%' : '–', 'sent on time')}${kpi('Teacher forms', fmt(tb.baseline_forms), 'baseline and M&E')}</div>${ownRows(tb.rows)}</div>`;
}
function ownSection() {
  const m = S.ov?.mine; if (!m || !m.own) return '';
  const rcView = S.who.role === 'rc';
  return `<div class="grid two" style="margin-top:14px">${ownCard(m.own, 'Your own work', rcView ? 'The schools you lead and your own records. As Regional Coordinator you also answer for the Assistant\'s work, shown on the right.' : 'The schools you lead and your own records. You report to ' + (m.own.reports_to || 'your Regional Coordinator') + '.')}${teamBlockCard(m.team_block)}</div>${rcView && m.arc_own ? `<div style="margin-top:14px">${ownCard(m.arc_own, 'Your Assistant: ' + m.arc_own.person.name, 'You are responsible for this work too.')}</div>` : ''}`;
}
// ---- how early records are sent ----
const lagText = (h) => (h == null ? '–' : h < 1 ? Math.max(1, Math.round(h * 60)) + ' min' : h < 48 ? (Math.round(h * 10) / 10) + ' h' : Math.round(h / 24) + ' days');
const sameChip = (s) => (s ? chip(s.same_pct + '%', s.same_pct >= 90 ? 'good' : s.same_pct >= 70 ? 'warn' : 'bad') : '<span class="m">–</span>');
function submitBoard(rows) {
  const ok = rows.filter((a) => a.sub_all && a.sub_all.n >= 5);
  if (ok.length < 2) return '<div class="card" style="margin-top:14px"><h3>Who sends records early</h3><div class="sub">Appears once people have sent at least 5 records.</div></div>';
  const ord = ok.slice().sort((x, y) => (y.sub_all.same_pct - x.sub_all.same_pct) || ((x.sub_all.avg_h ?? 1e9) - (y.sub_all.avg_h ?? 1e9)));
  const line = (a, i) => `<tr class="click" data-open="person:${esc(a.name)}"><td class="num">${i}</td><td><b>${lk('person', a.name, a.name)}</b></td><td>${sameChip(a.sub_all)}</td><td class="r num">${lagText(a.sub_all.avg_h)}</td><td class="r num">${lagText(a.sub_all.max_h)}</td><td class="r num">${a.sub_all.d1 + a.sub_all.d2 + a.sub_all.d3}</td></tr>`;
  const head = '<thead><tr><th>#</th><th>Name</th><th>Same day</th><th class="r">Delay</th><th class="r">Longest</th><th class="r">Days late</th></tr></thead>';
  const n = Math.min(5, Math.floor(ord.length / 2));
  return `<div class="grid two"><div class="card"><h3>Earliest to send</h3><div class="sub">Share of records sent the same day as the visit, then the usual wait between finishing a form and sending it. Thank these people.</div><div class="tbl"><table>${head}<tbody>${ord.slice(0, n).map((a, i) => line(a, i + 1)).join('')}</tbody></table></div></div>
  <div class="card"><h3>Latest to send</h3><div class="sub">A record that waits on the phone can be lost. Sending the same day (auto send on) fixes it.</div><div class="tbl"><table>${head}<tbody>${ord.slice(-n).reverse().map((a, i) => line(a, ord.length - i)).join('')}</tbody></table></div></div></div>`;
}
function peopleTable(rows, hq) {
  const cols = [
    { k: 'name', label: 'Name', val: (a) => a.name, search: (a) => a.name, html: (a) => `<b>${lk('person', a.name, a.name)}</b>${S.who && a.staff_id === S.who.id ? ' ' + chip('You', 'gold') : ''}` },
    ...(hq ? [{ k: 'region', label: 'Region', val: (a) => a.region || '', search: (a) => a.region, html: (a) => (a.region ? lk('region', a.region, title(a.region)) : '–') }] : []),
    { k: 'role', label: 'Role', val: (a) => roleLabel(a), search: (a) => roleLabel(a), html: (a) => `<span class="chip c-${a.role === 'rc' ? 'navy' : a.role === 'arc' ? 'teal' : a.role === 'unlisted' ? 'mute' : 'gold'}">${esc(roleLabel(a))}</span>` },
    { k: 'tested', label: 'Tested', cls: 'r', val: (a) => a.tested, html: (a) => `<span class="num">${fmt(a.tested)}</span>` },
    { k: 'sameday', label: 'Same-day sends', cls: 'r', val: (a) => a.sub_all?.same_pct ?? null, html: (a) => sameChip(a.sub_all) },
    { k: 'lag', label: 'Usual delay', cls: 'r', small: true, val: (a) => a.sub_all?.avg_h ?? null, html: (a) => `<span class="num">${lagText(a.sub_all?.avg_h)}</span>` },

    { k: 'g1', label: 'Gr 1 min', cls: 'r', small: true, val: (a) => a.by_grade[1], html: (a) => speedChip(a.by_grade[1], 1) },
    { k: 'g2', label: 'Gr 2 min', cls: 'r', small: true, val: (a) => a.by_grade[2], html: (a) => speedChip(a.by_grade[2], 2) },
    { k: 'g3', label: 'Gr 3 min', cls: 'r', small: true, val: (a) => a.by_grade[3], html: (a) => speedChip(a.by_grade[3], 3) },
    { k: 'fast', label: 'Too fast', cls: 'r', val: (a) => a.fast_share ?? 0, html: (a) => chip((a.fast_share ?? 0) + '%', (a.fast_share ?? 0) >= 8 ? 'bad' : (a.fast_share ?? 0) >= 3 ? 'warn' : 'good') },
    { k: 'notlist', label: 'Not on list', cls: 'r', small: true, val: (a) => a.not_list, html: (a) => chip(a.not_list, a.not_list >= 10 ? 'bad' : a.not_list ? 'warn' : 'good') },
    { k: 'late', label: 'After hours', cls: 'r', small: true, val: (a) => a.late, html: (a) => chip(a.late, a.late >= 10 ? 'bad' : a.late ? 'warn' : 'good') },
    { k: 'days', label: 'Days', cls: 'r', small: true, val: (a) => a.days, html: (a) => `<span class="num">${a.days}</span>` },
    { k: 'quality', label: 'Quality', cls: 'r', val: (a) => a.quality, html: (a) => qChip(a.quality) },
  ];
  const filters = [
    ...(hq ? [{ k: 'region', label: 'Region', get: (a) => a.region || '', options: (r) => [...new Set(r.map((a) => a.region).filter(Boolean))].sort().map((x) => [x, title(x)]) }] : []),
    { k: 'role', label: 'Role', get: (a) => a.role, options: () => [['rc', 'Regional coordinator'], ['arc', 'Assistant coordinator'], ['volunteer', 'Volunteer'], ['unlisted', 'Not in roster']] },
    { k: 'qb', label: 'Quality', get: (a) => (a.quality == null ? 'none' : a.quality >= 90 ? 'good' : a.quality >= 75 ? 'mid' : 'low'), options: () => [['good', '90 and above'], ['mid', '75 to 89'], ['low', 'below 75'], ['none', 'no score yet']] },
  ];
  return dataTable(hq ? 'people' : 'team', cols, rows, { filters, sort: 'quality', dir: 1, open: (a) => 'person:' + a.name, placeholder: 'Search a name or region' });
}
const SHORT_ROW = { plan: 'Plan', visits: 'Visits', notices: 'Notices', changes: 'Changes in time', sameday: 'Same-day sends', queries: 'Overdue queries' };
function coordinatorsBlock() {
  const o = S.ov; if (!o.coordinators) return '';
  const val = (x, k) => (x.rows.find((r) => r.key === k) || {});
  const cell = (r) => (r.status ? chip(esc(r.display), r.status) : esc(r.display || '–'));
  const rowsC = o.coordinators.map((c) => `<tr class="click" data-open="person:${esc(c.person.name)}"><td><b>${esc(c.person.name)}</b></td><td>${esc(title(c.person.region))}</td><td>${chip(esc(c.person.position), c.person.role === 'rc' ? 'navy' : 'teal')}</td><td class="r num">${fmt(c.assessment.tested)}</td><td class="r num">${c.assessment.sampling}</td><td class="r num">${c.led.done}/${c.led.due || 0}</td><td>${cell(val(c, 'notices'))}</td><td>${cell(val(c, 'changes'))}</td><td>${cell(val(c, 'sameday'))}</td><td>${qChip(c.assessment.quality)}</td><td>${cell(val(c, 'queries'))}</td><td class="r num">${c.baseline.forms}</td></tr>`).join('');
  const rowsT = Object.values(o.team_blocks).map((t) => `<tr class="click" data-open="region:${esc(t.region)}"><td><b>${esc(title(t.region))}</b></td><td>${esc(t.people.map((p) => p.name.split(' ')[0] + ' (' + p.position + ')').join(', '))}</td><td class="chips">${t.rows.map((r) => chip(esc(SHORT_ROW[r.key] || r.label) + ': ' + esc(r.display), r.status || 'mute')).join(' ')}</td></tr>`).join('');
  return `<div class="card" style="margin-top:14px"><h3>Coordinators' own work</h3><div class="sub">What each RC and ARC did themselves, apart from supervising the team. Chips use the targets in each person's card.</div><div class="tbl"><table><thead><tr><th>Name</th><th>Region</th><th>Role</th><th class="r">Tested</th><th class="r">Sampling</th><th class="r">Led, done</th><th>Notices on time</th><th>Late changes</th><th>Same-day sends</th><th>Quality</th><th>Queries answered in 2 days</th><th class="r">Teacher forms</th></tr></thead><tbody>${rowsC}</tbody></table></div></div>
  <div class="card" style="margin-top:14px"><h3>Regional coordination teams</h3><div class="sub">What each RC and ARC did together for their region</div><div class="tbl"><table class="stk"><thead><tr><th>Region</th><th>Team</th><th>Status</th></tr></thead><tbody>${rowsT}</tbody></table></div></div>`;
}
function viewPeopleHQ() {
  return `${dataBanner()}<div class="pagehead"><div><h2>Coordinators and volunteers</h2><p>Click a name for the full card. Click a column to sort. Chips are coloured against the normal range for each grade.</p></div></div>${coordinatorsBlock()}${submitBoard(S.ov.admins)}<div class="card" style="margin-top:14px">${peopleTable(S.ov.admins, true)}<div class="legend"><span><i style="background:var(--good)"></i>normal</span><span><i style="background:var(--gold)"></i>borderline</span><span><i style="background:var(--bad)"></i>outside the normal range</span><span>Normal test time: ${bandsText()}</span></div></div>`;
}
function viewTeam() {
  return `${dataBanner()}<div class="pagehead"><div><h2>My team</h2><p>Pace, test speed and quality for everyone in ${esc(title(S.who.region))}. Click a name for their card.</p></div></div>${submitBoard(S.ov.mine.admins)}<div class="card" style="margin-top:14px">${peopleTable(S.ov.mine.admins, false)}</div>`;
}

// ---------- Data explorer (schools) ----------
function schoolTable(rows, hq) {
  const t = (s) => s.g[1].av + s.g[2].av + s.g[3].av, tg = (s) => s.g[1].target + s.g[2].target + s.g[3].target;
  const cols = [
    { k: 'name', label: 'School', val: (s) => s.name, search: (s) => s.name + ' ' + s.id, html: (s) => `<b>${lk('school', s.id, s.name)}</b>` },
    ...(hq ? [{ k: 'region', label: 'Region', val: (s) => s.region, search: (s) => s.region, html: (s) => lk('region', s.region, title(s.region)) }] : []),
    { k: 'lga', label: 'LGA', val: (s) => s.lga, search: (s) => s.lga + ' ' + (s.ward || ''), small: true, html: (s) => esc(title(s.lga)) },
    { k: 'type', label: 'Group', val: (s) => s.arm, small: true, html: (s) => chip(esc(armLabel(s)), s.arm === 'Treatment' ? 'teal' : 'mute') },
    { k: 'att', label: 'Attended 1/2/3', cls: 'r', small: true, val: (s) => s.g[1].att, html: (s) => `<span class="num">${s.g[1].att ?? '–'}/${s.g[2].att ?? '–'}/${s.g[3].att ?? '–'}</span>` },
    ...[1, 2, 3].map((g) => ({ k: 'g' + g, label: 'Gr ' + g, cls: 'r', small: true, val: (s) => pc(s.g[g].av, s.g[g].target), html: (s) => chip(`${s.g[g].av}/${s.g[g].target}`, s.g[g].done ? 'good' : s.g[g].av ? 'warn' : 'mute') })),
    { k: 'prog', label: 'Progress', val: (s) => pc(t(s), tg(s)), html: (s) => `<div style="min-width:90px">${bar(pc(t(s), tg(s)))}</div>` },
    { k: 'team', label: 'People · phones', cls: 'r', small: true, val: (s) => s.max_team, html: (s) => `<span class="num">${s.max_team || '–'} · ${s.max_devices || '–'}</span>` },
    { k: 'tf', label: 'Teacher forms', cls: 'r', small: true, val: (s) => s.teacher_forms, html: (s) => `<span class="num">${s.teacher_forms}</span>` },
    { k: 'visit', label: 'Visit', small: true, val: (s) => s.first || '', html: (s) => (s.first ? shortDate(s.first) + (s.last && s.last !== s.first ? ' – ' + shortDate(s.last) : '') : '–') },
    { k: 'status', label: 'Status', val: (s) => (s.done ? 2 : s.started ? 1 : 0), html: (s) => statusPill(s) },
  ];
  const filters = [
    ...(hq ? [{ k: 'region', label: 'Region', get: (s) => s.region, options: (r) => [...new Set(r.map((s) => s.region))].sort().map((x) => [x, title(x)]) }] : [{ k: 'mine', label: 'Mine', get: (s) => ((s.admins || []).includes(S.who.name) ? 'mine' : 'other'), options: () => [['mine', 'Schools I worked in']] }]),
    { k: 'lga', label: 'LGA', get: (s) => s.lga, options: (r) => [...new Set(r.map((s) => s.lga))].sort().map((x) => [x, title(x)]) },
    { k: 'arm', label: 'Group', get: (s) => s.arm, options: () => [['Treatment', 'Treatment'], ['Control', 'Control'], ['Pilot', 'Pilot']] },
    { k: 'type', label: 'M&E', get: (s) => s.mne, options: () => [['M&E', 'M&E schools'], ['No-M&E', 'Without M&E']] },
    { k: 'status', label: 'Status', get: (s) => (s.done ? 'done' : s.started ? 'prog' : 'new'), options: () => [['done', 'Complete'], ['prog', 'In progress'], ['new', 'Not started']] },
  ];
  return dataTable(hq ? 'schools-hq' : 'schools', cols, rows, { filters, sort: 'name', dir: 1, open: (s) => 'school:' + s.id, placeholder: 'Search a school, ward or LGA', limit: 400 });
}
// ---- source tags: every table says which form it comes from and which phase ----
const SRC = {
  assess: { cls: 'src-assess', label: 'Assessments', form: 'Student test form' },
  pupils: { cls: 'src-assess', label: 'Pupil records', form: 'Student test form' },
  samp: { cls: 'src-samp', label: 'Sampling', form: 'Sampling form' },
  teach: { cls: 'src-teach', label: 'Teachers', form: 'Teacher form' },
  school: { cls: 'src-school', label: 'School baseline', form: 'School block of the teacher form' },
  linked: { cls: 'src-linked', label: 'Linked', form: 'Two or more sources joined on the school' },
};
function srcTag(kind, extra) {
  const s = SRC[kind]; const o = S.ov || {}; const T = S.tch?.sources;
  const phase = kind === 'teach' || kind === 'school' ? 'Baseline 2026' : kind === 'linked' ? 'Baseline 2026 + Endline ' + (o.year || '') : 'Endline ' + (o.year || '');
  const recs = (kind === 'teach' || kind === 'school') && T ? ` · ${fmt(T.teachers.records)} teacher records` : '';
  const upd = (kind === 'teach' || kind === 'school') ? T?.teachers.updated : o.as_of;
  return `<div class="srcbar"><span class="src ${s.cls}">${s.label}</span><span class="m">${esc(s.form)} · ${esc(phase)}${recs}${upd ? ' · updated ' + new Date(upd).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : ''}${extra ? ' · ' + extra : ''}</span></div>`;
}
const exTabs = () => [['assess', 'Assessments'], ['pupils', 'Pupil records'], ['samp', 'Sampling'], ['teach', 'Teachers'], ['school', 'School baseline'], ['linked', 'Linked']];
async function loadExplore(tab) {
  S.exTab = tab; S.exErr = null;
  render();
  const hq = S.who.role === 'hq';
  try {
    if ((tab === 'teach' || tab === 'school') && !S.tch) { S.tch = await api('/api/teachers'); render(); }
    if (tab === 'linked' && !S.linked) { S.linked = await api('/api/linked' + (S.year ? '?year=' + S.year : '')); if (!S.tch) S.tch = await api('/api/teachers'); render(); }
  } catch (e) { S.exErr = e.message; render(); }
}
function viewExplore() {
  const o = S.ov; if (!o || o.status === 'waiting') return waiting();
  const hq = S.who.role === 'hq';
  const tab = S.exTab || 'assess';
  const bar = `<div class="tabs2" id="extabs">${exTabs().map(([k, t]) => `<button class="${'x-' + k}" aria-selected="${k === tab}" data-ex="${k}"><i class="dot ${SRC[k].cls}"></i>${t}</button>`).join('')}</div>`;
  const rows = hq ? S.allSchools || [] : o.mine.schools;
  let body;
  if (hq && !S.allSchools && (tab === 'assess' || tab === 'samp')) body = '<div class="empty">Loading schools…</div>';
  else if (tab === 'assess') body = srcTag('assess') + `<div class="card">${schoolTable(rows, hq)}</div>`;
  else if (tab === 'pupils') body = srcTag('assess') + pupilsView();
  else if (tab === 'samp') body = srcTag('samp') + `<div class="card">${samplingTable(rows, hq)}</div>`;
  else if (tab === 'teach') body = S.exErr ? `<div class="banner bad">${esc(S.exErr)}</div>` : !S.tch ? '<div class="empty">Loading teacher data…</div>' : teachersView(hq);
  else if (tab === 'school') body = !S.tch ? '<div class="empty">Loading school baseline…</div>' : schoolBaselineView(hq);
  else body = !S.linked || !S.tch ? '<div class="empty">Linking the sources…</div>' : linkedView(hq);
  return `${dataBanner()}<div class="pagehead"><div><h2>Data explorer</h2><p>Four sources, kept apart, plus the links between them. The colour tag on each table says where the numbers come from.</p></div></div>${bar}${body}`;
}

function samplingTable(rows, hq) {
  const cols = [
    { k: 'name', label: 'School', val: (s) => s.name, search: (s) => s.name + ' ' + s.id, html: (s) => `<b>${lk('school', s.id, s.name)}</b>` },
    ...(hq ? [{ k: 'region', label: 'Region', val: (s) => s.region, search: (s) => s.region, html: (s) => lk('region', s.region, title(s.region)) }] : []),
    { k: 'lga', label: 'LGA', small: true, val: (s) => s.lga, search: (s) => s.lga, html: (s) => esc(title(s.lga)) },
    ...[1, 2, 3].map((g) => ({ k: 'a' + g, label: 'Present Gr ' + g, cls: 'r', val: (s) => s.g[g].att, html: (s) => `<span class="num">${s.g[g].att ?? '–'}</span>` })),
    ...[1, 2, 3].map((g) => ({ k: 't' + g, label: 'Tested vs sample Gr ' + g, cls: 'r', small: g > 1, val: (s) => pc(s.g[g].av, s.g[g].target), html: (s) => (s.g[g].att == null && s.g[g].n ? chip('no sampling', 'bad') : chip(`${s.g[g].av}/${s.g[g].target}`, s.g[g].done ? 'good' : s.g[g].av ? 'warn' : 'mute')) })),
    { k: 'sampled', label: 'Sampled', val: (s) => (s.g[1].att != null) + (s.g[2].att != null) + (s.g[3].att != null), html: (s) => { const n = (s.g[1].att != null) + (s.g[2].att != null) + (s.g[3].att != null); return chip(n + ' of 3', n === 3 ? 'good' : n ? 'warn' : 'mute'); } },
  ];
  const filters = [
    ...(hq ? [{ k: 'region', label: 'Region', get: (s) => s.region, options: (r) => [...new Set(r.map((s) => s.region))].sort().map((x) => [x, title(x)]) }] : [{ k: 'mine', label: 'Mine', get: (s) => ((s.admins || []).includes(S.who.name) ? 'mine' : 'other'), options: () => [['mine', 'Schools I worked in']] }]),
    { k: 'smp', label: 'Sampling', get: (s) => ((s.g[1].att != null) + (s.g[2].att != null) + (s.g[3].att != null)) === 3 ? 'all' : ((s.g[1].att != null) + (s.g[2].att != null) + (s.g[3].att != null)) ? 'part' : 'none', options: () => [['all', 'All 3 grades'], ['part', 'Some grades'], ['none', 'Not sampled']] },
  ];
  return dataTable(hq ? 'samp-hq' : 'samp', cols, rows, { filters, sort: 'name', dir: 1, open: (s) => 'school:' + s.id, placeholder: 'Search a school', limit: 400 });
}

const pctOf = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '–');
function teachersView(hq) {
  const T = S.tch, R = T.regions;
  const sum = (k) => R.reduce((a, r) => a + (r[k] || 0), 0);
  const withF = sum('with_forms'), exp = sum('expected');
  const gap = (r, g, d) => r.gaps[d + g];
  const regRows = R.map((r) => `<tr class="click" data-open="region:${esc(r.region)}"><td><b>${esc(title(r.region))}</b></td><td class="r num">${r.with_forms}/${r.expected}</td><td class="r num">${fmt(r.teachers)}</td><td class="r num">${r.head}</td><td class="r num">${r.subj}</td><td class="r num">${pctOf(r.female, r.male + r.female)}</td><td class="r num">${pctOf(r.smart, r.teachers)}</td><td class="r num">${r.replaced}</td><td class="r">${chip(r.gaps.r1 + r.gaps.a1 + r.gaps.r2 + r.gaps.a2 + r.gaps.r3 + r.gaps.a3, (r.gaps.r1 + r.gaps.a1 + r.gaps.r2 + r.gaps.a2 + r.gaps.r3 + r.gaps.a3) ? 'warn' : 'good')}</td></tr>`).join('');
  const cols = [
    { k: 'name', label: 'School', val: (s) => s.name, search: (s) => s.name + ' ' + s.id, html: (s) => `<b>${lk('school', s.id, s.name)}</b>` },
    ...(hq ? [{ k: 'region', label: 'Region', val: (s) => s.region, search: (s) => s.region, html: (s) => lk('region', s.region, title(s.region)) }] : []),
    { k: 'n', label: 'Teachers', cls: 'r', val: (s) => s.t?.n ?? -1, html: (s) => (s.t ? `<span class="num">${s.t.n}</span>` : chip('no form', 'bad')) },
    { k: 'head', label: 'Head / Subject', cls: 'r', small: true, val: (s) => s.t?.head ?? -1, html: (s) => (s.t ? `<span class="num">${s.t.head} / ${s.t.subj}</span>` : '–') },
    { k: 'sex', label: 'Women', cls: 'r', small: true, val: (s) => (s.t ? s.t.female / Math.max(1, s.t.male + s.t.female) : -1), html: (s) => (s.t ? pctOf(s.t.female, s.t.male + s.t.female) : '–') },
    ...[1, 2, 3].flatMap((g) => [['r', 'Read'], ['a', 'Math']].map(([d, l]) => ({ k: `g${g}${d}`, label: `Gr ${g} ${l}`, cls: 'r', small: g > 1 || d === 'a', val: (s) => s.t?.teach[g][d] ?? -1, html: (s) => (s.t ? chip(s.t.teach[g][d], s.t.teach[g][d] ? 'good' : 'bad') : '–') }))),
    { k: 'smart', label: 'Smartphone', cls: 'r', small: true, val: (s) => (s.t ? s.t.smart / Math.max(1, s.t.n) : -1), html: (s) => (s.t ? pctOf(s.t.smart, s.t.n) : '–') },
    { k: 'rep', label: 'Replaced', cls: 'r', small: true, val: (s) => s.t?.replaced ?? -1, html: (s) => (s.t ? `<span class="num">${s.t.replaced}</span>` : '–') },
  ];
  const filters = [
    ...(hq ? [{ k: 'region', label: 'Region', get: (s) => s.region, options: (r) => [...new Set(r.map((s) => s.region))].sort().map((x) => [x, title(x)]) }] : []),
    { k: 'has', label: 'Teacher form', get: (s) => (s.t ? 'yes' : 'no'), options: () => [['yes', 'Has teacher forms'], ['no', 'No teacher form yet']] },
    { k: 'gap', label: 'Coverage', get: (s) => (s.t && [1, 2, 3].every((g) => s.t.teach[g].r && s.t.teach[g].a) ? 'full' : s.t ? 'gap' : 'none'), options: () => [['full', 'Every grade and subject covered'], ['gap', 'A grade or subject has no teacher'], ['none', 'No form']] },
  ];
  return `${srcTag('teach')}
  <div class="grid kpis">${kpi('Schools with teacher forms', `${withF}<small> / ${exp}</small>`, 'treatment and pilot schools')}${kpi('Teacher records', fmt(sum('teachers')), sum('head') + ' head · ' + sum('subj') + ' subject teachers')}${kpi('Women', pctOf(sum('female'), sum('male') + sum('female')), 'of teachers with a recorded gender')}${kpi('Own a smartphone', pctOf(sum('smart'), sum('teachers')))}${kpi('Replacement teachers', fmt(sum('replaced')), 'recorded in place of the listed teacher')}</div>
  <div class="card" style="margin-top:14px"><h3>By region</h3><div class="sub">"Gaps" counts school, grade and subject combinations with no teacher recorded (reading or arithmetic, grades 1 to 3).</div><div class="tbl"><table><thead><tr><th>Region</th><th class="r">Schools</th><th class="r">Teachers</th><th class="r">Head</th><th class="r">Subject</th><th class="r">Women</th><th class="r">Smartphone</th><th class="r">Replaced</th><th class="r">Gaps</th></tr></thead><tbody>${regRows}</tbody></table></div></div>
  <div class="card" style="margin-top:14px"><h3>By school</h3><div class="sub">Teachers recorded as teaching reading (Read) and arithmetic (Math) in each grade. Red means nobody is recorded. Names, phone numbers and bank details are never brought into the dashboard.</div>${dataTable(hq ? 'tch-hq' : 'tch', cols, T.schools, { filters, sort: 'name', dir: 1, open: (s) => 'school:' + s.id, placeholder: 'Search a school', limit: 400 })}</div>`;
}

function schoolBaselineView(hq) {
  const T = S.tch, R = T.regions;
  const E = (g, k) => R.reduce((a, r) => a + (r.enrol[g][k] || 0), 0);
  const w = (c) => R.reduce((a, r) => a + (r.weo[c] || 0), 0);
  const wTot = w(1) + w(2) + w(3);
  const regRows = R.map((r) => `<tr class="click" data-open="region:${esc(r.region)}"><td><b>${esc(title(r.region))}</b></td>${[1, 2, 3].map((g) => `<td class="r num">${fmt(r.enrol[g][2])}</td>`).join('')}<td class="r num">${pctOf(r.enrol[1][0] + r.enrol[2][0] + r.enrol[3][0], r.enrol[1][2] + r.enrol[2][2] + r.enrol[3][2])}</td><td class="r num">${r.nsch_nt ? (r.nt / r.nsch_nt).toFixed(1) : '–'}</td><td class="r num">${r.nsch_nt ? (r.nkf / r.nsch_nt).toFixed(1) : '–'}</td><td class="r num">${pctOf(r.weo[1] || 0, (r.weo[1] || 0) + (r.weo[2] || 0) + (r.weo[3] || 0))}</td></tr>`).join('');
  const cols = [
    { k: 'name', label: 'School', val: (s) => s.name, search: (s) => s.name + ' ' + s.id, html: (s) => `<b>${lk('school', s.id, s.name)}</b>` },
    ...(hq ? [{ k: 'region', label: 'Region', val: (s) => s.region, search: (s) => s.region, html: (s) => lk('region', s.region, title(s.region)) }] : []),
    { k: 'lga', label: 'LGA', small: true, val: (s) => s.lga, search: (s) => s.lga, html: (s) => esc(title(s.lga)) },
    ...[1, 2, 3].map((g) => ({ k: 'e' + g, label: 'Enrolled Gr ' + g, cls: 'r', small: g > 1, val: (s) => s.t?.enrol?.[g]?.[2] ?? -1, html: (s) => (s.t?.enrol?.[g] ? `<span class="num">${s.t.enrol[g][2]}</span> <span class="m">(${s.t.enrol[g][0]}G/${s.t.enrol[g][1]}B)</span>` : '–') })),
    { k: 'nt', label: 'Teachers', cls: 'r', small: true, val: (s) => s.t?.nt ?? -1, html: (s) => `<span class="num">${s.t?.nt ?? '–'}</span>` },
    { k: 'nkf', label: 'KiuFunza teachers', cls: 'r', small: true, val: (s) => s.t?.nkf ?? -1, html: (s) => `<span class="num">${s.t?.nkf ?? '–'}</span>` },
    { k: 'weo', label: 'Ward officer', small: true, val: (s) => s.t?.weo || '', html: (s) => (s.t?.weo === '1' ? chip('took part', 'good') : s.t?.weo === '3' ? chip('representative', 'warn') : s.t?.weo === '2' ? chip('did not', 'bad') : chip('–', 'mute')) },
  ];
  const filters = [
    ...(hq ? [{ k: 'region', label: 'Region', get: (s) => s.region, options: (r) => [...new Set(r.map((s) => s.region))].sort().map((x) => [x, title(x)]) }] : []),
    { k: 'weo', label: 'Ward officer', get: (s) => s.t?.weo || '', options: () => [['1', 'Took part'], ['3', 'Sent a representative'], ['2', 'Did not take part']] },
  ];
  return `${srcTag('school')}
  <div class="grid kpis">${kpi('Pupils enrolled, Grade 1', fmt(E(1, 2)), fmt(E(1, 0)) + ' girls · ' + fmt(E(1, 1)) + ' boys')}${kpi('Grade 2', fmt(E(2, 2)), fmt(E(2, 0)) + ' girls · ' + fmt(E(2, 1)) + ' boys')}${kpi('Grade 3', fmt(E(3, 2)), fmt(E(3, 0)) + ' girls · ' + fmt(E(3, 1)) + ' boys')}${kpi('Ward officer took part', pctOf(w(1), wTot), pctOf(w(3), wTot) + ' sent a representative')}</div>
  <div class="card" style="margin-top:14px"><h3>By region</h3><div class="sub">Enrolment in grades 1 to 3 as counted at the baseline visit. Teachers are the average per school.</div><div class="tbl"><table><thead><tr><th>Region</th><th class="r">Gr 1</th><th class="r">Gr 2</th><th class="r">Gr 3</th><th class="r">Girls</th><th class="r">Teachers</th><th class="r">KiuFunza</th><th class="r">Ward officer</th></tr></thead><tbody>${regRows}</tbody></table></div></div>
  <div class="card" style="margin-top:14px"><h3>By school</h3><div class="sub">G = girls, B = boys.</div>${dataTable(hq ? 'sb-hq' : 'sb', cols, T.schools.filter((s) => s.t), { filters, sort: 'name', dir: 1, open: (s) => 'school:' + s.id, placeholder: 'Search a school', limit: 400 })}</div>`;
}

function linkedView(hq) {
  const L = S.linked, T = S.tch;
  const covRows = L.coverage.map((c) => `<tr class="click" data-open="region:${esc(c.region)}"><td><b>${esc(title(c.region))}</b></td><td class="r num">${c.with_teacher}/${c.expected_teacher}</td><td class="r num">${c.assessed}</td><td class="r">${chip(c.assessed_no_teacher, c.assessed_no_teacher ? 'warn' : 'good')}</td><td class="r">${chip(c.teacher_not_assessed, 'mute')}</td></tr>`).join('');
  const attCols = [
    { k: 'name', label: 'School', val: (a) => a.name, search: (a) => a.name, html: (a) => `<b>${lk('school', a.school, a.name)}</b>` },
    ...(hq ? [{ k: 'region', label: 'Region', val: (a) => a.region, search: (a) => a.region, html: (a) => lk('region', a.region, title(a.region)) }] : []),
    { k: 'grade', label: 'Grade', cls: 'r', val: (a) => a.grade, html: (a) => a.grade },
    { k: 'enrolled', label: 'Enrolled (baseline)', cls: 'r', val: (a) => a.enrolled, html: (a) => `<span class="num">${a.enrolled}</span>` },
    { k: 'attended', label: 'Present on test day', cls: 'r', val: (a) => a.attended, html: (a) => `<span class="num">${a.attended}</span>` },
    { k: 'rate', label: 'Attendance', cls: 'r', val: (a) => a.rate, html: (a) => chip(a.rate + '%', a.rate > 100 ? 'bad' : a.rate < 30 ? 'bad' : a.rate < 55 ? 'warn' : 'good') },
  ];
  const attFilters = [{ k: 'band', label: 'Attendance', get: (a) => (a.rate > 100 ? 'over' : a.rate < 30 ? 'low' : a.rate < 55 ? 'mid' : 'ok'), options: () => [['over', 'Above 100% (check the numbers)'], ['low', 'Below 30%'], ['mid', '30 to 54%'], ['ok', '55% and above']] }];
  const resCols = [
    { k: 'name', label: 'School', val: (a) => a.name, search: (a) => a.name, html: (a) => `<b>${lk('school', a.school, a.name)}</b>` },
    { k: 'region', label: 'Region', val: (a) => a.region, search: (a) => a.region, html: (a) => lk('region', a.region, title(a.region)) },
    { k: 'grade', label: 'Grade', cls: 'r', val: (a) => a.grade, html: (a) => a.grade },
    { k: 'subject', label: 'Subject', val: (a) => a.subject, html: (a) => esc(a.subject) },
    { k: 'teachers', label: 'Teachers recorded', cls: 'r', val: (a) => a.teachers ?? -1, html: (a) => (a.teachers == null ? chip('no form', 'mute') : chip(a.teachers, a.teachers ? 'good' : 'bad')) },
    { k: 'tested', label: 'Pupils tested', cls: 'r', val: (a) => a.tested, html: (a) => `<span class="num">${a.tested}</span>` },
    { k: 'pass', label: 'Skills passed', cls: 'r', val: (a) => a.pass_rate ?? -1, html: (a) => (a.pass_rate == null ? '–' : chip(a.pass_rate + '%', a.pass_rate >= 60 ? 'good' : a.pass_rate >= 35 ? 'warn' : 'bad')) },
  ];
  const resFilters = [
    { k: 'region', label: 'Region', get: (a) => a.region, options: (r) => [...new Set(r.map((s) => s.region))].sort().map((x) => [x, title(x)]) },
    { k: 'grade', label: 'Grade', get: (a) => String(a.grade), options: () => [['1', 'Grade 1'], ['2', 'Grade 2'], ['3', 'Grade 3']] },
    { k: 'subject', label: 'Subject', get: (a) => a.subject, options: () => [['Reading', 'Reading'], ['Arithmetic', 'Arithmetic']] },
    { k: 'tz', label: 'Teacher', get: (a) => (a.teachers === 0 ? 'none' : 'some'), options: () => [['none', 'No teacher recorded'], ['some', 'Has teacher(s)']] },
  ];
  return `${srcTag('linked')}
  <div class="card"><h3>1. Coverage: teacher forms and assessments</h3><div class="sub">Joined on the school code. "Assessed without teacher form" means tests exist but the school has no teacher record, which matters when teachers are paid on results.</div><div class="tbl"><table><thead><tr><th>Region</th><th class="r">Teacher forms</th><th class="r">Schools assessed</th><th class="r">Assessed, no teacher form</th><th class="r">Teacher form, not yet assessed</th></tr></thead><tbody>${covRows}</tbody></table></div></div>
  <div class="card" style="margin-top:14px"><h3>2. Pupils enrolled at baseline against pupils present on test day</h3><div class="sub">Enrolment from the baseline visit, attendance from the sampling form. Above 100% or very low rates are worth a second look.</div>${dataTable(hq ? 'att-hq' : 'att', attCols, L.attendance, { filters: attFilters, sort: 'rate', dir: -1, placeholder: 'Search a school', limit: 300 })}</div>
  ${hq && L.results ? `<div class="card" style="margin-top:14px;border-left:4px solid var(--terra)"><h3>3. Results by grade and subject, with the teachers recorded <span class="chip c-gold">HQ only</span></h3><div class="sub">Share of skills passed by the pupils tested, next to how many teachers are recorded for that grade and subject. This view is for HQ only. It shows where results and staffing line up or do not. It is not a payment calculation: payments will be added once the payment rules are set up here.</div>${dataTable('res-hq', resCols, L.results, { filters: resFilters, sort: 'pass', dir: 1, placeholder: 'Search a school', limit: 300 })}</div>` : '<div class="note" style="margin-top:14px">Results by grade and subject are shown to HQ only.</div>'}`;
}

// ---------- Queries (all) ----------
function infoBlock(school) {
  const items = (S.info || []).filter((x) => !school || x.school === school); if (!items.length) return '';
  return `<details class="fd" style="margin:10px 0"><summary>For information, no action needed (${items.length})</summary><div class="m" style="margin:6px 0">Helpers, grade differences and planned people with no records. The tests stay credited to whoever sent them.</div>${items.map((x) => `<div class="hrow">${lk('school', x.school, schoolNameOf(x.school))} · ${shortDate(x.date)} · ${esc(x.text)}</div>`).join('')}</details>`;
}
function viewAllQueries() {
  const hq = S.who.role === 'hq';
  const all = flagsAll();
  const F = (S.qf ||= (() => { try { return { q: '', type: '', sev: '', region: '', st: 'open', ...JSON.parse(store.get(memKey('qf')) || '{}'), q: '' }; } catch { return { q: '', type: '', sev: '', region: '', st: 'open' }; } })());
  const needsMe = (f) => { const a = qAbility(f); return a.respond || a.review; }; const inReview = (f) => ['team', 'hq1', 'final'].includes(wfOf(f).stage);
  const list = all.filter((f) => (F.st === 'all' || (F.st === 'resolved' ? !isOpen(f) : F.st === 'mine' ? isOpen(f) && needsMe(f) : F.st === 'review' ? isOpen(f) && inReview(f) : isOpen(f))) && (!F.type || f.type === F.type) && (!F.sev || f.sev === F.sev) && (!F.region || f.region === F.region) && (!F.q || [f.school_name, f.school, f.admin, f.lga, f.ward, f.text].join(' ').toLowerCase().includes(F.q.toLowerCase())));
  const types = [...new Set(all.map((f) => f.type))];
  const sel = (key, label, opts) => `<select data-qf="${key}" aria-label="${label}"><option value="">${label}: all</option>${opts.map(([v, t]) => `<option value="${esc(v)}" ${F[key] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  return `${dataBanner()}${infoBlock()}<div class="pagehead"><div><h2>Queries</h2><p>Automatic checks on submitted tests. Open a query for the exact region, school, pupils and times so the person involved can find the records.</p></div></div><div class="card"><div class="toolbar"><input data-qf="q" type="search" placeholder="Search school, person, LGA" value="${esc(F.q)}">${sel('type', 'Check', types.map((t) => [t, FLAG_LABEL[t] || t]))}${sel('sev', 'Severity', [['bad', 'Serious'], ['warn', 'Review']])}${hq ? sel('region', 'Region', S.cfg.regions.map((r) => [r, title(r)])) : ''}<select data-qf="st"><option value="open" ${F.st === 'open' ? 'selected' : ''}>Open</option><option value="mine" ${F.st === 'mine' ? 'selected' : ''}>I review or respond</option><option value="review" ${F.st === 'review' ? 'selected' : ''}>In review</option><option value="resolved" ${F.st === 'resolved' ? 'selected' : ''}>Approved and closed</option><option value="all" ${F.st === 'all' ? 'selected' : ''}>All</option></select><span class="count">${list.length} shown</span></div>${flagListFull(list, 60)}</div>`;
}
function flagListFull(list, limit) {
  const open = list.filter(() => true);
  if (!open.length) return '<div class="empty">No queries match.</div>';
  return flagList(open.map((f) => ({ ...f, q: f.q && f.q.status === 'resolved' ? { ...f.q, status: 'open' } : f.q })), { limit });
}

// ---------- Phones: what each phone did during the day ----------
const SCHOOL_COLORS = ['#5EA6B8', '#FFC650', '#BE6243', '#354062', '#7E8CD0', '#6FAE7C', '#C97CA6', '#8C8C8C'];
async function loadPhones() {
  S.phErr = null;
  try { S.ph = await api(`/api/phones?x=1${S.phDate ? '&date=' + S.phDate : ''}${S.phRegion ? '&region=' + S.phRegion : ''}${S.year ? '&year=' + S.year : ''}`); if (S.ph.date) S.phDate = S.ph.date; } catch (e) { S.phErr = e.message; }
}
function timelineChart(P) {
  const ev = P.events; if (!ev.length) return '<div class="empty">No phone activity in this view.</div>';
  const rows = [...new Set(ev.map((e) => e.c))].sort((x, y) => Math.min(...ev.filter((e) => e.c === x).map((e) => e.s)) - Math.min(...ev.filter((e) => e.c === y).map((e) => e.s)));
  const t0 = Math.floor((Math.min(...ev.map((e) => e.s)) - 900) / 1800) * 1800, t1 = Math.ceil((Math.max(...ev.map((e) => e.e)) + 900) / 1800) * 1800;
  const W = 1000, LX = 150, RH = 26, H = rows.length * RH + 36, X = (t) => LX + ((t - t0) / (t1 - t0)) * (W - LX - 10);
  const schools = [...new Set(ev.map((e) => e.sc))]; const col = (sc) => SCHOOL_COLORS[schools.indexOf(sc) % SCHOOL_COLORS.length];
  const gcol = { 1: 'var(--teal)', 2: 'var(--gold)', 3: 'var(--terra)' };
  const hm = (t) => `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`;
  let g = '';
  for (let t = t0; t <= t1; t += 1800) g += `<line class="gl" x1="${X(t)}" x2="${X(t)}" y1="14" y2="${H - 18}"/><text x="${X(t)}" y="${H - 4}" text-anchor="middle">${hm(t)}</text>`;
  rows.forEach((c, i) => {
    const list = ev.filter((e) => e.c === c).sort((a, b) => a.s - b.s); const y = 18 + i * RH;
    const names = [...new Set(list.map((e) => e.w))].map((n) => (n || '').split(' ')[0]).join(', ');
    g += `<text x="4" y="${y + 13}" style="font-weight:700">${esc(c)}</text><text x="4" y="${y + 24}" style="font-size:9px">${esc(names.slice(0, 22))}</text>`;
    list.forEach((e, k) => {
      const sch = (SCHOOL_BY_ID_UI[e.sc] || e.sc);
      g += `<rect x="${X(e.s)}" y="${y + 3}" width="${Math.max(2, X(e.e) - X(e.s))}" height="${RH - 8}" rx="2" fill="${gcol[e.g] || 'var(--teal)'}" fill-opacity=".78" stroke="${col(e.sc)}" stroke-width="2.5" ${e.k === 's' ? 'stroke-dasharray="3 2"' : ''}><title>${hm(e.s)}-${hm(e.e)} · Grade ${e.g} · ${esc(sch)} · ${esc(e.w)} · ${e.k === 's' ? 'sampling' : 'test'}</title></rect>`;
      const nx = list[k + 1];
      if (nx && nx.sc !== e.sc && nx.s - e.e < 1800) g += `<line x1="${X(e.e)}" x2="${X(nx.s)}" y1="${y + RH / 2}" y2="${y + RH / 2}" stroke="var(--bad)" stroke-width="2.5"/><text x="${(X(e.e) + X(nx.s)) / 2}" y="${y + 2}" text-anchor="middle" style="fill:var(--bad);font-size:9px;font-weight:700">${Math.max(0, Math.round((nx.s - e.e) / 60))} min</text>`;
    });
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Phone timeline">${g}</svg>
  <div class="legend"><span><i style="background:var(--teal)"></i>Grade 1</span><span><i style="background:var(--gold)"></i>Grade 2</span><span><i style="background:var(--terra)"></i>Grade 3</span><span>Border colour = school: ${schools.map((sc) => `<i style="background:${col(sc)};display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 8px"></i>${esc(SCHOOL_BY_ID_UI[sc] || sc)}`).join('')}</span><span>Dashed = sampling form</span><span style="color:var(--bad)"><b>Red line</b> = same phone at a different school within 30 minutes</span></div>`;
}
const SCHOOL_BY_ID_UI = new Proxy({}, { get: (_, id) => (S.ph?.schools || []).find((s) => s.id === id)?.name || schoolNameOf(String(id)) });
function viewPhones() {
  if (S.phErr) return `<div class="banner bad">${esc(S.phErr)}</div>`;
  const P = S.ph; if (!P) return '<div class="empty">Loading phone activity…</div>';
  if (P.status === 'none') return `<div class="pagehead"><div><h2>Phones</h2><p>${esc(P.note)}</p></div></div>`;
  const hq = S.who.role === 'hq';
  const dev = P.flags;
  const sel = `<div class="sel"><select id="phDate" aria-label="Day">${P.dates.slice().reverse().map((d) => `<option value="${d}" ${d === P.date ? 'selected' : ''}>${dayName(d)}</option>`).join('')}</select>${hq ? `<select id="phRegion" aria-label="Region"><option value="">All regions</option>${S.cfg.regions.map((r) => `<option value="${r}" ${r === (S.phRegion || '') ? 'selected' : ''}>${title(r)}</option>`).join('')}</select>` : `<span class="pill mute">${esc(title(S.who.region))}</span>`}</div>`;
  const maxPer = Math.max(0, ...P.schools.map((s) => s.phones));
  const prows = P.phones.slice().sort((a, b) => a.first - b.first).map((p) => { const hm = (t) => `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`; const nflags = dev.filter((f) => (f.text || '').includes(p.c)).length; return `<tr class="click" data-open="phone:${esc(p.c)}"><td class="num"><b>${esc(p.c)}</b>${p.names.includes(S.who.name) ? ' ' + chip('You', 'gold') : ''}</td><td>${p.names.map((n) => lk('person', n, n)).join(', ') || '–'}</td><td>${p.schools.map((s) => lk('school', s.id, s.name)).join(', ')}</td><td class="r num">${p.n}</td><td class="num">${hm(p.first)}–${hm(p.last)}</td><td class="r">${nflags ? chip(nflags + ' flag' + (nflags > 1 ? 's' : ''), 'warn') : chip('clear', 'good')}</td></tr>`; }).join('');
  return `<div class="pagehead"><div><h2>Phones</h2><p>What each phone did on the day. Shown to the whole team so the work is open and fair. A flag means "look at this", not "this is wrong". Open <b>What does this mean?</b> under any check for a plain explanation.</p></div>${sel}</div>
  <div class="grid kpis">${kpi('Phones active', P.phones.length)}${kpi('Schools with tests', P.schools.length, 'on this day')}${kpi('Most phones at one school', maxPer)}${kpi('Phone checks to look at', dev.length, dev.filter((f) => f.sev === 'bad').length + ' serious')}</div>
  <div class="card" style="margin-top:14px"><h3>Timeline</h3><div class="sub">One row per phone. Each bar is a test or sampling record. A phone should do one thing at a time, in one school, and one person normally uses one phone.</div>${timelineChart(P)}</div>
  <div class="card" style="margin-top:14px"><h3>Checks on phone behaviour</h3><div class="sub">We look at phones because each phone should belong to one person, test one pupil at a time, and stay with its team. These checks never mean someone did wrong; they ask for a short explanation so the data can be trusted. Looking for: tests overlapping on one phone, a phone at two schools within 30 minutes, a phone jumping back and forth between grades, names changing on one phone, one person on several phones, fewer phones than people.</div>${dev.length ? flagList(dev, { limit: 30 }) : '<div class="empty">Nothing to look at for this day.</div>'}</div>
  <div class="card" style="margin-top:14px"><h3>Phones and people</h3><div class="tbl"><table><thead><tr><th>Phone</th><th>Names used</th><th>Schools</th><th class="r">Records</th><th>Active</th><th class="r">Checks</th></tr></thead><tbody>${prows}</tbody></table></div></div>`;
}


// ---------- Practice: training schools, open to everyone, never counted in the real numbers ----------
async function loadPractice() {
  S.prErr = null;
  try {
    S.pr = await api('/api/practice');
    S.prPh = null;
    if (S.pr.status === 'ok') { try { S.prPh = await api('/api/phones?year=practice' + (S.prDate ? '&date=' + S.prDate : '')); if (S.prPh.date) S.prDate = S.prPh.date; } catch {} }
  } catch (e) { S.prErr = e.message; }
}
function viewPractice() {
  if (S.prErr) return `<div class="banner bad">${esc(S.prErr)}</div>`;
  const P = S.pr; if (!P) return '<div class="empty">Loading…</div>';
  const banner = '<div class="banner warn"><b>PRACTICE AREA.</b> Everything here comes from the TRAINING region (TRAINING SCHOOL 1, 2 and 3). It is for role-play, training and testing the forms. It never counts in the real progress, forecasts, alerts or emails, and the calendar check is off for these schools. Anyone can use it, from any region.</div>';
  const head = `<div class="pagehead"><div><h2>Practice</h2><p>Submit a test or a sampling record for a TRAINING school and see it here within a few minutes.</p></div>${S.who.role === 'hq' ? '<button class="btn ghost" data-act="practiceClear">Clear practice data</button>' : ''}</div>`;
  if (P.status !== 'ok') return `${banner}${head}<div class="card"><div class="empty">${esc(P.note || 'No practice records yet.')}</div><div class="sub" style="margin-top:8px">${P.schools.map((x) => esc(x.name) + ' (' + esc(x.id) + ')').join(' · ')}</div></div>`;
  const gcell = (x, f) => [1, 2, 3].map((g) => { const v = x.g?.[g]?.[f]; return `<span class="num">${v == null ? '–' : v}</span>`; }).join(' · ');
  const srows = P.schools.map((x) => { const pd = x.people ? Math.max(0, ...Object.values(x.people).map((p) => p[1])) : 0; const nn = x.people ? Math.max(0, ...Object.values(x.people).map((p) => p[0])) : 0; return `<tr class="click" data-open="school:${esc(x.id)}"><td><b>${esc(x.name)}</b><div class="sub">${esc(x.id)}</div></td><td>${gcell(x, 'att')}</td><td>${[1, 2, 3].map((g) => { const G = x.g?.[g]; return `<span class="num">${G ? G.av : 0}${G && G.target ? '/' + G.target : ''}</span>`; }).join(' · ')}</td><td class="r num">${nn || '–'} · ${pd || '–'}</td></tr>`; }).join('');
  const nSamp = P.schools.reduce((a, x) => a + [1, 2, 3].filter((g) => x.g?.[g]?.att != null).length, 0);
  const ppl = (P.people || []).length ? `<div class="card" style="margin-top:14px"><h3>Everyone who took part, by name</h3><div class="sub">Test admins and whoever filled in a sampling form, with what each did and the phones they used. This is what each person looks like on the real dashboard.</div><div class="tbl dt-wrap"><table class="dt"><thead><tr><th>Name</th><th>Role</th><th class="r">Tested Gr 1 · 2 · 3</th><th class="r">Pupils</th><th>Sampling</th><th>Phones</th></tr></thead><tbody>${P.people.map((x) => `<tr class="click" ${x.position ? `data-open="person:${esc(x.name)}"` : ''}><td><b>${esc(x.name)}</b></td><td>${x.position ? esc(x.position) + (x.region ? ' · ' + esc(title(x.region)) : '') : '<span class="pill mute">not in the roster</span>'}</td><td class="r num">${x.tests[1]} · ${x.tests[2]} · ${x.tests[3]}</td><td class="r num">${x.tested}</td><td style="white-space:normal">${(x.sampling || []).length ? x.sampling.map(esc).join('<br>') : '–'}</td><td class="num">${(x.phones || []).map(esc).join(', ') || '–'}</td></tr>`).join('')}</tbody></table></div></div>` : '';
  const ph = S.prPh && S.prPh.events ? `<div class="card" style="margin-top:14px"><h3>Phones in practice</h3><div class="sub">One row per phone, each bar a record, so people can see how their own phone shows up on the dashboard.</div>${timelineChart(S.prPh)}</div>` : '';
  return `${banner}${head}<div class="grid kpis">${kpi('Sampling forms', fmt(nSamp), 'class lists drawn')}${kpi('Test records', fmt(P.records))}${kpi('Pupils tested', fmt(P.tested))}${kpi('Phones', P.devices || 0)}${kpi('Checks raised', (P.flags || []).length)}</div>
  <div class="card" style="margin-top:14px"><h3>Training schools</h3><div class="tbl"><table><thead><tr><th>School</th><th>Present (sampling) Gr 1 · 2 · 3</th><th>Tested Gr 1 · 2 · 3</th><th class="r">People · phones</th></tr></thead><tbody>${srows}</tbody></table></div></div>
  <div class="card" style="margin-top:14px"><h3>Checks raised on practice records</h3><div class="sub">Open one to see what a real query looks like, and reply to it to practise the process.</div>${flagList(P.flags || [], { limit: 30 })}</div>${ppl}${ph}`;
}


// ---------- Reports: build from live numbers, edit, download ----------
const REP_PARAMS = { period: ['from', 'to'] };
async function openReports() {
  try {
    const [t, l] = await Promise.all([api('/api/reports/templates'), api('/api/reports')]);
    const keep = S.rep || {}; S.rep = { ...keep, templates: t.templates, scope: t.scope, saved: l.reports, formats: keep.formats || { xlsx: true, docx: false, pdf: false, csv: false }, msg: keep.msg || '' };
  } catch (e) { S.rep = { error: e.message }; }
  render();
}
const repCanSave = () => !(S.who.role === 'hq' && hqLevel() === 'viewer');
function repSync() { // read what is typed on the screen into the state, before anything re-renders
  const g = (id) => document.getElementById(id); const R = S.rep; if (!R || !R.edit || !g('repTitle')) return;
  R.edit.title = g('repTitle').value; R.edit.headline = g('repHead').value; R.edit.notes = g('repNotes').value;
  const P = R.params || {}; for (const k of ['region', 'from', 'to', 'date']) { const el = g('rp_' + k); if (el) P[k] = el.value; }
}
async function repPick(id) {
  const R = S.rep; const t = R.templates.find((x) => x.id === id); if (!t) return;
  R.tpl = t; R.id = null; R.frozen = false; R.params = { region: R.scope || '' }; R.edit = { title: t.title, headline: '', notes: '', hidden: [], filter: '', sort: null }; R.msg = '';
  await repBuild();
}
async function repBuild() {
  const R = S.rep; R.busy = true; render();
  try { R.built = await api('/api/reports/preview', { method: 'POST', body: { template: R.tpl.id, params: R.params } }); R.frozen = false; if (!R.id) R.edit.title = R.tpl.title + (R.params.region ? ' · ' + title(R.params.region) : '') + (R.built.params?.date ? ' · ' + R.built.params.date : ''); } catch (e) { R.msg = e.message; }
  R.busy = false; render();
}
async function repOpenSaved(id) {
  const R = S.rep; try { const it = await api('/api/reports/item?id=' + encodeURIComponent(id)); R.tpl = R.templates.find((x) => x.id === it.template) || { id: it.template, title: it.title, desc: '', params: [] }; R.id = it.id; R.frozen = true; R.params = it.params || {}; R.built = { columns: it.snapshot.columns, rows: it.snapshot.rows, kpis: it.snapshot.kpis, generated_at: it.snapshot.generated_at, data_as_of: it.snapshot.data_as_of, params: it.params }; const hidden = it.columns ? it.snapshot.columns.map((c) => c.k).filter((k) => !it.columns.includes(k)) : []; R.edit = { title: it.title, headline: it.headline || '', notes: it.notes || '', hidden, filter: it.filter || '', sort: it.sort || null }; R.msg = 'Showing the saved copy from ' + eatTime(it.snapshot.generated_at) + '. Press "Update with today\'s numbers" for fresh figures.'; } catch (e) { R.msg = e.message; }
  render();
}
function repData() { // what the person sees, and exactly what the files contain
  const R = S.rep, B = R.built, E = R.edit; const hid = new Set(E.hidden || []);
  const columns = B.columns.filter((c) => !hid.has(c.k)); let rows = B.rows.slice(); const q = (E.filter || '').trim().toLowerCase();
  if (q) rows = rows.filter((r) => columns.some((c) => String(r[c.k] ?? '').toLowerCase().includes(q)));
  if (E.sort) { const { k, dir } = E.sort; rows.sort((a, b) => { const x = a[k], y = b[k]; if (x == null || x === '') return 1; if (y == null || y === '') return -1; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir; }); }
  const P = R.params || {}; const bits = [R.tpl.title, P.region ? title(P.region) : (R.scope ? title(R.scope) : 'All regions'), B.params?.date ? 'Day ' + B.params.date : '', P.from || P.to ? `${P.from || '…'} to ${P.to || '…'}` : ''].filter(Boolean);
  const b = S.cfg?.brand || {};
  return { title: E.title || R.tpl.title, subtitle: `${bits.join(' · ')} · Generated ${eatTime(B.generated_at)} by ${S.who.name} · Data as of ${eatTime(B.data_as_of)}${B.rehearsal ? ' (rehearsal data)' : ''}`, kpis: B.kpis, headline: E.headline, notes: E.notes, footer: `${b.platform || ''} · ${b.programme || ''}`, columns, rows };
}
function repTable() {
  const R = S.rep, E = R.edit; const d = repData(); const max = 150;
  const head = d.columns.map((c) => `<th class="${c.type === 'num' || c.type === 'pct' ? 'r' : ''}" data-rs="${esc(c.k)}" style="cursor:pointer" title="Sort">${esc(c.label)}${E.sort && E.sort.k === c.k ? (E.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  const body = d.rows.slice(0, max).map((r) => `<tr${r._sid ? ` class="click" data-open="school:${esc(r._sid)}"` : r._pn ? ` class="click" data-open="person:${esc(r._pn)}"` : ''}>${d.columns.map((c) => `<td class="${c.type === 'num' || c.type === 'pct' ? 'r num' : ''}">${esc(c.type === 'pct' && typeof r[c.k] === 'number' ? r[c.k] + '%' : r[c.k] ?? '')}</td>`).join('')}</tr>`).join('');
  return `<div class="tbl rectbl" style="max-height:480px"><table class="dt"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${d.columns.length}" class="empty">Nothing matches.</td></tr>`}</tbody></table></div><div class="m" style="margin-top:4px">${d.rows.length > max ? `Showing ${max} of ${d.rows.length} rows here. The downloaded files contain all ${d.rows.length}.` : `${d.rows.length} row${d.rows.length === 1 ? '' : 's'}.`}</div>`;
}
function viewReports() {
  const R = S.rep; if (!R) return '<div class="empty">Loading…</div>'; if (R.error) return `<div class="banner bad">${esc(R.error)}</div>`; if (!R.templates) return '<div class="empty">Loading…</div>';
  const tpls = R.templates.map((t) => `<button class="repbtn ${R.tpl && R.tpl.id === t.id ? 'on' : ''}" data-act="repPick" data-id="${t.id}"><b>${esc(t.title)}</b><span>${esc(t.desc)}</span></button>`).join('');
  const saved = (R.saved || []).map((x) => `<div class="repsaved ${R.id === x.id ? 'on' : ''}"><a href="#reports" data-act="repOpen" data-id="${esc(x.id)}"><b>${esc(x.title)}</b></a><span class="m">${esc(x.owner || '')} · ${eatTime(x.updated_at)} · ${x.rows} rows</span>${repCanSave() ? `<button class="btn sm ghost" data-act="repDelete" data-id="${esc(x.id)}">Delete</button>` : ''}</div>`).join('') || '<div class="m">No saved reports yet.</div>';
  const left = `<div><div class="card"><h3>Choose a report</h3><div class="sub">The numbers always come from the live data, so a report can never disagree with the dashboard.</div>${tpls}</div><div class="card" style="margin-top:14px"><h3>Saved reports</h3>${saved}</div></div>`;
  let right = '<div class="card"><div class="empty">Choose a report on the left.</div></div>';
  if (R.tpl && R.built) {
    const E = R.edit, P = R.params || {}, B = R.built; const hq = S.who.role === 'hq';
    const params = `<div class="f" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">${R.tpl.params.includes('region') ? (hq ? `<label>Region<select id="rp_region"><option value="">All regions</option>${S.cfg.regions.map((g) => `<option value="${g}" ${P.region === g ? 'selected' : ''}>${esc(title(g))}</option>`).join('')}</select></label>` : `<label>Region<input value="${esc(title(R.scope))}" disabled></label>`) : ''}${R.tpl.params.includes('period') ? `<label>From<input id="rp_from" type="date" value="${esc(P.from || '')}"></label><label>To<input id="rp_to" type="date" value="${esc(P.to || '')}"></label>` : ''}${R.tpl.params.includes('date') ? `<label>Day<input id="rp_date" type="date" value="${esc(P.date || B.params?.date || '')}"></label>` : ''}<button class="btn sm sec" data-act="repUpdate">${R.frozen ? "Update with today's numbers" : 'Update'}</button></div>`;
    const chips = B.columns.map((c) => `<label class="cchip ${(E.hidden || []).includes(c.k) ? '' : 'on'}"><input type="checkbox" data-rc="${esc(c.k)}" ${(E.hidden || []).includes(c.k) ? '' : 'checked'}> ${esc(c.label)}</label>`).join('');
    const fm = Object.entries(KFExport.FORMATS).map(([k, v]) => `<label class="cb"><input type="checkbox" data-rf="${k}" ${R.formats[k] ? 'checked' : ''}> ${esc(v[0])}</label>`).join('');
    right = `<div class="card"><h3>${esc(R.tpl.title)}</h3><div class="sub">${esc(R.tpl.desc)}${R.frozen ? ' <span class="pill warn">saved copy</span>' : ''}</div>
    <div class="f"><label style="grid-column:1/-1">Title<input id="repTitle" maxlength="120" value="${esc(E.title)}"></label></div>${params}
    ${B.rehearsal ? '<div class="banner" style="margin-top:8px">These are rehearsal numbers from an earlier year, until 2026 data arrives.</div>' : ''}
    <div class="grid kpis" style="margin-top:10px">${(B.kpis || []).map((k) => kpi(esc(k.label), esc(String(k.value)))).join('')}</div>
    <div class="f"><label style="grid-column:1/-1">Headline (your words, shown above the table)<textarea id="repHead" rows="2" maxlength="1500" placeholder="For example: Eight of ten regions are on plan; Singida and Kigoma need help.">${esc(E.headline)}</textarea></label><label style="grid-column:1/-1">Notes (shown under the table)<textarea id="repNotes" rows="3" maxlength="4000">${esc(E.notes)}</textarea></label></div>
    <details style="margin:8px 0"><summary><b>Columns</b> <span class="m">tick what to show</span></summary><div class="cchips">${chips}</div></details>
    <div class="recbar"><input id="repFilter" placeholder="Filter the rows (type any word)" value="${esc(E.filter || '')}" autocomplete="off"></div>
    <div id="repTable">${repTable()}</div>
    <div style="margin-top:12px;display:flex;gap:14px;flex-wrap:wrap;align-items:center"><b>Download</b> ${fm}<button class="btn sm" data-act="repDownload">Download</button>${repCanSave() ? '<button class="btn sm sec" data-act="repSave">Save report</button>' : ''}${hq && hqLevel() !== 'viewer' ? '<button class="btn sm ghost" data-act="repNews">Post the headline to News (draft)</button>' : ''}</div>
    <div class="m" style="margin-top:6px">Pick one or more formats. With more than one you get a single .zip file. Word and Excel open for editing offline.</div>${R.msg ? `<p class="m" style="margin-top:8px"><b>${esc(R.msg)}</b></p>` : ''}${R.busy ? '<div class="m">Working…</div>' : ''}</div>`;
  }
  return `<div class="pagehead"><div><h2>Reports</h2><p>Build a report from the live numbers, edit the title, columns and your own words, then download it as Excel, Word, PDF or CSV.${S.who.role === 'rc' ? ' You see your own region.' : ''}</p></div></div><div class="grid two repgrid">${left}${right}</div>`;
}
async function repAction(a, t) {
  const R = S.rep; if (a !== 'repOpen' && a !== 'repPick') repSync();
  if (a === 'repPick') { await repPick(t.dataset.id); return; }
  if (a === 'repOpen') { await repOpenSaved(t.dataset.id); return; }
  if (a === 'repUpdate') { await repBuild(); return; }
  if (a === 'repDelete') { if (confirm('Delete this saved report?')) { try { await api('/api/reports/delete', { method: 'POST', body: { id: t.dataset.id } }); if (R.id === t.dataset.id) { R.id = null; } R.saved = (await api('/api/reports')).reports; } catch (e) { R.msg = e.message; } render(); } return; }
  if (a === 'repSave') {
    const E = R.edit; try { const r = await api('/api/reports/save', { method: 'POST', body: { id: R.id, template: R.tpl.id, title: E.title, params: R.params, headline: E.headline, notes: E.notes, columns: R.built.columns.map((c) => c.k).filter((k) => !(E.hidden || []).includes(k)), filter: E.filter, sort: E.sort } }); R.id = r.id; R.frozen = false; R.msg = 'Saved. The saved copy keeps today\'s numbers.'; R.saved = (await api('/api/reports')).reports; } catch (e) { R.msg = e.message; }
    render(); return;
  }
  if (a === 'repDownload') {
    const fmts = Object.keys(R.formats).filter((k) => R.formats[k]); if (!fmts.length) { R.msg = 'Tick at least one format.'; render(); return; }
    try { const files = KFExport.make(repData(), fmts); for (const f of files) { const url = URL.createObjectURL(new Blob([f.data], { type: f.mime })); const link = document.createElement('a'); link.href = url; link.download = f.name; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); } R.msg = files.length ? 'Downloaded ' + files.map((f) => f.name).join(', ') + '.' : ''; } catch (e) { R.msg = 'Could not make the file: ' + e.message; }
    render(); return;
  }
  if (a === 'repNews') {
    const E = R.edit; if (!E.headline.trim()) { R.msg = 'Write a headline first.'; render(); return; }
    try { await api('/api/admin/news', { method: 'POST', body: { action: 'save', title: E.title, body: E.headline + (E.notes ? '\n\n' + E.notes : ''), kind: 'update', to: 'all' } }); R.msg = 'Saved as a draft in News. Open News to read it and send it.'; } catch (e) { R.msg = e.message; }
    render();
  }
}
// ---------- News and announcements ----------
const newsSeen = () => store.get('kf_news_seen') || '';
const unreadNews = () => (S.news?.items || []).filter((i) => i.sent_at > newsSeen());
async function loadNews() { try { S.news = await api('/api/news'); } catch { /* the tab shows what it has */ } updateNewsBadge(); }
function updateNewsBadge() {
  const b = document.querySelector('[data-tab="news"]'); if (!b) return;
  const n = S.tab === 'news' ? 0 : unreadNews().length;
  b.innerHTML = 'News' + (n ? ` <span class="nbadge">${n}</span>` : '');
}
async function openNews() {
  S.newsPrev = newsSeen();
  await loadNews();
  if (!S.viewAs && S.news?.items?.length) { try { await api('/api/news/seen', { method: 'POST', body: { ids: S.news.items.map((i) => i.id) } }); } catch {} }
  if (S.who.role === 'hq' && hqLevel() !== 'viewer') { try { S.newsAdmin = await api('/api/admin/news'); } catch (e) { S.nwMsg = e.message; } }
  const latest = S.news?.latest || ''; if (latest) store.set('kf_news_seen', latest);
}
const nl2br = (t) => esc(t).replace(/\n/g, '<br>');
const KIND_CLS = { announcement: 'navy', goodwill: 'gold', reminder: 'warn', congrats: 'good', update: 'teal' };
function reactBar(i, hq) {
  const em = S.news?.emoji || ['👍', '👏', '🎉', '❤️'];
  return `<div class="rxbar">${em.map((e) => { const n = (i.counts || {})[e] || 0; const who = hq && i.names && i.names[e] ? ` title="${esc(i.names[e].join(', '))}"` : ''; return `<button class="rx ${i.mine === e ? 'on' : ''}" data-act="react" data-id="${esc(i.id)}" data-e="${e}"${who}>${e}${n ? ' <b>' + n + '</b>' : ''}</button>`; }).join('')}</div>${(i.seen || []).length ? `<details class="fd rxwho"><summary>Seen by (${i.seen.length})</summary>${i.seen.map((x) => `<div class="hrow"><b>${esc(x.n)}</b> <span class="m">${esc([x.p, x.r && x.r !== 'HQ' ? title(x.r) : x.r].filter(Boolean).join(' · '))}${x.at ? ' · ' + fmtAt(x.at) : ''}</span></div>`).join('')}</details>` : ''}${i.unseen ? `<details class="fd rxwho"><summary>Not seen yet (${i.unseen.length} of ${i.audience})</summary>${i.unseen.length ? Object.entries(i.unseen.reduce((m, x) => { (m[x.r] ||= []).push(x); return m; }, {})).sort().map(([r, xs]) => `<div class="hrow"><b>${esc(title(r))}</b> <span class="m">${xs.length}</span><div class="m">${xs.map((x) => esc(x.n + (x.p === 'RC' || x.p === 'ARC' ? ' (' + x.p + ')' : ''))).join(', ')}</div></div>`).join('') : '<div class="hrow">Everyone has seen it.</div>'}</details>` : ''}${(i.reacted || []).length ? `<details class="fd rxwho"><summary>Who reacted (${i.reacted.length})</summary>${i.reacted.map((x) => `<div class="hrow"><span style="font-size:16px">${x.e}</span> <b>${esc(x.n)}</b> <span class="m">${esc([x.p, x.r && x.r !== 'HQ' ? title(x.r) : x.r].filter(Boolean).join(' · '))}${x.at ? ' · ' + fmtAt(x.at) : ''}</span></div>`).join('')}</details>` : ''}`;
}
function newsCard(i, hq) {
  const isNew = i.sent_at && i.sent_at > (S.newsPrev || '') && !hq;
  const status = hq && i.status !== 'sent' ? `<span class="pill ${i.status === 'scheduled' ? 'warn' : 'mute'}">${i.status === 'scheduled' ? 'scheduled ' + eatTime(i.publish_at) : 'draft'}</span>` : '';
  const aud = hq ? `<span class="m" style="font-size:12px">To: ${esc({ all: 'everyone', hq: 'HQ only', coordinators: 'RCs and ARCs', volunteers: 'volunteers' }[i.to] || i.to)}${i.regions?.length ? ' · ' + i.regions.map(title).join(', ') : ''}${i.push ? ' · phone alert' : ''}${i.auto ? ' · automatic' : ''}</span>` : '';
  const acts = hq ? `<div class="nacts">${i.status !== 'sent' ? `<button class="btn sm ghost" data-act="nwEdit" data-id="${esc(i.id)}">Edit</button><button class="btn sm" data-act="nwPublish" data-id="${esc(i.id)}">Send now</button>` : `<button class="btn sm ghost" data-act="nwPin" data-id="${esc(i.id)}" data-p="${i.pinned ? '' : '1'}">${i.pinned ? 'Unpin' : 'Pin'}</button>`}<button class="btn sm ghost" data-act="nwDelete" data-id="${esc(i.id)}">Delete</button></div>` : '';
  return `<div class="card newscard ${i.pinned ? 'pinned' : ''}"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${chip(esc(i.kind_label || ''), KIND_CLS[i.kind] || 'mute')}${isNew ? '<span class="pill warn">new</span>' : ''}${i.pinned ? '<span class="pill mute">pinned</span>' : ''}${status}<span class="m" style="margin-left:auto;font-size:12px">${i.sent_at ? eatTime(i.sent_at) : ''}</span></div><h3 style="margin:8px 0 4px">${esc(i.title)}</h3><div class="nbody">${nl2br(i.body)}</div>${aud}${i.status === 'sent' || !hq ? reactBar(i, hq) : ''}${acts}</div>`;
}
function composer() {
  const d = S.nwDraft || {}; const regs = S.cfg?.regions || [];
  return `<div class="card"><h3>Edit message</h3><div class="sub">Change this scheduled message or draft, then save it, schedule it or send it now. To write a new message, close this and use Write a message. <button class="btn sm ghost" data-act="nwClear">Close editor</button></div>
  <div class="f"><label>Title<input id="nwTitle" maxlength="120" value="${esc(d.title || '')}" placeholder="For example: Pilot day is tomorrow"></label></div>
  <div class="f"><label>Message<textarea id="nwBody" rows="6" maxlength="2000" placeholder="Write in English, Kiswahili or both. Keep it short.">${esc(d.body || '')}</textarea></label></div>
  <div class="f" style="display:flex;gap:10px;flex-wrap:wrap"><label>Type<select id="nwKind">${Object.entries({ announcement: 'Announcement', goodwill: 'Good wishes', reminder: 'Reminder', congrats: 'Congratulations', update: 'Update' }).map(([k, t]) => `<option value="${k}" ${d.kind === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
  <label>To<select id="nwTo">${[['all', 'Everyone'], ['coordinators', 'RCs and ARCs'], ['volunteers', 'Volunteers'], ['hq', 'HQ only']].map(([k, t]) => `<option value="${k}" ${(d.to || 'all') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
  <label>Region<select id="nwRegion"><option value="">All regions</option>${regs.map((r) => `<option value="${r}" ${d.regions && d.regions[0] === r ? 'selected' : ''}>${esc(title(r))}</option>`).join('')}</select></label>
  <label>Send later (East Africa time)<input type="datetime-local" id="nwWhen" value="${esc(d.when || '')}"></label></div>
  <div class="f" style="display:flex;gap:16px;flex-wrap:wrap"><label class="cb"><input type="checkbox" id="nwPush" ${d.push === false ? '' : 'checked'}> Phone alert</label><label class="cb"><input type="checkbox" id="nwPin" ${d.pinned ? 'checked' : ''}> Pin to the top</label><label class="cb"><input type="checkbox" id="nwSw" ${d.sw ? 'checked' : ''}> Polish with a Kiswahili version</label></div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn sec" data-act="nwPolish">Polish with AI</button><button class="btn sec" data-act="nwSave">Save draft</button><button class="btn" data-act="nwSend">Send now</button><button class="btn sec" data-act="nwSchedule">Schedule</button>${d.id ? '<button class="btn ghost" data-act="nwClear">Start a new one</button>' : ''}</div>${S.nwMsg ? `<p class="m" style="margin-top:8px">${esc(S.nwMsg)}</p>` : ''}</div>`;
}
function readComposer() {
  const g = (id) => document.getElementById(id); if (!g('nwTitle')) return S.nwDraft || {};
  const reg = g('nwRegion').value;
  return { id: S.nwDraft?.id, title: g('nwTitle').value, body: g('nwBody').value, kind: g('nwKind').value, to: g('nwTo').value, regions: reg ? [reg] : [], push: g('nwPush').checked, pinned: g('nwPin').checked, sw: g('nwSw').checked, when: g('nwWhen').value };
}
const eatIso = (v) => (v ? new Date(v.length === 16 ? v + ':00+03:00' : v).toISOString() : null);
function viewNews() {
  const hq = S.who.role === 'hq' && hqLevel() !== 'viewer'; const N = S.news;
  if (hq) {
    const A = S.newsAdmin; const all = A ? A.items : []; const view = S.nwView || 'read'; const waiting = all.filter((i) => i.status !== 'sent'); const sent = A ? all.filter((i) => i.status === 'sent') : N ? N.items : null;
    const bar = `<div class="sel" style="margin:6px 0 12px"><button class="btn sm ${view === 'read' ? '' : 'sec'}" data-act="nwView" data-v="read">Read</button><button class="btn sm ${view === 'manage' ? '' : 'sec'}" data-act="nwView" data-v="manage">Scheduled and drafts${waiting.length ? ' (' + waiting.length + ')' : ''}</button><button class="btn sm sec" data-tab="messages" style="margin-left:auto">Write a message</button></div>`;
    const head = `<div class="pagehead"><div><h2>News</h2><p>Messages from HQ to the team. People can react with a thumbs up, a clap, a party or a heart. To write a new message, use Write a message.</p></div></div>${bar}`;
    if (S.nwDraft) return `${head}${composer()}`;
    if (view === 'manage') return `${head}${waiting.length ? waiting.map((i) => newsCard(i, true)).join('') : '<div class="empty">No scheduled messages or drafts.</div>'}`;
    return `${head}${!sent ? '<div class="empty">Loading…</div>' : sent.length ? sent.map((i) => newsCard(i, false)).join('') : '<div class="empty">No news yet.</div>'}`;
  }
  const items = N ? N.items : null;
  return `<div class="pagehead"><div><h2>News</h2><p>Messages from HQ, good wishes and updates for the whole field team. Tap a reaction to say thank you.</p></div></div>${!items ? '<div class="empty">Loading…</div>' : items.length ? items.map((i) => newsCard(i, false)).join('') : '<div class="empty">No news yet. Messages from HQ will appear here.</div>'}`;
}
async function newsAction(a, t) {
  S.nwDraft = { ...(S.nwDraft || {}), ...readComposer() };
  const D = S.nwDraft; const body = { id: D.id, title: D.title, body: D.body, kind: D.kind, to: D.to, regions: D.regions, push: D.push, pinned: D.pinned };
  const refresh = async () => { S.newsAdmin = await api('/api/admin/news'); await loadNews(); };
  try {
    if (a === 'nwPolish') { S.nwMsg = 'Polishing…'; render(); const r = await api('/api/admin/news', { method: 'POST', body: { action: 'polish', title: D.title, body: D.body, kind: D.kind, add_swahili: D.sw } }); S.nwDraft = { ...D, title: r.title, body: r.body }; S.nwMsg = 'Polished. Read it carefully and change anything before you send.'; }
    else if (a === 'nwSave') { const r = await api('/api/admin/news', { method: 'POST', body: { action: 'save', ...body } }); S.nwDraft = { ...D, id: r.id }; S.nwMsg = 'Saved as a draft.'; await refresh(); }
    else if (a === 'nwSend') { if (!D.title || !D.body) { S.nwMsg = 'Write a title and a message first.'; } else if (confirm(`Send "${D.title}" now to ${{ all: 'everyone', coordinators: 'RCs and ARCs', volunteers: 'volunteers', hq: 'HQ only' }[D.to || 'all']}${D.regions?.length ? ' in ' + title(D.regions[0]) : ''}? It cannot be unsent.`)) { await api('/api/admin/news', { method: 'POST', body: { action: 'send', ...body } }); S.nwDraft = null; S.nwMsg = 'Sent.'; await refresh(); } }
    else if (a === 'nwSchedule') { if (!D.when) { S.nwMsg = 'Choose the date and time to send.'; } else { const r = await api('/api/admin/news', { method: 'POST', body: { action: 'save', ...body, publish_at: eatIso(D.when) } }); S.nwDraft = null; S.nwMsg = 'Scheduled for ' + eatTime(eatIso(D.when)) + '.'; await refresh(); } }
    else if (a === 'nwClear') { S.nwDraft = null; S.nwMsg = ''; }
    else if (a === 'nwEdit') { const i = (S.newsAdmin?.items || []).find((x) => x.id === t.dataset.id); if (i) { const w = i.publish_at ? new Date(Date.parse(i.publish_at) + 3 * 3600e3).toISOString().slice(0, 16) : ''; S.nwDraft = { id: i.id, title: i.title, body: i.body, kind: i.kind, to: i.to, regions: i.regions, push: i.push, pinned: i.pinned, when: w }; S.nwMsg = ''; window.scrollTo(0, 0); } }
    else if (a === 'nwPublish') { if (confirm('Send this message now?')) { await api('/api/admin/news', { method: 'POST', body: { action: 'publish', id: t.dataset.id } }); S.nwMsg = 'Sent.'; await refresh(); } }
    else if (a === 'nwDelete') { if (confirm('Delete this message?')) { await api('/api/admin/news', { method: 'POST', body: { action: 'delete', id: t.dataset.id } }); await refresh(); } }
    else if (a === 'nwPin') { await api('/api/admin/news', { method: 'POST', body: { action: 'pin', id: t.dataset.id, pinned: Boolean(t.dataset.p) } }); await refresh(); }
  } catch (e) { S.nwMsg = e.message; }
  render();
}
async function reactTo(t) {
  const r = await api('/api/news/react', { method: 'POST', body: { id: t.dataset.id, emoji: t.dataset.e } }).catch(() => null);
  if (!r) return;
  const apply = (list) => { const k = (list || []).findIndex((x) => x.id === r.item.id); if (k >= 0) list[k] = { ...list[k], counts: r.item.counts, mine: r.item.mine }; };
  apply(S.news?.items);
  if (S.who.role === 'hq' && hqLevel() !== 'viewer') { try { S.newsAdmin = await api('/api/admin/news'); } catch {} }
  render();
}

// ---------- global search ----------
function searchItems() {
  const items = [];
  if (!S.who) return items;
  for (const r of S.cfg.regions) items.push({ kind: 'region', id: r, label: title(r), sub: 'Region' });
  for (const s of schoolsAll()) items.push({ kind: 'school', id: s.id, label: s.name, sub: `School · ${title(s.lga)}${s.region ? ', ' + title(s.region) : ''}` });
  if (!isVol()) for (const a of adminsAll()) items.push({ kind: 'person', id: a.name, label: a.name, sub: `${roleLabel(a)}${a.region ? ' · ' + title(a.region) : ''}` });
  return items;
}
function doSearch(q) {
  const box = $('#gsr'); q = q.trim().toLowerCase();
  if (q.length < 2) { box.hidden = true; return; }
  const res = searchItems().filter((i) => i.label.toLowerCase().includes(q) || i.id.toLowerCase().includes(q)).slice(0, 8);
  box.innerHTML = res.length ? res.map((i) => `<a href="#" class="gsi" data-open="${esc(i.kind)}:${esc(i.id)}"><b>${esc(i.label)}</b><span>${esc(i.sub)}</span></a>`).join('') : '<div class="gsi"><span>No match</span></div>';
  box.hidden = false;
}

function applyBrand() {
  const b = S.cfg?.brand; if (!b) return;
  const el = document.querySelector('header .brand'); if (el) { el.innerHTML = `<b><span class="bl">${esc(b.platform)}</span><span class="bs">${esc(String(b.platform).split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase())}</span></b><span>${esc(b.programme || '')}</span>`; el.title = [b.programme, b.tagline].filter(Boolean).join(' · '); }
  document.title = b.platform + (b.programme ? ' · ' + b.programme : '');
}
// ---------- shell ----------
const TABS = {
  public: [['progress', 'Progress'], ['compare', 'Compare']],
  volunteer: [['day', 'My day'], ['pilot', 'Pilot day'], ['news', 'News'], ['work', 'My work'], ['queries', 'My queries'], ['stats', 'My stats'], ['phones', 'Phones'], ['pupils', 'Pupil records'], ['compare', 'Compare'], ['practice', 'Practice (Mafunzo)'], ['help', 'Help']],
  rc: [['region', 'Region'], ['news', 'News'], ['plan', 'Plan & calendar'], ['team', 'My team'], ['pilot', 'Pilot day'], ['allq', 'Queries'], ['phones', 'Phones'], ['compare', 'Compare'], ['reports', 'Reports'], ['narr', 'School reports'], ['clean', 'Data cleaning'], ['explore', 'Data explorer'], ['practice', 'Practice (Mafunzo)'], ['help', 'Help']],
  hq: [['today', 'Today'], ['hq', 'HQ'], ['usage', 'Usage & analytics'], ['news', 'News'], ['messages', 'Write and schedule'], ['clean', 'Data cleaning'], ['regions', 'Regions & plans'], ['plan', 'Plan & calendar'], ['pilot', 'Pilot day'], ['people', 'People'], ['allq', 'Queries'], ['phones', 'Phones'], ['compare', 'Compare'], ['reports', 'Reports'], ['payments', 'Payments'], ['payments', 'Payments'], ['explore', 'Data explorer'], ['admin', 'Admin'], ['help', 'Help'], ['practice', 'Practice (Mafunzo)']],
};
const GROUPS = { rc: [['Home', ['region', 'news']], ['Plan', ['plan', 'team', 'pilot']], ['Checks', ['allq', 'clean', 'phones', 'compare', 'explore']], ['Reports', ['reports', 'narr']], ['More', ['practice', 'help']]], volunteer: [['Today', ['day', 'pilot', 'news']], ['My work', ['work', 'queries', 'stats']], ['Team', ['phones', 'pupils', 'compare']], ['More', ['practice', 'help']]] };
const HQ_GROUPS = [['Today', ['today']], ['Field', ['hq', 'regions', 'plan', 'pilot', 'people', 'practice']], ['Checks', ['allq', 'clean', 'phones', 'compare', 'explore']], ['Messages', ['news', 'messages']], ['Reports', ['reports', 'narr', 'payments']], ['Admin', ['admin', 'usage']], ['Help', ['help']]];
const REPORTS_READY = true;
const LEVEL_TXT = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };
const hqLevel = () => (S.who?.role === 'hq' ? S.who.level || 'admin' : null);
const canWrite = () => !S.who || S.who.role !== 'hq' || hqLevel() !== 'viewer'; // editors and admins write messages and reports
function tabAllowed(k) {
  if (k === 'admin') return hqLevel() === 'admin';
  if (k === 'payments') return hqLevel() === 'admin';
  if (k === 'messages') return hqLevel() !== null;
  if (k === 'reports') return REPORTS_READY && S.who && S.who.role !== 'volunteer';
  if (k === 'usage') return Boolean(S.who && S.who.role === 'hq');
  if (k === 'narr') return Boolean(S.who && S.who.role !== 'volunteer');
  return true;
}
const roleKey = () => (!S.who ? 'public' : S.who.role === 'arc' ? 'rc' : S.who.role);
const VIEWS = { progress: viewProgress, compare: viewCompare, day: viewDay, work: viewWork, queries: viewQueries, stats: viewStats, region: viewRegion, plan: viewPlan, team: viewTeam, explore: viewExplore, hq: viewHQ, regions: viewRegionsHQ, people: viewPeopleHQ, admin: viewAdmin, allq: viewAllQueries, phones: viewPhones, practice: viewPractice, news: viewNews, pilot: viewPilot, payments: viewPayments, pupils: viewPupils, messages: viewMessages, reports: viewReports, narr: viewNarr, usage: viewUsage, clean: viewClean, today: viewToday, help: viewHelp };

// Admin is long: each card folds away so you can jump to what you need. The first card stays open; your choices are remembered.
function enhanceCollapsible() {
  if (S.tab !== 'admin') return;
  let first = true;
  document.querySelectorAll('#app .card').forEach((card) => {
    const h = card.querySelector(':scope > h3'); if (!h || card.closest('details')) return;
    const key = 'kf_col:' + h.textContent.trim(); const saved = store.get(key);
    const d = document.createElement('details'); d.className = card.className + ' colcard'; d.style.cssText = card.style.cssText;
    d.open = saved ? saved === 'o' : first; first = false;
    const sum = document.createElement('summary'); sum.className = 'colsum'; sum.innerHTML = h.innerHTML; h.remove(); d.appendChild(sum);
    while (card.firstChild) d.appendChild(card.firstChild);
    d.addEventListener('toggle', () => store.set(key, d.open ? 'o' : 'c'));
    card.replaceWith(d);
  });
  const ds = [...document.querySelectorAll('#app details.colcard')]; const head = document.querySelector('#app .pagehead');
  if (head && ds.length > 3 && !document.querySelector('#app .jump')) { const j = document.createElement('div'); j.className = 'jump'; ds.forEach((d, i) => { const t = d.querySelector('summary').textContent.trim(); const b = document.createElement('button'); b.textContent = t.length > 22 ? t.slice(0, 21) + '…' : t; b.onclick = () => { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; j.appendChild(b); }); head.after(j); }
}
const startKey = () => (S.who && !S.viewAs ? store.get('kf_start:' + roleKey() + ':' + (S.who.id ?? S.who.name)) : null);
const IC = (d) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const GICON = {
  Today: IC('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'), Home: IC('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  Field: IC('<path d="M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'), Plan: IC('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  Checks: IC('<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>'), Messages: IC('<path d="M21 12a8 8 0 01-11.5 7.2L4 21l1.8-5A8 8 0 1121 12z"/>'),
  Reports: IC('<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>'), Admin: IC('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'),
  Help: IC('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 115 0c0 1.7-2.5 2-2.5 4M12 17h.01"/>'), 'My work': IC('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h6"/>'),
  Team: IC('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M16 5a3 3 0 010 6M21 20c0-2.6-1.6-4.7-4-5.6"/>'), More: IC('<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'),
};
function bottomBar(groups, cur, badge) {
  let b = document.getElementById('bbar'); if (!b) { b = document.createElement('nav'); b.id = 'bbar'; b.setAttribute('aria-label', 'Main'); document.body.appendChild(b); }
  let sh = document.getElementById('msheet'); if (!sh) { sh = document.createElement('div'); sh.id = 'msheet'; sh.hidden = true; document.body.appendChild(sh); }
  const lastOf = (g, ks) => (S.grpLast[g] && ks.includes(S.grpLast[g]) ? S.grpLast[g] : ks[0]);
  const over = groups.length > 5; const main = over ? groups.slice(0, 4) : groups; const rest = over ? groups.slice(4) : [];
  const btn = ([g, ks]) => `<button data-tab="${lastOf(g, ks)}" class="${g === cur[0] ? 'on' : ''}" aria-label="${g}">${GICON[g] || ''}<span>${g}${ks.includes('news') ? badge('news') : ''}</span></button>`;
  const moreOn = rest.some(([g]) => g === cur[0]);
  b.innerHTML = main.map(btn).join('') + (over ? `<button data-act="moreMenu" class="${moreOn ? 'on' : ''}" aria-label="More">${GICON.More}<span>More</span></button>` : '');
  sh.innerHTML = rest.map(([g, ks]) => `<button data-tab="${lastOf(g, ks)}" class="${g === cur[0] ? 'on' : ''}">${GICON[g] || ''}<span>${g}</span></button>`).join('');
  b.hidden = false; if (!over) sh.hidden = true;
}
const REFRESH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/></svg>';
const BELL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
const themePref = () => { try { return localStorage.getItem('kf_theme') || ''; } catch { return ''; } };
function setTheme(v) { try { v ? localStorage.setItem('kf_theme', v) : localStorage.removeItem('kf_theme'); } catch {} if (v) document.documentElement.setAttribute('data-theme', v); else document.documentElement.removeAttribute('data-theme'); const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = '#354062'; }
function whoHtml() {
  if (!S.who) return '<button class="ghost" data-act="showLogin">Sign in</button>';
  const w = S.who; const ini = String(w.name || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase() || '?';
  const sub = [w.position, w.region ? title(w.region) : '', w.role === 'hq' ? LEVEL_TXT[hqLevel()] : ''].filter(Boolean).join(' · ');
  const bell = pushSupported() ? `<button class="ico ${S.alertsOn ? 'on' : ''}" id="alertsBtn" data-act="alerts" title="${esc(alertsLabel())}" aria-label="${esc(alertsLabel())}">${BELL}</button>` : '';
  const back = S.viewAs ? '<button class="ghost" data-act="exitPreview">Back to HQ</button>' : '';
  const rf = `<button class="ico" id="rfb" data-act="refresh" title="Refresh" aria-label="Refresh">${REFRESH}</button>`;
  return `${back}${rf}${bell}<div class="umw"><button class="uav" data-act="umenu" aria-haspopup="true" aria-label="Account menu">${esc(ini)}</button><div class="um" id="um" hidden>
  <div class="who2"><b>${esc(w.name)}</b><span>${esc(sub)}</span></div>
  ${viewAsControl() ? `<div class="row"><label>View the app as</label>${viewAsControl()}</div>` : ''}
  ${S.viewAs ? '' : `<div class="row"><label>Open the app on</label><select id="startSel" aria-label="Start page"><option value="">The first tab (default)</option>${TABS[roleKey()].filter(([k]) => tabAllowed(k)).map(([k, t]) => `<option value="${k}" ${startKey() === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`}
  <div class="row"><label>Appearance</label><select id="themeSel" aria-label="Appearance"><option value="" ${themePref() === '' ? 'selected' : ''}>Match my phone (automatic)</option><option value="light" ${themePref() === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${themePref() === 'dark' ? 'selected' : ''}>Dark</option></select></div>
  <button class="mbtn" data-act="alerts">${esc(alertsLabel())}</button>
  <button class="mbtn out" data-act="logout">Sign out</button></div></div>`;
}
function pilotBanner() {
  if (!S.who || S.viewAs || !['volunteer', 'rc', 'arc'].includes(S.who.role)) return '';
  if (!S.pil) { S.pil = { loading: true }; loadPilot(); return ''; }
  const d = S.pil.data; if (!d) return ''; const c = d.schools.find((x) => x.mine); if (!c) return '';
  const me = S.who; let line; const mine = [...c.staff[me.region].rc, ...c.staff[me.region].arc, ...c.staff[me.region].volunteers].find((x) => x.id === me.id) || {};
  const leadsG = Object.entries(c.sampling_lead || {}).find(([, id]) => id === me.id)?.[0]; const helpsG = Object.entries(c.samplers || {}).filter(([, ids]) => ids.includes(me.id)).map(([g]) => g)[0];
  if (me.role === 'volunteer') line = mine.grade ? `You test <b>Gr ${mine.grade}</b>.${helpsG ? ' You <b>also run the sampling</b> in Gr ' + helpsG + ', guided by the ARC.' : ''}` : 'Your RC will place you in a grade.';
  else if (me.role === 'rc') line = c.lead === me.id ? 'You <b>lead the day</b>.' : `You <b>support the lead</b> and oversee <b>${mine.support ? 'Gr ' + mine.support : 'one grade (to be set)'}</b>.${leadsG ? ' You <b>lead the sampling</b> in Gr ' + leadsG + '.' : ''}`;
  else line = leadsG ? `You <b>lead the sampling</b> in Gr ${leadsG}.` : helpsG ? `You <b>run the sampling</b> in Gr ${helpsG}.` : 'You <b>oversee the sampling</b> and guide the test admins.';
  return `<div class="banner" style="background:var(--gold);color:var(--on-gold)"><b>Pilot day, ${esc(dayName(d.day))}:</b> ${esc(title(c.name))} with ${esc(c.regions.filter((r) => r !== me.region).map(title).join(''))}${c.start ? ' · starts ' + esc(c.start) : ''}. ${line} <a href="#pilot" data-tab="pilot"><b>Open Pilot day</b></a></div>`;
}
// ---- usage tracking (kept inside the system; only HQ sees the analysis) ----
const isPhone = () => (window.matchMedia && window.matchMedia('(max-width:720px)').matches) || /Mobi|Android|iPhone/i.test(navigator.userAgent);
function trackSend(tab, ms, open) {
  if (!S.who || S.viewAs || !S.code || !tab) return;
  try { fetch('/api/usage', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', 'x-access-code': S.code }, body: JSON.stringify({ tab, ms, open: Boolean(open), dev: isPhone() ? 'm' : 'd' }) }).catch(() => {}); } catch { /* tracking never blocks the app */ }
}
function trackTab() {
  if (!S.who || S.viewAs) return; const t = S.tab; const T = (S.trk ||= { tab: null, t0: 0, opened: false });
  if (T.tab === t) return;
  if (T.tab) trackSend(T.tab, Date.now() - T.t0, false);
  T.tab = t; T.t0 = Date.now(); trackSend(t, 0, !T.opened); T.opened = true;
}
document.addEventListener('visibilitychange', () => { const T = S.trk; if (!T || !T.tab) return; if (document.hidden) { trackSend(T.tab, Date.now() - T.t0, false); T.t0 = 0; } else T.t0 = Date.now(); });
function render() {
  trackTab();
  const tabs = TABS[roleKey()].filter(([k]) => tabAllowed(k));
  if (!tabs.find((t) => t[0] === S.tab)) { const st = startKey(); S.tab = st && tabs.find((t) => t[0] === st) ? st : tabs[0][0]; if (S.tab !== tabs[0][0] && !S.viewAs) { const want = S.tab; setTimeout(() => { if (S.tab === want) selectTab(want); }, 0); } }
  const badge = (k) => (k === 'news' && S.tab !== 'news' && unreadNews().length ? ` <span class="nbadge">${unreadNews().length}</span>` : '');
  let n2 = $('#nav2'); if (!n2) { n2 = document.createElement('nav'); n2.id = 'nav2'; n2.setAttribute('role', 'tablist'); $('#nav').after(n2); }
  const GRP = roleKey() === 'hq' ? HQ_GROUPS : GROUPS[roleKey()];
  if (GRP) {
    const ok = new Set(tabs.map((t) => t[0])), lab = Object.fromEntries(tabs);
    const groups = GRP.map(([g, ks]) => [g, ks.filter((k) => ok.has(k))]).filter(([, ks]) => ks.length);
    const cur = groups.find(([, ks]) => ks.includes(S.tab)) || groups[0];
    S.grpLast ||= {};
    $('#nav').innerHTML = groups.map(([g, ks]) => `<button role="tab" aria-selected="${g === cur[0]}" data-tab="${S.grpLast[g] && ks.includes(S.grpLast[g]) ? S.grpLast[g] : ks[0]}">${g}${ks.includes('news') ? badge('news') : ''}</button>`).join('');
    S.grpLast[cur[0]] = S.tab; bottomBar(groups, cur, badge);
    n2.innerHTML = cur[1].length > 1 ? cur[1].map((k) => `<button role="tab" aria-selected="${k === S.tab}" data-tab="${k}">${lab[k]}</button>`).join('') : ''; n2.hidden = cur[1].length < 2;
  } else { const bb = document.getElementById('bbar'); if (bb) bb.hidden = true; $('#nav').innerHTML = tabs.map(([k, t]) => `<button role="tab" aria-selected="${k === S.tab}" data-tab="${k}">${t}${badge(k)}</button>`).join(''); n2.innerHTML = ''; n2.hidden = true; }
  $('#who').innerHTML = whoHtml(); $('#gsb').hidden = !S.who;
  const pd = S.ov && S.ov.plan_due;
  let planBanner = '';
  if (pd && !pd.locked && !S.viewAs) {
    const left = Math.round((Date.parse(pd.deadline) - Date.parse(new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10))) / 86400000);
    const msg = left > 0 ? `Submit your whole-field plan by ${dayName(pd.deadline)} (${left} day${left > 1 ? 's' : ''} left).` : left === 0 ? 'Your whole-field plan is due TODAY.' : `Your whole-field plan is overdue (it was due ${dayName(pd.deadline)}).`;
    planBanner = `<div class="banner ${left <= 0 ? 'bad' : ''}"><b>Plan not submitted.</b> ${left > 0 ? `Due ${dayName(pd.deadline)} (${left} day${left > 1 ? 's' : ''} left).` : left === 0 ? 'Due TODAY.' : 'Overdue.'} Notices to schools depend on it. <a href="#plan" data-tab="plan"><b>Open Plan &amp; calendar</b></a></div>`;
  }
  const un = S.tab !== 'news' && S.who && !S.viewAs ? unreadNews()[0] : null;
  const newsBanner = un ? `<div class="banner" style="background:var(--surface2)"><b>News:</b> ${esc(un.title)} <a href="#news" data-tab="news"><b>Read</b></a></div>` : '';
  $('#app').innerHTML = previewBanner() + planBanner + (S.tab === 'pilot' ? '' : pilotBanner()) + newsBanner + VIEWS[S.tab]();
  $('#gswrap').hidden = !S.who;
  enhanceCollapsible();
  aiRender();
}

// ---------- Today (HQ start page) ----------
function viewToday() {
  const o = S.ov; if (!o || o.status === 'waiting') return `${dataBanner()}<div class="pagehead"><div><h2>Today</h2><p>What needs you today</p></div></div>${waiting()}`;
  const flags = o.flags || [];
  const mine = flags.filter((f) => f.qk && qAbility(f).review);
  const waitingResp = flags.filter((f) => f.qk && ['open', 'rework'].includes(wfOf(f).stage || 'open') && isOpen(f));
  const inReview = flags.filter((f) => f.qk && ['team', 'hq1', 'final'].includes(wfOf(f).stage));
  const noPlan = o.regions.filter((r) => r.region !== 'DODOMA' && (o.plans[r.region] || {}).status !== 'locked'); // the Dodoma pilot has its own plan
  const bad = flags.filter((f) => isOpen(f) && f.sev === 'bad' && !f.qk).length;
  const nextNews = (S.newsAdmin?.items || []).filter((i) => i.publish_at && !i.published_at && Date.parse(i.publish_at) > Date.now()).sort((a, b) => Date.parse(a.publish_at) - Date.parse(b.publish_at))[0];
  const item = (cls, title0, text, tab, btn) => `<div class="tdrow"><i class="st ${cls}"></i><div style="flex:1;min-width:0"><b class="${cls === 'bad' ? 'need-l' : ''}">${title0}</b><span>${text}</span></div>${tab ? (tab === 'allq' && btn === 'Open queries' ? `<button class="btn sm ${cls === 'good' ? 'sec' : ''}" data-act="goMineQ">${btn}</button>` : `<button class="btn sm ${cls === 'good' ? 'sec' : ''}" data-tab="${tab}">${btn}</button>`) : ''}</div>`;
  const pil = o.regions.find((r) => r.region === 'DODOMA'); const pilTested = pil ? pil.tested || 0 : 0;
  const rows = [
    o.today === '2026-10-15' || pilTested ? item(pilTested ? 'good' : 'warn', `Pilot day, live: ${pilTested} of ${pil?.target || 600} pupils tested`, 'Real data from the five Dodoma schools. Sampling and tests update every minute.', 'pilot', 'Pilot day') : '',
    item(mine.length ? 'bad' : 'good', mine.length ? `${mine.length} query response${mine.length > 1 ? 's' : ''} waiting for your review` : 'No query waiting for your review', 'Responses reach you after the team review. Approve, send back, or edit and approve.', 'allq', 'Open queries'),
    item(waitingResp.length ? 'warn' : 'good', `${waitingResp.length} quer${waitingResp.length === 1 ? 'y' : 'ies'} waiting for a response, ${inReview.length} in review`, 'Responses come first from the test admin, or from the RC or ARC.', 'allq', 'See all'),
    item(noPlan.length ? 'warn' : 'good', noPlan.length ? `${noPlan.length} region${noPlan.length > 1 ? 's' : ''} without a submitted plan` : 'All regions have submitted their plan', noPlan.length ? noPlan.map((r) => esc(title(r.region))).join(', ') + '. The plan deadline is Fri 16 Oct. Notices and the calendar file depend on it.' : 'The calendar file can now be switched on in Admin.', 'regions', 'Regions and plans'),
    item(bad ? 'bad' : 'good', bad ? `${bad} serious check${bad > 1 ? 's' : ''} open` : 'No serious check open', 'Data and phone checks that need an explanation.', 'hq', 'HQ overview'),
    nextNews ? item('', 'Next scheduled message', `${esc(nextNews.title)} · ${eatTime(nextNews.publish_at)}`, 'news', 'News') : '',
  ].join('');
  const quick = [['reports', 'Reports and downloads'], ['phones', 'Phones today'], ['explore', 'Data explorer'], ['help', 'Help and guides']].filter(([k]) => tabAllowed(k)).map(([k, t]) => `<button class="btn sm sec" data-tab="${k}">${t}</button>`).join(' ');
  const g = o.national;
  return `${dataBanner()}<div class="pagehead"><div><h2>Today</h2><p>${esc(dayName(new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10)))} · what needs you, in order</p></div></div>
  <div class="grid kpis">${kpi('Schools complete', `${fmt(g.done)}<small> / ${fmt(g.schools)}</small>`, pc(g.done, g.schools) + '%', 'regions')}${kpi('Pupils tested', fmt(g.tested), 'of ' + fmt(g.target), 'compare')}${kpi('For your review', fmt(mine.length), 'queries', 'allq')}${kpi('Plans missing', fmt(noPlan.length), 'of ' + (o.regions.length - (o.regions.some((r) => r.region === 'DODOMA') ? 1 : 0)) + ' regions', 'regions')}</div>
  <div class="card" style="margin-top:14px"><h3>Needs you</h3><div class="sub">Green means nothing to do. Open an item to act on it.</div>${rows}</div>
  <div class="card" style="margin-top:14px"><h3>Go to</h3><div style="display:flex;gap:8px;flex-wrap:wrap">${quick}</div>${S.cfg?.brand?.assistant ? `<p class="m" style="margin-top:10px">Not sure where to look? Press <b>Ask assistant</b> (gold button, bottom right) and ask in plain words.</p>` : ''}</div>`;
}

// ---------- Help ----------
const HELP = {
  common: [
    ['Install the app on your phone (Android)', '<ol style="margin:4px 0 8px;padding-left:20px"><li>Open the link or scan the QR code below in <b>Chrome</b>. (If you tapped the link inside WhatsApp, Facebook or another app, choose <b>Open in Chrome</b> from its menu first.)</li><li>Enter your access code.</li><li>Tap the menu <b>&#8942;</b> (three dots, top right of Chrome), then <b>Install app</b>, or <b>Add to Home screen</b> if you do not see Install. Tap <b>Install</b>.</li><li>Look for the <b>KiuFunza</b> icon on your home screen or in your apps list. From now on open it from the icon, with no link.</li></ol><p><b>If you do not see Install app:</b> update Chrome from the Play Store, make sure you are in Chrome and not another browser, and try again. In <b>Samsung Internet</b>: menu, <b>Add page to</b>, <b>Home screen</b>.</p><p><b>Alerts:</b> tap the bell icon at the top of the app and choose <b>Allow</b>. If you chose Block by mistake: Settings, Apps, KiuFunza (or Chrome), Notifications, switch on.</p><p><b>Updates:</b> tap the refresh icon at the top, or pull the page down from the top. You do not need to close and reopen the app.</p><p style="margin-top:8px"><img src="/api/qr.png" width="160" height="160" alt="QR code for the dashboard" style="border:1px solid var(--line);background:#fff"><br><span class="m">Scan with your camera to open the dashboard.</span></p>'],
    ['Install the app on your phone (iPhone)', '<ol style="margin:4px 0 8px;padding-left:20px"><li>Open the link in <b>Safari</b>, not inside WhatsApp or another app.</li><li>Enter your access code.</li><li>Tap <b>Share</b> (the square with an arrow), scroll down, tap <b>Add to Home Screen</b>, then <b>Add</b>.</li><li>Open the <b>KiuFunza</b> icon from your home screen. Alerts work only when it is opened from that icon.</li></ol>'],
    ['What is this?', 'One place for the field work: who is where, which schools are done, what needs a reply, and what is next. It reads the KoBo forms every few minutes. It never shows pupil names.'],
    ['How do I sign in?', 'Use the code you were sent. It is yours alone. Do not share it. If it does not work, ask your RC or HQ for a new one.'],
    ['How do I get alerts on my phone?', 'Press <b>Turn on alerts</b> at the top and allow notifications. On an iPhone, first use Share, then Add to Home Screen, and open the app from there.'],
    ['What do the colours mean?', 'Green is fine. Amber means look at it. Red means it needs an answer soon. A check is a question, not a charge: it asks for a short explanation.'],
    ['What does Treatment, Control and M&E mean?', 'Treatment and Control are the two study groups of schools. M&E is an extra label on some schools that also have monitoring visits or surveys.'],
  ],
  volunteer: [
    ['My day', 'Shows the school you are at today, the sampling status and your own test times. Check it in the morning.'],
    ['Sending your records', 'Turn on auto send in KoBo Collect so records go out the same day. Sent late (2 or more days after the visit) is a check.'],
    ['My queries: how to respond', 'When a check is raised on your records, press <b>Write the response</b> and say in a sentence or two what happened and what was done. Your RC or ARC reviews it, then HQ reviews and approves it. You can see every step and the history. If it is sent back, read the reason and write it again.'],
    ['Phones', 'Each phone should belong to one person. Do not lend yours. If you must, tell your RC and write it in your response.'],
    ['Practice', 'Use the TRAINING schools to practise. They do not count in the real numbers.'],
  ],
  rc: [
    ['Plan and calendar', 'Plan the whole field work before 16 Oct: 2 schools a day is the standard. One or three schools in a day needs a reason. After you submit, a change needs a reason and shows in the history.'],
    ['Notices to schools', 'Ward officers get 5 working days notice and head teachers 3. The tracker has ready messages: copy, send by SMS or WhatsApp, then press Mark sent.'],
    ['Queries: reviewing your team', 'Test admin responses reach you first. Read each, check it makes sense, then <b>Approve</b> (goes to HQ), <b>Edit and approve</b>, or <b>Send back</b> with a reason. Your own queries you answer yourself and they go to HQ. A response is overdue after 2 working days; you get a reminder every day.'],
    ['Your own work', 'Your targets: visits, notices on time, plan changes made early, same-day sending, quality, queries answered. They are the same for RC and ARC.'],
    ['Reports', 'RCs can build, edit and download reports for their region (Excel, Word, PDF, CSV).'],
  ],
  hq: [
    ['Today', 'Your start page: queries waiting for your review, plans missing, serious checks and the next scheduled message.'],
    ['Query review (the chain)', 'Test admin writes the response; RC or ARC reviews; the first HQ reviewer (Joram) reviews; the final approver (Mundo) approves. Each step can approve, send back with a reason, or edit and approve. Nothing is deleted: the full history stays. Set who reviews in Admin, HQ team, Query review.'],
    ['News', 'Write a message, polish it with AI, then send now or schedule it. Messages go as phone alerts too.'],
    ['Reports', 'Pick a template, build it, edit the text, then download as Excel, Word, PDF or CSV. Choose several formats to get a zip.'],
    ['The assistant', 'Press the button at the bottom right. Ask about progress, regions, plans, queries. It only reads; it can suggest a News draft or open a screen, but you decide.'],
    ['Admin: people and levels', 'Admin can do everything. Editors write messages and reports and reply to queries. Viewers read and download. Each person has a personal code; switch the shared code off once everyone has theirs.'],
    ['Admin: forms', 'Admin, Forms: choose the XLSX, press Rehearse (it tests on a throwaway copy and rolls back), then Deploy by typing the project name. Roll back is one button. Submissions are never touched.'],
    ['Admin: calendar file', 'When all 11 plans are in, switch on the automatic calendar update. A manual download and upload stay as backup.'],
    ['Activity log', 'Every change by an HQ person is logged with who and when. Look in Admin.'],
  ],
};
function viewHelp() {
  const role = roleKey(); const mk = (list) => list.map(([q, a]) => `<details class="fd helpq"><summary><b>${q}</b></summary><div class="phbox">${a}</div></details>`).join('');
  const mine = HELP[role] || [];
  return `<div class="pagehead"><div><h2>Help</h2><p>Short answers in plain words. Open any question.</p></div></div>
  ${mine.length ? `<div class="card"><h3>For your role</h3>${mk(mine)}</div>` : ''}<div class="card" style="margin-top:14px"><h3>For everyone</h3>${mk(HELP.common)}</div>
  <div class="card" style="margin-top:14px"><h3>Still stuck?</h3><div class="sub">Tell your Regional Coordinator. RCs tell HQ.</div></div>`;
}

// ---------- the assistant (HQ) ----------
const AI_SUGGEST = ['Which regions are behind and why?', 'What needs my review today?', 'Which regions have not submitted their plan?', 'Draft a good-luck message for the first field day', 'Summarise this week for Mundo and Joram'];
function aiName() { return (S.cfg?.brand?.assistant || 'Assistant'); }
function aiRender() {
  let el = document.getElementById('ai'); const on = S.who && S.who.role === 'hq' && !S.viewAs;
  if (!on) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'ai'; document.body.appendChild(el); }
  const A = (S.ai ||= { open: false, msgs: [], busy: false });
  const msgs = A.msgs.map((m, i) => `<div class="aim ${m.role}"><div>${esc(m.content).replace(/\n/g, '<br>')}</div>${(m.actions || []).map((x, j) => x.type === 'news_draft' ? (canWrite() ? `<button class="btn sm" data-act="aiDraft" data-i="${i}" data-j="${j}">Save as News draft: ${esc(x.title)}</button>` : `<span class="m">Draft: ${esc(x.title)} (needs an Editor to save)</span>`) : x.type === 'open' ? `<button class="btn sm sec" data-act="aiOpen" data-go="${esc(x.tab)}">${esc(x.label || 'Open')}</button>` : '').join('')}</div>`).join('');
  el.innerHTML = A.open ? `<div class="aipanel" role="dialog" aria-label="${esc(aiName())}"><div class="aihead"><b>${esc(aiName())}</b><span><button class="btn sm ghost" data-act="aiNew">New chat</button> <button class="btn sm ghost" data-act="aiClose" aria-label="Close">✕</button></span></div>
  <div class="aibody" id="aibody">${msgs || `<div class="m">Ask about progress, regions, plans or queries. I read the live numbers and never change anything. I never see pupil or teacher names.</div><div class="aisug">${AI_SUGGEST.map((q) => `<button class="chipbtn" data-act="aiAsk" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>`}${A.busy ? '<div class="aim assistant"><div>Thinking…</div></div>' : ''}</div>
  <div class="aiin"><textarea id="aiText" rows="2" placeholder="Ask in plain words" ${A.busy ? 'disabled' : ''}></textarea><button class="btn" data-act="aiSend" ${A.busy ? 'disabled' : ''}>Send</button></div></div>` : `<button class="aibtn" data-act="aiOpen2" aria-label="Ask ${esc(aiName())}">Ask assistant</button>`;
  const b = document.getElementById('aibody'); if (b) b.scrollTop = b.scrollHeight;
}
async function aiAction(a, t) {
  const A = (S.ai ||= { open: false, msgs: [], busy: false });
  if (a === 'aiOpen2') { A.open = true; aiRender(); const x = document.getElementById('aiText'); x && x.focus(); return; }
  if (a === 'aiClose') { A.open = false; aiRender(); return; }
  if (a === 'aiNew') { A.msgs = []; aiRender(); return; }
  if (a === 'aiOpen') { S.tab = t.dataset.go; A.open = false; render(); return; }
  if (a === 'aiDraft') { const x = A.msgs[+t.dataset.i].actions[+t.dataset.j]; try { await api('/api/admin/news', { method: 'POST', body: { action: 'save', title: x.title, body: x.body, kind: x.kind, to: x.to } }); A.msgs.push({ role: 'assistant', content: 'Saved as a draft in News. Open News to polish and send it. Nothing was sent.' }); } catch (e) { A.msgs.push({ role: 'assistant', content: e.message }); } aiRender(); return; }
  if (a === 'aiAsk' || a === 'aiSend') {
    const q = a === 'aiAsk' ? t.dataset.q : (document.getElementById('aiText').value || '').trim(); if (!q || A.busy) return;
    A.msgs.push({ role: 'user', content: q }); A.busy = true; aiRender();
    try { const r = await api('/api/assistant', { method: 'POST', body: { messages: A.msgs.map((m) => ({ role: m.role, content: m.content })) } }); A.msgs.push({ role: 'assistant', content: r.text, actions: r.actions || [] }); }
    catch (e) { A.msgs.push({ role: 'assistant', content: e.message || 'That did not work. Try again.' }); }
    A.busy = false; aiRender();
  }
}

// ---------- Pupil records: every student record with its key information (no pupil names) ----------
const todayEAT = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
function pupilsView() {
  const P = (S.pu ||= { f: { region: '', school: '', from: todayEAT(), to: '', grade: '', enumerator: '', stuid: '', absent: false }, res: null, msg: '' }); const f = P.f; const hq = S.who.role === 'hq';
  const schools = schoolsAll().filter((x) => !String(x.id).startsWith('TRAIN') || true);
  const R = P.res;
  const sum = R ? `<div class="grid kpis" style="margin:10px 0">${kpi('Records', fmt(R.total), R.capped ? 'first ' + fmt(R.records.length) + ' shown' : '')}${kpi('Present', fmt(R.summary.present))}${kpi('Absent', fmt(R.summary.absent))}${R.summary.by_grade.map(([g, n]) => kpi('Grade ' + g, fmt(n))).join('')}</div>
  <details class="fd"><summary>Count by test admin (${R.summary.by_enumerator.length})</summary><div class="tbl"><table><tbody>${R.summary.by_enumerator.map(([n, c]) => `<tr><td>${esc(n)}</td><td class="r num">${c}</td></tr>`).join('')}</tbody></table></div></details>
  <details class="fd"><summary>Count by day (${R.summary.by_date.length})</summary><div class="tbl"><table><tbody>${R.summary.by_date.map(([n, c]) => `<tr><td>${esc(n)}</td><td class="r num">${c}</td></tr>`).join('')}</tbody></table></div></details>` : '';
  const rows = R ? R.records.map((r) => `<tr><td class="num">${esc(r.date)}</td>${hq ? `<td>${esc(title(r.region))}</td>` : ''}<td>${esc(r.school_name)}</td><td>${esc(r.grade)}</td><td>${esc(r.enumerator)}</td><td class="num">${esc(r.stuid)}</td><td class="r num">${esc(r.rand)}</td><td>${r.present === 'absent' ? chip('absent', 'warn') : 'present'}</td><td class="num">${esc(r.at)}</td><td class="r num">${r.mins === '' ? '' : esc(r.mins)}</td><td class="num">${esc(r.phone)}</td></tr>`).join('') : '';
  return `<div class="card"><h3>Pupil records</h3><div class="sub">Every student test record with its key information. No pupil names. Choose where and when, then count or download.</div>
  <div class="mf" style="display:flex;gap:10px;flex-wrap:wrap">${hq ? `<label>Region<select id="puRegion"><option value="">All</option>${(S.cfg?.regions || []).map((r) => `<option value="${r}" ${f.region === r ? 'selected' : ''}>${esc(title(r))}</option>`).join('')}</select></label>` : ''}
  <label>School<input id="puSchool" list="puSchools" value="${esc(f.school)}" placeholder="Name or code (optional)"></label><datalist id="puSchools">${schools.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</datalist>
  <label>From<input type="date" id="puFrom" value="${esc(f.from)}"></label><label>To<input type="date" id="puTo" value="${esc(f.to)}"></label>
  <label>Grade<select id="puGrade"><option value="">All</option>${[1, 2, 3].map((g) => `<option ${f.grade == g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
  <label>Test admin<input id="puEnum" value="${esc(f.enumerator)}" placeholder="Part of the name"></label><label>Pupil ID<input id="puStu" value="${esc(f.stuid)}"></label></div>
  <label class="cb"><input type="checkbox" id="puAbsent" ${f.absent ? 'checked' : ''}> Absent pupils only</label>
  <p style="margin:10px 0 0"><button class="btn" data-act="puFind">Show records</button> ${R ? '<button class="btn sec" data-act="puCsv">Download as CSV</button>' : ''} ${P.msg ? `<span class="m">${esc(P.msg)}</span>` : ''}</p></div>
  ${R ? `${sum}<div class="card" style="margin-top:12px"><div class="tbl dt-wrap"><table class="dt"><thead><tr><th>Date</th>${hq ? '<th>Region</th>' : ''}<th>School</th><th>Gr</th><th>Test admin</th><th>Pupil ID</th><th class="r">No.</th><th>Status</th><th>Start</th><th class="r">Min</th><th>Phone</th></tr></thead><tbody>${rows || '<tr><td colspan="11" class="empty">No records match.</td></tr>'}</tbody></table></div></div>` : ''}`;
}
function viewPupils() { return `${dataBanner()}<div class="pagehead"><div><h2>Pupil records</h2><p>Look at and count every student record for your region.</p></div></div>${pupilsView()}`; }
function puRead() { const g = (i) => document.getElementById(i); const P = (S.pu ||= { f: {}, res: null }); if (!g('puFrom')) return P.f; P.f = { region: g('puRegion')?.value || '', school: g('puSchool').value.trim(), from: g('puFrom').value, to: g('puTo').value, grade: g('puGrade').value, enumerator: g('puEnum').value.trim(), stuid: g('puStu').value.trim(), absent: g('puAbsent').checked }; return P.f; }
async function pupilAction(a) {
  const P = (S.pu ||= { f: {}, res: null, msg: '' });
  try {
    if (a === 'puFind') { const f = puRead(); P.msg = 'Reading from KoBo…'; render(); const q = new URLSearchParams(Object.fromEntries(Object.entries({ region: f.region, school: f.school, from: f.from, to: f.to, grade: f.grade, enumerator: f.enumerator, stuid: f.stuid, absent: f.absent ? '1' : '' }).filter(([, v]) => v))); P.res = await api('/api/pupils?' + q); P.msg = ''; }
    else if (a === 'puCsv') { const hdr = ['Date', 'Region', 'School code', 'School', 'Grade', 'Test admin', 'Pupil ID', 'Pupil no', 'Status', 'Start', 'Minutes', 'Phone', 'Submitted']; const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"'; const lines = [hdr.map(q).join(',')].concat(P.res.records.map((r) => [r.date, title(r.region), r.school, r.school_name, r.grade, r.enumerator, r.stuid, r.rand, r.present, r.at, r.mins, r.phone, r.sub].map(q).join(','))); const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }); const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = `pupil-records-${todayEAT()}.csv`; l.click(); return; }
  } catch (e) { P.msg = e.message; }
  render();
}

// ---------- Payments (HQ Admin only): the COD calculation by school; no names or bank details ----------
const SKL = { k: 'Kiswahili', a: 'Arithmetic' };
const tzs = (n) => (n == null ? '–' : Math.round(n).toLocaleString('en-GB'));
async function loadPayments(year) { try { S.pay = { ...(S.pay || {}), data: null, err: null }; render(); S.pay.data = await api('/api/payments' + (year ? '?year=' + year : '')); } catch (e) { S.pay = { ...(S.pay || {}), err: e.message }; } render(); }
function viewPayments() {
  const P = S.pay; if (!P) return '<div class="empty">Loading…</div>'; if (P.err) return `<div class="banner bad">${esc(P.err)}</div>`; const d = P.data; if (!d) return '<div class="empty">Calculating from the stored test results…</div>';
  if (d.status === 'waiting') return '<div class="empty">No data for that year yet.</div>';
  const sel = `<select id="payYear" aria-label="Year">${d.years.map((y) => `<option value="${y}" ${y === d.year ? 'selected' : ''}>${y}</option>`).join('')}</select>`;
  const ok = d.checks.filter((c) => c.ok).length; const prices = d.price_table.map((r) => r.price_per_pass).filter((x) => x != null);
  const note = d.current ? `<div class="banner"><b>Provisional.</b> These are the numbers from the tests so far. They change until every school has been tested and the teacher data is complete. The official payment run is done in Stata.</div>` : `<div class="banner"><b>Rehearsal with ${esc(d.year)} data.</b> The same rules on last round's results, to check the engine. The 2025 official run paid TZS 334,400,000 to teachers and 66,880,000 to head teachers.</div>`;
  const kp = `<div class="grid kpis" style="margin-top:10px">${kpi('Teacher budget (net)', tzs(d.net), 'after 5% tax')}${kpi('Head teacher pool', tzs(d.ht_net), '20% of teacher earnings')}${kpi('Schools in the pool', fmt(d.schools.length), 'control schools left out')}${kpi('Price per pass', prices.length ? tzs(Math.min(...prices)) + ' to ' + tzs(Math.max(...prices)) : '–', 'TZS, by skill')}${kpi('Checks passed', `${ok}<small> / ${d.checks.length}</small>`, ok === d.checks.length ? 'all clear' : 'see below')}</div>`;
  const checks = `<div class="card" style="margin-top:14px"><h3>Checks</h3><div class="sub">All must pass before a payment list is approved.</div>${d.checks.map((c) => `<div class="flag"><i class="st ${c.ok ? 'good' : 'bad'}"></i><div><b>${esc(c.name)}</b><span>${esc(c.detail)}</span></div></div>`).join('')}</div>`;
  const prt = `<div class="card" style="margin-top:14px"><h3>Price per pass, by skill</h3><div class="sub">The skill budget divided by all projected passes in the programme. Harder skills have fewer passes, so each pass pays more.</div><div class="tbl dt-wrap"><table class="dt"><thead><tr><th>Grade</th><th>Subject</th><th>Skill</th><th class="r">Budget</th><th class="r">Projected passes</th><th class="r">TZS per pass</th></tr></thead><tbody>${d.price_table.map((r) => `<tr><td>${r.grade}</td><td>${r.subject === 'kis' ? 'Kiswahili' : 'Arithmetic'}</td><td>${esc(r.skill.replace(/^[ka]\d_/, '').replace(/_/g, ' '))}</td><td class="r num">${tzs(r.budget)}</td><td class="r num">${tzs(r.projected_passes)}</td><td class="r num">${r.price_per_pass == null ? '–' : tzs(r.price_per_pass)}</td></tr>`).join('')}</tbody></table></div></div>`;
  const reg = `<div class="card" style="margin-top:14px"><h3>By region</h3><div class="tbl dt-wrap"><table class="dt"><thead><tr><th>Region</th><th class="r">Schools ready</th><th class="r">Teacher pay (TZS)</th><th class="r">Head teacher pool (TZS)</th></tr></thead><tbody>${d.regions.map((r) => `<tr><td><b>${esc(title(r.region))}</b></td><td class="r num">${r.ready} / ${r.schools}</td><td class="r num">${tzs(r.total)}</td><td class="r num">${tzs(r.ht_pot)}</td></tr>`).join('')}</tbody></table></div></div>`;
  const names = Object.fromEntries(d.schools.map((s) => [s.id, s.name]));
  const inf = `<div class="card" style="margin-top:14px"><h3>Infrastructure bonus: leading school in each region</h3><div class="sub">Highest pass rate over all skill tests. Earlier winners (2023 to 2025) are left out. TZS 5,000,000 each.</div><div class="tbl dt-wrap"><table class="dt"><thead><tr><th>Region</th><th>School</th><th class="r">Pass rate</th></tr></thead><tbody>${d.infra.winners.slice().sort((a, b) => a.region.localeCompare(b.region)).map((w) => `<tr><td>${esc(title(w.region))}</td><td><b>${esc(names[w.school] || w.school)}</b></td><td class="r num">${(w.rate * 100).toFixed(1)}%</td></tr>`).join('')}</tbody></table></div>${d.infra.ties.length ? `<p class="m"><b>Tie:</b> ${d.infra.ties.map((t) => esc(title(t.region))).join(', ')}. Decide the tie-break.</p>` : ''}</div>`;
  const cols = [
    { k: 'name', label: 'School', val: (s) => s.name, search: (s) => s.name + ' ' + s.id, html: (s) => `<b>${esc(s.name)}</b>` },
    { k: 'region', label: 'Region', val: (s) => s.region, search: (s) => s.region, html: (s) => esc(title(s.region)) },
    { k: 'arm', label: 'Group', small: true, val: (s) => s.arm, html: (s) => esc(s.arm) },
    { k: 'rate', label: 'Pass rate', cls: 'r', val: (s) => s.pass_rate ?? -1, html: (s) => (s.pass_rate == null ? '–' : (s.pass_rate * 100).toFixed(1) + '%') },
    { k: 'total', label: 'Teacher pay (TZS)', cls: 'r', val: (s) => s.total, html: (s) => `<span class="num">${tzs(s.total)}</span>` },
    { k: 'each', label: 'Average per teacher', cls: 'r', small: true, val: (s) => { const c = s.cells.filter((x) => x.each); return c.length ? c.reduce((a, x) => a + x.each, 0) / c.length : 0; }, html: (s) => { const c = s.cells.filter((x) => x.each); return `<span class="num">${c.length ? tzs(c.reduce((a, x) => a + x.each, 0) / c.length) : '–'}</span>`; } },
    { k: 'ht', label: 'Head teacher (TZS)', cls: 'r', small: true, val: (s) => s.ht_each ?? 0, html: (s) => `<span class="num">${tzs(s.ht_each)}</span>` },
    { k: 'ready', label: 'Ready', val: (s) => s.grades_ready, html: (s) => chip(s.grades_ready + ' of 3', s.grades_ready === 3 ? 'good' : s.grades_ready ? 'warn' : 'bad') },
  ];
  const filters = [{ k: 'region', label: 'Region', get: (s) => s.region, options: (r) => [...new Set(r.map((s) => s.region))].sort().map((x) => [x, title(x)]) }, { k: 'rdy', label: 'Ready', get: (s) => (s.grades_ready === 3 ? 'yes' : 'no'), options: () => [['yes', 'All 3 grades'], ['no', 'Not complete']] }];
  const tbl = `<div class="card" style="margin-top:14px"><h3>Schools</h3><div class="sub">Projected payment per school from the pass rates so far. "Average per teacher" is the school's payment shared by the teachers recorded for each grade and subject. Names of teachers and bank details are never shown here.</div>${dataTable('pay-schools', cols, d.schools, { filters, sort: 'total', dir: -1, placeholder: 'Search a school', limit: 400 })}<p style="margin-top:10px"><button class="btn sm sec" data-act="payCsv">Download the school table (CSV)</button></p></div>`;
  return `<div class="pagehead"><div><h2>Payments</h2><p>The cash-on-delivery bonus worked out from the test results. HQ Admin only.</p></div>${sel}</div>${note}${kp}${checks}${reg}${inf}${prt}${tbl}`;
}
function payCsv() {
  const d = S.pay?.data; if (!d) return; const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [['School code', 'School', 'Region', 'Group', 'Pass rate', 'Teacher pay TZS', 'Head teacher pool TZS', 'Head teachers', 'Per head teacher TZS', 'Grades ready'].map(q).join(',')].concat(d.schools.map((s) => [s.id, s.name, title(s.region), s.arm, s.pass_rate == null ? '' : s.pass_rate.toFixed(4), s.total, s.ht_pot, s.head_teachers, s.ht_each ?? '', s.grades_ready].map(q).join(',')));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = `cod-by-school-${d.year}.csv`; a.click();
}

// ---------- Pilot day: who does what at each Dodoma pilot school ----------
async function loadPilot() { try { S.pil = { ...(S.pil || {}), data: await api('/api/pilot'), err: null }; } catch (e) { S.pil = { ...(S.pil || {}), err: e.message }; } render(); }
// progress: the lead, a grade for every test admin, and a sampling lead for each grade
function pilotProgress(c) {
  const vols = c.regions.flatMap((r) => c.staff[r].volunteers); const withGrade = vols.filter((v) => v.grade).length; const sl = Object.keys(c.sampling_lead || {}).length;
  const total = 1 + vols.length + 3; const done = (c.lead_set ? 1 : 0) + withGrade + sl;
  const next = !c.lead_set ? 'Name the lead RC' : withGrade < vols.length ? `Place ${vols.length - withGrade} test admin${vols.length - withGrade > 1 ? 's' : ''} in a grade` : sl < 3 ? `Name ${3 - sl} sampling lead${3 - sl > 1 ? 's' : ''}` : 'All set';
  return { done, total, next, vols, withGrade, sl, pct: Math.round((100 * done) / total) };
}
const pilOpen = (k, dflt) => ((S.pilOpen || {})[k] ?? dflt);
document.addEventListener('toggle', (e) => { const k = e.target?.dataset?.pk; if (k) (S.pilOpen ||= {})[k] = e.target.open; }, true);
const pbar = (pc) => `<div class="pbar"><i style="width:${pc}%"></i></div>`;
// live results for a pilot school: per grade, is the sampling in and how many pupils are tested (target 40)
function pilotLive(c) {
  const L = c.live; const gs = [1, 2, 3].map((g) => { const x = (L && L.g && L.g[g]) || {}; return { g, n: x.av ?? x.n ?? 0, att: x.att, target: x.target ?? 40 }; }); // target = the smaller of 40 and the pupils present on the sampling day; tested = present pupils tested
  const tested = gs.reduce((a, x) => a + x.n, 0), target = gs.reduce((a, x) => a + x.target, 0), samp = gs.filter((x) => x.att != null).length;
  const cell = (x) => `<div class="lg"><b>Gr ${x.g}</b><div class="${x.att != null ? 'ok' : 'need-l'}">${x.att != null ? '✓ Sampling in · ' + x.att + ' on register' : 'Sampling not in yet'}</div><div>${x.n} of ${x.target} tested</div>${pbar(x.target ? Math.min(100, Math.round((100 * x.n) / x.target)) : 100)}</div>`;
  return { tested, target, samp, html: `<div class="plive"><div class="lh"><b>Live from KoBo</b><span class="m">${tested} of ${target} tested · sampling in ${samp} of 3</span></div><div class="lgs">${gs.map(cell).join('')}</div></div>` };
}
// "Your pilot results": the person's own pilot tests, minutes per test against the usual range, and their checks.
// RCs and ARCs see the same for each member of their regional team at this school.
function pilotResults(c) {
  const o = S.ov, me = S.who; if (!o || o.status !== 'ok' || o.year !== '2026' || !o.mine || !me || roleKey() === 'hq') return '';
  const coord = roleKey() === 'rc'; const admins = o.mine.admins || (o.mine.me ? [o.mine.me] : []);
  const nameOf = (staffId) => (admins.find((a) => a.staff_id === staffId) || {}).name;
  const rowsFor = (adminName) => (coord ? (o.mine.work_all || {})[adminName] : o.mine.work) || [];
  const stat = (adminName) => {
    const w = rowsFor(adminName).filter((r) => r[1] === c.school); const n = w.reduce((a, r) => a + r[3], 0);
    const tm = w.filter((r) => r[4] != null); const tn = tm.reduce((a, r) => a + r[3], 0); const avg = tn ? tm.reduce((a, r) => a + r[3] * r[4], 0) / tn : null;
    const g = w.length ? w.slice().sort((x, y) => y[3] - x[3])[0][2] : null; const b = g && o.bands ? o.bands[g] : null;
    let verdict = '', cls = '';
    if (avg != null && b) { if (avg < b.p10) { verdict = `a little fast, usual ${b.p10.toFixed(1)} to ${b.p90.toFixed(1)} min`; cls = 'need-l'; } else if (avg > b.p90) { verdict = `a little slow, usual ${b.p10.toFixed(1)} to ${b.p90.toFixed(1)} min`; cls = 'need-l'; } else { verdict = `in the usual range (${b.p10.toFixed(1)} to ${b.p90.toFixed(1)} min)`; cls = 'okc'; } }
    return { n, avg, g, verdict, cls };
  };
  const flags = (o.mine.flags || []).filter((f) => f.school === c.school);
  const flagLine = flags.length ? `<div class="pflags">${flags.slice(0, 4).map((f) => `<div class="pf"><i class="st ${f.sev === 'bad' ? 'bad' : 'warn'}"></i><span>${esc(f.text)}</span></div>`).join('')}<button class="btn sm" data-tab="${coord ? 'allq' : 'queries'}">Open ${flags.length} check${flags.length > 1 ? 's' : ''}</button></div>` : '<div class="m">No checks on your pilot records. Good.</div>';
  let body;
  if (coord) {
    const team = (c.staff[me.region] ? [...c.staff[me.region].rc, ...c.staff[me.region].arc, ...c.staff[me.region].volunteers] : []);
    const rows = team.map((p) => { const an = nameOf(p.id) || p.name; const st = stat(an); const fl = flags.filter((f) => String(f.admin || '').split(' and ').includes(an)).length; return `<tr><td>${esc(p.name.split(' ')[0])} ${esc((p.name.split(' ').slice(1).join(' ') || '').slice(0, 1))}.</td><td class="r">${p.grade ? 'Gr ' + p.grade : '–'}</td><td class="num r">${st.n}</td><td class="num r ${st.cls}">${st.avg != null ? st.avg.toFixed(1) : '–'}</td><td class="r ${fl ? 'need-l' : ''}">${fl || '–'}</td></tr>`; }).join('');
    body = `<div class="tbl"><table><thead><tr><th>Name</th><th class="r">Grade</th><th class="r">Pupils</th><th class="r">Min</th><th class="r">Flags</th></tr></thead><tbody>${rows}</tbody></table></div>${flagLine}`;
  } else {
    const st = stat(o.mine.me?.name || me.name);
    body = st.n ? `<div class="big2">${st.n}<small> pupils tested${st.g ? ' · Gr ' + st.g : ''}</small></div><div>Average ${st.avg != null ? st.avg.toFixed(1) + ' min per test' : '–'}${st.verdict ? ': <span class="' + st.cls + '">' + st.verdict + '</span>' : ''}.</div>${flagLine}` : '<div class="m">Your tests will show here a few minutes after you submit them.</div>';
  }
  return `<div class="plive pres"><div class="lh"><b>Your pilot results</b><span class="m">Real data, same checks as a live school</span></div>${body}</div>`;
}
function pilotBody(c) {
  const gsel = (kind, sid, id, cur, ok, label) => (ok ? `<select data-${kind}="${sid}:${id}" aria-label="${esc(label)}"><option value="">None</option>${[1, 2, 3].map((g) => `<option value="${g}" ${cur === g ? 'selected' : ''}>Gr ${g}</option>`).join('')}</select>` : cur ? 'Gr ' + cur : '–');
  const rcs = c.regions.flatMap((r) => c.staff[r].rc.map((p) => ({ ...p, r }))); const arcs = c.regions.flatMap((r) => c.staff[r].arc.map((p) => ({ ...p, r })));
  const vols = c.regions.flatMap((r) => c.staff[r].volunteers.map((v) => ({ ...v, r }))); const me = S.who?.id; const SL = c.sampling_lead || {}; const SM = c.samplers || {};
  const nm = (p) => `<b>${esc(p.name.split(' ')[0])} ${esc((p.name.split(' ').slice(1).join(' ') || '').slice(0, 1))}.</b> <span class="m">${esc(title(p.r || p.region))}</span>${me === p.id ? ' ' + chip('You', 'gold') : ''}`;
  const prow = (p, role, ctl) => `<div class="prow ${me === p.id ? 'me' : ''}"><div class="pl"><div>${nm(p)}</div><div class="m">${role}</div></div><div class="pr">${ctl}</div></div>`;
  const P = pilotProgress(c); const leadRc = rcs.find((p) => p.id === c.lead); const assistant = rcs.find((p) => p.id !== c.lead);
  const canTeam = (r) => c.can_set_sampling || c.editable.includes(r); const isSampler = (g, id) => (SM[g] || []).includes(id);
  const step = (n, ok, title0, body) => `<div class="step ${ok ? 'ok' : ''}"><div class="sn">${ok ? '✓' : n}</div><div class="sb"><b>${title0}</b>${body}</div></div>`;
  const s1 = step(1, c.lead_set, 'Lead RC', `<div>${leadRc ? nm(leadRc) : '–'} </div>${c.lead_set ? '' : '<div class="need-l">Tap a name below to choose</div>'}${c.can_set_lead ? `<div>${rcs.filter((p) => p.id !== c.lead).map((p) => `<button class="btn sm sec" data-act="pilLead" data-school="${c.school}" data-staff="${p.id}">Make ${esc(p.name.split(' ')[0])} lead</button>`).join(' ')}${!c.lead_set && leadRc ? ` <button class="btn sm" data-act="pilLead" data-school="${c.school}" data-staff="${leadRc.id}">Confirm ${esc(leadRc.name.split(' ')[0])}</button>` : ''}</div>` : ''}`);
  // step 2: place every test admin in a grade
  const unplaced = vols.filter((v) => !v.grade);
  const place = (v) => prow(v, '<span class="need-l">Tests · pick a grade</span>', c.editable.includes(v.r) ? `<select class="need" data-pg="${c.school}:${v.id}" aria-label="Place ${esc(v.name)} in a grade"><option value="" disabled selected>Place in…</option>${[1, 2, 3].map((g) => `<option value="${g}">Gr ${g}</option>`).join('')}</select>` : '<span class="m">their RC places them</span>');
  const s2 = step(2, unplaced.length === 0 && vols.length > 0, 'Place test admins in grades', `<div class="${unplaced.length ? 'need-l' : ''}">${P.withGrade} of ${vols.length} placed</div>${c.editable.length && unplaced.length ? `<div>${c.editable.map((r) => `<button class="btn sm sec" data-act="pilSpread" data-school="${c.school}" data-region="${r}">Place the rest evenly: ${esc(title(r))}</button>`).join(' ')}</div>` : ''}${unplaced.length ? `<details class="fd" data-pk="unp:${c.school}" ${pilOpen('unp:' + c.school, c.mine) ? 'open' : ''}><summary class="need-l">Not placed yet (${unplaced.length}) · tap to open</summary>${unplaced.map(place).join('')}</details>` : ''}`);
  // step 3: per grade: sampling lead, test admins (some also sample), ARCs who can sample
  const leadOpts = (g) => { const taken = Object.entries(SL).filter(([gg]) => Number(gg) !== g).map(([, id]) => id); return [...arcs, ...(assistant ? [assistant] : [])].filter((p) => !taken.includes(p.id)); };
  const gradeCard = (g) => {
    const lead = [...arcs, ...rcs].find((p) => p.id === SL[g]); const tv = vols.filter((v) => v.grade === g);
    const leadCtl = c.can_set_sampling ? `<select class="${SL[g] ? '' : 'need'}" data-psl="${c.school}:${g}" aria-label="Sampling lead, grade ${g}"><option value="">${SL[g] ? 'Not set' : 'Choose…'}</option>${leadOpts(g).map((p) => `<option value="${p.id}" ${SL[g] === p.id ? 'selected' : ''}>${esc(p.name)} (${p.role === 'rc' || rcs.some((x) => x.id === p.id) ? 'assistant RC' : 'ARC'}, ${esc(title(p.r))})</option>`).join('')}</select>` : lead ? esc(lead.name) : '<span class="m">not set</span>';
    const rows = tv.map((v) => prow(v, `<span class="chip c-navy">Tests</span> ${isSampler(g, v.id) ? '<span class="chip c-good">Samples</span>' : ''}`, `${canTeam(v.r) ? `<label class="cb"><input type="checkbox" data-psm="${c.school}:${g}:${v.id}" ${isSampler(g, v.id) ? 'checked' : ''}> Also samples</label>` : ''}${c.editable.includes(v.r) ? `<select data-pg="${c.school}:${v.id}" aria-label="Move ${esc(v.name)} to another grade"><option value="" disabled selected>Move…</option>${[1, 2, 3].filter((x) => x !== g).map((x) => `<option value="${x}">Gr ${x}</option>`).join('')}<option value="0">Unplace</option></select>` : ''}`)).join('') || '<div class="m">No test admins placed in this grade yet.</div>';
    const arcRows = arcs.map((p) => prow(p, SL[g] === p.id ? chip('Sampling lead', 'good') : 'Can run the sampling', canTeam(p.r) ? `<label class="cb"><input type="checkbox" data-psm="${c.school}:${g}:${p.id}" ${isSampler(g, p.id) || SL[g] === p.id ? 'checked' : ''} ${SL[g] === p.id ? 'disabled' : ''}> Runs sampling</label>` : (isSampler(g, p.id) || SL[g] === p.id ? 'Yes' : '–'))).join('');
    const ar = assistant && assistant.support === g ? `<div class="m">Assistant RC ${esc(assistant.name.split(' ')[0])} oversees this grade.</div>` : '';
    return `<div class="gcard"><h4>Grade ${g} <span class="m">${tv.length} test admin${tv.length === 1 ? '' : 's'} · ${(SM[g] || []).filter((id) => vols.some((v) => v.id === id)).length} sampling</span></h4>${ar}<div class="prow stack"><div class="pl"><b class="${lead ? '' : 'need-l'}">Sampling lead${lead ? '' : ' · choose one'}</b><div class="m">ARC or assistant RC</div></div><div class="pr">${leadCtl}</div></div>${rows}<details class="fd" data-pk="arc:${c.school}:${g}" ${pilOpen('arc:' + c.school + ':' + g, false) ? 'open' : ''}><summary>ARCs who can run the sampling</summary>${arcRows}</details></div>`;
  };
  const s3 = step(3, P.sl === 3, 'Sampling and testing, grade by grade', `<div class="m">Each grade has a sampling lead. Test admins can also run the sampling, but only in the grade they test.</div>${[1, 2, 3].map(gradeCard).join('')}`);
  const rcRows = rcs.map((p) => { const lead = p.id === c.lead; return prow(p, lead ? chip('Lead RC', 'good') : 'Assistant RC · oversees', gsel('ps', c.school, p.id, p.support, c.editable.includes(p.r), 'Grade for ' + p.name)); }).join('');
  const arcRows2 = arcs.map((p) => prow(p, Object.entries(SL).filter(([, id]) => id === p.id).map(([g]) => 'Leads sampling Gr ' + g).join('') || 'Sampling · tests if needed', gsel('ps', c.school, p.id, p.support, c.editable.includes(p.r), 'Grade for ' + p.name))).join('');
  return `${pilotLive(c).html}${c.mine ? pilotResults(c) : ''}<div class="pnext ${P.next === 'All set' ? 'ok' : ''}"><b>${P.next === 'All set' ? '✓ All set' : 'Next: ' + esc(P.next)}</b><div>${P.done} of ${P.total} done</div>${pbar(P.pct)}</div>${s1}${s2}${s3}
  <details class="fd" data-pk="rc:${c.school}" ${pilOpen('rc:' + c.school, false) ? 'open' : ''}><summary>RCs and ARCs: grade they also oversee or test (${rcs.length + arcs.length})</summary><h4 style="margin:6px 0 2px">RCs</h4>${rcRows}<h4 style="margin:8px 0 2px">ARCs</h4>${arcRows2}</details>`;
}
function pilotMine(c) { return `<div class="card pilot" style="margin-top:12px;border-left:4px solid var(--gold)"><h3 style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>${esc(title(c.name))} ${chip('your school', 'gold')}</span><span class="m" style="font-weight:400">${esc(c.regions.map(title).join(' + '))}${c.start ? ' · ' + esc(c.start) : ''}</span></h3>${pilotBody(c)}</div>`; }
function pilotFold(c, open) { const P = pilotProgress(c); const LV = pilotLive(c); return `<details class="card pilot pfold" style="margin-top:8px" data-pk="fold:${c.school}" ${pilOpen('fold:' + c.school, open) ? 'open' : ''}><summary><div class="psum"><b>${esc(title(c.name))}</b><span class="m">${esc(c.regions.map(title).join(' + '))} · ${LV.tested}/${LV.target} tested</span></div><div class="pmeta"><span class="m ${P.next === 'All set' ? '' : 'need-l'}">${P.next === 'All set' ? '✓ all set' : P.done + ' of ' + P.total + ' · tap to fill'}</span>${pbar(P.pct)}</div></summary>${pilotBody(c)}</details>`; }
function pilotTotal(d) {
  const all = d.schools.map(pilotLive); const t = all.reduce((a, x) => a + x.tested, 0), tg = all.reduce((a, x) => a + x.target, 0), sp = all.reduce((a, x) => a + x.samp, 0);
  return `<div class="card plivetot"><div class="lh"><b>Pilot day, live</b><span class="m">Updates every minute</span></div><div class="big">${t}<small> of ${tg} pupils tested</small></div>${pbar(Math.min(100, Math.round((100 * t) / (tg || 1))))}<div class="m">Sampling in for ${sp} of ${all.length * 3} school grades.</div></div>`;
}
function viewPilot() {
  const P = S.pil; if (!P) return '<div class="empty">Loading…</div>'; if (P.err) return `<div class="banner bad">${esc(P.err)}</div>`; const d = P.data; if (!d) return '<div class="empty">Loading…</div>';
  const mine = d.schools.filter((c) => c.mine), rest = roleKey() !== 'hq' ? [] : d.schools.filter((c) => !c.mine); // field staff see only their own school; HQ sees all five
  return `<div class="pagehead"><div><h2>Pilot day</h2><p>${esc(dayName(d.day))}: two regional teams at each school.</p><ul class="brief"><li><b>Lead RC</b> leads the day. The <b>assistant RC</b> supports, oversees one grade and can lead the sampling in one grade.</li><li>Each grade has a <b>sampling lead</b>: an ARC or the assistant RC.</li><li><b>Test admins</b> test one grade. Some also run the sampling in that same grade, guided by the ARC. ARCs can run the sampling too.</li></ul></div></div>
  ${pilotTotal(d)}
  ${mine.map(pilotMine).join('')}${!mine.length && roleKey() !== 'hq' ? '<div class="card" style="margin-top:12px"><b class="need-l">We could not find your pilot school.</b><div class="m">Every RC, ARC and volunteer is placed at one. Tell HQ so your record can be checked.</div></div>' : ''}${rest.length ? `<h3 style="margin:18px 0 0">${mine.length ? 'The other pilot schools' : 'The five pilot schools'}</h3>${rest.map((c) => pilotFold(c, false)).join('')}` : ''}`;
}
async function pilotAction(a, t) {
  try { if (a === 'pilSpread') await api('/api/pilot', { method: 'POST', body: { action: 'spread', school: t.dataset.school, region: t.dataset.region } }); else if (a === 'pilLead') await api('/api/pilot', { method: 'POST', body: { action: 'lead', school: t.dataset.school, staff_id: t.dataset.staff } }); await loadPilot(); }
  catch (e) { alert(e.message); await loadPilot(); }
}

// ---------- Admin: KoBo storage and deleting photos ----------
const gb = (b) => (b == null ? '–' : (b / 1e9).toFixed(2) + ' GB');
function storageCard() {
  const T = S.storage; if (!T) return '';
  const can = hqLevel() === 'admin' && S.who?.hq_id && (S.who.review_level || 0) >= 3; S.stMsg ||= {};
  const rows = T.projects.map((p) => `<div class="formbox"><b>${esc(p.name)}</b> <span class="pill mute">${esc(p.status || '')}</span> · ${gb(p.bytes)} · ${fmt(p.submissions)} submissions${p.protected ? ' <span class="pill good">protected: files here are never deleted</span>' : ''}
    ${!p.protected && can ? `<div class="mf"><label class="cb"><input type="checkbox" id="stk-${esc(p.asset)}"> I saved all the files of this project and checked them</label><label>Type the project name to confirm<input id="stc-${esc(p.asset)}" placeholder="${esc(p.name)}"></label></div><button class="btn sm sec" data-act="stDel" data-asset="${esc(p.asset)}" data-n="3">1. Test with 3 photos</button> <button class="btn sm" style="background:var(--bad,#b8432a);color:#fff" data-act="stDel" data-asset="${esc(p.asset)}" data-n="0">2. Delete all the photos</button><p class="m">Only photos go. The records and the small audit-log files stay. This cannot be undone from KoBo.</p>` : !p.protected ? `<p class="m">Deleting files needs <b>Final approval</b> rights. Yours are: ${S.who?.hq_id ? (['No review', 'No review', 'First review', 'Final approval'][S.who.review_level || 0]) : 'the shared code'}. An Admin can change this in <b>HQ team and access levels</b>, Query review column. Only Michael or Mundo should have it.</p>` : ''}${S.stMsg[p.asset] ? `<p class="m"><b>${esc(S.stMsg[p.asset])}</b></p>` : ''}</div>`).join('');
  const hrs = T.dash ? Object.entries(T.dash.hours).sort() : []; const dsum = hrs.reduce((a, [, x]) => a + x.n, 0);
  const dashLine = T.dash ? `<p class="m" style="margin-top:10px"><b>This dashboard's own load</b> (Cloudflare free plan allows 100,000 storage requests a day; the count restarts at 03:00 East Africa time): ${fmt(dsum)} in the last ${hrs.length} hour(s) since ${esc(new Date(T.dash.since).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}. Busiest hour: ${hrs.length ? esc(hrs.slice().sort((a, b) => b[1].n - a[1].n)[0][0].replace('T', ' ') + ':00 UTC') + ' with ' + fmt(hrs.slice().sort((a, b) => b[1].n - a[1].n)[0][1].n) : '–'}.</p>` : '';
  return `<div class="card" style="margin-top:14px"><h3>KoBo storage and files</h3><div class="sub">Used <b>${gb(T.used)}</b> of <b>${gb(T.limit)}</b>${T.exceeded ? ' · <span class="pill bad">over the limit: KoBo refuses new submissions</span>' : ' · <span class="pill good">within the limit</span>'} · Submissions this 30-day period: ${fmt(T.submissions_period ?? 0)} of ${fmt(T.submissions_limit ?? 0)}. Photos are what fills the space. Save a copy of the files before deleting.</div>${rows || '<p class="m">No project holds more than 1 MB.</p>'}${dashLine}</div>`;
}
async function storageAction(t) {
  const asset = t.dataset.asset, n = Number(t.dataset.n); S.stMsg ||= {};
  const name = (S.storage.projects.find((p) => p.asset === asset) || {}).name; const typed = (document.getElementById('stc-' + asset)?.value || '').trim(); const ok = document.getElementById('stk-' + asset)?.checked;
  if (!ok) { S.stMsg[asset] = 'Tick the box: confirm the files were saved and checked.'; render(); return; }
  if (typed !== name) { S.stMsg[asset] = 'Type the project name exactly.'; render(); return; }
  if (!confirm(n ? `Delete ${n} photos as a test?` : 'Delete ALL the photos in this project now? The records stay. This cannot be undone from KoBo.')) return;
  S.stMsg[asset] = 'Working… this can take a few minutes.'; render();
  try {
    let total = 0, gone = 0, first = null, last = null;
    for (let i = 0; i < 40; i++) {
      const r = await api('/api/admin/attach', { method: 'POST', body: { asset, confirm: typed, copy_ok: true, ...(n ? { batch_limit: n } : {}), reason: 'Free KoBo storage. Records kept. Files saved first. Approved by Michael Kamukulu 12 Oct 2026.' } });
      first = first || r; last = r; total += r.deleted || 0; gone += r.already_gone || 0; S.stMsg[asset] = `Deleted ${total} photo(s) so far, ${r.remaining} left…`; render();
      if (n || r.done || r.remaining === 0 || r.problems?.length || (!r.deleted && !r.already_gone)) break;
    }
    S.stMsg[asset] = `Deleted ${total} photo(s)${gone ? ` (${gone} were already gone from KoBo)` : ''}. Photos left in the project: ${last.remaining}. Storage ${gb(first.storage_before)} to ${gb(last.storage_after)}${last.problems?.length ? ' · problems: ' + last.problems.join('; ') : ''}. KoBo can take a little while to update the storage figure.${last.remaining ? ' Press the button again to continue.' : ''}`;
  } catch (e) { S.stMsg[asset] = e.message; }
  try { S.storage = await api('/api/admin/storage'); } catch { /* keep the old figures */ }
  render();
}

// ---------- Admin: Forms ----------
function formsCard() {
  const F = S.forms; if (!F) return '';
  S.formRes ||= {}; S.formMsg ||= {}; S.formFile ||= {};
  const cards = F.forms.map((f) => {
    if (f.error) return `<div class="orow"><b>${esc(f.label)}</b> <span class="pill bad">${esc(f.error)}</span></div>`;
    const res = S.formRes[f.asset] || f.rehearsal; const file = S.formFile[f.asset];
    const okReh = res && res.ok && file && res.hash === file.hash;
    const last = (F.history || []).find((h) => h.asset === f.asset && h.ok && h.previous_version && h.file !== 'ROLLBACK') || (F.history || []).find((h) => h.asset === f.asset && h.ok && h.previous_version);
    const probs = res ? `${res.ok ? '<div class="banner" style="background:var(--good-bg,#e8f5ec)"><b>Rehearsal passed</b> for ' + esc(res.file || '') + ' (' + esc(new Date(res.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })) + ')</div>' : `<div class="banner bad"><b>Rehearsal found problems.</b></div>`}${(res.problems || []).map((x) => `<p class="m" style="color:var(--bad)">• ${esc(x)}</p>`).join('')}${(res.notes || []).map((x) => `<p class="m">• ${esc(x)}</p>`).join('')}<p class="m">Rows: live ${res.rows_live ?? '–'}, new ${res.rows_new ?? '–'}. ${(res.log || []).map(esc).join(' ')}</p>` : '';
    return `<div class="formbox"><h4 style="margin:0 0 4px">${esc(f.label)} <span class="pill mute">${esc(f.name || '')}</span></h4><div class="sub">${f.rows} rows · ${fmt(f.submissions)} submissions · deployed ${f.date_deployed ? new Date(f.date_deployed).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '–'}${f.draft ? ' · <b>has an undeployed draft</b>' : ''}</div>
    <div class="f" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input type="file" accept=".xlsx" data-ffile="${esc(f.asset)}">${file ? `<span class="m">${esc(file.name)}</span>` : ''}<button class="btn sm sec" data-act="fmRehearse" data-asset="${esc(f.asset)}">1. Rehearse on a throwaway copy</button></div>
    ${S.formMsg[f.asset] ? `<p class="m">${esc(S.formMsg[f.asset])}</p>` : ''}${probs}
    ${okReh ? `<div class="f" style="margin-top:8px"><label>2. To deploy to the LIVE project, type its name: <b>${esc(f.name)}</b><input id="fmc-${esc(f.asset)}" placeholder="${esc(f.name)}"></label><button class="btn sm" data-act="fmDeploy" data-asset="${esc(f.asset)}">Deploy to the live project</button></div>` : '<p class="m">Deploying unlocks after a passing rehearsal of the same file.</p>'}
    ${last ? `<div style="margin-top:8px"><button class="btn sm ghost" data-act="fmRollback" data-asset="${esc(f.asset)}">Roll back to the earlier version</button> <span class="m">earlier version from ${esc(new Date(last.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}</span></div>` : ''}</div>`;
  }).join('');
  const hist = (F.history || []).slice(0, 8).map((h) => `<tr><td>${esc(new Date(h.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}</td><td>${esc(h.label)}</td><td>${esc(h.file || '')}</td><td>${esc(h.by)}</td><td>${h.ok ? '<span class="pill good">done</span>' : '<span class="pill bad">stopped</span>'}</td></tr>`).join('');
  return `<div class="card" style="margin-top:14px"><h3>Forms in KoBo</h3><div class="sub">Replace a form without leaving the dashboard. The file is first tried on a throwaway copy (import, deploy, roll back, delete). Only then can you deploy it to the live project, by typing the project name. Submissions are never touched, and a roll back puts the earlier version back.</div>${cards}${hist ? `<h4 style="margin:14px 0 4px">Recent form changes</h4><div class="tbl"><table><thead><tr><th>When</th><th>Form</th><th>File</th><th>By</th><th></th></tr></thead><tbody>${hist}</tbody></table></div>` : ''}</div>`;
}
async function formsAction(a, t) {
  const asset = t.dataset.asset; S.formMsg ||= {}; S.formRes ||= {}; S.formFile ||= {};
  try {
    if (a === 'fmRehearse') {
      const F = S.formFile[asset]; if (!F) { S.formMsg[asset] = 'Choose the XLSX file first.'; render(); return; }
      S.formMsg[asset] = 'Rehearsing on a throwaway copy. This takes about a minute…'; render();
      const r = await api('/api/admin/forms', { method: 'POST', body: { action: 'rehearse', asset, filename: F.name, xlsx_b64: F.b64 } }); S.formRes[asset] = r; S.formMsg[asset] = r.ok ? 'Rehearsal passed.' : 'Rehearsal found problems. Fix the file and rehearse again.';
    } else if (a === 'fmDeploy') {
      const F = S.formFile[asset]; const typed = (document.getElementById('fmc-' + asset)?.value || '').trim();
      if (!confirm('Deploy this file to the LIVE project now? Phones pick it up the next time they refresh forms. Submissions are not touched.')) return;
      S.formMsg[asset] = 'Deploying…'; render();
      const r = await api('/api/admin/forms', { method: 'POST', body: { action: 'deploy', asset, filename: F.name, xlsx_b64: F.b64, confirm: typed } }); S.formMsg[asset] = `Deployed. ${r.rows} rows, ${fmt(r.submissions)} submissions kept. Earlier version id kept for roll back.`; S.formRes[asset] = null; S.formFile[asset] = null;
    } else if (a === 'fmRollback') {
      const typed = prompt('To roll back, type the project name exactly:'); if (!typed) return;
      S.formMsg[asset] = 'Rolling back…'; render();
      const r = await api('/api/admin/forms', { method: 'POST', body: { action: 'rollback', asset, confirm: typed } }); S.formMsg[asset] = `Rolled back. ${r.rows} rows, ${fmt(r.submissions)} submissions kept.`;
    }
  } catch (e) { S.formMsg[asset] = e.message; }
  try { S.forms = await api('/api/admin/forms'); } catch { /* keep the old list */ }
  render();
}

// ---------- Messages hub (compose, schedule, templates, built-in emails, log) ----------
const MS_TABS = [['compose', 'Compose'], ['jobs', 'Scheduled and repeating'], ['tpl', 'Templates'], ['builtin', 'Built-in emails'], ['log', 'Sent log']];
const DOW = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const BUILTIN_TXT = { morning: ['Morning brief and update', 'Progress, plans, calendar changes, checks, today and tomorrow. To HQ and coordinators, Monday to Friday.'], evening: ['End-of-day check', 'Schools that started and are not complete. Field days only. Not sent when nothing is open.'], reminder: ['Reminders', 'Plan not submitted, notices due, queries waiting. Not sent when nothing is due.'] };
const msBlank = () => ({ id: null, name: '', subject: '', body: '', channels: { email: true, push: false, news: false }, audience: { roles: ['rc', 'arc'], regions: [], people: [] }, schedule: { type: 'now', at: '', time: '08:00', days: [1, 2, 3, 4, 5], from: '', until: '' } });
async function loadMsgs() { try { const d = await api('/api/admin/messages'); S.msg = { ...(S.msg || {}), data: d, tab: S.msg?.tab || 'compose', draft: S.msg?.draft || msBlank(), note: S.msg?.note || '' }; } catch (e) { S.msg = { ...(S.msg || {}), err: e.message }; } }
function msRead() {
  const D = (S.msg.draft ||= msBlank()); const g = (id) => document.getElementById(id); if (!g('mcSubj')) return D;
  D.subject = g('mcSubj').value; D.body = g('mcBody').value; D.name = g('mcName')?.value || D.name;
  D.channels = { email: g('mcEmail').checked, push: g('mcPush').checked, news: g('mcNews').checked }; D.cc_hq = g('mcCc') ? g('mcCc').checked : D.cc_hq;
  D.audience = { roles: ['hq', 'rc', 'arc', 'volunteer'].filter((r) => g('mcR-' + r)?.checked), regions: [...document.querySelectorAll('[data-mreg]')].filter((x) => x.checked).map((x) => x.dataset.mreg), people: [...document.querySelectorAll('[data-mpe]')].filter((x) => x.checked).map((x) => x.dataset.mpe) };
  const t = document.querySelector('input[name=mcWhen]:checked')?.value || 'now';
  D.schedule = { type: t, at: g('mcAt').value, time: g('mcTime').value || '08:00', days: [...document.querySelectorAll('[data-mday]')].filter((x) => x.checked).map((x) => Number(x.dataset.mday)), from: g('mcFrom').value, until: g('mcUntil').value };
  return D;
}
const msBody = (D) => ({ ...D, name: D.name || D.subject, schedule: { ...D.schedule, at: D.schedule.type === 'once' && D.schedule.at ? eatIso(D.schedule.at) : null } });
function msCount(D) {
  const A = D.audience, P = S.msg.data.people; const regs = new Set(A.regions.map((r) => r.toUpperCase()));
  const em = P.filter((p) => A.people.includes(p.email) || (A.roles.includes(p.role) && (p.role === 'hq' || !regs.size || regs.has(String(p.region || '').toUpperCase())))).length;
  return em;
}
function viewMessages() {
  const M = S.msg; if (!M) return '<div class="empty">Loading…</div>'; if (M.err) return `<div class="banner bad">${esc(M.err)}</div>`; if (!M.data) return '<div class="empty">Loading…</div>';
  const t = M.tab || 'compose'; const d = M.data; const pend = d.jobs.filter((j) => j.status === 'pending').length;
  const bar = `<div class="sel" style="margin:8px 0 12px;flex-wrap:wrap">${MS_TABS.map(([k, n]) => `<button class="btn sm ${k === t ? '' : 'sec'}" data-act="msTab" data-t="${k}">${n}${k === 'jobs' && d.jobs.filter((j) => ['scheduled', 'pending', 'paused'].includes(j.status)).length ? ` (${d.jobs.filter((j) => ['scheduled', 'pending', 'paused'].includes(j.status)).length})` : ''}${k === 'jobs' && pend ? ' ⚑' : ''}</button>`).join('')}</div>`;
  const head = `<div class="pagehead"><div><h2>Messages</h2><p>Write a message, send it now, schedule it once or repeat it. Emails, phone alerts and News all work from here.</p></div></div>${d.sending_on ? '' : '<div class="banner bad"><b>Email sending is switched off in this system.</b> Phone alerts and News still work.</div>'}${M.note ? `<div class="banner" style="background:var(--surface2)">${esc(M.note)}</div>` : ''}`;
  return head + bar + ({ compose: msCompose, jobs: msJobs, tpl: msTpl, builtin: msBuiltin, log: msLog }[t] || msCompose)();
}
function msCompose() {
  const M = S.msg, d = M.data, D = M.draft || msBlank(); const can = canWrite(); const sc = D.schedule;
  const chips = d.fields.map((f) => `<button type="button" class="chipbtn" data-act="msInsert" data-f="${f}">{${f}}</button>`).join(' ');
  const roleBox = [['hq', 'HQ'], ['rc', 'RCs'], ['arc', 'ARCs'], ['volunteer', 'Volunteers (phone alert and News only)']].map(([k, n]) => `<label class="cb"><input type="checkbox" id="mcR-${k}" ${D.audience.roles.includes(k) ? 'checked' : ''}> ${n}</label>`).join(' ');
  const regBox = d.regions.map((r) => `<label class="cb"><input type="checkbox" data-mreg="${r}" ${D.audience.regions.includes(r) ? 'checked' : ''}> ${esc(title(r))}</label>`).join(' ');
  const peBox = d.people.map((p) => `<label class="cb"><input type="checkbox" data-mpe="${esc(p.email)}" ${D.audience.people.includes(p.email) ? 'checked' : ''}> ${esc(p.name)} <span class="m">${esc((p.role || '').toUpperCase())}${p.region ? ' · ' + esc(title(p.region)) : ''}</span></label>`).join(' ');
  const n = msCount(D);
  return `<div class="card"><h3>${D.id ? 'Edit message' : 'New message'}</h3>
  <div class="mf"><label>Start from a template<select id="mcTpl"><option value="">None</option>${d.templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label></div>
  <div class="mf"><label>Subject<input id="mcSubj" value="${esc(D.subject)}" placeholder="What is it about?"></label></div>
  <div class="mf"><label>Message<textarea id="mcBody" rows="8" placeholder="Write it as you would speak to the person.">${esc(D.body)}</textarea></label><div class="m" style="margin-top:4px">Fields filled for each person: ${chips}</div></div>
  <div class="mf"><b>How</b><div>${['email:Email', 'push:Phone alert', 'news:News feed'].map((x) => { const [k, nme] = x.split(':'); return `<label class="cb"><input type="checkbox" id="mc${k[0].toUpperCase() + k.slice(1)}" ${D.channels[k] ? 'checked' : ''}> ${nme}</label>`; }).join(' ')}</div></div>
  <div class="mf"><label class="cb"><input type="checkbox" id="mcCc" ${D.cc_hq === false ? '' : 'checked'}> Copy Michael, Mundo and Joram on each email</label></div>
  <div class="mf"><b>Who</b><div>${roleBox}</div>
  <details class="fd"><summary>Regions (everyone if none ticked)</summary><div>${regBox}</div></details><details class="fd"><summary>Add named people (emails)${D.audience.people.length ? ' · ' + D.audience.people.length + ' chosen' : ''}</summary><div style="columns:2;min-width:0">${peBox}</div></details>
  <div class="m" style="margin-top:6px">Email goes to <b>${n}</b> address${n === 1 ? '' : 'es'} on the email list.</div></div>
  <div class="mf"><b>When</b><div><label class="cb"><input type="radio" name="mcWhen" value="now" ${sc.type === 'now' ? 'checked' : ''}> Send now</label> <label class="cb"><input type="radio" name="mcWhen" value="once" ${sc.type === 'once' ? 'checked' : ''}> Once, later</label> <label class="cb"><input type="radio" name="mcWhen" value="repeat" ${sc.type === 'repeat' ? 'checked' : ''}> Repeat</label></div>
  <div style="${sc.type === 'once' ? '' : 'display:none'}" id="mcOnce"><label>Date and time (East Africa time)<input type="datetime-local" id="mcAt" value="${esc(sc.at || '')}"></label></div>
  <div style="${sc.type === 'repeat' ? '' : 'display:none'}" id="mcRep"><div>${DOW.map(([k, nme]) => `<label class="cb"><input type="checkbox" data-mday="${k}" ${sc.days.includes(k) ? 'checked' : ''}> ${nme}</label>`).join(' ')}</div><div style="display:flex;gap:10px;flex-wrap:wrap"><label>At<input type="time" id="mcTime" value="${esc(sc.time)}"></label><label>From<input type="date" id="mcFrom" value="${esc(sc.from || '')}"></label><label>Until<input type="date" id="mcUntil" value="${esc(sc.until || '')}"></label></div><div class="m">${can && S.who.level !== 'admin' ? 'A repeating message waits for an Admin to approve it.' : ''}</div></div></div>
  <div class="mf"><label>Name for the list (optional)<input id="mcName" value="${esc(D.name || '')}"></label></div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn sec" data-act="msPolish">Polish with AI</button><button class="btn sec" data-act="msPreview">Preview</button><input id="mcTest" type="email" placeholder="test to my email" value="${esc(store.get('kf_test_to') || '')}" style="max-width:220px"><button class="btn sec" data-act="msTest">Send test</button><button class="btn sec" data-act="msTplSave">Save as template</button>${D.id ? '<button class="btn ghost" data-act="msNew">Start a new one</button>' : ''}</div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${can ? `<button class="btn" data-act="msSend">${sc.type === 'now' ? 'Send now' : sc.type === 'once' ? 'Schedule' : 'Start repeating'}</button>` : '<span class="m">Viewers can read only.</span>'}</div>
  ${M.preview ? `<div style="margin-top:12px"><div class="banner" style="background:var(--warn-bg)"><b>PREVIEW, NOT SENT.</b> Subject: ${esc(M.preview.subject)} · shown for ${esc(M.preview.sample)}</div><iframe sandbox title="Preview" style="width:100%;height:380px;border:1px solid var(--line);border-radius:8px" srcdoc="${esc(M.preview.html)}"></iframe></div>` : ''}</div>`;
}
const msWhen = (j) => { const s = j.schedule; return s.type === 'once' ? 'Once, ' + (s.at ? eatTime(s.at) : '') : s.type === 'repeat' ? `${s.days.length === 5 && [1, 2, 3, 4, 5].every((x) => s.days.includes(x)) ? 'Every working day' : DOW.filter(([k]) => s.days.includes(k)).map(([, n]) => n).join(', ')} at ${s.time}${s.from ? ' from ' + s.from : ''}${s.until ? ' until ' + s.until : ''}` : 'Sent now'; };
const msWho = (j) => [...j.audience.roles.map((r) => ({ hq: 'HQ', rc: 'RCs', arc: 'ARCs', volunteer: 'Volunteers' }[r])), j.audience.regions.length ? 'in ' + j.audience.regions.map(title).join(', ') : '', j.audience.people.length ? `+${j.audience.people.length} named` : ''].filter(Boolean).join(' ');
function msJobs() {
  const d = S.msg.data, can = canWrite(), admin = S.who.level === 'admin' || !S.who.level;
  const rows = d.jobs.slice().sort((a, b) => (a.status === 'sent') - (b.status === 'sent') || (b.created_at > a.created_at ? 1 : -1)).map((j) => `<tr><td><b>${esc(j.name)}</b><div class="m">${esc(j.subject)}</div></td><td>${['email', 'push', 'news'].filter((k) => j.channels[k]).map((k) => ({ email: 'Email', push: 'Phone alert', news: 'News' }[k])).join(', ')}</td><td>${esc(msWho(j))}</td><td>${esc(msWhen(j))}${j.next ? `<div class="m">Next: ${esc(j.next)}</div>` : ''}${j.last_at ? `<div class="m">Last: ${esc(eatTime(j.last_at))}</div>` : ''}</td><td>${chip(({ scheduled: 'scheduled', pending: 'needs approval', paused: 'paused', sent: 'sent', ended: 'ended', draft: 'draft' })[j.status] || j.status, j.status === 'scheduled' ? 'good' : j.status === 'pending' ? 'warn' : 'mute')}<div class="m">by ${esc(j.by || '')}</div></td><td style="white-space:nowrap">${can ? `${j.status !== 'sent' ? `<button class="btn sm sec" data-act="msEdit" data-id="${j.id}">Edit</button> ` : `<button class="btn sm sec" data-act="msEdit" data-id="${j.id}" data-copy="1">Copy</button> `}${j.status === 'pending' && admin ? `<button class="btn sm" data-act="msJob" data-op="job_approve" data-id="${j.id}">Approve</button> ` : ''}${j.status === 'scheduled' ? `<button class="btn sm ghost" data-act="msJob" data-op="job_pause" data-id="${j.id}">Pause</button> ` : ''}${j.status === 'paused' ? `<button class="btn sm ghost" data-act="msJob" data-op="job_resume" data-id="${j.id}">Resume</button> ` : ''}${['scheduled', 'paused'].includes(j.status) ? `<button class="btn sm ghost" data-act="msJob" data-op="job_run" data-id="${j.id}" data-ask="Send this message now to everyone it is set for?">Send now</button> ` : ''}<button class="btn sm ghost" data-act="msJob" data-op="job_delete" data-id="${j.id}" data-ask="Delete this message?">Delete</button>` : ''}</td></tr>`).join('');
  return `<div class="card"><h3>Scheduled and repeating</h3><div class="sub">Everything written here. Pause a repeating message any time. A repeating message from an Editor waits for an Admin.</div><div class="tbl dt-wrap"><table class="dt"><thead><tr><th>Message</th><th>How</th><th>Who</th><th>When</th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">Nothing yet. Write one in Compose.</td></tr>'}</tbody></table></div></div>`;
}
function msTpl() {
  const d = S.msg.data, can = canWrite(); const E = S.msg.tplEdit;
  const rows = d.templates.map((t) => `<tr><td><b>${esc(t.name)}</b><div class="m">${esc(t.subject)}</div></td><td class="m">${esc(t.body.slice(0, 120))}${t.body.length > 120 ? '…' : ''}</td><td style="white-space:nowrap">${can ? `<button class="btn sm" data-act="msUse" data-id="${t.id}">Use</button> <button class="btn sm sec" data-act="msTplEdit" data-id="${t.id}">Edit</button> <button class="btn sm ghost" data-act="msTplDel" data-id="${t.id}">Delete</button>` : ''}</td></tr>`).join('');
  const form = E ? `<div class="card" style="margin-top:14px"><h3>${E.id ? 'Edit template' : 'New template'}</h3><div class="mf"><label>Name<input id="tpN" value="${esc(E.name)}"></label></div><div class="mf"><label>Subject<input id="tpS" value="${esc(E.subject)}"></label></div><div class="mf"><label>Message<textarea id="tpB" rows="7">${esc(E.body)}</textarea></label><div class="m">Fields: ${d.fields.map((f) => '{' + f + '}').join(' ')}</div></div><div style="display:flex;gap:8px"><button class="btn" data-act="msTplOk">Save template</button><button class="btn ghost" data-act="msTplCancel">Cancel</button></div></div>` : '';
  return `<div class="card"><h3>Templates</h3><div class="sub">Ready-made wording you can edit. Fields like {first_name} fill in for each person.</div>${can ? '<p><button class="btn sm" data-act="msTplEdit" data-id="">New template</button></p>' : ''}<div class="tbl dt-wrap"><table class="dt"><thead><tr><th>Name</th><th>Message</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>${form}`;
}
function msBuiltin() {
  const d = S.msg.data; const admin = S.who.level === 'admin' || !S.who.level; const sched = S.adm?.emailSched;
  const rows = Object.entries(d.builtin).map(([k, c]) => `<tr><td><b>${BUILTIN_TXT[k][0]}</b><div class="m">${BUILTIN_TXT[k][1]}</div></td><td class="c"><input type="checkbox" data-bi="${k}" data-f="enabled" ${c.enabled ? 'checked' : ''} ${admin ? '' : 'disabled'}></td><td><input type="time" data-bi="${k}" data-f="time" value="${esc(c.time)}" ${admin ? '' : 'disabled'}></td><td><input data-bi="${k}" data-f="note" value="${esc(c.note || '')}" placeholder="Optional note at the top" ${admin ? '' : 'disabled'}></td><td>${admin ? `<button class="btn sm" data-act="msBuiltin" data-k="${k}">Save</button>` : ''}</td></tr>`).join('');
  return `<div class="card"><h3>Built-in emails</h3><div class="sub">These go out by themselves on working days (the other automatic emails, such as the weekly backup, are listed in Admin under Automatic emails). An Admin can switch one off, change its time (East Africa time) or add a note at the top. The contents (numbers, plans, your day) are filled in automatically.</div><div class="tbl dt-wrap"><table class="dt"><thead><tr><th>Email</th><th class="c">On</th><th>Time</th><th>Note</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
function msLog() {
  const rows = S.msg.data.log.map((l) => `<tr><td>${esc(eatTime(l.at))}</td><td><b>${esc(l.name)}</b></td><td>${esc(l.by || '')}</td><td>${l.email ? `Email: ${l.email.sent}/${l.email.people}${l.email.errors?.length ? ` <span class="pill bad">${l.email.errors.length} problem${l.email.errors.length > 1 ? 's' : ''}</span>` : ''}` : ''}${l.push ? ` Alert: ${l.push.sent ?? 0}${l.push.skipped ? ' (' + esc(l.push.skipped) + ')' : ''}` : ''}${l.news ? ' News: ' + (l.news.ok ? 'posted' : esc(l.news.error || 'not posted')) : ''}</td></tr>`).join('');
  return `<div class="card"><h3>Sent log</h3><div class="sub">Every message sent from here, newest first. Built-in emails are listed in Admin.</div><div class="tbl dt-wrap"><table class="dt"><thead><tr><th>When</th><th>Message</th><th>By</th><th>Result</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">Nothing sent yet.</td></tr>'}</tbody></table></div></div>`;
}
async function msAction(a, t) {
  const M = S.msg; M.note = '';
  try {
    if (a === 'msTab') { msRead(); M.tab = t.dataset.t; M.preview = null; }
    else if (a === 'msInsert') { msRead(); M.draft.body += (M.draft.body && !/\s$/.test(M.draft.body) ? ' ' : '') + '{' + t.dataset.f + '}'; }
    else if (a === 'msNew') { M.draft = msBlank(); M.preview = null; }
    else if (a === 'msPreview') { const D = msRead(); M.preview = await api('/api/admin/messages', { method: 'POST', body: { action: 'preview', ...msBody(D) } }); }
    else if (a === 'msTest') { const D = msRead(); const to = document.getElementById('mcTest').value.trim(); store.set('kf_test_to', to); const r = await api('/api/admin/messages', { method: 'POST', body: { action: 'test', to, ...msBody(D) } }); M.note = 'Test sent to ' + r.sent_to + '.'; }
    else if (a === 'msPolish') { const D = msRead(); M.note = 'Polishing…'; render(); const r = await api('/api/admin/messages', { method: 'POST', body: { action: 'polish', subject: D.subject, body: D.body } }); D.subject = r.title || D.subject; D.body = r.body || D.body; M.note = 'Polished. Read it carefully before you send.'; }
    else if (a === 'msSend') {
      const D = msRead(); const n = msCount(D); const sc = D.schedule.type;
      if (sc === 'now' && !confirm(`Send "${D.subject}" now? ${D.channels.email ? n + ' email address' + (n === 1 ? '' : 'es') + '. ' : ''}${D.channels.push ? 'Phone alerts too. ' : ''}${D.channels.news ? 'It will be posted in News. ' : ''}`)) return;
      const r = await api('/api/admin/messages', { method: 'POST', body: { action: sc === 'now' ? 'job_send' : 'job_save', ...msBody(D) } });
      M.note = sc === 'now' ? `Sent. ${r.sent?.email ? 'Emails: ' + r.sent.email.sent + ' of ' + r.sent.email.people + '. ' : ''}${r.sent?.push ? 'Phone alerts: ' + (r.sent.push.sent ?? 0) + '. ' : ''}${r.sent?.news ? 'Posted in News.' : ''}` : r.status === 'pending' ? 'Saved. It waits for an Admin to approve it.' : 'Scheduled.';
      M.draft = msBlank(); M.tab = sc === 'now' ? 'log' : 'jobs'; M.preview = null;
    }
    else if (a === 'msTplSave') { const D = msRead(); const name = prompt('Name for this template:', D.subject); if (!name) return; await api('/api/admin/messages', { method: 'POST', body: { action: 'template_save', name, subject: D.subject, body: D.body } }); M.note = 'Template saved.'; }
    else if (a === 'msUse') { const tp = M.data.templates.find((x) => x.id === t.dataset.id); M.draft = { ...msBlank(), subject: tp.subject, body: tp.body }; M.tab = 'compose'; }
    else if (a === 'msTplEdit') { const tp = M.data.templates.find((x) => x.id === t.dataset.id); M.tplEdit = tp ? { ...tp } : { id: null, name: '', subject: '', body: '' }; }
    else if (a === 'msTplCancel') { M.tplEdit = null; }
    else if (a === 'msTplOk') { const E = M.tplEdit; await api('/api/admin/messages', { method: 'POST', body: { action: 'template_save', id: E.id, name: document.getElementById('tpN').value, subject: document.getElementById('tpS').value, body: document.getElementById('tpB').value } }); M.tplEdit = null; M.note = 'Template saved.'; }
    else if (a === 'msTplDel') { if (!confirm('Delete this template?')) return; await api('/api/admin/messages', { method: 'POST', body: { action: 'template_delete', id: t.dataset.id } }); }
    else if (a === 'msEdit') { const j = M.data.jobs.find((x) => x.id === t.dataset.id); const cp = Boolean(t.dataset.copy); M.draft = { ...msBlank(), ...JSON.parse(JSON.stringify(j)), id: cp ? null : j.id, name: j.name, schedule: { ...j.schedule, at: j.schedule.at ? new Date(Date.parse(j.schedule.at) + 3 * 3600e3).toISOString().slice(0, 16) : '', from: j.schedule.from || '', until: j.schedule.until || '' } }; if (cp) M.draft.schedule.type = 'now'; M.tab = 'compose'; }
    else if (a === 'msJob') { if (t.dataset.ask && !confirm(t.dataset.ask)) return; const r = await api('/api/admin/messages', { method: 'POST', body: { action: t.dataset.op, id: t.dataset.id } }); if (t.dataset.op === 'job_run') M.note = 'Sent.'; }
    else if (a === 'msBuiltin') { const k = t.dataset.k; const g = (f) => document.querySelector(`[data-bi="${k}"][data-f="${f}"]`); await api('/api/admin/messages', { method: 'POST', body: { action: 'builtin_save', id: k, enabled: g('enabled').checked, time: g('time').value, note: g('note').value } }); M.note = 'Saved. It applies from the next run.'; try { S.adm.emailSched = await api('/api/admin/email-schedule'); } catch { /* shown on next Admin visit */ } }
    await loadMsgs();
  } catch (e) { M.note = e.message; }
  render();
}

// ---------- Data cleaning: suggest, review and carry out deletions through the approval chain ----------
const DEL_STEPS = [['suggested', 'Suggested'], ['initiated', 'Initiated by Joram'], ['deleted', 'Decided by Mundo']];
const DEL_IX = { suggested: 0, initiated: 1, rework: 0, deleted: 2, done: 2, rejected: 2, withdrawn: 0 };
async function loadClean() { try { S.cl = { ...(S.cl || {}), data: await api('/api/deletions'), err: null }; } catch (e) { S.cl = { ...(S.cl || {}), err: e.message }; } if (S.who?.role === 'hq' && !S.allSchools) ensureSchools(); }
const meId = () => String(S.who?.id ?? S.who?.hq_id ?? '');
const myLvl = () => (S.who?.role === 'hq' ? S.who.review_level || 0 : 0);
function delAbility(r) {
  const me = meId(), lv = myLvl(), open = ['suggested', 'initiated', 'rework'].includes(r.stage); const o = { initiate: false, del: false, back: false, resub: false, withdraw: false };
  if (!open || S.viewAs) return o;
  if (r.stage === 'suggested') { o.initiate = lv >= 2 && r.by_id !== me; o.back = lv >= 2; }
  if (r.stage === 'initiated') { o.del = lv >= 3 && r.initiated_by !== me; o.back = lv >= 3; }
  if (r.stage === 'rework') o.resub = r.by_id === me;
  o.withdraw = r.by_id === me;
  return o;
}
function delChain(r) {
  const ix = DEL_IX[r.stage] ?? 0; const bad = ['rejected', 'withdrawn'].includes(r.stage);
  return `<div class="chain">${DEL_STEPS.map(([k, t], i) => { const done = (r.stage === 'deleted' || r.stage === 'done') ? true : i < ix; const cur = !done && i === ix && !bad; return `<div class="cs ${done ? 'done' : cur ? 'cur' : 'pending'}"><b>${t}</b><span>${done || cur ? '' : 'later'}${i === 0 ? ' ' + esc(r.by.split(' ')[0]) : ''}</span></div>${i < 2 ? '<i>›</i>' : ''}`; }).join('')}</div><div class="m"><b>${esc(r.stage_label)}</b>${bad ? '' : ''}</div>`;
}
function delCard(r) {
  const a = delAbility(r); const cl = S.cl; const open = cl.open === r.id; const tx = `dtx-${r.id}`;
  const items = r.items.map((i) => `<tr>${a.initiate || a.resub ? `<td><input type="checkbox" data-drm="${r.id}" value="${i.id}" title="Tick to REMOVE this record from the request"></td>` : ''}<td class="num">${i.id}</td><td>${esc(i.school_name || i.school)}</td><td>${esc(i.grade)}</td><td>${esc(i.date)}</td><td>${esc(i.enumerator)}</td><td class="num">${esc(i.stuid || i.att || '')}</td><td>${esc(i.at || '')}</td></tr>`).join('');
  const hist = r.history.map((h) => `<div style="padding:6px 0;border-top:1px solid var(--line,#e3e7ee)"><b>${esc(h.by)}</b> <span class="m">${esc(h.role)} · ${fmtAt(h.at)}</span><br>${esc(h.action)}${h.text ? ': ' + esc(h.text) : ''}</div>`).join('');
  const actions = !open ? '' : `<div class="qbox" style="margin-top:8px"><textarea id="${tx}" placeholder="${a.del ? 'Optional note' : a.resub ? 'The reason, written again' : 'A note or the reason (needed to send back or reject)'}"></textarea><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
  ${a.initiate ? `<button class="btn sm" data-act="dlAct" data-op="initiate" data-id="${r.id}">Initiate (send to Mundo)</button>` : ''}
  ${a.del ? `<label class="m">Type ${r.ids.length} to confirm <input id="dcf-${r.id}" style="width:60px"></label><button class="btn sm" style="${r.type === 'edit' ? '' : 'background:var(--bad,#b8432a);color:#fff'}" data-act="dlAct" data-op="${r.type === 'edit' ? 'apply' : 'delete'}" data-id="${r.id}">${r.type === 'edit' ? 'Apply the edit in KoBo' : 'Delete from KoBo'}</button>` : ''}
  ${a.resub ? `<button class="btn sm" data-act="dlAct" data-op="resubmit" data-id="${r.id}">Resubmit</button>` : ''}
  ${a.back ? `<button class="btn sm sec" data-act="dlAct" data-op="send_back" data-id="${r.id}">Send back</button><button class="btn sm ghost" data-act="dlAct" data-op="reject" data-id="${r.id}">Reject</button>` : ''}
  <button class="btn sm ghost" data-act="dlAct" data-op="comment" data-id="${r.id}">Add a note</button>${a.withdraw ? `<button class="btn sm ghost" data-act="dlAct" data-op="withdraw" data-id="${r.id}">Withdraw</button>` : ''}</div></div>`;
  return `<div class="card" style="margin-top:12px;border-left:4px solid ${r.stage === 'deleted' ? 'var(--ink3,#888)' : 'var(--gold)'}"><h3 style="display:flex;justify-content:space-between;gap:8px"><span>${r.type === 'edit' ? chip('Edit: ' + esc(r.field_label || ''), 'teal') + ' ' : ''}${r.ids.length} record${r.ids.length > 1 ? 's' : ''} · ${esc(r.kind === 'sampling' ? 'Sampling' : 'Students assessment')} · ${esc((r.regions || []).map(title).join(', '))}</span><button class="btn sm ghost" data-act="dlOpen" data-id="${open ? '' : r.id}">${open ? 'Close' : 'Open'}</button></h3>
  <div class="sub">Suggested by ${esc(r.by)} (${esc(r.by_role)}) · ${fmtAt(r.created_at)}</div>${delChain(r)}${r.type === 'edit' ? `<div class="note" style="margin:8px 0"><b>What changes.</b> ${(r.edit_lines || []).slice(0, open ? 60 : 3).map((l) => esc(l.text) + ' <span class="m">(record ' + l.id + ')</span>').join('<br>')}${!open && (r.edit_lines || []).length > 3 ? '<br>…' : ''}${r.edit && r.edit.field === 'grade' ? '<br><span class="m">Only the grade label and the pupil ID change. The questions the pupil was asked stay as they were.</span>' : ''}</div>` : ''}<p style="margin:8px 0"><b>Reason.</b> ${esc(r.reason)}${r.link ? ` <span class="m">Link: ${esc(r.link)}</span>` : ''}</p>
  ${open ? `<details class="fd" open><summary>Records (${r.ids.length})</summary><div class="tbl"><table><thead><tr>${a.initiate || a.resub ? '<th>Remove</th>' : ''}<th>Id</th><th>School</th><th>Grade</th><th>Date</th><th>Enumerator</th><th>Pupil ID</th><th>Time</th></tr></thead><tbody>${items}</tbody></table></div></details><details class="fd" open><summary>History (${r.history.length})</summary>${hist}</details>${r.applied ? `<p class="m">Applied ${r.applied.n} record(s). ${S.who?.role === 'hq' && myLvl() >= 2 ? `<a href="/api/deletions/copy?id=${r.id}" data-dl="${r.id}">Download the saved originals</a>` : ''}</p>` : ''}${r.deleted ? `<p class="m">KoBo count ${r.deleted.before} to ${r.deleted.after}. ${S.who?.role === 'hq' && myLvl() >= 2 ? `<a href="/api/deletions/copy?id=${r.id}" data-dl="${r.id}">Download the saved copy</a>` : ''}</p>` : ''}${actions}` : ''}</div>`;
}
function viewClean() {
  const C = S.cl; if (!C) return '<div class="empty">Loading…</div>'; if (C.err) return `<div class="banner bad">${esc(C.err)}</div>`; if (!C.data) return '<div class="empty">Loading…</div>';
  const d = C.data; const mine = d.requests.filter((r) => { const a = delAbility(r); return a.initiate || a.del || a.resub; }); const rest = d.requests.filter((r) => !mine.includes(r));
  const head = `<div class="pagehead"><div><h2>Data cleaning</h2><p>Duplicates and test records are removed only through this chain: a team member or Mundo suggests, Joram reviews and initiates, Mundo approves and deletes. A full copy is saved first, and every step stays in the history.</p></div></div>${d.rebuilding ? '<div class="banner"><b>Dashboard totals are being rebuilt</b> after a deletion. The numbers update when it finishes.</div>' : ''}`;
  const hqLog = d.log.length ? `<div class="card" style="margin-top:14px"><h3>Deletion log</h3><div class="tbl dt-wrap"><table class="dt"><thead><tr><th>When</th><th>Project</th><th class="r">Records</th><th>Suggested</th><th>Initiated</th><th>Deleted by</th><th class="r">KoBo count</th></tr></thead><tbody>${d.log.map((l) => `<tr><td>${esc(eatTime(l.at))}</td><td>${esc(l.kind)}</td><td class="r num">${l.ids.length}</td><td>${esc(l.suggested_by)}</td><td>${esc(l.initiated_by)}</td><td>${esc(l.approved_by)}</td><td class="r num">${l.count_before} to ${l.count_after} ${l.ok ? '' : '<span class="pill bad">check</span>'}</td></tr>`).join('')}</tbody></table></div></div>` : '';
  return head + (d.me.can_suggest ? delNew() : '') + (mine.length ? `<h3 style="margin:16px 0 0">Needs you (${mine.length})</h3>${mine.map(delCard).join('')}` : '') + groupedReqs(rest, mine.length) + hqLog;
}
function groupedReqs(list, hasMine) {
  if (!list.length) return `<h3 style="margin:16px 0 0">${hasMine ? 'Other requests' : 'Requests'} (0)</h3><div class="empty">No requests yet.</div>`;
  const firstSchool = (r) => (r.items[0] && (r.items[0].school_name || r.items[0].school)) || '';
  const sec = (title0, rs) => (rs.length ? `<h3 style="margin:16px 0 0">${title0} (${rs.length})</h3>${rs.slice().sort((a, b) => (r0(a) === r0(b) ? firstSchool(a).localeCompare(firstSchool(b)) : r0(a) < r0(b) ? -1 : 1)).map(delCard).join('')}` : '');
  const r0 = (r) => (r.stage === 'done' || r.stage === 'deleted' || r.stage === 'rejected' || r.stage === 'withdrawn' ? 'z' : 'a');
  return sec(hasMine ? 'Other edits' : 'Edits', list.filter((r) => r.type === 'edit')) + sec(hasMine ? 'Other deletions' : 'Deletions', list.filter((r) => r.type !== 'edit'));
}
function delNew() {
  const C = S.cl; const f = C.form || (C.form = { kind: 'students', school: '', date: '', grade: '', stuid: '', dups: true }); const F = C.found;
  const schools = schoolsAll().filter((s) => !String(s.id).startsWith('TRAIN') || true);
  const rows = F ? F.records.map((r) => `<tr><td><input type="checkbox" data-dsel="${r.id}" ${C.sel?.includes(r.id) ? 'checked' : ''} ${r.pending ? 'disabled' : ''}></td><td class="num">${r.id}</td><td>${esc(r.grade)}</td><td>${esc(r.date)}</td><td>${esc(r.enumerator)}</td><td class="num">${esc(r.stuid || r.att || '')}</td><td>${esc(r.at)}</td><td>${r.pending ? chip('in a request', 'warn') : ''}</td></tr>`).join('') : '';
  const mode = C.mode || 'delete'; const sel = C.sel || [];
  const fld = C.editField || 'school';
  const editBox = mode === 'edit' && F ? `<div class="mf" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end"><label>What to change<select id="dfField" data-act="dfField">${[['school', 'School'], ['grade', 'Grade'], ['tester', 'Test administrator (who did the test)'], ['lga', 'District (LGA)'], ['region', 'Region'], ['pupil', 'Pupil number / ID']].filter(([k]) => !(k === 'pupil' && F.kind === 'sampling')).map(([k, t]) => `<option value="${k}" ${fld === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    ${fld === 'grade' ? `<label>New grade<select id="dfValue"><option>1</option><option>2</option><option>3</option></select></label>` : ''}
    ${fld === 'tester' ? `<label>New name (as in the roster)<input id="dfValue" list="dfStaff" placeholder="Type the name"></label><datalist id="dfStaff">${(S.staffNames || []).map((n) => `<option value="${esc(n)}">`).join('')}</datalist>` : ''}
    ${fld === 'region' ? `<label>Correct region<select id="dfValue">${S.cfg.regions.map((r) => `<option value="${esc(r)}">${esc(title(r))}</option>`).join('')}</select></label>` : ''}
    ${fld === 'lga' ? `<label>Correct district (LGA)<input id="dfValue" list="dfLgas" placeholder="Type the LGA"></label><datalist id="dfLgas">${[...new Set(schoolsAll().map((x) => x.lga).filter(Boolean))].sort().map((l) => `<option value="${esc(l)}">`).join('')}</datalist>` : ''}
    ${fld === 'school' ? `<label>Correct school<input id="dfValue" list="dfSchools" placeholder="School name or code"></label>` : ''}</div>
    ${fld === 'pupil' ? `<div class="m">New pupil number for each ticked record:</div>${sel.map((id) => `<div class="m">Record ${id} <input type="number" min="1" max="400" data-dpn="${id}" style="width:80px"></div>`).join('') || '<div class="m">Tick the records first.</div>'}` : ''}
    ${fld === 'grade' ? '<div class="note">Only the grade label and the pupil ID change. The questions the pupil was asked do not change, so use this only when the wrong grade was recorded by mistake.</div>' : ''}` : '';
  return `<div class="card" style="margin-top:14px"><h3>Suggest a deletion or an edit</h3><div class="sel" style="margin:6px 0"><button class="btn sm ${mode === 'delete' ? '' : 'sec'}" data-act="dlMode" data-m="delete">Delete records</button><button class="btn sm ${mode === 'edit' ? '' : 'sec'}" data-act="dlMode" data-m="edit">Edit records</button></div><div class="sub">${mode === 'edit' ? 'Find the records, tick the ones to correct, choose what changes, and say why. Joram reviews, then Mundo applies it.' : 'Find the records, tick the ones to delete, and say why.'}</div>
  <div class="mf"><label>Project<select id="dfKind"><option value="students" ${f.kind === 'students' ? 'selected' : ''}>Students assessment</option><option value="sampling" ${f.kind === 'sampling' ? 'selected' : ''}>Sampling</option></select></label></div>
  <div class="mf"><label>School<input id="dfSchool" list="dfSchools" value="${esc(f.school)}" placeholder="Type the school name or code"></label><datalist id="dfSchools">${schools.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</datalist></div>
  <div class="mf" style="display:flex;gap:10px;flex-wrap:wrap"><label>Date<input type="date" id="dfDate" value="${esc(f.date)}"></label><label>Grade<select id="dfGrade"><option value="">All</option>${[1, 2, 3].map((g) => `<option ${f.grade == g ? 'selected' : ''}>${g}</option>`).join('')}</select></label><label>Pupil ID contains<input id="dfStu" value="${esc(f.stuid)}"></label></div>
  <label class="cb"><input type="checkbox" id="dfDups" ${f.dups ? 'checked' : ''}> Show only records that look like duplicates (same pupil ID in the same grade; or two sampling forms for one grade)</label>
  <p><button class="btn" data-act="dlFind">Find records</button> ${C.msg ? `<span class="m">${esc(C.msg)}</span>` : ''}</p>
  ${F ? `<div class="m">${F.total} record${F.total === 1 ? '' : 's'} found${F.total > F.records.length ? ' (showing the first ' + F.records.length + ')' : ''}. Ticked: <b>${(C.sel || []).length}</b>.</div><div class="tbl"><table><thead><tr><th></th><th>Id</th><th>Grade</th><th>Date</th><th>Enumerator</th><th>Pupil ID</th><th>Time</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="empty">Nothing found.</td></tr>'}</tbody></table></div>
  ${editBox}<div class="mf"><label>${mode === 'edit' ? 'Why is this correction needed?' : 'Why should these be deleted?'}<textarea id="dfReason" rows="3" placeholder="${mode === 'edit' ? 'For example: the tester chose Grade 2 by mistake; the pupil is in Grade 1.' : 'For example: the same pupil was tested twice on 20 Oct; the second record is a repeat entry.'}">${esc(C.reasonDraft || '')}</textarea></label></div><button class="btn" data-act="dlSuggest" ${(C.sel || []).length ? '' : 'disabled'}>${mode === 'edit' ? 'Suggest editing' : 'Suggest deleting'} ${(C.sel || []).length} record${(C.sel || []).length === 1 ? '' : 's'}</button>` : ''}</div>`;
}
async function cleanAction(a, t) {
  const C = (S.cl ||= {});
  try {
    if (a === 'dlOpen') { C.open = t.dataset.id || null; }
    else if (a === 'dlMode') { C.mode = t.dataset.m; C.found = null; C.sel = []; if (C.form) C.form.dups = C.mode === 'delete'; }
    else if (a === 'dlFind') {
      const g = (id) => document.getElementById(id); const f = C.form = { kind: g('dfKind').value, school: g('dfSchool').value.trim(), date: g('dfDate').value, grade: g('dfGrade').value, stuid: g('dfStu').value.trim(), dups: g('dfDups').checked };
      C.msg = 'Searching…'; render(); const q = new URLSearchParams({ kind: f.kind, school: f.school, ...(f.date ? { date: f.date } : {}), ...(f.grade ? { grade: f.grade } : {}), ...(f.stuid ? { stuid: f.stuid } : {}), ...(f.dups ? { dups: '1' } : {}) });
      C.found = await api('/api/deletions/find?' + q); C.sel = []; C.msg = '';
    } else if (a === 'dlSuggest') {
      const reason = (document.getElementById('dfReason').value || '').trim(); if (reason.length < 15) { C.msg = 'Write the reason clearly (a sentence).'; render(); return; }
      let extra = {}; if (C.mode === 'edit') { const field = (document.getElementById('dfField') || {}).value || 'grade'; const value = ((document.getElementById('dfValue') || {}).value || '').trim(); const values = {}; document.querySelectorAll('[data-dpn]').forEach((x) => { if (x.value) values[x.dataset.dpn] = x.value; }); extra = { type: 'edit', field, value, values }; C.editField = field; if (!confirm(`Suggest editing ${C.sel.length} record(s)? Nothing changes yet. Joram reviews, then Mundo decides.`)) return; }
      else if (!confirm(`Suggest deleting ${C.sel.length} record(s)? Nothing is deleted yet. Joram reviews, then Mundo decides.`)) return;
      await api('/api/deletions', { method: 'POST', body: { action: 'suggest', kind: C.found.kind, ids: C.sel, reason, ...extra } }); C.found = null; C.sel = []; C.reasonDraft = ''; C.msg = 'Sent to Joram.';
    } else if (a === 'dlAct') {
      const id = t.dataset.id, op = t.dataset.op; const text = (document.getElementById('dtx-' + id)?.value || '').trim(); const remove = [...document.querySelectorAll(`[data-drm="${id}"]:checked`)].map((x) => Number(x.value));
      if (op === 'apply') { const n = document.getElementById('dcf-' + id)?.value; if (!confirm('Apply this edit in KoBo now? The originals are saved first and every record is checked afterwards.')) return; const r = await api('/api/deletions', { method: 'POST', body: { action: 'apply', id, confirm: Number(n) } }); C.msg = r.ok ? `Edited ${r.changed} record(s) and checked them in KoBo.` : `Stopped. ${(r.failed || []).join('; ')}`; }
      else if (op === 'delete') { const n = document.getElementById('dcf-' + id)?.value; if (!confirm('Delete these records from KoBo now? A full copy is saved first. This cannot be undone from KoBo.')) return; const r = await api('/api/deletions', { method: 'POST', body: { action: 'delete', id, confirm: Number(n) } }); C.msg = `Deleted ${r.deleted} record(s). KoBo count ${r.before} to ${r.after}.`; }
      else { await api('/api/deletions', { method: 'POST', body: { action: op, id, text, remove } }); C.msg = ''; }
    }
    if (a !== 'dlOpen' && a !== 'dlFind') await loadClean();
  } catch (e) { C.msg = e.message; }
  render();
}

// ---------- Usage and analytics (HQ only) ----------
async function loadUsage() { try { S.us = await api('/api/usage/report'); S.usErr = null; } catch (e) { S.usErr = e.message; } render(); }
function viewUsage() {
  const head = '<div class="pagehead"><div><h2>Usage & analytics</h2><p>How the Command Center is used: who opens it, which pages, when, on what device, and who has phone alerts on. This stays inside the system and only HQ sees it.</p></div></div>';
  if (S.usErr) return head + `<div class="banner bad">${esc(S.usErr)}</div>`; const U = S.us; if (!U) return head + '<div class="empty">Loading…</div>';
  const k = U.kpis; const mx = (a) => Math.max(1, ...a);
  const bars = (vals, labels, cls = '') => { const m = mx(vals); return `<div class="ubars ${cls}">${vals.map((v, i) => `<div class="ub" title="${esc(labels[i])}: ${v}"><i style="height:${Math.round((v / m) * 100)}%"></i><span>${esc(labels[i])}</span></div>`).join('')}</div>`; };
  const trend = bars(U.days.map((d) => d.users), U.days.map((d) => d.date.slice(8))); const actHrs = bars(U.hours_actions.slice(5, 23), U.hours_actions.slice(5, 23).map((_, i) => String(i + 5)));
  const hrs = bars(U.hours.slice(5, 23), U.hours.slice(5, 23).map((_, i) => String(i + 5)));
  const tabLabel = (t) => ({ day: 'My day', work: 'My work', queries: 'My queries', allq: 'Queries', news: 'News', plan: 'Plan & calendar', region: 'Region', hq: 'HQ', today: 'Today', pilot: 'Pilot day', phones: 'Phones', reports: 'Reports', narr: 'School reports', clean: 'Data cleaning', explore: 'Data explorer', compare: 'Compare', stats: 'My stats', pupils: 'Pupil records', practice: 'Practice', help: 'Help', admin: 'Admin', usage: 'Usage', team: 'My team', people: 'People', regions: 'Regions & plans', messages: 'Messages', payments: 'Payments', progress: 'Progress' }[t] || t);
  const topTabs = U.tabs.slice(0, 10); const tm = mx(topTabs.map((x) => x[1]));
  const tabsHtml = topTabs.map(([t, n]) => `<div class="hbar"><span>${esc(tabLabel(t))}</span><i style="width:${Math.round((n / tm) * 100)}%"></i><b>${n}</b></div>`).join('') || '<div class="empty">No page views yet. They appear as people use the app.</div>';
  const reg = U.by_region.filter((r) => r.people).map((r) => `<tr><td><b>${esc(title(r.region))}</b></td><td class="r num">${r.people}</td><td class="r num">${r.active7}</td><td class="r num">${r.never}</td><td class="r num">${r.alerts}</td></tr>`).join('');
  const ago = (r) => (!r.seen ? '<span class="pill bad">never</span>' : r.ago === 0 ? '<span class="pill good">today</span>' : `${r.ago} d ago`);
  const rows = U.rows.filter((r) => S.usF === 'quiet' ? (!r.seen || r.ago >= 3) && r.position !== 'AI assistant' : S.usF === 'hq' ? r.role === 'hq' || r.position === 'AI assistant' : true).slice(0, 400).map((r) => `<tr class="click" data-open="person:${esc(r.name)}"><td><b>${esc(r.name)}</b><div class="m">${esc(r.position)}${r.region ? ' · ' + esc(title(r.region)) : ''}</div></td><td>${ago(r)}</td><td class="r num">${r.sessions}</td><td class="r num">${r.views}${r.api ? ` <span class="m">+${r.api} calls</span>` : ''}</td><td class="r num">${r.acts}</td><td class="r num">${r.minutes}</td><td>${esc(tabLabel(r.top))}</td><td>${esc(r.device)}</td><td>${r.alerts ? chip('on', 'good') : chip('off', 'warn')}</td></tr>`).join('');
  const ins = U.insights.length ? `<div class="card" style="margin-top:12px;border-left:4px solid var(--gold)"><h3>What this suggests</h3>${U.insights.map((t) => `<div class="flag"><i class="st good"></i><div><span style="color:var(--ink);font-size:14px">${esc(t)}</span></div></div>`).join('')}</div>` : '';
  const f = S.usF || 'all'; const fb = (v, t) => `<button class="btn sm ${f === v ? '' : 'sec'}" data-act="usFilter" data-v="${v}">${t}</button>`;
  return `${head}<div class="kpis"><div class="kpi"><div class="l">Field staff who opened it today</div><div class="v num">${k.active_today}<small> of ${k.people}</small></div></div><div class="kpi"><div class="l">Opened in the last 7 days</div><div class="v num">${k.active_7d}<small> of ${k.people}</small></div></div><div class="kpi"><div class="l">No activity recorded yet</div><div class="v num">${k.never}</div></div><div class="kpi"><div class="l">Phone alerts on</div><div class="v num">${k.alerts_on}<small> of ${k.people}</small></div></div><div class="kpi"><div class="l">HQ active in 7 days</div><div class="v num">${k.hq_active_7d}<small> of ${k.hq_total}</small></div></div></div>${ins}
  <div class="pgrid"><div class="card"><h3>People opening it, last 14 days</h3>${trend}</div><div class="card"><h3>Busy hours (East Africa Time)</h3>${hrs}<div class="m">Phones: ${U.device.m} page views · computers: ${U.device.d}</div></div></div>
  <div class="card" style="margin-top:12px"><h3>When people act (saved actions since ${esc(U.actions_since)})</h3><div class="sub">Plans, replies, reviews, changes and turning alerts on. Days before ${esc(U.live_since)} in the chart above come from these actions, not page views.</div>${actHrs}</div>
  <div class="card" style="margin-top:12px"><h3>Pages people open most</h3>${tabsHtml}</div>
  <div class="card" style="margin-top:12px"><h3>By region</h3><div class="tbl"><table><thead><tr><th>Region</th><th class="r">People</th><th class="r">Opened in 7 days</th><th class="r">Never opened</th><th class="r">Alerts on</th></tr></thead><tbody>${reg}</tbody></table></div></div>
  <div class="card" style="margin-top:12px"><h3>Everyone</h3><div class="sel" style="margin:6px 0">${fb('all', 'All')}${fb('quiet', 'Not using it (3+ days or never)')}${fb('hq', 'HQ and AI assistants')}</div><div class="tbl"><table><thead><tr><th>Person</th><th>Last opened</th><th class="r">Sessions</th><th class="r">Page views</th><th class="r">Actions saved</th><th class="r">Minutes</th><th>Most used page</th><th>Device</th><th>Alerts</th></tr></thead><tbody>${rows}</tbody></table></div><div class="m" style="margin-top:6px">Counting started ${esc(U.as_of.slice(0, 10))}; earlier use is not included. AI assistants are counted by their calls to the system.</div></div>`;
}

// ---------- School narrative reports (RC and ARC write, after the visit) ----------
async function loadNarr(school) {
  const N = (S.nr ||= { lang: store.get('kf_nlang') || 'en' }); N.err = null;
  try {
    if (!N.region) N.region = S.who.role === 'hq' ? (S.cfg.regions[0] && (S.cfg.regions[0].id || S.cfg.regions[0])) : S.who.region;
    N.list = await api('/api/narratives?region=' + encodeURIComponent(N.region));
    if (school || N.open) N.doc = await api('/api/narratives/school?school=' + encodeURIComponent(school || N.open));
  } catch (e) { N.err = e.message; }
  render();
}
function viewNarr() {
  const N = S.nr; const hq = S.who.role === 'hq';
  const head = `<div class="pagehead"><div><h2>School reports</h2><p>After each school visit the RC or ARC writes a short narrative: a few guiding questions and a free space. You can write in Kiswahili or English. At the end the system compiles every school, with its numbers, into one report.</p></div></div>`;
  if (!N || (!N.list && !N.err)) return head + '<div class="empty">Loading…</div>';
  if (N.err) return head + `<div class="banner bad">${esc(N.err)}</div>`;
  const regSel = hq ? `<div class="mf"><label>Region<select id="nrRegion">${S.cfg.regions.map((r) => { const id = r.id || r; return `<option value="${esc(id)}" ${id === N.region ? 'selected' : ''}>${esc(title(r.name || id))}</option>`; }).join('')}</select></label></div>` : '';
  const L = N.list; const done = L.schools.filter((x) => x.n_done).length;
  const rows = L.schools.slice().sort((a, b) => (b.visited - a.visited) || String(b.last || '').localeCompare(String(a.last || ''))).map((x) => `<tr class="click" data-act="nrOpen" data-s="${esc(x.id)}"><td><b>${esc(x.name)}</b><div class="m">${esc(title(x.lga))}${x.last ? ' · visited ' + shortDate(x.last) : x.visited ? '' : ' · not visited yet'}</div></td><td>${x.n_done ? chip('written', 'good') : x.n_draft ? chip('draft', 'warn') : x.visited ? chip('please write', 'bad') : '<span class="m">after the visit</span>'}</td></tr>`).join('');
  const compiled = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0"><button class="btn sm" data-act="nrCompiled" data-all="">Open the compiled report for ${esc(title(N.region))}</button>${hq ? '<button class="btn sm sec" data-act="nrCompiled" data-all="1">Open the compiled report for all regions</button>' : ''}</div>`;
  return `${head}${regSel}<div class="kpis"><div class="kpi"><div class="v">${done}</div><div class="l">of ${L.schools.length} schools have a written report</div></div></div>${compiled}${N.doc ? narrEditor(N) : ''}<div class="card" style="margin-top:12px"><div class="tbl"><table><tbody>${rows}</tbody></table></div></div>`;
}
function narrEditor(N) {
  const D = N.doc; const lang = N.lang; const me = D.mine; const can = D.can_write; const ans = (me && me.answers) || {};
  const others = D.entries.filter((e) => !me || e.by_id !== me.by_id);
  const T = lang === 'sw' ? { open: 'Mengineyo (chochote ambacho hakijaulizwa hapo juu)', save: 'Hifadhi rasimu', fin: 'Maliza na uwasilishe', hint: 'Andika sentensi chache kwa kila swali. Unaweza kuandika kwa Kiswahili au Kiingereza.' } : { open: 'Anything else (whatever the questions above did not ask)', save: 'Save draft', fin: 'Mark complete', hint: 'A few sentences for each question is enough. Write in Kiswahili or English, whichever is easier.' };
  const qs = D.questions.map((q) => `<div class="f"><label>${esc(q[lang])}<textarea data-nq="${q.k}" rows="3">${esc(ans[q.k] || '')}</textarea></label></div>`).join('');
  const oth = others.map((e) => `<details class="fd"><summary>${esc(e.by)} (${esc(e.role)}) · ${e.done ? 'complete' : 'draft'} · ${e.lang === 'sw' ? 'Kiswahili' : 'English'}</summary>${D.questions.filter((q) => e.answers[q.k]).map((q) => `<p><b>${esc(q[e.lang === 'sw' ? 'sw' : 'en'])}</b><br>${esc(e.answers[q.k])}</p>`).join('')}${e.open ? `<p>${esc(e.open)}</p>` : ''}</details>`).join('');
  return `<div class="card" style="margin-top:12px;border-left:4px solid var(--gold)"><h3 style="display:flex;justify-content:space-between;gap:8px"><span>${esc(D.name)}</span><button class="btn sm ghost" data-act="nrClose">Close</button></h3>
  <div class="sel" style="margin:6px 0"><button class="btn sm ${lang === 'en' ? '' : 'sec'}" data-act="nrLang" data-l="en">English</button><button class="btn sm ${lang === 'sw' ? '' : 'sec'}" data-act="nrLang" data-l="sw">Kiswahili</button></div>
  ${can ? `<div class="sub">${T.hint}</div>${qs}<div class="f"><label>${T.open}<textarea data-nq="__open" rows="4">${esc((me && me.open) || '')}</textarea></label></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sec" data-act="nrSave" data-done="">${T.save}</button><button class="btn" data-act="nrSave" data-done="1">${T.fin}</button></div>${N.msg ? `<p class="m">${esc(N.msg)}</p>` : ''}` : '<div class="note">Only the RC or ARC of the region can write this report.</div>'}
  ${oth ? `<h4 style="margin:12px 0 4px">Written by others</h4>${oth}` : ''}</div>`;
}
async function narrAction(a, t) {
  const N = (S.nr ||= { lang: 'en' });
  try {
    if (a === 'nrOpen') { N.open = t.dataset.s; N.msg = ''; N.doc = await api('/api/narratives/school?school=' + encodeURIComponent(N.open)); }
    else if (a === 'nrClose') { N.open = null; N.doc = null; }
    else if (a === 'nrLang') { keepNarr(); N.lang = t.dataset.l; store.set('kf_nlang', N.lang); }
    else if (a === 'nrSave') {
      keepNarr(); const D = N.doc; const body = { school: D.school, lang: N.lang, done: Boolean(t.dataset.done), answers: N.draft.answers, open: N.draft.open };
      await api('/api/narratives', { method: 'POST', body }); N.msg = body.done ? 'Saved as complete. Thank you.' : 'Draft saved.'; await loadNarr(D.school); return;
    }
    else if (a === 'nrCompiled') {
      const q = t.dataset.all ? '' : '?region=' + encodeURIComponent(N.region); const res = await fetch('/api/narratives/compiled' + q, { headers: { 'x-access-code': S.code } });
      if (!res.ok) throw new Error('Could not build the report'); const blob = new Blob([await res.text()], { type: 'text/html' }); window.open(URL.createObjectURL(blob), '_blank'); return;
    }
  } catch (e) { N.msg = e.message; }
  render();
}
function keepNarr() { const N = S.nr; const answers = {}; let open = ''; document.querySelectorAll('[data-nq]').forEach((x) => { if (x.dataset.nq === '__open') open = x.value; else if (x.value.trim()) answers[x.dataset.nq] = x.value; }); N.draft = { answers, open }; if (N.doc) { N.doc.mine = { ...(N.doc.mine || {}), answers, open }; } }

// ---------- phone alerts ----------
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function alertsLabel() {
  if (!pushSupported()) return 'Alerts: not on this device';
  if (Notification.permission === 'denied') return 'Alerts blocked';
  return S.alertsOn ? 'Alerts on' : 'Turn on alerts';
}
const keyBytes = (b64) => { const p = '='.repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); };
async function checkAlerts() {
  try { if (!pushSupported()) return; const reg = await navigator.serviceWorker.ready; S.alertsOn = Boolean(await reg.pushManager.getSubscription()) && Notification.permission === 'granted'; const b = document.getElementById('alertsBtn'); if (b) { b.classList.toggle('on', S.alertsOn); b.title = alertsLabel(); } } catch {}
}
async function toggleAlerts() {
  if (!pushSupported()) { alert('Alerts need a newer browser. On iPhone, first add this page to the home screen (Share, then Add to Home Screen), then open it from there.'); return; }
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing && S.alertsOn) { await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: existing.endpoint } }); await existing.unsubscribe(); S.alertsOn = false; render(); return; }
  const cfg = await api('/api/push/config');
  if (!cfg.ready) { alert('Alerts are not switched on at the server yet.'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { render(); return; }
  const sub = existing || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.public_key) }));
  await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
  S.alertsOn = true; render();
}

// ---------- HQ: preview the app as another person (training and support) ----------
const isRealHQ = () => (S.real || S.who)?.role === 'hq';
function viewAsControl() {
  if (!isRealHQ() || !S.staffList.length) return '';
  const groups = [['rc', 'Regional coordinators'], ['arc', 'Assistant coordinators'], ['volunteer', 'Test admins (volunteers)']];
  const opts = groups.map(([r, l]) => `<optgroup label="${l}">${S.staffList.filter((s) => s.role === r).map((s) => `<option value="${s.id}" ${String(S.viewAs) === String(s.id) ? 'selected' : ''}>${esc(title(s.region))} · ${esc(s.name)}</option>`).join('')}</optgroup>`).join('');
  return `<select id="viewAsSel" class="vsel" aria-label="View as"><option value="">View as: HQ (me)</option><option value="public" ${S.viewAs === 'public' ? 'selected' : ''}>View as: Public visitor</option>${opts}</select>`;
}
async function setViewAs(val) {
  if (!val) { S.viewAs = null; if (S.real) S.who = S.real; S.real = null; }
  else {
    if (!S.real) S.real = S.who;
    if (val === 'public') { S.viewAs = 'public'; S.who = null; }
    else { const p = S.staffList.find((s) => String(s.id) === val); if (!p) return; S.viewAs = val; S.who = { role: p.role, name: p.name, region: p.region, position: p.position, id: p.id, viewAs: true }; }
  }
  S.ov = null; S.pub = null; S.cmp = null; S.pred = null; S.brief = null; S.plan = null; S.allSchools = null; S.workCache = {}; S.tbl = {}; S.qf = null; S.tch = null; S.linked = null; S.exTab = 'assess'; S.exErr = null; S.tab = null; S.cur = null; closeDetail(); S.stale = null;
  await go();
}
const previewBanner = () => (S.viewAs ? `<div class="banner preview"><b>Preview.</b> You are looking at the app as ${S.viewAs === 'public' ? 'a public visitor' : esc(S.who.name) + ' (' + esc(S.who.position || S.who.role) + ', ' + esc(title(S.who.region)) + ')'}. Nothing you do here changes anything. <button class="btn sm sec" data-act="exitPreview">Back to HQ</button></div>` : '');

function loginScreen(msg) {
  $('#nav').innerHTML = ''; $('#who').innerHTML = '';
  $('#app').innerHTML = `<div class="login"><img src="/learnimpact-logo.png" alt="LearnImpact" style="filter:none"><h2 style="margin-top:14px">Karibu · Welcome</h2><p style="color:var(--ink2)">Enter your access code. Your coordinator or HQ gives you one.</p><input id="code" maxlength="12" autocomplete="off" autocapitalize="characters" aria-label="Access code"><button class="btn" data-act="login" style="width:100%">Sign in</button>${msg ? `<div class="banner bad">${esc(msg)}</div>` : ''}<p style="margin-top:20px"><button class="btn sec sm" data-act="goPublic">See public progress</button></p></div>`;
  $('#code')?.focus();
}

async function loadData() {
  const q = S.year ? '?year=' + S.year : '';
  if (!S.who) { S.pub = await api('/api/public' + q); S.cmp = publicCompare(S.pub); return; }
  const vol = S.who.role === 'volunteer';
  if (!vol) api('/api/assign-info').then((r) => { S.info = r.items || []; }).catch(() => { S.info = S.info || []; }); // for information: helpers, grade differences
  // everything the first screen needs is fetched at the same time, not one after another
  const [ov, cmp, pred, brief] = await Promise.all([
    api('/api/overview' + q),
    api('/api/compare' + q).catch(() => null),
    vol ? null : api('/api/predict').catch(() => null),
    vol ? null : api('/api/brief').catch(() => null),
  ]);
  S.ov = ov; S.pub = ov; S.cmp = cmp; S.pred = pred; S.brief = brief;
  if (ov.staff) S.staffList = ov.staff;
  if (S.tab === 'plan' || vol) await loadPlan();
  if (S.tab === 'admin') await loadAdmin();
  saveSnapshot();
}
// The big school list is only needed for search, the explorer and region cards, so it loads after the first screen.
async function ensureSchools() {
  if (S.who?.role !== 'hq' || S.allSchools || S.loadingSchools) return;
  S.loadingSchools = true;
  try { S.allSchools = (await api('/api/schools' + (S.year ? '?year=' + S.year : ''))).schools; } catch { S.allSchools = null; }
  S.loadingSchools = false;
  if (S.allSchools) { render(); if (S.cur) openDetail(S.cur, false); }
}
S.workCache = {};
async function loadWork(name) {
  if (S.workCache[name]) return;
  try { const r = await api('/api/work?name=' + encodeURIComponent(name) + (S.year ? '&year=' + S.year : '')); S.workCache[name] = r.work; S.daysCache[name] = r.days || []; } catch { S.workCache[name] = []; S.daysCache[name] = []; }
  if (S.cur === 'person:' + name) openDetail(S.cur, false);
}
// Last good screen is kept on the device so the app opens instantly, then refreshes behind it.
function saveSnapshot() { try { if (S.code && S.ov && !S.viewAs) localStorage.setItem('kf_snap', JSON.stringify({ code: S.code, t: Date.now(), ov: S.ov, cmp: S.cmp, pred: S.pred, brief: S.brief })); } catch {} }
function loadSnapshot() { try { const s = JSON.parse(localStorage.getItem('kf_snap') || 'null'); return s && s.code === S.code && Date.now() - s.t < 12 * 3600 * 1000 ? s : null; } catch { return null; } }
function publicCompare(pub) {
  if (!pub || !pub.regions) return { status: 'waiting' };
  return { regions: pub.regions.map((r) => ({ ...r, tested_pct: pc(r.tested, r.target) })).sort((a, b) => b.tested_pct - a.tested_pct), people: [] };
}
async function loadPlan(region) {
  const r = region || S.planRegion || S.who.region || S.cfg.regions[0];
  S.planRegion = r;
  S.planErr = null;
  try { S.plan = await api('/api/plan?region=' + r); } catch (e) { S.plan = null; S.planErr = e.message; }
}
// Admin opens at once with the two things that matter first (status and readiness); every other card fills in as its data arrives, all at the same time.
let adminTimer = null;
const adminPaint = () => { clearTimeout(adminTimer); adminTimer = setTimeout(() => { if (S.tab === 'admin' && !document.activeElement?.closest?.('#app input, #app textarea, #app select')) render(); }, 250); };
async function loadAdmin() {
  const [status, ready] = await Promise.all([api('/api/admin/status'), api('/api/admin/readiness').catch(() => null)]);
  S.recRows = null; S.adm = { status, ready, preview: S.adm?.preview || null };
  const set = (k, path) => api(path).then((v) => { if (!S.adm) return; S.adm[k] = v; if (k === 'rec') S.recRows = null; adminPaint(); }).catch(() => { adminPaint(); });
  for (const [k, path] of [['hqUsers', '/api/admin/hq-users'], ['settings', '/api/admin/settings'], ['emailSched', '/api/admin/email-schedule'], ['rec', '/api/admin/recipients'], ['push', '/api/admin/push-status'], ['calsync', '/api/admin/calsync'], ['formjob', '/api/admin/formjob'], ['codes', '/api/admin/codes'], ['roster', '/api/admin/roster'], ['devices', '/api/admin/devices'], ['backups', '/api/admin/backup?list=1'], ['activity', '/api/admin/activity']]) set(k, path);
  api('/api/admin/storage').then((r) => { S.storage = r; adminPaint(); }).catch(() => {});
  api('/api/admin/forms').then((r) => { S.forms = r; adminPaint(); }).catch(() => {});
}

if (!window.__pilTimer) window.__pilTimer = setInterval(() => { const a = document.activeElement; if (S.who && !document.hidden && S.tab === 'pilot' && !(a && /^(SELECT|INPUT|TEXTAREA)$/.test(a.tagName))) { api('/api/overview' + (S.year ? '?year=' + S.year : '')).then((ov) => { if (ov && ov.status === 'ok') { S.ov = ov; S.pub = ov; } }).catch(() => {}).finally(loadPilot); } }, 60000);
if (!window.__newsTimer) window.__newsTimer = setInterval(() => { if (S.who && !document.hidden) loadNews(); }, 180000);
async function go() {
  const exm = /^#explore\/(\w+)$/.exec(location.hash);
  if (exm) { S.tab = 'explore'; S.exTab = exm[1]; }
  else if (!S.tab && location.hash && !location.hash.includes(':')) S.tab = location.hash.slice(1);
  if (S.who && !S.ov && !S.viewAs) { const snap = loadSnapshot(); if (snap) { S.ov = snap.ov; S.pub = snap.ov; S.cmp = snap.cmp; S.pred = snap.pred; S.brief = snap.brief; S.stale = snap.t; render(); } }
  try { await loadData(); S.stale = null; render(); ensureSchools(); if (S.tab === 'explore' && ['teach', 'school', 'linked'].includes(S.exTab)) loadExplore(S.exTab); if (S.tab === 'phones' && !S.ph) loadPhones().then(render); if (S.tab === 'practice' && !S.pr) loadPractice().then(render); if (S.tab === 'reports' && !S.rep) openReports(); loadNews().then(() => { if (S.tab === 'news') openNews().then(render); }); if (location.hash.includes(':')) { try { openDetail(decodeURIComponent(location.hash.slice(1))); } catch {} } } catch (e) { if (e.status === 401 && S.code) { S.code = null; S.who = null; store.set('kf_code', null); loginScreen('Your code was not recognised. Try again.'); } else $('#app').innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; }
}

async function selectTab(k) {
  if (k === 'pilot') { S.tab = k; render(); await loadPilot(); return; }
  S.tab = k; S.selVisit = null; if (S.tab === 'messages') { render(); await loadMsgs(); } if (S.tab === 'clean') { render(); await loadClean(); } if (S.tab === 'payments') { await loadPayments();  return; } if (S.tab === 'plan') { await loadPlan(); } if (S.tab === 'phones') { S.ph = null; render(); await loadPhones(); } if (S.tab === 'practice') { S.pr = null; render(); await loadPractice(); } if (S.tab === 'news') { await openNews(); } if (S.tab === 'reports') { render(); await openReports(); } if (S.tab === 'narr') { render(); await loadNarr(); } if (S.tab === 'usage') { render(); await loadUsage(); } if (S.tab === 'admin') await loadAdmin(); render();
}

// ---------- refresh: a button and pull-down; also picks up a new version of the app ----------
const sigOf = (t) => { let h = 0; for (let i = 0; i < t.length; i++) h = (Math.imul(31, h) + t.charCodeAt(i)) | 0; return t.length + ':' + h; };
async function appSig() { try { const r = await fetch('/app.js', { cache: 'no-store' }); return r.ok ? sigOf(await r.text()) : null; } catch { return null; } }
function toast(msg) { let t = document.getElementById('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); } t.textContent = msg; t.className = 'show'; clearTimeout(t._h); t._h = setTimeout(() => { t.className = ''; }, 2200); }
async function refreshApp() {
  if (S.refreshing) return; S.refreshing = true; const b = document.getElementById('rfb'); if (b) b.classList.add('spin');
  try {
    try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) await reg.update(); } catch { /* offline: carry on */ }
    const now = await appSig();
    if (now && S.sig && now !== S.sig) { toast('New version found. Loading it…'); setTimeout(() => location.reload(), 500); return; }
    if (now && !S.sig) S.sig = now;
    await selectTab(S.tab); await go(); try { await loadNews(); } catch { /* the tab shows what it has */ }
    toast('Up to date');
  } catch { toast('Could not refresh. Check the connection.'); }
  finally { S.refreshing = false; const b2 = document.getElementById('rfb'); if (b2) b2.classList.remove('spin'); }
}
appSig().then((x) => { S.sig = x; });
(() => { // pull down at the top of the page to refresh
  let y0 = null, dy = 0; const bar = () => { let p = document.getElementById('ptr'); if (!p) { p = document.createElement('div'); p.id = 'ptr'; p.innerHTML = '<span></span>'; document.body.appendChild(p); } return p; };
  const skip = (t) => t.closest && t.closest('select,input,textarea,.tbl,.aipanel,#drawer,details[open] summary+*,iframe');
  document.addEventListener('touchstart', (e) => { y0 = window.scrollY <= 0 && e.touches.length === 1 && !skip(e.target) ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  document.addEventListener('touchmove', (e) => { if (y0 === null) return; dy = e.touches[0].clientY - y0; if (dy <= 0) { bar().style.transform = 'translateY(-60px)'; return; } const p = bar(); p.style.transform = `translateY(${Math.min(dy, 110) - 60}px)`; p.classList.toggle('ready', dy > 80); }, { passive: true });
  document.addEventListener('touchend', () => { if (y0 === null) return; const p = document.getElementById('ptr'); if (p) { p.style.transform = 'translateY(-60px)'; p.classList.remove('ready'); } if (dy > 80) refreshApp(); y0 = null; dy = 0; }, { passive: true });
})();

document.addEventListener('click', async (e) => {
  if (!e.target.closest('#msheet,[data-act=moreMenu]')) { const m = document.getElementById('msheet'); if (m && !m.hidden) m.hidden = true; }
  if (!e.target.closest('.umw')) { const m = document.getElementById('um'); if (m && !m.hidden) m.hidden = true; }
  const dl = e.target.closest('[data-dl]'); if (dl) { e.preventDefault(); try { const res = await fetch('/api/deletions/copy?id=' + dl.dataset.dl, { headers: { 'x-access-code': S.code } }); if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Not allowed'); const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = 'deleted-records-' + dl.dataset.dl + '.json.gz'; a.click(); } catch (er) { alert(er.message); } return; }
  const ex = e.target.closest('[data-ex]'); if (ex) { await loadExplore(ex.dataset.ex); return; }
  const op = e.target.closest('[data-open]');
  if (op && !e.target.closest('summary,button,select,input,textarea')) { e.preventDefault(); $('#gsr') && ($('#gsr').hidden = true); openDetail(op.dataset.open); return; }
  const rs = e.target.closest('[data-rs]'); if (rs && S.rep?.edit) { repSync(); const E = S.rep.edit; E.sort = E.sort && E.sort.k === rs.dataset.rs ? { k: rs.dataset.rs, dir: -E.sort.dir } : { k: rs.dataset.rs, dir: 1 }; const el = document.getElementById('repTable'); if (el) el.innerHTML = repTable(); return; }
  const th = e.target.closest('[data-ts]');
  if (th) { const [id, k] = th.dataset.ts.split(':'); const T = S.tbl[id]; if (T.sort === k) T.dir = -T.dir; else { T.sort = k; T.dir = 1; } tblSave(id); render(); return; }
  const t = e.target.closest('[data-tab],[data-act]'); if (!t) return;
  if (t.dataset.tab) { await selectTab(t.dataset.tab); return; }
  const a = t.dataset.act;
  try {
    if (a === 'login') { const c = $('#code').value.trim().toUpperCase(); if (!c) return; S.code = c; try { const r = await api('/api/login'); S.who = r.who; store.set('kf_code', c); S.tab = null; await go(); } catch { S.code = null; loginScreen('That code was not recognised.'); } }
    else if (a === 'logout') { S.code = null; S.who = null; S.ov = null; S.plan = null; S.draft = null; store.set('kf_code', null); try { localStorage.removeItem('kf_snap'); } catch {} S.tab = null; loginScreen(); }
    else if (a === 'showLogin') loginScreen();
    else if (a === 'tblReset') { const T = S.tbl[t.dataset.id]; if (T) { T.f = {}; T.q = ''; store.set(memKey('t:' + t.dataset.id), null); } render(); }
    else if (a === 'moreMenu') { const m = document.getElementById('msheet'); if (m) m.hidden = !m.hidden; }
    else if (a === 'refresh') await refreshApp();
    else if (a === 'fuPrev') { S.adm.preview = await api('/api/admin/followup'); render(); }
    else if (a === 'fuTest') { const to = ($('#testTo').value || '').trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { S.testMsg = 'Type a valid email address first.'; render(); return; } store.set('kf_test_to', to); try { const r = await api('/api/admin/followup', { method: 'POST', body: { action: 'test', to } }); S.testMsg = 'Follow-up test sent to ' + to + '. ' + r.note; } catch (e) { S.testMsg = e.message; } render(); }
    else if (a === 'fuSend') { try { const c = await api('/api/admin/followup', { method: 'POST', body: { action: 'count' } }); if (!confirm(`Send the onboarding follow-up now to ${c.recipients} coordinators? Each email contains the person's own access code, and ${c.cc} HQ people are copied on each one.`)) return; S.testMsg = 'Sending…'; render(); const r = await api('/api/admin/followup', { method: 'POST', body: { action: 'send' } }); S.testMsg = `Sent ${r.results.filter((x) => x.sent).length} of ${r.results.length}.${r.results.some((x) => x.error) ? ' Problems: ' + r.results.filter((x) => x.error).map((x) => x.email + ': ' + x.error).join('; ') : ''}`; } catch (e) { S.testMsg = e.message; } render(); }
    else if (a === 'umenu') { const m = document.getElementById('um'); if (m) m.hidden = !m.hidden; }
    else if (a === 'searchToggle') { const g = document.getElementById('gswrap'); g.classList.toggle('open'); if (g.classList.contains('open')) document.getElementById('gs').focus(); }
    else if (a === 'alerts') await toggleAlerts();
    else if (a === 'exitPreview') await setViewAs('');
    else if (a === 'hqAdd') { const name = $('#hqName').value.trim(); if (!name) { S.hqMsg = 'Write the name first.'; render(); return; } try { await api('/api/admin/hq-users', { method: 'POST', body: { action: 'add', name, email: $('#hqEmail').value, level: $('#hqLevel').value } }); S.hqMsg = name + ' was added. Their code is in the table: send it to them (Email code).'; await loadAdmin(); } catch (e) { S.hqMsg = e.message; } render(); }
    else if (a === 'hqReissue') { if (confirm('Give this person a new code? The old one stops working at once.')) { try { await api('/api/admin/hq-users', { method: 'POST', body: { action: 'reissue', id: t.dataset.id } }); S.hqMsg = 'New code issued.'; await loadAdmin(); } catch (e) { S.hqMsg = e.message; } render(); } }
    else if (a === 'hqEmail') { try { const r = await api('/api/admin/hq-users', { method: 'POST', body: { action: 'email', id: t.dataset.id } }); S.hqMsg = 'The code was emailed to ' + r.sent_to + '.'; } catch (e) { S.hqMsg = e.message; } render(); }
    else if (a === 'hqShared') { const on = Boolean(t.dataset.on); if (!on && !confirm('Switch the shared HQ code off? Everyone in HQ must then use their personal code.')) return; try { await api('/api/admin/hq-users', { method: 'POST', body: { action: 'shared', enabled: on } }); S.hqMsg = on ? 'The shared code is on again.' : 'The shared code is off.'; await loadAdmin(); } catch (e) { S.hqMsg = e.message; } render(); }
    else if (a === 'stSave') { const g = (id) => document.getElementById(id).value; const targets = {}; document.querySelectorAll('[data-tg]').forEach((i) => { (targets[i.dataset.tg] ||= {})[i.dataset.f] = Number(i.value); }); try { await api('/api/admin/settings', { method: 'POST', body: { brand: { platform: g('stPlatform'), programme: g('stProgramme'), tagline: g('stTagline'), assistant: g('stAssistant') }, targets } }); S.cfg = await api('/api/config'); applyBrand(); S.stMsg = 'Saved. The new name shows everywhere.'; await loadAdmin(); } catch (e) { S.stMsg = e.message; } render(); }
    else if (/^rep[A-Z]/.test(a)) await repAction(a, t);
    else if (a === 'goMineQ') { S.qf = { q: '', type: '', sev: '', region: '', st: 'mine' }; S.tab = 'allq'; render(); }
    else if (a === 'payCsv') payCsv();
    else if (a === 'wkx') await workToggle(t);
    else if (/^pil[A-Z]/.test(a)) await pilotAction(a, t);
    else if (/^pu[A-Z]/.test(a)) await pupilAction(a);
    else if (a === 'fixClean') {
      const C = (S.cl ||= {}); C.mode = t.dataset.mode; C.form = { kind: t.dataset.kind, school: t.dataset.school, date: t.dataset.date, grade: t.dataset.grade, stuid: t.dataset.mode === 'edit' || t.dataset.mode === 'delete' ? t.dataset.stu : '', dups: false }; C.found = null; C.sel = []; C.msg = 'Searching…';
      await selectTab('clean');
      try { const f = C.form; const q = new URLSearchParams({ kind: f.kind, school: f.school, ...(f.date ? { date: f.date } : {}), ...(f.grade ? { grade: f.grade } : {}), ...(f.stuid ? { stuid: f.stuid } : {}) }); C.found = await api('/api/deletions/find?' + q); C.sel = []; C.msg = C.found.records.length ? 'Tick the record to correct or remove.' : ''; if (C.mode === 'edit') C.editField = 'pupil'; } catch (e) { C.msg = e.message; }
      render();
    }
    else if (/^dl[A-Z]/.test(a)) await cleanAction(a, t);
    else if (/^nr[A-Z]/.test(a)) await narrAction(a, t);
    else if (a === 'usFilter') { S.usF = t.dataset.v; render(); }
    else if (a === 'admSub') { S.admSub = t.dataset.v; try { store.set('kf_admsub', S.admSub); } catch {} render(); window.scrollTo(0, 0); }
    else if (/^ms[A-Z]/.test(a)) await msAction(a, t);
    else if (/^ai[A-Z]/.test(a)) await aiAction(a, t);
    else if (a === 'stDel') await storageAction(t);
    else if (/^fm[A-Z]/.test(a)) await formsAction(a, t);
    else if (a === 'react') await reactTo(t);
    else if (a === 'sendTest') { const to = ($('#testTo').value || '').trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { S.testMsg = 'Type a valid email address first.'; render(); return; } store.set('kf_test_to', to); try { await api('/api/admin/test-email', { method: 'POST', body: { to } }); S.testMsg = 'A test was sent to ' + to + '. It is marked [TEST] and goes only to that address.'; } catch (e) { S.testMsg = e.message; } render(); }
    else if (a === 'copyNotice') await copyNotice(t);
    else if (a === 'noticeAll') { S.nAll = !S.nAll; render(); }
    else if (a === 'nwView') { S.nwView = t.dataset.v; render(); }
    else if (/^nw[A-Z]/.test(a)) await newsAction(a, t);
    else if (a === 'calsyncOn' || a === 'calsyncOff') { if (a === 'calsyncOn' && !confirm('Switch on? When enough regions have submitted, the calendar check turns on in the forms for every planned school.')) return; await api('/api/admin/calsync', { method: 'POST', body: { action: a === 'calsyncOn' ? 'enable' : 'disable' } }); await loadAdmin(); render(); }
    else if (a === 'calsyncRun') { S.calSyncMsg = 'Uploading…'; render(); try { const r = await api('/api/admin/calsync', { method: 'POST', body: { action: 'run' } }); S.calSyncMsg = r.ran?.skipped || (r.ran?.ok ? 'Uploaded ' + r.ran.version : 'Failed: ' + JSON.stringify(r.ran?.results)); } catch (e) { S.calSyncMsg = e.message; } await loadAdmin(); render(); }
    else if (a === 'formJobCancel' || a === 'formJobArm') { await api('/api/admin/formjob', { method: 'POST', body: { action: a === 'formJobArm' ? 'arm' : 'disarm' } }); await loadAdmin(); render(); }
    else if (a === 'formJobRun') { if (!confirm('Replace the live Sampling form with the standard form now? Submissions are kept; the checks run first.')) return; S.formJobMsg = 'Running…'; render(); try { const r = await api('/api/admin/formjob', { method: 'POST', body: { action: 'run' } }); S.formJobMsg = r.ran?.ok ? 'Done.' : 'Stopped: ' + (r.ran?.why || r.ran?.skipped); } catch (e) { S.formJobMsg = e.message; } await loadAdmin(); render(); }
    else if (a === 'practiceClear') { if (prompt('This removes every practice record from the dashboard (KoBo keeps them). Type CLEAR to confirm.') === 'CLEAR') { await api('/api/admin/practice-clear', { method: 'POST', body: { confirm: 'CLEAR' } }); await loadPractice(); render(); } }
    else if (a === 'pushTest') { const r = await api('/api/admin/push-test', { method: 'POST', body: { role: 'hq' } }); alert(r.skipped || `Sent to ${r.sent} device(s)` + (r.errors?.length ? ', errors: ' + r.errors.join(', ') : '')); }
    else if (a === 'prevRem') { S.adm.preview = await api('/api/admin/reminder-preview?region=' + t.dataset.region); render(); }
    else if (a === 'retryPlan') { await loadPlan(); render(); }
    else if (a === 'dClose') closeDetail();
    else if (a === 'dBack') { const prev = S.stack.pop(); openDetail(prev, false); }
    else if (a === 'goPublic') { S.tab = null; await go(); }
    else if (a === 'selVisit') { S.selVisit = t.dataset.id || null; render(); if (S.selVisit) $('#chDate')?.scrollIntoView({ block: 'center' }); }
    else if (a === 'notice') { S.plan = await api('/api/plan?region=' + S.planRegion, { method: 'POST', body: { action: 'notice', visit_id: t.dataset.id, kind: t.dataset.kind } }).then(async () => api('/api/plan?region=' + S.planRegion)); render(); }
    else if (a === 'applyChange') {
      try { await api('/api/plan?region=' + S.planRegion, { method: 'POST', body: { action: 'change', visit_id: t.dataset.id, new_date: $('#chDate').value, new_start: $('#chStart').value, reason_code: $('#chReason').value, note: $('#chNote').value } }); S.selVisit = null; await loadPlan(); render(); }
      catch (er) { const b = $('#chErr'); b.hidden = false; b.textContent = er.message; }
    }
    else if (a === 'resuggest') { S.draft = suggest(S.plan.schools, S.planRegion, S.plan.staff); S.dayNotes = {}; render(); }
    else if (a === 'saveDraft' || a === 'submitPlan') {
      readDraftFromDom(); const visits = S.draft;
      try { await api('/api/plan?region=' + S.planRegion, { method: 'POST', body: { action: a === 'submitPlan' ? 'submit' : 'draft', visits, day_notes: S.dayNotes || {} } }); if (a === 'submitPlan') { S.draft = null; S.dayNotes = null; } await loadPlan(); render(); }
      catch (er) { const b = $('#plErr'); b.hidden = false; b.innerHTML = esc(er.message) + (er.data?.errors ? '<ul>' + er.data.errors.slice(0, 8).map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : ''); }
    }
    else if (a === 'qOpen') { S.qOpen = t.dataset.k || null; S.qMode = t.dataset.m || 'respond'; render(); $('#qText')?.focus(); }
    else if (a === 'qRemind') { try { await api('/api/query', { method: 'POST', body: { key: t.dataset.k, action: 'remind' } }); alert('Reminder sent'); await loadData(); } catch (e) { alert(e.message); } render(); }
    else if (a === 'qSubmit' || a === 'qApprove' || a === 'qClose') {
      const m = t.dataset.m; const text = ($('#qText') || {}).value || '';
      let body = { key: t.dataset.k };
      if (a === 'qApprove') { if (!confirm('Approve this response and pass it on?')) return; body = { ...body, action: 'review', decision: 'approve' }; }
      else if (a === 'qClose') { const why = prompt('Why is this being closed without the review chain? (recorded in the history)'); if (!why) return; body = { ...body, action: 'resolve', text: why }; }
      else if (m === 'respond') body = { ...body, action: 'respond', text };
      else if (m === 'edit') body = { ...body, action: 'review', decision: 'edit', text };
      else body = { ...body, action: 'review', decision: 'reject', note: text };
      try { await api('/api/query', { method: 'POST', body }); S.qOpen = null; await loadData(); } catch (e) { alert(e.message); }
      render();
    }
    else if (a === 'saveRec') { const bad = S.recRows.find((r) => r.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email.trim())); if (bad) { alert('This email address is not valid: ' + bad.email); return; } const rows = S.recRows.filter((r) => r.email.trim()).map((r) => ({ email: r.email.trim(), name: r.name.trim(), role: r.role, region: r.role === 'hq' ? '' : r.region, copy: r.copy, paused: !r.active, from: r.from, backup: r.backup })); const lost = S.recRows.filter((r) => r.email.trim() && r.role !== 'hq' && !r.region); if (lost.length && !confirm(lost.length + ' RC/ARC row(s) have no region and will get no regional emails. Save anyway?')) return; await api('/api/admin/recipients', { method: 'POST', body: { rows } }); S.recRows = null; await loadAdmin(); render(); }
    else if (a === 'recAdd') { S.recRows.unshift({ email: '', name: '', role: 'rc', region: '', copy: false, backup: '', from: '', active: true }); S.recDirty = true; render(); const f = document.querySelector('[data-rr="0"][data-f="name"]'); if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); } }
    else if (a === 'recDel') { const i = Number(t.dataset.i); const r = S.recRows[i]; if (r && (!r.email || confirm('Remove ' + (r.name || r.email) + ' from the email list? (Save to apply.)'))) { S.recRows.splice(i, 1); S.recDirty = true; render(); } }
    else if (a === 'prevMail') { const p = await api(`/api/admin/digest-preview?kind=${t.dataset.kind}&region=${t.dataset.region}`); S.adm.preview = p; render(); }
    else if (a === 'calCsvLast') {
      const res = await fetch('/api/admin/calendar-csv?which=last', { headers: { 'x-access-code': S.code } });
      if (!res.ok) { S.calMsg = 'Nothing has been uploaded automatically yet, so there is no copy to download.'; render(); return; }
      const blob = await res.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = 'ref_calendar.csv'; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      S.calMsg = 'Downloaded the copy the system last uploaded by itself.'; render();
    }
    else if (a === 'calCsv') {
      const res = await fetch('/api/admin/calendar-csv', { headers: { 'x-access-code': S.code } });
      if (!res.ok) throw new Error('Could not build the calendar file');
      const rows = res.headers.get('x-calendar-rows'), ver = res.headers.get('x-calendar-version');
      const blob = await res.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = 'ref_calendar.csv'; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      S.calMsg = `Downloaded ${rows} planned school visits (${ver}). Upload it to the form as ref_calendar.csv.`; render();
    }
    else if (a === 'koboStatus') {
      if (S.koboConfirm !== t.dataset.k) { S.koboConfirm = t.dataset.k; render(); if (S.cur) openDetail(S.cur, false); return; }
      const qk = t.dataset.k.split('|').slice(0, -1).join('|');
      try { const r = await api('/api/kobo/status', { method: 'POST', body: { ids: t.dataset.ids.split(',').map(Number), status: t.dataset.status, year: S.ov?.year } }); S.koboMsg = { k: qk, t: `Done: ${r.updated} submission(s) set to "${t.dataset.status.replace('_', ' ')}" in KoBo.` }; }
      catch (er) { S.koboMsg = { k: qk, t: 'Not done: ' + er.message }; }
      S.koboConfirm = null; render(); if (S.cur) openDetail(S.cur, false);
    }
    else if (a === 'rosterSave') { const id = t.dataset.id; const g = (k) => document.querySelector(`[data-rs="${k}"][data-id="${id}"]`).value; await api('/api/admin/roster', { method: 'POST', body: { action: 'update', id, name: g('name'), region: g('region'), position: g('position') } }); S.rosterMsg = 'Saved.'; await loadAdmin(); render(); }
    else if (a === 'rosterRemove' || a === 'rosterRestore') { await api('/api/admin/roster', { method: 'POST', body: { action: a === 'rosterRemove' ? 'remove' : 'restore', id: t.dataset.id } }); S.rosterMsg = a === 'rosterRemove' ? 'Removed. Their code no longer works.' : 'Restored.'; await loadAdmin(); render(); }
    else if (a === 'rosterReissue') { const r = await api('/api/admin/roster', { method: 'POST', body: { action: 'reissue', id: t.dataset.id } }); S.rosterMsg = `New code: ${r.code}. The old code no longer works. Send it to the person privately.`; await loadAdmin(); render(); }
    else if (a === 'rosterAdd') { try { await api('/api/admin/roster', { method: 'POST', body: { action: 'add', name: $('#newName').value, region: $('#newRegion').value, position: $('#newPos').value } }); S.rosterMsg = 'Person added. Their code is in the Access codes list below.'; } catch (er) { S.rosterMsg = er.message; } await loadAdmin(); render(); }
    else if (a === 'rosterAlias') { const n = t.dataset.n; const sel = document.querySelector(`[data-ra="${CSS.escape(n)}"]`); if (!sel || !sel.value) return; await api('/api/admin/roster', { method: 'POST', body: { action: 'alias', kobo_name: n, staff_id: sel.value } }); S.rosterMsg = `"${n}" is now counted under the chosen person.`; await loadAdmin(); render(); }
    else if (a === 'rosterUnalias') { await api('/api/admin/roster', { method: 'POST', body: { action: 'unalias', kobo_name: t.dataset.n } }); await loadAdmin(); render(); }
    else if (a === 'daysShow') { S.dwFrom = $('#dwFrom').value; S.dwTo = $('#dwTo').value; S.daysRows = await api(`/api/admin/days-worked?from=${S.dwFrom}&to=${S.dwTo}`); render(); }
    else if (a === 'daysCsv') { S.dwFrom = $('#dwFrom').value; S.dwTo = $('#dwTo').value; await downloadFile(`/api/admin/days-worked?format=csv&from=${S.dwFrom}&to=${S.dwTo}`, 'days-worked.csv'); }
    else if (a === 'backupDownload') { await downloadFile('/api/admin/backup?full=1', `kf4-backup-${new Date().toISOString().slice(0, 10)}-full.json`); S.backupMsg = 'Downloaded. Keep the file somewhere safe.'; render(); }
    else if (a === 'devAssign') { const sel = document.querySelector(`[data-dv="${CSS.escape(t.dataset.c)}"]`); await api('/api/admin/devices', { method: 'POST', body: { code: t.dataset.c, staff_id: sel.value || null } }); await loadAdmin(); render(); }
    else if (a === 'backupGet') { await downloadFile('/api/admin/backup?key=' + encodeURIComponent(t.dataset.key), t.dataset.key.slice(3) + '.json.gz'); }
    else if (a === 'backupPick') { S.pickKey = t.dataset.key || null; render(); }
    else if (a === 'restoreKey') { const r = await api('/api/admin/restore', { method: 'POST', body: { confirm: ($('#restoreConfirmKey') || {}).value, key: S.pickKey, states: S.pickKey.endsWith('-full') } }); S.backupMsg = 'Restored: ' + Object.entries(r.restored).map(([k, v]) => `${v} ${k}`).join(', '); S.pickKey = null; await loadAdmin(); render(); }
    else if (a === 'backupMail') { const r = await api('/api/admin/backup', { method: 'POST', body: { full: true, email: true } }); S.backupMsg = r.emailed ? `Copy stored and emailed to ${r.to}${r.cc.length ? ' with ' + r.cc.length + ' in copy' : ''}.` : 'Copy stored, but no email sent (check the backup recipient).'; await loadAdmin(); render(); }
    else if (a === 'backupNow') { const r = await api('/api/admin/backup', { method: 'POST', body: { full: true } }); S.backupMsg = `Copy stored inside Cloudflare (${Math.round(r.gz_bytes / 1024)} KB).`; await loadAdmin(); render(); }
    else if (a === 'restoreRun') { const r = await api('/api/admin/restore', { method: 'POST', body: { confirm: ($('#restoreConfirm') || {}).value, backup: S.restoreData, states: Boolean(S.restoreData.states) } }); S.backupMsg = 'Restored: ' + Object.entries(r.restored).map(([k, v]) => `${v} ${k}`).join(', '); S.restoreData = null; await loadAdmin(); render(); }
    else if (a === 'koboCheck') { const r = await api('/api/admin/kobo-check'); S.koboWho = r.username ? `The connection signs in to KoBo as "${r.username}". The form belongs to "${r.owner}". ${r.username === r.owner ? 'Same account, so writing approved or on-hold status should work.' : 'Different account: writing status needs edit permission on the form for this account.'}` : 'Could not read the KoBo account.'; render(); }
    else if (a === 'refreshNow') { t.disabled = true; await api('/api/admin/refresh', { method: 'POST' }); await loadAdmin(); render(); }
  } catch (er) { alert(er.message); }
});
async function downloadFile(path, name) {
  const res = await fetch(path, { headers: { 'x-access-code': S.code } });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}
document.addEventListener('change', async (e) => {
  if (e.target.id === 'themeSel') { setTheme(e.target.value); return; }
  if (e.target.id === 'nrRegion') { S.nr.region = e.target.value; S.nr.open = null; S.nr.doc = null; await loadNarr(); return; }
  if (e.target.id === 'dfField') { (S.cl ||= {}).editField = e.target.value; render(); return; }
  if (e.target.dataset?.rc !== undefined && S.rep?.edit) { const k = e.target.dataset.rc; const H = new Set(S.rep.edit.hidden || []); if (e.target.checked) H.delete(k); else H.add(k); S.rep.edit.hidden = [...H]; repSync(); render(); return; }
  if (e.target.dataset?.rf !== undefined && S.rep) { S.rep.formats[e.target.dataset.rf] = e.target.checked; return; }
  if (e.target.dataset?.hq) { const f = e.target.dataset.f; const body = { action: 'update', id: e.target.dataset.hq, [f]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }; try { await api('/api/admin/hq-users', { method: 'POST', body }); S.hqMsg = 'Saved.'; } catch (err) { S.hqMsg = err.message; } await loadAdmin(); render(); return; }
  if (e.target.dataset?.rr !== undefined && S.recRows) { const r = S.recRows[Number(e.target.dataset.rr)]; const f = e.target.dataset.f; if (r) { r[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; if (f === 'role' && r.role === 'hq') r.region = ''; S.recDirty = true; if (f === 'active' || f === 'role') render(); else { const tr = e.target.closest('tr'); if (tr) tr.dataset.q = (r.name + ' ' + r.email + ' ' + r.role + ' ' + r.region).toLowerCase(); } } return; }
  if (e.target.id === 'phDate') { S.phDate = e.target.value; S.ph = null; render(); await loadPhones(); render(); return; }
  if (e.target.id === 'phRegion') { S.phRegion = e.target.value; S.ph = null; render(); await loadPhones(); render(); return; }
  if (e.target.dataset?.pl && S.plan && S.plan.plan.status !== 'locked') { readDraftFromDom(); render(); return; }
  if (e.target.dataset?.dn) { S.dayNotes ||= {}; const d = e.target.dataset.d; (S.dayNotes[d] ||= {})[e.target.dataset.dn] = e.target.value; return; }
  if (e.target.id === 'restoreFile' && e.target.files[0]) {
    try { const f = e.target.files[0]; let text; if (/\.gz$/i.test(f.name)) text = await new Response(f.stream().pipeThrough(new DecompressionStream('gzip'))).text(); else text = await f.text(); S.restoreData = JSON.parse(text); if (S.restoreData.format !== 'kf4-backup-1') throw new Error('not a backup'); } catch { S.restoreData = null; S.backupMsg = 'That file is not a KiuFunza backup.'; }
    render(); return;
  }
  if (e.target.dataset?.ffile && e.target.files[0]) { const f = e.target.files[0]; const buf = new Uint8Array(await f.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192)); const b64 = btoa(bin); const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 16); (S.formFile ||= {})[e.target.dataset.ffile] = { name: f.name, b64, hash: h }; (S.formMsg ||= {})[e.target.dataset.ffile] = ''; render(); return; }
  if (e.target.id === 'mcTpl' && e.target.value) { const tp = S.msg.data.templates.find((x) => x.id === e.target.value); msRead(); S.msg.draft.subject = tp.subject; S.msg.draft.body = tp.body; render(); return; }
  if (e.target.name === 'mcWhen') { msRead(); render(); return; }
  if (e.target.dataset?.mreg || e.target.dataset?.mpe || e.target.id?.startsWith('mcR-')) { msRead(); render(); return; }
  if (e.target.dataset?.dsel) { const id = Number(e.target.dataset.dsel); const C = S.cl; const g0 = (i) => document.getElementById(i); if (g0('dfSchool')) C.form = { kind: g0('dfKind').value, school: g0('dfSchool').value.trim(), date: g0('dfDate').value, grade: g0('dfGrade').value, stuid: g0('dfStu').value.trim(), dups: g0('dfDups').checked }; const rs0 = g0('dfReason'); if (rs0) C.reasonDraft = rs0.value; C.sel = (C.sel || []).filter((x) => x !== id); if (e.target.checked) C.sel.push(id); render(); return; }
  const tf = e.target.dataset?.tf; if (tf) { const [id, k] = tf.split(':'); S.tbl[id].f[k] = e.target.value; tblSave(id); render(); return; }
  const qf = e.target.dataset?.qf; if (qf) { S.qf[qf] = e.target.value; store.set(memKey('qf'), JSON.stringify(S.qf)); render(); return; }
  if (e.target.id === 'startSel') { store.set('kf_start:' + roleKey() + ':' + (S.who.id ?? S.who.name), e.target.value || null); return; }
  if (e.target.dataset?.psm) { const [school, g, sid] = e.target.dataset.psm.split(':'); try { await api('/api/pilot', { method: 'POST', body: { action: 'sampler', school, grade: g, staff_id: sid, on: e.target.checked } }); } catch (er) { alert(er.message); } await loadPilot(); return; }
  if (e.target.dataset?.psl) { const [school, g] = e.target.dataset.psl.split(':'); try { await api('/api/pilot', { method: 'POST', body: { action: 'sampling_lead', school, grade: g, staff_id: e.target.value || null } }); } catch (er) { alert(er.message); } await loadPilot(); return; }
  if (e.target.dataset?.ps) { const [school, sid] = e.target.dataset.ps.split(':'); try { await api('/api/pilot', { method: 'POST', body: { action: 'support', school, staff_id: sid, grade: e.target.value || null } }); } catch (er) { alert(er.message); } await loadPilot(); return; }
  if (e.target.dataset?.pg) { const [school, sid] = e.target.dataset.pg.split(':'); try { await api('/api/pilot', { method: 'POST', body: { action: 'grade', school, staff_id: sid, grade: e.target.value && e.target.value !== '0' ? e.target.value : null } }); } catch (er) { alert(er.message); } await loadPilot(); return; }
  if (e.target.id === 'payYear') { await loadPayments(e.target.value); return; }
  if (e.target.id === 'viewAsSel') { await setViewAs(e.target.value); return; }
  if (e.target.id === 'yearSel') { S.year = e.target.value; S.allSchools = null; S.workCache = {}; S.linked = null; await go(); }
  else if (e.target.id === 'planRegion') { S.draft = null; S.dayNotes = null; await loadPlan(e.target.value); render(); }
  else if (e.target.id === 'exLga') { S.explore.lga = e.target.value; render(); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'repFilter' && S.rep?.edit) { S.rep.edit.filter = e.target.value; const el = document.getElementById('repTable'); if (el) el.innerHTML = repTable(); return; }
  if (e.target.id === 'actQ') { const q = e.target.value.trim().toLowerCase(); document.querySelectorAll('tr[data-q]').forEach((tr) => { tr.hidden = Boolean(q) && !tr.dataset.q.includes(q); }); return; }
  if (e.target.id === 'recQ') { const q = e.target.value.trim().toLowerCase(); document.querySelectorAll('tr[data-ri]').forEach((tr) => { tr.hidden = Boolean(q) && !tr.dataset.q.includes(q); }); return; }
  if (e.target.dataset?.rr !== undefined && S.recRows && e.target.type !== 'checkbox') { const r = S.recRows[Number(e.target.dataset.rr)]; if (r) { r[e.target.dataset.f] = e.target.value; S.recDirty = true; } return; }
  if (e.target.id === 'gs') { doSearch(e.target.value); return; }
  const tq = e.target.dataset?.tq; if (tq) { S.tbl[tq].q = e.target.value; const pos = e.target.selectionStart; render(); const el = document.querySelector(`[data-tq="${tq}"]`); if (el) { el.focus(); el.setSelectionRange(pos, pos); } return; }
  if (e.target.dataset?.qf === 'q') { S.qf.q = e.target.value; const pos = e.target.selectionStart; render(); const el = document.querySelector('[data-qf="q"]'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } return; } if (e.target.id === 'exQ') { S.explore.q = e.target.value; const pos = e.target.selectionStart; render(); const el = $('#exQ'); el.focus(); el.setSelectionRange(pos, pos); } });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDetail(); if (e.key === 'Enter' && e.target.id === 'code') document.querySelector('[data-act="login"]').click(); });

(async function boot() {
  setTimeout(() => { checkAlerts(); }, 1500);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try { S.cfg = await api('/api/config'); applyBrand(); } catch { $('#app').innerHTML = '<div class="banner bad">Cannot reach the server.</div>'; return; }
  const saved = store.get('kf_code');
  if (saved) { S.code = saved; try { S.who = (await api('/api/login')).who; } catch { S.code = null; S.who = null; store.set('kf_code', null); } }
  if (!S.who) { loginScreen(); return; }
  const asHash = /^#as=(\w+)(?:\/(\w+))?$/.exec(location.hash);
  if (asHash && S.who.role === 'hq') { S.tab = 'hq'; await go(); history.replaceState(null, '', location.pathname); await setViewAs(asHash[1]); if (asHash[2]) { S.tab = asHash[2]; if (S.tab === 'plan') await loadPlan(); render(); } return; }
  await go();
})();

// ---------- connection dot (green online, red offline) ----------
(() => {
  const dot = document.getElementById('net'); if (!dot) return;
  const set = (on) => { dot.classList.toggle('on', on); const t = on ? 'Online' : 'Offline: showing the last saved data'; dot.title = t; dot.setAttribute('aria-label', t); };
  const ping = async () => { if (!navigator.onLine) return set(false); try { const r = await fetch('/manifest.json?ping=' + Date.now(), { cache: 'no-store' }); set(r.ok || r.status < 500); } catch { set(false); } };
  addEventListener('online', ping); addEventListener('offline', () => set(false)); setInterval(ping, 30000); ping();
})();

(function () { const el = document.getElementById('tdate'); if (!el) return; const t = () => { const d = new Date(Date.now() + 3 * 3600e3); const f = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).formatToParts(d); const g = (t) => (f.find((x) => x.type === t) || {}).value || ''; el.innerHTML = `<span class="dw">${g('weekday')} </span>${g('day')} ${g('month')}`; el.title = 'Today, East Africa Time'; }; t(); setInterval(t, 60000); })();
