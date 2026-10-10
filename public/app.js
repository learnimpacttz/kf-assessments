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

const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString('en-GB'));
const pc = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const dayName = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortDate = (iso) => (iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '–');
const title = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const FLAG_LABEL = { fast: 'Test too fast', slow: 'Test too slow', window: 'Outside school hours', gps: 'Far from school', skilltime: 'Skills skipped', dup: 'Pupil tested twice', notlist: 'Not on sampling list', team: 'Team size', over: 'Over the sample', short: 'Short of the sample', nosample: 'No sampling record', offcal: 'Visited off the calendar', headcount: 'Fewer phones than people', devshare: 'One phone, several names', devowner: 'Someone else\'s phone', devoverlap: 'Tests overlap on one phone', devtravel: 'Phone at two schools too fast', devswitch: 'Phone jumping between grades', devnames: 'Names changing on one phone', namedevs: 'One person, several phones' };

// ---------- shared pieces ----------
const kpi = (l, v, s = '') => `<div class="kpi"><div class="l">${l}</div><div class="v num">${v}</div><div class="s">${s}</div></div>`;
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
function flagList(all, { limit = 8, names = true } = {}) {
  const flags = all.filter(isOpen);
  if (!flags.length) return '<div class="empty">No open flags. Nothing needs a call right now.</div>';
  const canResolve = S.who && S.who.role !== 'volunteer';
  const one = (f) => {
    const thread = f.q && f.q.thread.length ? `<div class="thread">${f.q.thread.map((m) => `<div><b>${esc(m.by)}</b> <span>${fmtAt(m.at)}</span><br>${esc(m.text)}</div>`).join('')}</div>` : '';
    const box = S.qOpen === f.qk ? `<div class="qbox"><textarea id="qText" placeholder="Your reply, in a sentence or two"></textarea><div style="display:flex;gap:6px;margin-top:6px"><button class="btn sm" data-act="qSend" data-k="${esc(f.qk)}">Send</button>${canResolve ? `<button class="btn sm sec" data-act="qResolve" data-k="${esc(f.qk)}">Mark resolved</button>` : ''}<button class="btn sm sec" data-act="qOpen" data-k="">Cancel</button></div></div>` : `<button class="btn sm sec" data-act="qOpen" data-k="${esc(f.qk)}" style="margin-top:6px">${f.q && f.q.thread.length ? 'Reply' : 'Reply or explain'}</button>`;
    return `<div class="flag"><i class="st ${f.sev}"></i><div style="min-width:0;flex:1"><b>${esc(f.school_name || f.school)} · ${esc(FLAG_LABEL[f.type] || f.type)}</b><span>${esc(f.region ? title(f.region) + ' · ' : '')}${esc(f.lga ? title(f.lga) + ' · ' : '')}${f.grade ? 'Grade ' + f.grade + ' · ' : ''}${esc(f.text)}${names && f.admin ? ' · ' + esc(f.admin) : ''}${f.date ? ' · ' + shortDate(f.date) : ''}</span><span>${esc(f.hint || '')}</span>${thread}<details class="fd"><summary>Details to find the records</summary>${flagDetail(f)}</details>${f.qk ? box : ''}</div></div>`;
  };
  return flags.slice(0, limit).map(one).join('') + (flags.length > limit ? `<div class="note">+ ${flags.length - limit} more in the data explorer.</div>` : '');
}

function briefCard(title0 = "Today's briefing") {
  const b = S.brief; if (!b) return '';
  const items = b.items.length ? b.items.map((i) => `<div class="flag"><i class="st ${i.sev}"></i><div><span style="color:var(--ink);font-size:14px">${esc(i.text)}</span></div></div>`).join('') : '<div class="empty">Nothing to report yet.</div>';
  const ai = b.ai ? `<div class="aiwrap"><div class="ai-col"><h4>English</h4><ul>${(b.ai.en || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div><div class="ai-col"><h4>Kiswahili</h4><ul>${(b.ai.sw || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>` : '';
  const tm = Object.entries(b.tomorrow_schools || {}).map(([r, s]) => `<div class="m"><b>${esc(title(r))}</b>: ${s.map(esc).join(', ')}</div>`).join('');
  return `<div class="card brief"><h3>${title0}</h3><div class="sub">Worked out from the data and the plans. ${b.ai ? 'Wording by AI from the same facts.' : ''}</div>${items}${ai}${tm ? `<h4 style="margin:12px 0 4px">Tomorrow, ${dayName(b.tomorrow)}</h4>${tm}` : ''}</div>`;
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
    return `<tr><td><b>${esc(s.name)}</b></td><td class="hide-s">${esc(title(s.lga))}</td><td class="hide-s">${s.mne === 'M&E' ? 'M&amp;E' : 'Test only'}</td><td class="num hide-s">${s.g[1].av}/${s.g[1].target}</td><td class="num hide-s">${s.g[2].av}/${s.g[2].target}</td><td class="num hide-s">${s.g[3].av}/${s.g[3].target}</td><td>${bar(pc(t, tg))}</td><td>${statusPill(s)}</td></tr>`;
  }).join('');
  const neededPerDay = remaining > 0 ? remaining / Math.max(1, workingLeft(o.today)) : 0;
  return `${dataBanner()}<div class="pagehead"><div><h2>${esc(title(r.region))} · ${esc(S.who.position || 'Coordinator')}</h2><p>${r.total} schools · target ${tpg} pupils per grade per school</p></div></div>
  <div class="grid kpis">${kpi('Schools complete', `${r.done}<small> / ${r.total}</small>`, pc(r.done, r.total) + '%')}${kpi('Pupils tested', fmt(r.tested), 'of ' + fmt(r.target))}${kpi('Open flags', flags.length, flags.filter((f) => f.sev === 'bad').length + ' need a call')}${kpi('Pace', r.pace + ' / day', 'schools per field day, last 5 days')}${kpi('Projected finish', r.projected === 'done' ? 'Done' : r.projected ? shortDate(r.projected) : '–', r.behind ? 'after the 4 Dec close' : 'before the 4 Dec close')}</div>
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
  const card = (v) => { const s = sch[v.school]; const g = s?.g; return `<div class="sch"><h4>${esc(v.school_name)}</h4><div class="m">${esc(title(v.lga))} · ${v.mne === 'M&E' ? 'M&amp;E school' : 'test-only school'} · starts ${esc(v.start)}</div>${g ? `<div class="gr">${[1, 2, 3].map((k) => `<div><b>${g[k].av}/${g[k].target}</b><small>Darasa ${k}</small></div>`).join('')}</div>` : ''}${s?.done ? '<div class="note" style="margin-top:8px">Shule imekamilika · School complete</div>' : ''}</div>`; };
  const mf = o.mine.flags.filter(isOpen).length;
  return `${dataBanner()}<div class="pagehead"><div><h2>Habari, ${esc(me.name.split(' ')[0])}</h2><p>${dayName(today)} · ${esc(title(me.region))}</p></div></div>
  ${mf ? `<div class="banner bad">You have <b>${mf}</b> query(ies) to look at. Open "My queries".</div>` : ''}
  <h3 style="margin:14px 0 8px">Leo · Today</h3>${todays.length ? todays.map(card).join('') : '<div class="note">No school in the plan for you today. Check with your RC.</div>'}
  <h3 style="margin:18px 0 8px">Zinazofuata · Coming up</h3>${next.length ? next.map((v) => `<div class="sch"><h4>${esc(v.school_name)}</h4><div class="m">${dayName(v.date)} · ${esc(v.start)} · ${esc(title(v.lga))}</div></div>`).join('') : '<div class="note">Nothing planned yet.</div>'}`;
}
function viewWork() {
  const rows = (S.ov.mine.work || []).map((w) => `<tr><td>${shortDate(w[0])}</td><td>${esc(schoolName(w[1]))}</td><td class="r">${w[2]}</td><td class="num r">${w[3]}</td><td class="num r">${w[4] ?? '–'}</td></tr>`).join('');
  return `<div class="pagehead"><div><h2>My work</h2><p>Everything you tested, by day and school. Pupils appear as numbers only.</p></div></div><div class="card"><div class="tbl"><table><thead><tr><th>Day</th><th>School</th><th class="r">Grade</th><th class="r">Tested</th><th class="r">Avg min</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">Nothing recorded yet.</td></tr>'}</tbody></table></div></div>`;
}
function schoolName(id) { const s = (S.ov.mine?.schools || []).find((x) => x.id === id); return s ? s.name : id; }
function viewQueries() {
  const f = S.ov.mine.flags;
  return `<div class="pagehead"><div><h2>My queries</h2><p>Automatic checks on your records. Talk to your RC about anything here.</p></div></div><div class="card">${flagList(f.map((x) => ({ ...x, school_name: schoolName(x.school) })), { limit: 50, names: false })}</div>`;
}
function viewStats() {
  const me = S.ov.mine.me, b = S.ov.bands;
  if (!me) return `<div class="empty"><h3>No tests yet</h3><p>Your numbers appear after your first submission.</p></div>`;
  const band = (g) => { const lo = b[g].p3, hi = b[g].p99, v = me.by_grade[g]; if (v == null) return ''; const span = hi * 1.3; const left = (lo / span) * 100, width = ((hi - lo) / span) * 100, pos = Math.min(100, (v / span) * 100); return `<div class="m" style="margin-top:8px">Grade ${g}: your average ${v} min · normal ${lo.toFixed(1)}–${hi.toFixed(0)} min</div><div class="band"><i style="left:${left}%;width:${width}%"></i><b style="left:${pos}%"></b></div>`; };
  return `<div class="pagehead"><div><h2>My stats</h2><p>${esc(me.name)}</p></div></div>
  <div class="grid kpis">${kpi('Pupils tested', fmt(me.tested))}${kpi('Avg test time', (me.avg_min ?? '–') + ' min')}${kpi('Quality', me.quality ?? '–', 'out of 100')}${kpi('School days', me.days, me.schools + ' schools')}</div>
  <div class="card" style="margin-top:14px"><h3>Test speed</h3><div class="sub">Your average against the normal range for each grade, from earlier rounds</div>${[1, 2, 3].map(band).join('')}</div>
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
  if (region === 'DODOMA') return schools.map((s) => ({ school: s.id, date: S.cfg.pilot_day, start: '08:00', team: [] }));
  const days = workDays(S.cfg.field.start, S.cfg.field.end);
  const sorted = schools.slice().sort((a, b) => a.lga.localeCompare(b.lga) || a.name.localeCompare(b.name));
  // Protocol: 2 schools a day. The RC leads one school with 2 volunteers, the ARC leads the other with 2 volunteers.
  const rc = staff.find((p) => p.position === 'RC'), arc = staff.find((p) => p.position === 'ARC'), vols = staff.filter((p) => /^Volunteer/.test(p.position)).map((p) => p.name);
  const teams = [[rc?.name, ...vols.slice(0, 2)].filter(Boolean), [arc?.name, ...vols.slice(2, 4)].filter(Boolean)];
  return sorted.map((s, i) => ({ school: s.id, date: days[Math.floor(i / 2)], start: '08:00', team: teams[i % 2] }));
}
function dayCountsOf(draft) { const per = {}; for (const v of draft) if (v.date) (per[v.date] ||= []).push(v.school); return per; }
function readDraftFromDom() {
  S.draft = S.plan.schools.map((s) => ({ school: s.id, date: document.querySelector(`[data-pl="date"][data-s="${s.id}"]`)?.value || null, start: document.querySelector(`[data-pl="start"][data-s="${s.id}"]`)?.value || '08:00', team: [...document.querySelectorAll(`[data-pt="${s.id}"]:checked`)].map((c) => c.value) }));
}
function dayReasonPanel(region, draft) {
  if (region === 'DODOMA') return '';
  const per = dayCountsOf(draft); const dates = Object.keys(per).sort();
  const c1 = dates.filter((d) => per[d].length === 1), c3 = dates.filter((d) => per[d].length === 3), c2 = dates.filter((d) => per[d].length === 2);
  const row = (d, kind) => { const n = S.dayNotes[d] || {}; const opts = Object.entries(S.cfg.day_reasons[kind]); return `<tr><td><b>${dayName(d)}</b><div class="m">${per[d].map((id) => esc(SCH(id))).join(', ')}</div></td><td><select data-dn="code" data-d="${d}"><option value="">Choose a reason</option>${opts.map(([k, t]) => `<option value="${k}" ${n.code === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></td><td><input data-dn="note" data-d="${d}" value="${esc(n.note || '')}" placeholder="${kind === 'three' ? 'Which schools, how far apart, why three is possible' : 'Why only one school this day'}" style="width:100%;min-width:200px"></td></tr>`; };
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
  const nrows = plan.visits.filter((v) => v.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 14).map((v) => `<tr><td><b>${esc(v.school_name)}</b><br><span class="m" style="font-size:12px;color:var(--ink3)">${dayName(v.date)}</span></td><td>${notice(v.aek_state)} <span style="font-size:12px;color:var(--ink3)">by ${shortDate(v.aek_due)}</span>${canEdit && !v.notices.aek ? ` <button class="btn sm sec" data-act="notice" data-kind="aek" data-id="${v.id}">Mark sent</button>` : ''}</td><td>${notice(v.ht_state)} <span style="font-size:12px;color:var(--ink3)">by ${shortDate(v.ht_due)}</span>${canEdit && !v.notices.ht ? ` <button class="btn sm sec" data-act="notice" data-kind="ht" data-id="${v.id}">Mark sent</button>` : ''}</td><td>${notice(v.team_state)}${canEdit && !v.notices.team ? ` <button class="btn sm sec" data-act="notice" data-kind="team" data-id="${v.id}">Mark told</button>` : ''}</td></tr>`).join('');
  const changes = plan.changes.slice().reverse().slice(0, 8).map((c) => `<div class="flag"><i class="st ${c.late ? 'bad' : 'warn'}"></i><div><b>${esc(SCH(c.school))} · ${shortDate(c.from.date)} → ${shortDate(c.to.date)}${c.late ? ' · late change' : ''}</b><span>${esc(c.reason)}${c.note ? ': ' + esc(c.note) : ''} · ${esc(c.by)}</span></div></div>`).join('') || '<div class="empty">No changes yet.</div>';
  const v = plan.visits.find((x) => x.id === S.selVisit);
  const editor = v && canEdit ? `<div class="card" style="margin-top:14px"><h3>Change ${esc(v.school_name)}</h3><div class="sub">Planned ${dayName(v.date)} at ${esc(v.start)}. The team and the ward and head teacher notices are re-sent for a new date.</div><div class="f"><label>New date<input type="date" id="chDate" value="${v.date}" min="${planFrom(region)}" max="${S.cfg.field.end}"></label><label>Start<input type="time" id="chStart" value="${esc(v.start)}"></label><label>Reason<select id="chReason">${Object.entries(S.cfg.reasons).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label><textarea id="chNote" placeholder="Short note (required for Other)"></textarea></div><div style="margin-top:10px;display:flex;gap:8px"><button class="btn" data-act="applyChange" data-id="${v.id}">Save change</button><button class="btn sec" data-act="selVisit" data-id="">Cancel</button></div><div id="chErr" class="banner bad" hidden></div></div>` : '';
  const n = plan.visits.length;
  const done = plan.visits.filter((x) => x.outcome === 'visited').length, past = plan.visits.filter((x) => x.date <= today && x.date < today).length;
  return `${head}<div class="grid kpis">${kpi('Schools planned', n, 'submitted ' + (plan.submitted_at ? shortDate(plan.submitted_at.slice(0, 10)) : '') + ' by ' + esc(plan.submitted_by || ''))}${kpi('Changes', plan.changes.length, plan.changes.filter((c) => c.late).length + ' late')}${kpi('On plan so far', past ? pc(done, past) + '%' : '–', done + ' of ' + past + ' visits due')}${kpi('Plan version', 'v' + plan.version)}</div>
  <div class="card" style="margin-top:14px"><h3>Calendar</h3><div class="sub">Planned (grey), done (green), moved (amber), missed (red). Tap a school to change it.</div>${cal}</div>${dayNotesList(plan, byDate)}${editor}
  <div class="grid two" style="margin-top:14px"><div class="card"><h3>Notice tracker</h3><div class="sub">Ward officer 5 working days before, head teacher 3 working days before, team told at the same time</div><div class="tbl"><table><thead><tr><th>Visit</th><th>Ward officer</th><th>Head teacher</th><th>Team</th></tr></thead><tbody>${nrows || '<tr><td colspan="4" class="empty">No upcoming visits.</td></tr>'}</tbody></table></div></div>
  <div class="card"><h3>Changes and reasons</h3><div class="sub">Every change is recorded with who made it and why</div>${changes}</div></div>`;
}
function dayNotesList(plan, byDate) {
  const odd = Object.keys(byDate).filter((d) => byDate[d].length !== 2 && plan.region !== 'DODOMA').sort();
  if (!odd.length) return '<div class="note" style="margin-top:12px">Every planned day has the standard 2 schools.</div>';
  return `<div class="card" style="margin-top:14px"><h3>Days that are not 2 schools, and why</h3>${odd.map((d) => `<div class="flag"><i class="st ${byDate[d].length === 3 ? 'warn' : 'good'}"></i><div><b>${dayName(d)} · ${byDate[d].length} school(s)</b><span>${esc(byDate[d].map((v) => v.school_name).join(', '))}</span><span>${esc(plan.day_notes?.[d]?.note || 'No reason recorded')}</span></div></div>`).join('')}</div>`;
}
const SCH = (id) => (S.plan?.schools || []).find((s) => s.id === id)?.name || id;
function planBuilder(P, canEdit, region) {
  if (!canEdit) return '<div class="note">The plan has not been submitted yet.</div>';
  const cur = S.draft || (P.plan.visits.length ? P.plan.visits : suggest(P.schools, region, P.staff));
  S.draft = cur;
  if (!S.dayNotes) S.dayNotes = { ...(P.plan.day_notes || {}) };
  const byId = Object.fromEntries(cur.map((v) => [v.school, v]));
  const people = P.staff.map((p) => p.name);
  const rows = P.schools.map((s) => { const v = byId[s.id] || { school: s.id, date: '', start: '08:00', team: [] }; return `<tr><td><b>${esc(s.name)}</b></td><td class="hide-s">${esc(title(s.lga))}</td><td class="hide-s">${s.mne === 'M&E' ? 'M&amp;E' : 'Test only'}</td><td><input type="date" data-pl="date" data-s="${s.id}" value="${esc(v.date)}" min="${planFrom(region)}" max="${S.cfg.field.end}"></td><td><input type="time" data-pl="start" data-s="${s.id}" value="${esc(v.start)}"></td><td><details class="teamd"><summary>${(v.team || []).length ? esc((v.team || []).map((n) => n.split(' ')[0]).join(', ')) : 'Choose team'}</summary><div class="teamlist">${people.map((n) => `<label><input type="checkbox" data-pt="${s.id}" data-pl="team" data-s="${s.id}" value="${esc(n)}" ${(v.team || []).includes(n) ? 'checked' : ''}> ${esc(n)}</label>`).join('')}</div></details></td></tr>`; }).join('');
  return `<div class="banner">Not submitted yet. The dates and teams below follow the protocol: 2 schools a day, the Regional Coordinator and the Assistant each leading one school with 2 volunteers. Change what does not fit. After you submit the plan locks.</div>
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
  <div class="grid kpis">${kpi('Schools complete', `${fmt(n.done)}<small> / ${fmt(n.schools)}</small>`, pc(n.done, n.schools) + '%')}${kpi('Pupils tested', fmt(n.tested), 'of ' + fmt(n.target))}${kpi('Open flags', fmt(openF.length), bad + ' serious')}${kpi('Regions at risk', atRisk, 'projected after 4 Dec')}${kpi('Projected finish', n.projected === 'done' ? 'Done' : n.projected ? shortDate(n.projected) : '–', 'at current pace')}</div>
  ${S.brief ? '<div style="margin-top:14px">' + briefCard() + '</div>' : ''}<div style="margin-top:14px">${forecastCard()}</div><div class="card" style="margin-top:14px"><h3>Regions</h3><div class="sub">Schools complete out of ${fmt(n.schools)}</div>${tiles(o.regions)}</div>
  <div class="grid two" style="margin-top:14px"><div class="card"><h3>Flags to act on</h3><div class="sub">Newest checks across all regions</div>${flagList(openF.slice().sort((a, b) => (a.sev === 'bad' ? 0 : 1) - (b.sev === 'bad' ? 0 : 1)), { limit: 12 })}</div>
  <div style="display:grid;gap:14px;align-content:start"><div class="card"><h3>Checks running</h3><div class="sub">Open flags by type</div>${types.map(([t, c]) => `<div style="display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)"><span style="flex:1">${esc(FLAG_LABEL[t] || t)}</span>${bar(pc(c, mx))}<span class="num" style="width:34px;text-align:right">${c}</span></div>`).join('') || '<div class="empty">No flags.</div>'}</div>
  <div class="card"><h3>Tests per day</h3><div class="sub">All regions</div>${barChart(n.series)}</div></div></div>`;
}
function viewRegionsHQ() {
  const o = S.ov;
  const rows = o.regions.map((r) => { const p = o.plans[r.region] || {}; return `<tr class="click" data-open="region:${esc(r.region)}"><td><b>${esc(title(r.region))}</b> <span class="pill mute">${esc(r.partner || '')}</span></td><td class="num r">${r.done}/${r.total}</td><td class="num r">${fmt(r.tested)}/${fmt(r.target)}</td><td>${bar(pc(r.tested, r.target))}</td><td class="num r">${r.pace}</td><td>${r.projected === 'done' ? 'Done' : r.projected ? shortDate(r.projected) : '–'}</td><td>${p.status === 'locked' ? `<span class="pill good">submitted</span> <span style="font-size:12px;color:var(--ink3)">${p.changes} changes${p.late_changes ? ', ' + p.late_changes + ' late' : ''}</span>` : '<span class="pill warn">not submitted</span>'}</td></tr>`; }).join('');
  return `${dataBanner()}<div class="pagehead"><div><h2>Regions and plans</h2><p>Progress, pace and whether each coordinator has submitted the field plan</p></div></div><div class="card"><div class="tbl"><table><thead><tr><th>Region</th><th class="r">Schools</th><th class="r">Pupils</th><th>Progress</th><th class="r">Pace/day</th><th>Finish</th><th>Field plan</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
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
function viewAdmin() {
  const a = S.adm; if (!a) return '<div class="empty">Loading…</div>';
  const sync = Object.entries(a.status.sync).map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${v.configured ? '<span class="pill good">connected</span>' : '<span class="pill bad">not set</span>'}</td><td class="num r">${fmt(v.records_last_pass)}</td><td>${v.in_progress ? `<span class="pill warn">syncing · page ${v.pages}</span>` : '<span class="pill good">idle</span>'}</td><td>${v.last_done ? new Date(v.last_done).toLocaleString('en-GB') : '–'}</td></tr>`).join('');
  const codes = a.codes ? a.codes.codes.map((c) => `<tr><td>${esc(title(c.region))}</td><td>${esc(c.position)}</td><td>${esc(c.name)}</td><td class="num"><b>${esc(c.code)}</b></td></tr>`).join('') : '';
  return `<div class="pagehead"><div><h2>Admin</h2><p>Readiness, data connections, people, access codes and backups</p></div><button class="btn" data-act="refreshNow">Sync now</button></div>
  ${readinessCard(a)}<div class="card"><h3>Data connections</h3><div class="sub">Student tests, sampling and teacher forms are read from KoBo every 5 minutes in field hours</div><div class="tbl"><table><thead><tr><th>Form</th><th>Status</th><th class="r">Records read</th><th>State</th><th>Last complete</th></tr></thead><tbody>${sync}</tbody></table></div></div>
  ${S.ov.unlisted?.length ? `<div class="banner" style="margin-top:14px"><b>Names in KoBo that are not in the staff roster:</b> ${S.ov.unlisted.map(esc).join(', ')}. Their tests still count, but they have no region or access code.</div>` : ''}
  <div class="card" style="margin-top:14px"><h3>Email digests</h3><div class="sub">Morning brief 07:00 and evening check 17:30 (East Africa Time). ${a.rec?.sending?.domain_ready && a.rec?.sending?.enabled ? '<span class="pill good">sending is on</span>' : '<span class="pill warn">preview only: no sending domain connected yet</span>'}</div>
  <div class="f"><label style="grid-column:1/-1">Recipients, one per line: email, name, role (hq, rc or arc), region, copy (write copy for copy-only), 6th column: paused, or a start date like 2026-10-16. 7th column: backup role, to or cc (weekly backup email)<textarea id="recText" placeholder="name@example.org, Hatibu Lugendo, rc, TANGA">${esc(Object.entries(a.rec?.recipients || {}).map(([e, r]) => [e, r.name, r.role, r.region || '', r.copy ? 'copy' : '', r.active === false ? 'paused' : (r.from || ''), r.backup || ''].join(', ')).join('\n'))}</textarea></label></div>
  <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-act="saveRec">Save recipients</button><button class="btn sm sec" data-act="prevMail" data-kind="morning" data-region="">Preview national morning</button><button class="btn sm sec" data-act="prevMail" data-kind="morning" data-region="TANGA">Preview Tanga morning</button><button class="btn sm sec" data-act="prevMail" data-kind="evening" data-region="">Preview evening</button><button class="btn sm sec" data-act="prevRem" data-region="TANGA">Preview notice reminder (Tanga)</button></div>
  ${a.preview ? `<p style="margin:12px 0 4px"><b>${esc(a.preview.subject)}</b></p><iframe sandbox title="Email preview" style="width:100%;height:420px;border:1px solid var(--line);border-radius:8px;background:#fff" srcdoc="${esc(a.preview.html)}"></iframe>` : ''}</div>
  <div class="card" style="margin-top:14px"><h3>Calendar for the KoBo forms</h3><div class="sub">The assessment and sampling forms check each visit against this file. Download it after plans are submitted and after every approved change, then upload it to both forms as <b>ref_calendar.csv</b> (Form, Settings, Media). Without it the check stays off.</div><button class="btn sm" data-act="calCsv">Download ref_calendar.csv</button>${S.calMsg ? `<p class="m" style="margin-top:8px">${esc(S.calMsg)}</p>` : ''}</div>\n  <div class="card" style="margin-top:14px"><h3>Phone alerts</h3><div class="sub">${a.push?.ready ? '<span class="pill good">server ready</span>' : '<span class="pill warn">not set up</span>'} ${a.push ? a.push.devices + ' device(s) subscribed' : ''}${a.push && a.push.devices ? ' (' + Object.entries(a.push.by_role).map(([k, v]) => v + ' ' + k).join(', ') + ')' : ''}. Each person turns alerts on from the header button on their own phone. On iPhone the page must be on the home screen first.</div><button class="btn sm" data-act="pushTest">Send a test alert to HQ devices</button></div>\n  ${rosterCard(a)}${devicesCard(a)}${backupDaysCard(a)}
  <div class="card" style="margin-top:14px"><h3>Access codes</h3><div class="sub">One code per person. Send each person their own code; do not share this list. HQ code stays with you.</div><div class="tbl"><table><thead><tr><th>Region</th><th>Role</th><th>Name</th><th>Code</th></tr></thead><tbody>${codes}</tbody></table></div></div>`;
}


// ---------- reusable table: search, filter, sort, click-to-open ----------
S.tbl = {};
function dataTable(id, cols, rows, opts = {}) {
  const T = (S.tbl[id] ||= { q: '', sort: opts.sort || null, dir: opts.dir ?? -1, f: {} });
  const filters = opts.filters || [];
  const q = T.q.toLowerCase();
  let list = rows.filter((r) => (!q || cols.some((c) => c.search && String(c.search(r) ?? '').toLowerCase().includes(q))) && filters.every((f) => !T.f[f.k] || String(f.get(r)) === T.f[f.k]));
  const sc = cols.find((c) => c.k === T.sort);
  if (sc) list = list.slice().sort((x, y) => { const a = sc.val(x), b = sc.val(y); if (a == null && b == null) return 0; if (a == null) return 1; if (b == null) return -1; return (typeof a === 'string' ? a.localeCompare(b) : a - b) * T.dir; });
  const tool = `<div class="toolbar"><input data-tq="${id}" type="search" placeholder="${esc(opts.placeholder || 'Search')}" value="${esc(T.q)}" aria-label="Search">${filters.map((f) => `<select data-tf="${id}:${f.k}" aria-label="${esc(f.label)}"><option value="">${esc(f.label)}: all</option>${f.options(rows).map((o) => `<option value="${esc(o[0])}" ${T.f[f.k] === String(o[0]) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`).join('')}<span class="count">${list.length} of ${rows.length}</span></div>`;
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
const schoolsAll = () => (S.who?.role === 'hq' ? S.allSchools || [] : S.ov?.mine?.schools || []);
const adminsAll = () => (S.who?.role === 'hq' ? S.ov.admins : S.ov?.mine?.admins || (S.ov?.mine?.me ? [S.ov.mine.me] : []));
const flagsAll = () => (S.who?.role === 'hq' ? S.ov.flags : S.ov?.mine?.flags || []);
const workOf = (name) => S.workCache[name] || (S.ov?.mine?.work_all || {})[name] || (S.ov?.mine?.me?.name === name ? S.ov.mine.work : []) || [];
S.stack = []; S.cur = null;

function openDetail(spec, push = true) {
  if (push && S.cur) S.stack.push(S.cur);
  S.cur = spec;
  const [kind, ...rest] = spec.split(':'); const id = rest.join(':');
  const body = kind === 'person' ? personCard(id) : kind === 'school' ? schoolCard(id) : kind === 'region' ? regionCard(id) : '<p>Not found.</p>';
  $('#drawerBody').innerHTML = `<div class="dnav">${S.stack.length ? '<button class="btn sm sec" data-act="dBack">‹ Back</button>' : ''}<button class="btn sm sec" data-act="dClose" style="margin-left:auto">Close ✕</button></div>${body}`;
  $('#drawer').hidden = false; if (push !== false || !$('#drawerBody').scrollTop) $('#drawerBody').scrollTop = 0;
  if (kind === 'person' && S.who?.role !== 'volunteer') loadWork(id);
  if ((kind === 'region' || kind === 'school') && S.who?.role === 'hq' && !S.allSchools) ensureSchools();
}
function closeDetail() { $('#drawer').hidden = true; S.cur = null; S.stack = []; }

function personCard(name) {
  const a = adminsAll().find((x) => x.name === name);
  if (!a) return `<h2>${esc(name)}</h2><p class="m">No tests recorded for this year yet.</p>`;
  const b = S.ov.bands, flags = flagsAll().filter((f) => f.admin === name && isOpen(f));
  const speed = [1, 2, 3].map((g) => { const v = a.by_grade[g]; const span = b[g].p99 * 1.25; return `<div class="m" style="margin-top:8px">Grade ${g}: ${v ?? '–'} min average ${speedChip(v, g)} · normal ${b[g].p3.toFixed(1)}–${b[g].p99.toFixed(0)} min</div><div class="band"><i style="left:${(b[g].p3 / span) * 100}%;width:${((b[g].p99 - b[g].p3) / span) * 100}%"></i>${v != null ? `<b style="left:${Math.min(100, (v / span) * 100)}%"></b>` : ''}</div>`; }).join('');
  const rows = workOf(name).slice(0, 25).map((w) => `<tr><td>${shortDate(w[0])}</td><td>${lk('school', w[1], schoolNameOf(w[1]))}</td><td class="r">${w[2]}</td><td class="r num">${w[3]}</td><td class="r num">${w[4] ?? '–'}</td></tr>`).join('');
  return `<h2>${esc(a.name)}</h2><p class="m">${esc(roleLabel(a))}${a.region ? ' · ' + lk('region', a.region, title(a.region)) + ' · ' + esc(partnerOf(a.region)) : ''}</p>
  <div class="grid kpis" style="margin-top:12px">${kpi('Pupils tested', fmt(a.tested))}${kpi('Avg test time', (a.avg_min ?? '–') + ' min')}${kpi('Quality', a.quality ?? '–', 'out of 100')}${kpi('Days · schools', a.days + ' · ' + a.schools)}</div>
  <h3 style="margin:16px 0 4px">Test speed</h3>${speed}
  <h3 style="margin:16px 0 4px">What counts against the score</h3><div class="m">Too fast <b>${a.fast}</b> · too slow <b>${a.slow}</b> · outside school hours <b>${a.late}</b> · not on sampling list <b>${a.not_list}</b> · far from school <b>${a.far}</b></div>
  <h3 style="margin:16px 0 4px">Open queries (${flags.length})</h3>${flags.length ? flagList(flags, { limit: 20, names: false }) : '<div class="note">No open queries.</div>'}
  ${S.daysCache[name]?.length ? `<h3 style="margin:16px 0 4px">Days worked</h3><div class="m"><b>${S.daysCache[name].length}</b> day(s) with tests · first ${shortDate(S.daysCache[name][0][0])} · latest ${shortDate(S.daysCache[name].slice(-1)[0][0])} · ${fmt(S.daysCache[name].reduce((t, d) => t + d[2], 0))} pupils tested. A day counts when at least one test was submitted.</div>` : ''}
  <h3 style="margin:16px 0 4px">Recent work</h3><div class="tbl"><table><thead><tr><th>Day</th><th>School</th><th class="r">Gr</th><th class="r">Tested</th><th class="r">Avg min</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">No work recorded.</td></tr>'}</tbody></table></div>`;
}
const schoolNameOf = (id) => schoolsAll().find((x) => x.id === id)?.name || S.plan?.schools?.find((x) => x.id === id)?.name || id;
function schoolCard(id) {
  const s = schoolsAll().find((x) => x.id === id);
  if (!s) return `<h2>School</h2><p class="m">Details are not available for ${esc(id)}.</p>`;
  const flags = flagsAll().filter((f) => f.school === id && isOpen(f));
  const rows = [1, 2, 3].map((g) => `<tr><td>Grade ${g}</td><td class="r num">${s.g[g].att ?? '–'}</td><td class="r num">${s.g[g].target}</td><td class="r num">${s.g[g].av}</td><td>${s.g[g].done ? '<span class="pill good">complete</span>' : s.g[g].n ? '<span class="pill warn">in progress</span>' : '<span class="pill mute">not started</span>'}</td></tr>`).join('');
  return `<h2>${esc(s.name)}</h2><p class="m">${s.region ? lk('region', s.region, title(s.region)) + ' · ' : ''}${esc(title(s.lga))} LGA · ${esc(title(s.ward || ''))} ward · ${esc(s.id)}</p>
  <p style="margin:8px 0">${statusPill(s)} <span class="pill mute">${s.mne === 'M&E' ? 'M&amp;E (team visit)' : 'Test only (one person)'}</span> <span class="pill mute">${esc(s.arm)}</span></p>
  <div class="grid kpis">${kpi('Visit', s.first ? shortDate(s.first) + (s.last && s.last !== s.first ? ' – ' + shortDate(s.last) : '') : 'not yet')}${kpi('People by name', s.max_team || '–', 'test admins recorded')}${kpi('Phones', s.max_devices || '–', 'different phones that sent tests')}${kpi('Teacher forms', s.teacher_forms)}${kpi('Test admins', s.admins.length)}</div>
  <h3 style="margin:16px 0 4px">Pupils by grade</h3><div class="tbl"><table><thead><tr><th>Grade</th><th class="r">Attended</th><th class="r">Sample</th><th class="r">Tested</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
  ${s.people && Object.keys(s.people).length ? `<h3 style="margin:16px 0 4px">People at the school, by day</h3><div class="tbl"><table><thead><tr><th>Day</th><th class="r">Names</th><th class="r">Phones</th><th></th></tr></thead><tbody>${Object.entries(s.people).sort().map(([d, [nn, dd]]) => `<tr><td>${shortDate(d)}</td><td class="r num">${nn}</td><td class="r num">${dd || '–'}</td><td>${dd && dd < nn ? chip('fewer phones than names', 'warn') : dd ? chip('matches', 'good') : chip('no phone data', 'mute')}</td></tr>`).join('')}</tbody></table></div><div class="m" style="margin-top:4px">Each person should use their own phone. The sampling form already sends the phone ID; the test form will once the updated form is installed.</div>` : ''}
  <h3 style="margin:16px 0 4px">Who tested here</h3><p>${s.admins.length ? s.admins.map((n) => lk('person', n, n)).join(' · ') : '<span class="m">Nobody yet.</span>'}</p>
  <h3 style="margin:16px 0 4px">Open queries (${flags.length})</h3>${flags.length ? flagList(flags, { limit: 20 }) : '<div class="note">No open queries.</div>'}`;
}
function regionCard(r) {
  const R = (S.ov.regions || []).find((x) => x.region === r); if (!R) return `<h2>${esc(title(r))}</h2>`;
  const schools = schoolsAll().filter((s) => s.region === r || !s.region).slice().sort((a, b) => a.done - b.done || a.name.localeCompare(b.name));
  const p = S.ov.plans?.[r];
  return `<h2>${esc(title(r))}</h2><p class="m">${esc(partnerOf(r) || 'Training region')}</p>
  <div class="grid kpis" style="margin-top:12px">${kpi('Schools complete', `${R.done}<small> / ${R.total}</small>`)}${kpi('Pupils tested', fmt(R.tested), 'of ' + fmt(R.target))}${kpi('Pace', R.pace + ' / day')}${kpi('Projected finish', R.projected === 'done' ? 'Done' : R.projected ? shortDate(R.projected) : '–')}</div>
  ${p ? `<p style="margin-top:10px">Field plan: ${p.status === 'locked' ? `<span class="pill good">submitted</span> ${p.changes} change(s), ${p.late_changes} late` : '<span class="pill warn">not submitted</span>'}</p>` : ''}
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
function peopleTable(rows, hq) {
  const cols = [
    { k: 'name', label: 'Name', val: (a) => a.name, search: (a) => a.name, html: (a) => `<b>${lk('person', a.name, a.name)}</b>` },
    ...(hq ? [{ k: 'region', label: 'Region', val: (a) => a.region || '', search: (a) => a.region, html: (a) => (a.region ? lk('region', a.region, title(a.region)) : '–') }] : []),
    { k: 'role', label: 'Role', val: (a) => roleLabel(a), search: (a) => roleLabel(a), html: (a) => `<span class="chip c-${a.role === 'rc' ? 'navy' : a.role === 'arc' ? 'teal' : a.role === 'unlisted' ? 'mute' : 'gold'}">${esc(roleLabel(a))}</span>` },
    { k: 'tested', label: 'Tested', cls: 'r', val: (a) => a.tested, html: (a) => `<span class="num">${fmt(a.tested)}</span>` },
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
function viewPeopleHQ() {
  return `${dataBanner()}<div class="pagehead"><div><h2>Coordinators and volunteers</h2><p>Click a name for the full card. Click a column to sort. Chips are coloured against the normal range for each grade.</p></div></div><div class="card">${peopleTable(S.ov.admins, true)}<div class="legend"><span><i style="background:var(--good)"></i>normal</span><span><i style="background:var(--gold)"></i>borderline</span><span><i style="background:var(--bad)"></i>outside the normal range</span><span>Normal test time: ${bandsText()}</span></div></div>`;
}
function viewTeam() {
  return `${dataBanner()}<div class="pagehead"><div><h2>My team</h2><p>Pace, test speed and quality for everyone in ${esc(title(S.who.region))}. Click a name for their card.</p></div></div><div class="card">${peopleTable(S.ov.mine.admins, false)}</div>`;
}

// ---------- Data explorer (schools) ----------
function schoolTable(rows, hq) {
  const t = (s) => s.g[1].av + s.g[2].av + s.g[3].av, tg = (s) => s.g[1].target + s.g[2].target + s.g[3].target;
  const cols = [
    { k: 'name', label: 'School', val: (s) => s.name, search: (s) => s.name + ' ' + s.id, html: (s) => `<b>${lk('school', s.id, s.name)}</b>` },
    ...(hq ? [{ k: 'region', label: 'Region', val: (s) => s.region, search: (s) => s.region, html: (s) => lk('region', s.region, title(s.region)) }] : []),
    { k: 'lga', label: 'LGA', val: (s) => s.lga, search: (s) => s.lga + ' ' + (s.ward || ''), small: true, html: (s) => esc(title(s.lga)) },
    { k: 'type', label: 'Type', val: (s) => s.mne, small: true, html: (s) => chip(s.mne === 'M&E' ? 'M&amp;E' : 'Test only', s.mne === 'M&E' ? 'teal' : 'mute') },
    { k: 'att', label: 'Attended 1/2/3', cls: 'r', small: true, val: (s) => s.g[1].att, html: (s) => `<span class="num">${s.g[1].att ?? '–'}/${s.g[2].att ?? '–'}/${s.g[3].att ?? '–'}</span>` },
    ...[1, 2, 3].map((g) => ({ k: 'g' + g, label: 'Gr ' + g, cls: 'r', small: true, val: (s) => pc(s.g[g].av, s.g[g].target), html: (s) => chip(`${s.g[g].av}/${s.g[g].target}`, s.g[g].done ? 'good' : s.g[g].av ? 'warn' : 'mute') })),
    { k: 'prog', label: 'Progress', val: (s) => pc(t(s), tg(s)), html: (s) => `<div style="min-width:90px">${bar(pc(t(s), tg(s)))}</div>` },
    { k: 'team', label: 'People · phones', cls: 'r', small: true, val: (s) => s.max_team, html: (s) => `<span class="num">${s.max_team || '–'} · ${s.max_devices || '–'}</span>` },
    { k: 'tf', label: 'Teacher forms', cls: 'r', small: true, val: (s) => s.teacher_forms, html: (s) => `<span class="num">${s.teacher_forms}</span>` },
    { k: 'visit', label: 'Visit', small: true, val: (s) => s.first || '', html: (s) => (s.first ? shortDate(s.first) + (s.last && s.last !== s.first ? ' – ' + shortDate(s.last) : '') : '–') },
    { k: 'status', label: 'Status', val: (s) => (s.done ? 2 : s.started ? 1 : 0), html: (s) => statusPill(s) },
  ];
  const filters = [
    ...(hq ? [{ k: 'region', label: 'Region', get: (s) => s.region, options: (r) => [...new Set(r.map((s) => s.region))].sort().map((x) => [x, title(x)]) }] : []),
    { k: 'lga', label: 'LGA', get: (s) => s.lga, options: (r) => [...new Set(r.map((s) => s.lga))].sort().map((x) => [x, title(x)]) },
    { k: 'type', label: 'Type', get: (s) => s.mne, options: () => [['M&E', 'M&E (team)'], ['No-M&E', 'Test only']] },
    { k: 'status', label: 'Status', get: (s) => (s.done ? 'done' : s.started ? 'prog' : 'new'), options: () => [['done', 'Complete'], ['prog', 'In progress'], ['new', 'Not started']] },
  ];
  return dataTable(hq ? 'schools-hq' : 'schools', cols, rows, { filters, sort: 'name', dir: 1, open: (s) => 'school:' + s.id, placeholder: 'Search a school, ward or LGA', limit: 400 });
}
// ---- source tags: every table says which form it comes from and which phase ----
const SRC = {
  assess: { cls: 'src-assess', label: 'Assessments', form: 'Student test form' },
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
const exTabs = () => [['assess', 'Assessments'], ['samp', 'Sampling'], ['teach', 'Teachers'], ['school', 'School baseline'], ['linked', 'Linked']];
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
    ...(hq ? [{ k: 'region', label: 'Region', get: (s) => s.region, options: (r) => [...new Set(r.map((s) => s.region))].sort().map((x) => [x, title(x)]) }] : []),
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
function viewAllQueries() {
  const hq = S.who.role === 'hq';
  const all = flagsAll();
  const F = (S.qf ||= { q: '', type: '', sev: '', region: '', st: 'open' });
  const list = all.filter((f) => (F.st === 'all' || (F.st === 'resolved' ? !isOpen(f) : isOpen(f))) && (!F.type || f.type === F.type) && (!F.sev || f.sev === F.sev) && (!F.region || f.region === F.region) && (!F.q || [f.school_name, f.school, f.admin, f.lga, f.ward, f.text].join(' ').toLowerCase().includes(F.q.toLowerCase())));
  const types = [...new Set(all.map((f) => f.type))];
  const sel = (key, label, opts) => `<select data-qf="${key}" aria-label="${label}"><option value="">${label}: all</option>${opts.map(([v, t]) => `<option value="${esc(v)}" ${F[key] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  return `${dataBanner()}<div class="pagehead"><div><h2>Queries</h2><p>Automatic checks on submitted tests. Open a query for the exact region, school, pupils and times so the person involved can find the records.</p></div></div><div class="card"><div class="toolbar"><input data-qf="q" type="search" placeholder="Search school, person, LGA" value="${esc(F.q)}">${sel('type', 'Check', types.map((t) => [t, FLAG_LABEL[t] || t]))}${sel('sev', 'Severity', [['bad', 'Serious'], ['warn', 'Review']])}${hq ? sel('region', 'Region', S.cfg.regions.map((r) => [r, title(r)])) : ''}<select data-qf="st"><option value="open" ${F.st === 'open' ? 'selected' : ''}>Open</option><option value="resolved" ${F.st === 'resolved' ? 'selected' : ''}>Resolved</option><option value="all" ${F.st === 'all' ? 'selected' : ''}>All</option></select><span class="count">${list.length} shown</span></div>${flagListFull(list, 60)}</div>`;
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
  const prows = P.phones.slice().sort((a, b) => a.first - b.first).map((p) => { const hm = (t) => `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`; const nflags = dev.filter((f) => (f.text || '').includes(p.c)).length; return `<tr><td class="num"><b>${esc(p.c)}</b></td><td>${p.names.map((n) => lk('person', n, n)).join(', ') || '–'}</td><td>${p.schools.map((s) => lk('school', s.id, s.name)).join(', ')}</td><td class="r num">${p.n}</td><td class="num">${hm(p.first)}–${hm(p.last)}</td><td class="r">${nflags ? chip(nflags + ' flag' + (nflags > 1 ? 's' : ''), 'warn') : chip('clear', 'good')}</td></tr>`; }).join('');
  return `<div class="pagehead"><div><h2>Phones</h2><p>What each phone did on the day. Shown to the whole team so the work is open and fair. A flag means "look at this", not "this is wrong".</p></div>${sel}</div>
  <div class="grid kpis">${kpi('Phones active', P.phones.length)}${kpi('Schools with tests', P.schools.length, 'on this day')}${kpi('Most phones at one school', maxPer)}${kpi('Phone checks to look at', dev.length, dev.filter((f) => f.sev === 'bad').length + ' serious')}</div>
  <div class="card" style="margin-top:14px"><h3>Timeline</h3><div class="sub">One row per phone. Each bar is a test or sampling record. A phone should do one thing at a time, in one school, and one person normally uses one phone.</div>${timelineChart(P)}</div>
  <div class="card" style="margin-top:14px"><h3>Checks on phone behaviour</h3><div class="sub">Tests overlapping on one phone, a phone at two schools within 30 minutes, a phone jumping back and forth between grades, names changing on one phone, one person on several phones, fewer phones than people.</div>${dev.length ? flagList(dev, { limit: 30 }) : '<div class="empty">Nothing to look at for this day.</div>'}</div>
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
  const srows = P.schools.map((x) => `<tr><td><b>${esc(x.name)}</b><div class="sub">${esc(x.id)}</div></td><td class="r num">${x.started ? 'yes' : 'no'}</td><td class="r num">${x.g ? Object.values(x.g).reduce((a, b) => a + (b.n || 0), 0) : 0}</td><td>${(x.admins || []).length}</td></tr>`).join('');
  const ph = S.prPh && S.prPh.events ? `<div class="card" style="margin-top:14px"><h3>Phones in practice</h3><div class="sub">One row per phone, each bar a record, so people can see how their own phone shows up on the dashboard.</div>${timelineChart(S.prPh)}</div>` : '';
  return `${banner}${head}<div class="grid kpis">${kpi('Practice records', fmt(P.records))}${kpi('Pupils tested', fmt(P.tested))}${kpi('Phones', P.devices || 0)}${kpi('Checks raised', (P.flags || []).length)}</div>
  <div class="card" style="margin-top:14px"><h3>Training schools</h3><div class="tbl"><table><thead><tr><th>School</th><th class="r">Started</th><th class="r">Pupils tested</th><th>People</th></tr></thead><tbody>${srows}</tbody></table></div></div>
  <div class="card" style="margin-top:14px"><h3>Checks raised on practice records</h3><div class="sub">Open one to see what a real query looks like, and reply to it to practise the process.</div>${flagList(P.flags || [], { limit: 30 })}</div>${ph}`;
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

// ---------- shell ----------
const TABS = {
  public: [['progress', 'Progress'], ['compare', 'Compare']],
  volunteer: [['day', 'My day'], ['work', 'My work'], ['queries', 'My queries'], ['stats', 'My stats'], ['phones', 'Phones'], ['compare', 'Compare'], ['practice', 'Practice']],
  rc: [['region', 'Region'], ['plan', 'Plan & calendar'], ['team', 'My team'], ['allq', 'Queries'], ['phones', 'Phones'], ['compare', 'Compare'], ['explore', 'Data explorer'], ['practice', 'Practice']],
  hq: [['hq', 'HQ'], ['regions', 'Regions & plans'], ['plan', 'Plan & calendar'], ['people', 'People'], ['allq', 'Queries'], ['phones', 'Phones'], ['compare', 'Compare'], ['explore', 'Data explorer'], ['admin', 'Admin'], ['practice', 'Practice']],
};
const roleKey = () => (!S.who ? 'public' : S.who.role === 'arc' ? 'rc' : S.who.role);
const VIEWS = { progress: viewProgress, compare: viewCompare, day: viewDay, work: viewWork, queries: viewQueries, stats: viewStats, region: viewRegion, plan: viewPlan, team: viewTeam, explore: viewExplore, hq: viewHQ, regions: viewRegionsHQ, people: viewPeopleHQ, admin: viewAdmin, allq: viewAllQueries, phones: viewPhones, practice: viewPractice };

function render() {
  const tabs = TABS[roleKey()];
  if (!tabs.find((t) => t[0] === S.tab)) S.tab = tabs[0][0];
  $('#nav').innerHTML = tabs.map(([k, t]) => `<button role="tab" aria-selected="${k === S.tab}" data-tab="${k}">${t}</button>`).join('');
  $('#who').innerHTML = S.viewAs ? `${viewAsControl()}<button class="ghost" data-act="exitPreview">Back to HQ</button>` : S.who ? `${viewAsControl()}<span>${esc(S.who.name)}${S.who.position ? ' · ' + esc(S.who.position) : ''}</span><button class="ghost" data-act="alerts" id="alertsBtn">${alertsLabel()}</button><button class="ghost" data-act="logout">Sign out</button>` : '<button class="ghost" data-act="showLogin">Sign in</button>';
  $('#app').innerHTML = previewBanner() + VIEWS[S.tab]();
  $('#gswrap').hidden = !S.who;
}

// ---------- phone alerts ----------
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function alertsLabel() {
  if (!pushSupported()) return 'Alerts: not on this device';
  if (Notification.permission === 'denied') return 'Alerts blocked';
  return S.alertsOn ? 'Alerts on' : 'Turn on alerts';
}
const keyBytes = (b64) => { const p = '='.repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); };
async function checkAlerts() {
  try { if (!pushSupported()) return; const reg = await navigator.serviceWorker.ready; S.alertsOn = Boolean(await reg.pushManager.getSubscription()) && Notification.permission === 'granted'; const b = document.getElementById('alertsBtn'); if (b) b.textContent = alertsLabel(); } catch {}
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
async function loadAdmin() {
  const [status, codes, rec, ready, roster] = await Promise.all([api('/api/admin/status'), api('/api/admin/codes').catch(() => null), api('/api/admin/recipients').catch(() => null), api('/api/admin/readiness').catch(() => null), api('/api/admin/roster').catch(() => null)]);
  const [devices, backups] = await Promise.all([api('/api/admin/devices').catch(() => null), api('/api/admin/backup?list=1').catch(() => null)]);
  const push = await api('/api/admin/push-status').catch(() => null);
  S.adm = { status, codes, rec, push, ready, roster, devices, backups, preview: S.adm?.preview || null };
}

async function go() {
  const exm = /^#explore\/(\w+)$/.exec(location.hash);
  if (exm) { S.tab = 'explore'; S.exTab = exm[1]; }
  else if (!S.tab && location.hash && !location.hash.includes(':')) S.tab = location.hash.slice(1);
  if (S.who && !S.ov && !S.viewAs) { const snap = loadSnapshot(); if (snap) { S.ov = snap.ov; S.pub = snap.ov; S.cmp = snap.cmp; S.pred = snap.pred; S.brief = snap.brief; S.stale = snap.t; render(); } }
  try { await loadData(); S.stale = null; render(); ensureSchools(); if (S.tab === 'explore' && ['teach', 'school', 'linked'].includes(S.exTab)) loadExplore(S.exTab); if (S.tab === 'phones' && !S.ph) loadPhones().then(render); if (S.tab === 'practice' && !S.pr) loadPractice().then(render); if (location.hash.includes(':')) { try { openDetail(decodeURIComponent(location.hash.slice(1))); } catch {} } } catch (e) { if (e.status === 401 && S.code) { S.code = null; S.who = null; store.set('kf_code', null); loginScreen('Your code was not recognised. Try again.'); } else $('#app').innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; }
}

document.addEventListener('click', async (e) => {
  const ex = e.target.closest('[data-ex]'); if (ex) { await loadExplore(ex.dataset.ex); return; }
  const op = e.target.closest('[data-open]');
  if (op && !e.target.closest('summary,button,select,input,textarea')) { e.preventDefault(); $('#gsr') && ($('#gsr').hidden = true); openDetail(op.dataset.open); return; }
  const th = e.target.closest('[data-ts]');
  if (th) { const [id, k] = th.dataset.ts.split(':'); const T = S.tbl[id]; if (T.sort === k) T.dir = -T.dir; else { T.sort = k; T.dir = 1; } render(); return; }
  const t = e.target.closest('[data-tab],[data-act]'); if (!t) return;
  if (t.dataset.tab) { S.tab = t.dataset.tab; S.selVisit = null; if (S.tab === 'plan') { await loadPlan(); } if (S.tab === 'phones') { S.ph = null; render(); await loadPhones(); } if (S.tab === 'practice') { S.pr = null; render(); await loadPractice(); } if (S.tab === 'admin') await loadAdmin(); render(); return; }
  const a = t.dataset.act;
  try {
    if (a === 'login') { const c = $('#code').value.trim().toUpperCase(); if (!c) return; S.code = c; try { const r = await api('/api/login'); S.who = r.who; store.set('kf_code', c); S.tab = null; await go(); } catch { S.code = null; loginScreen('That code was not recognised.'); } }
    else if (a === 'logout') { S.code = null; S.who = null; S.ov = null; S.plan = null; S.draft = null; store.set('kf_code', null); try { localStorage.removeItem('kf_snap'); } catch {} S.tab = null; loginScreen(); }
    else if (a === 'showLogin') loginScreen();
    else if (a === 'alerts') await toggleAlerts();
    else if (a === 'exitPreview') await setViewAs('');
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
    else if (a === 'qOpen') { S.qOpen = t.dataset.k || null; render(); $('#qText')?.focus(); }
    else if (a === 'qSend' || a === 'qResolve') { const text = ($('#qText') || {}).value || ''; await api('/api/query', { method: 'POST', body: { key: t.dataset.k, text, action: a === 'qResolve' ? 'resolve' : 'reply' } }); S.qOpen = null; await loadData(); render(); }
    else if (a === 'saveRec') { const rows = ($('#recText').value || '').split('\n').map((l) => l.split(',').map((x) => x.trim())).filter((p) => p[0]).map((p) => ({ email: p[0], name: p[1], role: p[2], region: p[3], copy: (p[4] || '').toLowerCase() === 'copy', paused: (p[5] || '').toLowerCase() === 'paused', from: /^\d{4}-\d\d-\d\d$/.test(p[5] || '') ? p[5] : '', backup: ['to', 'cc'].includes((p[6] || '').toLowerCase()) ? p[6].toLowerCase() : '' })); await api('/api/admin/recipients', { method: 'POST', body: { rows } }); await loadAdmin(); render(); }
    else if (a === 'prevMail') { const p = await api(`/api/admin/digest-preview?kind=${t.dataset.kind}&region=${t.dataset.region}`); S.adm.preview = p; render(); }
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
  if (e.target.id === 'phDate') { S.phDate = e.target.value; S.ph = null; render(); await loadPhones(); render(); return; }
  if (e.target.id === 'phRegion') { S.phRegion = e.target.value; S.ph = null; render(); await loadPhones(); render(); return; }
  if (e.target.dataset?.pl && S.plan && S.plan.plan.status !== 'locked') { readDraftFromDom(); render(); return; }
  if (e.target.dataset?.dn) { S.dayNotes ||= {}; const d = e.target.dataset.d; (S.dayNotes[d] ||= {})[e.target.dataset.dn] = e.target.value; return; }
  if (e.target.id === 'restoreFile' && e.target.files[0]) {
    try { const f = e.target.files[0]; let text; if (/\.gz$/i.test(f.name)) text = await new Response(f.stream().pipeThrough(new DecompressionStream('gzip'))).text(); else text = await f.text(); S.restoreData = JSON.parse(text); if (S.restoreData.format !== 'kf4-backup-1') throw new Error('not a backup'); } catch { S.restoreData = null; S.backupMsg = 'That file is not a KiuFunza backup.'; }
    render(); return;
  }
  const tf = e.target.dataset?.tf; if (tf) { const [id, k] = tf.split(':'); S.tbl[id].f[k] = e.target.value; render(); return; }
  const qf = e.target.dataset?.qf; if (qf) { S.qf[qf] = e.target.value; render(); return; }
  if (e.target.id === 'viewAsSel') { await setViewAs(e.target.value); return; }
  if (e.target.id === 'yearSel') { S.year = e.target.value; S.allSchools = null; S.workCache = {}; S.linked = null; await go(); }
  else if (e.target.id === 'planRegion') { S.draft = null; S.dayNotes = null; await loadPlan(e.target.value); render(); }
  else if (e.target.id === 'exLga') { S.explore.lga = e.target.value; render(); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'gs') { doSearch(e.target.value); return; }
  const tq = e.target.dataset?.tq; if (tq) { S.tbl[tq].q = e.target.value; const pos = e.target.selectionStart; render(); const el = document.querySelector(`[data-tq="${tq}"]`); if (el) { el.focus(); el.setSelectionRange(pos, pos); } return; }
  if (e.target.dataset?.qf === 'q') { S.qf.q = e.target.value; const pos = e.target.selectionStart; render(); const el = document.querySelector('[data-qf="q"]'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } return; } if (e.target.id === 'exQ') { S.explore.q = e.target.value; const pos = e.target.selectionStart; render(); const el = $('#exQ'); el.focus(); el.setSelectionRange(pos, pos); } });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDetail(); if (e.key === 'Enter' && e.target.id === 'code') document.querySelector('[data-act="login"]').click(); });

(async function boot() {
  setTimeout(() => { checkAlerts(); }, 1500);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try { S.cfg = await api('/api/config'); } catch { $('#app').innerHTML = '<div class="banner bad">Cannot reach the server.</div>'; return; }
  const saved = store.get('kf_code');
  if (saved) { S.code = saved; try { S.who = (await api('/api/login')).who; } catch { S.code = null; S.who = null; store.set('kf_code', null); } }
  if (!S.who) { loginScreen(); return; }
  const asHash = /^#as=(\w+)(?:\/(\w+))?$/.exec(location.hash);
  if (asHash && S.who.role === 'hq') { S.tab = 'hq'; await go(); history.replaceState(null, '', location.pathname); await setViewAs(asHash[1]); if (asHash[2]) { S.tab = asHash[2]; if (S.tab === 'plan') await loadPlan(); render(); } return; }
  await go();
})();
