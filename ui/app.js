/* AAVORAA Lead Agent - app UI (no libraries) */
'use strict';
const S = { me: null, state: null, cache: {} };
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n || 0).toLocaleString('en-IN');
const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '–';
const root = () => $('#root');

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, { method: opts.method || 'GET', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/login')) { S.me = null; location.hash = '#/login'; throw new Error(j.error || 'Please log in.'); }
  if (!res.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}
function toast(msg, err) { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), err ? 4500 : 2200); }
async function busy(btn, fn) { const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; try { return await fn(); } catch (e) { toast(e.message, true); } finally { btn.disabled = false; btn.innerHTML = old; } }
function copy(text) {
  const ok = () => toast('Copied');
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text || '').then(ok, fb); else fb();
  function fb() { const t = document.createElement('textarea'); t.value = text || ''; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); ok(); } catch (e) {} t.remove(); }
}
const TONE = { New: 'blue', Pitched: 'gold', 'Follow-up 1': 'gold', 'Follow-up 2': 'gold', Replied: 'blue', Interested: 'green', 'Do Not Contact': 'red', Bounced: 'red', 'Send Failed': 'red', 'To Connect': 'amber', 'Request Sent': 'gold', Connected: 'blue', 'Message Sent': 'gold', Hot: 'red', Warm: 'amber', Cold: 'blue', yes: 'green', no: '' };
const tag = v => v ? `<span class="tag ${TONE[v] || ''}">${esc(v)}</span>` : '<span class="sub">–</span>';
const ROLE_NAME = { owner: 'Owner', leader: 'Team Leader', linkedin: 'LinkedIn Executive' };

/* ------------------------------------------------------------ routing */
const PAGES = {
  dashboard: { title: 'Dashboard', ic: '◈', roles: ['owner', 'leader', 'linkedin'], render: pageDashboard, sec: 'Work' },
  linkedin: { title: 'LinkedIn tasks', ic: 'in', roles: ['owner', 'leader', 'linkedin'], render: pageLinkedIn, sec: 'Work' },
  calls: { title: 'Call / WhatsApp', ic: '☎', roles: ['owner', 'leader', 'linkedin'], render: pageCalls, sec: 'Work' },
  replies: { title: 'Replies from client', ic: '↩', roles: ['owner', 'leader', 'linkedin'], render: pageReplies, sec: 'Work' },
  qualified: { title: 'Qualified leads', ic: '★', roles: ['owner', 'leader'], render: pageQualified, sec: 'Work' },
  leads: { title: 'All email leads', ic: '✉', roles: ['owner', 'leader'], render: pageLeads, sec: 'Work' },
  import: { title: 'Import leads', ic: '⇪', roles: ['owner', 'leader'], render: pageImport, sec: 'Grow' },
  templates: { title: 'Templates & tone', ic: '✎', roles: ['owner', 'leader'], render: pageTemplates, sec: 'Grow' },
  settings: { title: 'Settings', ic: '⚙', roles: ['owner', 'leader'], render: pageSettings, sec: 'Manage' },
  activity: { title: 'Agent activity', ic: '◷', roles: ['owner', 'leader'], render: pageActivity, sec: 'Manage' },
  team: { title: 'Team & logins', ic: '◎', roles: ['owner'], render: pageTeam, sec: 'Manage' },
  connections: { title: 'Connections', ic: '⇄', roles: ['owner'], render: pageConnections, sec: 'Manage' },
  account: { title: 'My account', ic: '○', roles: ['owner', 'leader', 'linkedin'], render: pageAccount, hidden: true },
};
async function route() {
  try { S.state = await api('/state'); } catch (e) { root().innerHTML = `<div class="center"><div class="authcard"><span class="word">AAVORAA</span><p class="notice err">Cannot reach the agent: ${esc(e.message)}</p></div></div>`; return; }
  S.me = S.state.user;
  const page = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'dashboard';
  if (!S.state.configured || S.state.needsOwner) return S.state.isLocal ? pageSetup() : pageNotReady();
  if (!S.me) return pageLogin();
  const p = PAGES[page];
  if (!p || !p.roles.includes(S.me.role)) { location.hash = '#/' + (S.me.role === 'linkedin' ? 'linkedin' : 'dashboard'); return; }
  shell(page);
  try { await p.render($('#page')); } catch (e) { $('#page').innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', route);

function shell(active) {
  let nav = '', sec = '';
  for (const [id, p] of Object.entries(PAGES)) {
    if (p.hidden || !p.roles.includes(S.me.role)) continue;
    if (p.sec !== sec) { sec = p.sec; nav += `<div class="sec">${sec}</div>`; }
    nav += `<a href="#/${id}" class="${id === active ? 'on' : ''}"><span class="ic">${p.ic}</span>${p.title}</a>`;
  }
  root().innerHTML = `<div class="shell">
    <aside class="side" id="side"><div class="brand"><span class="word">AAVORAA</span><small>Lead Agent</small></div>
      <nav class="nav">${nav}</nav>
      <div class="me"><div class="avatar">${esc((S.me.name || '?')[0].toUpperCase())}</div><div class="who"><b>${esc(S.me.name)}</b><span>${ROLE_NAME[S.me.role]}</span></div>
      <a class="btn sm ghost" href="#/account" title="My account">⋯</a></div>
    </aside>
    <main class="main"><button class="btn sm menu-btn" id="menuBtn" style="margin-bottom:10px">☰ Menu</button><div id="page"><div class="empty"><span class="spin"></span></div></div></main></div>`;
  $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
}
function head(title, sub, actions = '') { return `<div class="head"><h1>${title}</h1>${actions}${sub ? `<div class="sub">${sub}</div>` : ''}</div>`; }

/* ------------------------------------------------------------ setup wizard */
async function pageSetup() {
  let conn = {}; try { conn = await api('/connections'); } catch (e) {}
  const st = S.state;
  let step = st.configured ? 5 : (Number(sessionStorage.getItem('aav_step')) || 1);
  const done = { 1: !!conn.serviceAccountEmail && !!conn.sheetUrl, 2: !!conn.gmailUser && !!conn.gmailAppPassword, 3: !!(conn.openaiKey || conn.geminiKey), 4: !!conn.apifyToken };
  const names = ['Google Sheet', 'Gmail', 'ChatGPT AI', 'Apify', 'Owner account'];
  const go = n => { sessionStorage.setItem('aav_step', n); pageSetup(); };
  const body = {
    1: `<h2>1. Connect your Google Sheet</h2>
      <div class="how">Leads, settings, templates and logins are all saved in one Google Sheet you own. One-time setup, about 10 minutes:
      <ol><li>Create a new, empty Google Sheet (sheets.new) while signed in as aavoraa.marketing@gmail.com and copy its link.</li>
      <li>Open <b>console.cloud.google.com</b> → New project → name it <code>AAVORAA Agent</code>.</li>
      <li>APIs &amp; Services → Library → search <b>Google Sheets API</b> → Enable.</li>
      <li>APIs &amp; Services → Credentials → Create credentials → <b>Service account</b> → name <code>lead-agent</code> → Done.</li>
      <li>Click the new service account → Keys → Add key → Create new key → <b>JSON</b>. A file downloads. Upload it below.</li>
      <li>In your Google Sheet click <b>Share</b> and add the service account email (shown below after upload) as <b>Editor</b>.</li></ol></div>
      <label class="f"><span>Google Sheet link</span><input type="url" id="sheetUrl" value="${esc(conn.sheetUrl || '')}" placeholder="https://docs.google.com/spreadsheets/d/…"></label>
      <label class="f"><span>Service account key (.json file)</span><div class="drop" id="drop">${conn.serviceAccountEmail ? '✓ Key saved. Click to replace.' : 'Click to choose the .json file, or drop it here'}</div><input type="file" id="saFile" accept=".json,application/json" class="hidden"></label>
      ${conn.serviceAccountEmail ? `<div class="notice">Share your Google Sheet with this email as <b>Editor</b>: <code>${esc(conn.serviceAccountEmail)}</code> <button class="copy" data-c="${esc(conn.serviceAccountEmail)}">Copy</button></div>` : ''}`,
    2: `<h2>2. Connect Gmail (aavoraa.marketing@gmail.com)</h2>
      <div class="how">The agent sends and reads email with a Gmail <b>App Password</b> (safer than your real password, and you can cancel it any time).
      <ol><li>Open <b>myaccount.google.com</b> signed in as aavoraa.marketing@gmail.com → Security → turn on <b>2-Step Verification</b>.</li>
      <li>Search <b>App passwords</b> at the top of that page → app name <code>AAVORAA Agent</code> → Create.</li>
      <li>Copy the 16-letter password and paste it below.</li>
      <li>In Gmail → Settings → See all settings → Forwarding and POP/IMAP → <b>Enable IMAP</b> → Save.</li></ol></div>
      <div class="row2"><label class="f"><span>Gmail address</span><input type="email" id="gmailUser" value="${esc(conn.gmailUser || 'aavoraa.marketing@gmail.com')}"></label>
      <label class="f"><span>App password (16 letters)</span><input type="password" id="gmailAppPassword" value="${esc(conn.gmailAppPassword || '')}" placeholder="abcd efgh ijkl mnop" autocomplete="off"></label></div>`,
    3: `<h2>3. Connect ChatGPT (OpenAI)</h2>
      <div class="how">ChatGPT writes every email and every reply to your leads.<ol><li>Open <b>platform.openai.com</b> and sign in (a ChatGPT Plus plan does not include this, the API is billed separately).</li><li>Settings → <b>Billing</b> → add a little credit, e.g. $5. Without credit the key does not work.</li><li>Open <b>platform.openai.com/api-keys</b> → <b>Create new secret key</b> → copy it (it starts with <code>sk-</code>) and paste it below.</li></ol>A typical day of emails and replies costs a few cents.</div>
      <label class="f"><span>ChatGPT (OpenAI) API key</span><input type="password" id="openaiKey" value="${esc(conn.openaiKey || '')}" placeholder="sk-…" autocomplete="off"></label>`,
    4: `<h2>4. Connect Apify (free $5 credit every month)</h2>
      <div class="how">Apify searches Google Maps and Google for new leads.<ol><li>Sign up free at <b>apify.com</b>.</li><li>Settings → <b>API &amp; Integrations</b> → copy the Personal API token → paste below.</li></ol></div>
      <label class="f"><span>Apify API token</span><input type="password" id="apifyToken" value="${esc(conn.apifyToken || '')}" autocomplete="off"></label>`,
    5: `<h2>5. Create your owner login</h2>
      <div class="how">This is your login. You can add your team (Team Leader, LinkedIn Executive) afterwards under <b>Team &amp; logins</b>.</div>
      <div class="row2"><label class="f"><span>Your name</span><input type="text" id="oName" value="Rennie Priya"></label><label class="f"><span>Username</span><input type="text" id="oUser" value="rennie" autocomplete="username"></label></div>
      <label class="f"><span>Password (8+ characters)</span><input type="password" id="oPass" autocomplete="new-password"></label>`,
  };
  root().innerHTML = `<div class="center"><div class="wizard panel" style="padding:30px">
    <span class="word">AAVORAA</span> <span class="sub" style="letter-spacing:.2em;text-transform:uppercase;margin-left:8px">Lead Agent · first-time setup</span>
    <div class="steps">${names.map((n, i) => `<span class="${i + 1 === step ? 'on' : (done[i + 1] || (i === 4 && st.configured && !st.needsOwner)) ? 'done' : ''}">${done[i + 1] ? '✓ ' : ''}${i + 1}. ${n}</span>`).join('')}</div>
    ${st.sheetError ? `<div class="notice err">${esc(st.sheetError)}</div>` : ''}
    <div id="msg"></div>${body[step]}
    <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap">
      ${step > 1 && step < 5 ? '<button class="btn" id="back">Back</button>' : ''}
      ${step < 5 ? '<button class="btn" id="test">Save &amp; test</button><button class="btn primary" id="next">Save &amp; continue</button>' : '<button class="btn primary" id="create">Create login &amp; start</button>'}
    </div></div></div>`;
  $$('.copy').forEach(b => b.onclick = () => copy(b.dataset.c));
  const msg = (t, cls) => { $('#msg').innerHTML = `<div class="notice ${cls}">${esc(t)}</div>`; };
  if (step === 1) {
    const pickFile = () => $('#saFile').click();
    $('#drop').onclick = pickFile;
    $('#drop').ondragover = e => { e.preventDefault(); $('#drop').classList.add('over'); };
    $('#drop').ondragleave = () => $('#drop').classList.remove('over');
    $('#drop').ondrop = e => { e.preventDefault(); readSa(e.dataTransfer.files[0]); };
    $('#saFile').onchange = e => readSa(e.target.files[0]);
    async function readSa(f) { if (!f) return; const text = await f.text(); try { await api('/connections', { method: 'POST', body: { serviceAccountJson: text, sheetUrl: $('#sheetUrl').value } }); pageSetup(); } catch (e) { msg(e.message, 'err'); } }
  }
  const save = async () => {
    const b = {};
    for (const id of ['sheetUrl', 'gmailUser', 'gmailAppPassword', 'openaiKey', 'apifyToken']) if ($('#' + id)) b[id] = $('#' + id).value.trim();
    await api('/connections', { method: 'POST', body: b });
  };
  const testName = { 1: 'sheet', 2: 'gmail', 3: 'openai', 4: 'apify' }[step];
  const test = async () => { await save(); const r = await api('/connections/test', { method: 'POST', body: { what: testName } }); msg(r.msg, 'ok'); return r; };
  if ($('#back')) $('#back').onclick = () => go(step - 1);
  if ($('#test')) $('#test').onclick = e => busy(e.currentTarget, test);
  if ($('#next')) $('#next').onclick = e => busy(e.currentTarget, async () => { try { await test(); go(step + 1); } catch (err) { msg(err.message, 'err'); } });
  if ($('#create')) $('#create').onclick = e => busy(e.currentTarget, async () => {
    try {
      await api('/setup/owner', { method: 'POST', body: { name: $('#oName').value, username: $('#oUser').value.trim(), password: $('#oPass').value } });
      await api('/login', { method: 'POST', body: { username: $('#oUser').value.trim(), password: $('#oPass').value } });
      sessionStorage.removeItem('aav_step'); location.hash = '#/settings'; toast('Welcome! Check your settings, then the agent starts on its own.'); route();
    } catch (err) { msg(err.message, 'err'); }
  });
}
function pageNotReady() { root().innerHTML = `<div class="center"><div class="authcard"><span class="word">AAVORAA</span><div class="tag2">Lead Agent</div><div class="notice">The owner hasn't finished setting up the app on the main PC yet.</div></div></div>`; }

/* ------------------------------------------------------------ login */
function pageLogin() {
  root().innerHTML = `<div class="center"><form class="authcard" id="lf"><span class="word">AAVORAA</span><div class="tag2">Lead Agent</div>
    <div id="msg"></div>
    <label class="f"><span>Username</span><input type="text" id="u" autocomplete="username" required autofocus></label>
    <label class="f"><span>Password</span><input type="password" id="p" autocomplete="current-password" required></label>
    <button class="btn primary" style="width:100%;height:42px" id="go">Log in</button>
    <p class="sub" style="text-align:center;margin-top:16px">Forgot your password? Ask the owner to reset it under Team &amp; logins.</p></form></div>`;
  $('#lf').onsubmit = e => { e.preventDefault(); busy($('#go'), async () => {
    try { const r = await api('/login', { method: 'POST', body: { username: $('#u').value, password: $('#p').value } }); S.me = r.user; location.hash = '#/' + (r.user.role === 'linkedin' ? 'linkedin' : 'dashboard'); route(); }
    catch (err) { $('#msg').innerHTML = `<div class="notice err">${esc(err.message)}</div>`; }
  }); };
}

/* ------------------------------------------------------------ dashboard */
async function pageDashboard(el) {
  const d = await api('/dashboard'); const t = d.totals, a = d.agent, s = d.series;
  const last7 = k => s.slice(-7).reduce((x, r) => x + r[k], 0);
  const isOwner = S.me.role === 'owner';
  el.innerHTML = head('Dashboard', '', `<a class="btn" href="${esc(a.sheetUrl)}" target="_blank" rel="noopener">Open Google Sheet</a><button class="btn" id="rf">Refresh</button>`) +
    `<div class="agentbar"><span class="dot ${a.on ? 'on' : 'off'}"></span><b>${a.on ? 'Agent is working' : 'Agent is paused'}</b>
      <span class="meta">Replies ${a.replyMode === 'draft' ? 'saved as drafts' : 'sent automatically'} · Tone: ${esc(a.tone)} · ${a.started ? `Sending ${a.sentToday} of ${a.todayLimit} today` : 'Sending starts ' + esc(a.startDate)}</span>
      ${isOwner ? `<label class="switch" style="margin-left:auto"><input type="checkbox" id="onoff" ${a.on ? 'checked' : ''}><i></i><span>${a.on ? 'ON' : 'OFF'}</span></label>` : ''}</div>
    <section class="kpis">
      ${kpi('Leads found', fmt(t.raw + t.linkedin), `+${fmt(last7('found'))} in 7 days`)}
      ${kpi('Emailed', fmt(t.emailed), `${fmt(t.waiting)} waiting · ${fmt(t.bounced)} bounced`)}
      ${kpi('Replies', fmt(t.replied), `${pct(t.replied, t.emailed)} reply rate`)}
      ${kpi('Qualified leads', fmt(t.qualified), `+${fmt(last7('qualified'))} in 7 days`, 'gold')}
      ${kpi('LinkedIn to connect', fmt(t.linkedinToConnect), `${fmt(t.linkedin)} prospects total`)}
      <div class="kpi"><div class="label">Emails sent today</div><div class="value">${fmt(a.sentToday)} / ${fmt(a.todayLimit)}</div><div class="bar"><i style="width:${Math.min(100, a.todayLimit ? a.sentToday / a.todayLimit * 100 : 0)}%"></i></div><div class="hint">limit grows each week</div></div>
    </section>
    <section class="grid"><div class="panel"><h2>Last 14 days</h2><div class="desc">What the agent did each day</div><div class="legend" id="lg"></div><div id="chart" style="height:240px"></div></div>
      <div class="panel"><h2>Pipeline</h2><div class="desc">From found to qualified, all time</div>${funnel([['Leads found', t.raw], ['Email found', t.withEmail], ['Emailed', t.emailed], ['Replied', t.replied], ['Qualified', t.qualified]])}
      <div class="sub" style="margin-top:12px">Reply rate ${pct(t.replied, t.emailed)} · Qualified from replies ${pct(t.qualified, t.replied)}</div></div></section>
    <section class="grid3"><div class="panel"><h2>Lead status</h2><div class="desc">Email leads</div>${blist(d.rawStatus, '#c9a24d', 8)}</div>
      <div class="panel"><h2>Services in demand</h2><div class="desc">${t.qualified ? 'What qualified leads want' : 'Best-fit service picked by AI'}</div>${blist(d.services, '#6fbf8a')}</div>
      <div class="panel"><h2>Newest qualified leads</h2><div class="desc">Hand these to the team leader</div>${d.recentQualified.length ? d.recentQualified.map(q => `<div class="field"><div class="strong">${esc(q['Business Name'] || q['Contact Name'])} ${tag(q['Lead Score'])}</div><div class="sub">${esc(q['Service Needed'])} · ${esc(q.Source)} · ${esc(q['Date Qualified'])}</div></div>`).join('') : '<div class="sub">None yet. They appear when someone says yes.</div>'}</div></section>`;
  chart($('#chart'), $('#lg'), s);
  $('#rf').onclick = () => route();
  if ($('#onoff')) $('#onoff').onchange = async e => { try { await api('/agent/toggle', { method: 'POST', body: { on: e.target.checked } }); toast(e.target.checked ? 'Agent switched ON' : 'Agent paused'); route(); } catch (err) { toast(err.message, true); } };
}
const kpi = (l, v, h, cls = '') => `<div class="kpi ${cls}"><div class="label">${l}</div><div class="value">${v}</div><div class="hint">${h}</div></div>`;
function funnel(steps) { const max = Math.max(1, steps[0][1]); return `<div class="funnel">${steps.map(([n, v]) => `<div class="frow"><span class="l">${n}</span><div class="ftrack"><div class="ffill" style="width:${Math.max(2, v / max * 100)}%"></div></div><span class="n">${fmt(v)}</span></div>`).join('')}</div>`; }
function blist(obj, color, n = 7) { const e = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, n); if (!e.length) return '<div class="sub">No data yet</div>'; const m = e[0][1]; return `<div class="blist">${e.map(([k, v]) => `<div class="bi"><div class="t"><span class="nm" title="${esc(k)}">${esc(k)}</span><span class="bb"><i style="width:${v / m * 100}%;background:${color}"></i></span></div><span class="v">${fmt(v)}</span></div>`).join('')}</div>`; }
function chart(el, lg, s) {
  const SR = [{ k: 'found', n: 'Leads found', c: '#7fa7d9' }, { k: 'emailed', n: 'Emails sent', c: '#c9a24d' }, { k: 'replies', n: 'Replies', c: '#e07a63' }, { k: 'qualified', n: 'Qualified', c: '#6fbf8a' }];
  lg.innerHTML = SR.map(x => `<span><i style="background:${x.c}"></i>${x.n}</span>`).join('');
  const W = el.clientWidth || 700, H = 240, P = { l: 34, r: 12, t: 10, b: 26 };
  const max = Math.max(4, ...s.flatMap(r => SR.map(x => r[x.k]))), step = Math.ceil(max / 4), top = step * 4;
  const x = i => P.l + (W - P.l - P.r) * (i / (s.length - 1)), y = v => P.t + (H - P.t - P.b) * (1 - v / top);
  let g = '';
  for (let i = 0; i <= 4; i++) { const yy = y(i * step); g += `<line x1="${P.l}" x2="${W - P.r}" y1="${yy}" y2="${yy}" stroke="#2b2620"/><text x="${P.l - 8}" y="${yy + 4}" text-anchor="end">${i * step}</text>`; }
  s.forEach((r, i) => { if (i % 2 === 1 || i === s.length - 1) { const d = new Date(r.date); g += `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === s.length - 1 ? 'end' : 'middle'}">${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}</text>`; } });
  const lines = SR.map(sr => `<polyline points="${s.map((r, i) => `${x(i)},${y(r[sr.k])}`).join(' ')}" fill="none" stroke="${sr.c}" stroke-width="2" stroke-linejoin="round"/>${s.map((r, i) => `<circle cx="${x(i)}" cy="${y(r[sr.k])}" r="2.6" fill="${sr.c}"/>`).join('')}`).join('');
  const hits = s.map((r, i) => `<rect x="${x(i) - W / s.length / 2}" y="${P.t}" width="${W / s.length}" height="${H - P.t - P.b}" fill="transparent" data-i="${i}"/>`).join('');
  el.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Activity chart">${g}${lines}${hits}</svg>`;
  const tip = $('#tip');
  $$('rect[data-i]', el).forEach(rc => { rc.onmousemove = ev => { const r = s[+rc.dataset.i]; tip.innerHTML = `<b>${new Date(r.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</b><br>` + SR.map(x => `<span style="color:${x.c}">●</span> ${x.n}: <b>${r[x.k]}</b>`).join('<br>'); tip.classList.remove('hidden'); tip.style.left = Math.min(ev.clientX + 14, innerWidth - 190) + 'px'; tip.style.top = ev.clientY + 14 + 'px'; }; rc.onmouseleave = () => tip.classList.add('hidden'); });
}

/* ------------------------------------------------------------ generic table */
function table(el, { rows, cols, statusKey, statusOptions, search = true, onRow, empty, extra = '' }) {
  let sort = { k: null, d: -1 }, q = '', st = '';
  el.innerHTML = `<div class="toolbar">${search ? '<input type="search" id="q" placeholder="Search name, company, country, service…">' : ''}
    ${statusKey ? `<select id="st"><option value="">All</option>${[...new Set(rows.map(r => r[statusKey]).filter(Boolean))].sort().map(o => `<option>${esc(o)}</option>`).join('')}</select>` : ''}${extra}<span class="count" id="cnt"></span></div><div id="tb"></div>`;
  const draw = () => {
    let r = rows;
    if (st) r = r.filter(x => x[statusKey] === st);
    if (q) r = r.filter(x => Object.values(x).join(' ').toLowerCase().includes(q));
    if (sort.k) { const c = cols.find(c => c.k === sort.k); r = r.slice().sort((a, b) => (c.num ? (Number(a[sort.k] || 0) - Number(b[sort.k] || 0)) : String(a[sort.k] || '').localeCompare(String(b[sort.k] || ''))) * sort.d); }
    $('#cnt', el).textContent = `${r.length} shown`;
    if (!r.length) { $('#tb', el).innerHTML = `<div class="tablewrap"><div class="empty"><b>${q || st ? 'Nothing matches' : empty[0]}</b>${q || st ? 'Try a different search or clear the filter.' : empty[1]}</div></div>`; return; }
    $('#tb', el).innerHTML = `<div class="tablewrap"><table><thead><tr>${cols.map(c => `<th data-k="${esc(c.k)}">${c.l}${sort.k === c.k ? `<span class="arr">${sort.d > 0 ? '↑' : '↓'}</span>` : ''}</th>`).join('')}</tr></thead><tbody>${r.slice(0, 1000).map((x, i) => `<tr class="click" data-i="${i}" tabindex="0">${cols.map(c => `<td>${c.h ? c.h(x) : (esc(x[c.k]) || '<span class="sub">–</span>')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    $$('th', el).forEach(th => th.onclick = () => { sort = { k: th.dataset.k, d: sort.k === th.dataset.k ? -sort.d : -1 }; draw(); });
    $$('tbody tr', el).forEach(tr => { const open = () => onRow && onRow(r[+tr.dataset.i]); tr.onclick = open; tr.onkeydown = e => { if (e.key === 'Enter') open(); }; });
  };
  if ($('#q', el)) $('#q', el).oninput = e => { q = e.target.value.trim().toLowerCase(); draw(); };
  if ($('#st', el)) $('#st', el).onchange = e => { st = e.target.value; draw(); };
  draw();
}
let lastFocus = null;
function drawer(title, sub, html, foot = '') {
  closeLayer(); lastFocus = document.activeElement;
  document.body.insertAdjacentHTML('beforeend', `<div class="scrim" id="scrim"></div><aside class="drawer" id="drawer" role="dialog" aria-label="${esc(title)}"><header><div><h3>${esc(title)}</h3><div class="sub">${sub || ''}</div></div><button class="btn sm" id="xd">Close</button></header><div class="body">${html}</div>${foot ? `<footer>${foot}</footer>` : ''}</aside>`);
  requestAnimationFrame(() => $('#drawer').classList.add('open'));
  $('#xd').onclick = closeLayer; $('#scrim').onclick = closeLayer; $('#xd').focus();
  $$('#drawer .copy').forEach(b => b.onclick = () => copy(b.dataset.c));
  return $('#drawer');
}
function modal(title, html, foot) {
  closeLayer(); lastFocus = document.activeElement;
  document.body.insertAdjacentHTML('beforeend', `<div class="scrim" id="scrim"></div><div class="modal" id="modal" role="dialog" aria-label="${esc(title)}"><header><h3>${esc(title)}</h3><button class="btn sm" id="xd">Close</button></header><div class="body">${html}</div><footer>${foot}</footer></div>`);
  $('#xd').onclick = closeLayer; $('#scrim').onclick = closeLayer;
  return $('#modal');
}
function closeLayer() { ['#scrim', '#drawer', '#modal'].forEach(s => { const e = $(s); if (e) e.remove(); }); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLayer(); });
const fields = (r, skip = [], copyable = []) => Object.entries(r).filter(([k, v]) => String(v ?? '').trim() && !skip.includes(k)).map(([k, v]) => { const s = String(v); const url = /^https?:\/\//.test(s); return `<div class="field"><div class="k">${esc(k)}${copyable.includes(k) ? `<button class="copy" data-c="${esc(s)}">Copy</button>` : ''}</div><div class="v">${url ? `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(s)}</a>` : esc(s)}</div></div>`; }).join('');

/* ------------------------------------------------------------ leads pages */
async function pageLeads(el) {
  const rows = await api('/leads/raw');
  el.innerHTML = head('All email leads', 'Every business the agent found or you imported. Click a row for details.', `<a class="btn" href="#/import">Import leads</a>`) + '<div id="t"></div>';
  const statuses = ['New', 'Pitched', 'Follow-up 1', 'Follow-up 2', 'Replied', 'Interested', 'Not Interested', 'Do Not Contact', 'Bounced', 'No Email', 'Low Fit', 'Send Failed'];
  table($('#t'), { rows, statusKey: 'Status', empty: ['No leads yet', 'The agent adds new businesses every few hours, or import your own list.'],
    cols: [{ k: 'Date Found', l: 'Found' }, { k: 'Business Name', l: 'Business', h: r => `<div class="strong">${esc(r['Business Name'])}</div><div class="sub">${esc(r.Industry)}</div>` }, { k: 'Country', l: 'Location', h: r => `${esc(r.City)}<div class="sub">${esc(r.Country)}</div>` }, { k: 'Email', l: 'Email', h: r => r.Email ? esc(r.Email) : '<span class="sub">not found</span>' }, { k: 'Best Service', l: 'Best service' }, { k: 'Fit Score', l: 'Fit', num: true, h: r => r['Fit Score'] ? `${esc(r['Fit Score'])}<span class="sub">/10</span>` : '<span class="sub">–</span>' }, { k: 'Status', l: 'Status', h: r => tag(r.Status) }, { k: 'Pitched On', l: 'Emailed' }],
    onRow: r => {
      const d = drawer(r['Business Name'], tag(r.Status) + ' <span class="sub">' + esc(r['Lead ID']) + '</span>', `<label class="f"><span>Change status</span><select id="ns">${statuses.map(s => `<option ${s === r.Status ? 'selected' : ''}>${s}</option>`).join('')}</select><small>Tip: "Do Not Contact" stops all emails to this lead forever. "New" puts it back in the queue.</small></label>
        <label class="f"><span>Email</span><input type="email" id="ne" value="${esc(r.Email)}"></label>
        <div class="field"><div class="k">Send an email now</div>
          <div class="acts" style="margin:6px 0"><button class="btn sm" id="wd">✎ Write it for me (AI)</button><span class="sub">${r['Message ID'] ? 'Goes in the same email thread as before' : 'Sent as their first email'}</span></div>
          <input type="text" id="es" placeholder="Subject${r['Message ID'] ? ' (leave empty to reply in the same thread)' : ''}" style="margin-bottom:6px">
          <textarea id="eb" rows="8" placeholder="Write your email… your signature is added automatically"></textarea>
          <div class="acts" style="margin-top:8px"><button class="btn sm primary" id="se" ${r.Status === 'Do Not Contact' ? 'disabled title="This lead asked not to be contacted"' : ''}>Send email</button></div></div>
        ${fields(r, ['Business Name', 'Message ID', 'Thread ID'], ['Email', 'Phone', 'Website'])}`, '<button class="btn primary" id="sv">Save</button>');
      const id = encodeURIComponent(r['Lead ID']);
      $('#sv', d).onclick = e => busy(e.currentTarget, async () => { await api('/leads/raw/' + id, { method: 'PATCH', body: { Status: $('#ns', d).value, Email: $('#ne', d).value.trim() } }); toast('Saved'); closeLayer(); route(); });
      $('#wd', d).onclick = e => busy(e.currentTarget, async () => { const x = await api('/leads/raw/' + id + '/draft'); $('#es', d).value = x.threaded ? '' : x.subject; $('#eb', d).value = x.body; $('#eb', d).focus(); });
      $('#se', d).onclick = e => busy(e.currentTarget, async () => {
        const to = $('#ne', d).value.trim(), text = $('#eb', d).value.trim();
        if (!to) throw new Error('Add their email address first.'); if (!text) throw new Error('Write the email first (or click "Write it for me").');
        if (!confirm(`Send this email to ${to} now?`)) return;
        const x = await api('/leads/raw/' + id + '/email', { method: 'POST', body: { to, subject: $('#es', d).value.trim(), text } });
        toast(`Email sent to ${x.to} from ${x.from}`); closeLayer(); route();
      });
    } });
}
async function pageQualified(el) {
  const rows = await api('/leads/qualified');
  el.innerHTML = head('Qualified leads', 'People who said yes. The team leader also gets an email for each one.') + '<div id="t"></div>';
  table($('#t'), { rows, statusKey: 'Lead Score', empty: ['No qualified leads yet', 'When someone replies "yes, interested", they appear here.'],
    cols: [{ k: 'Date Qualified', l: 'Date' }, { k: 'Business Name', l: 'Business', h: r => `<div class="strong">${esc(r['Business Name'] || r['Contact Name'])}</div><div class="sub">${esc(r['Contact Name'])}</div>` }, { k: 'Source', l: 'Source', h: r => tag(r.Source === 'LinkedIn' ? 'LinkedIn' : 'Email') }, { k: 'Service Needed', l: 'Service needed' }, { k: 'Lead Score', l: 'Score', h: r => tag(r['Lead Score']) }, { k: 'Country', l: 'Country' }, { k: 'Next Step', l: 'Next step' }, { k: 'Owner', l: 'Owner' }, { k: 'Last Contact On', l: 'Last contact', h: r => r['Last Contact On'] ? `${esc(r['Last Contact On'])}<div class="sub">${esc(r['Last Contact By'])}</div>` : '<span class="sub">not yet</span>' }],
    onRow: r => {
      const d = drawer(r['Business Name'] || r['Contact Name'], tag(r['Lead Score']) + ' ' + tag(r.Source), `<div class="row2"><label class="f"><span>Next step</span><input type="text" id="nx" value="${esc(r['Next Step'])}"></label><label class="f"><span>Owner</span><input type="text" id="ow" value="${esc(r.Owner)}"></label></div>
        <label class="f"><span>Score</span><select id="sc">${['Hot', 'Warm', 'Cold'].map(s => `<option ${s === r['Lead Score'] ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <div class="field"><div class="k">Reply to them</div>
          <div class="seg" style="margin:6px 0" id="ch">${r.LinkedIn ? `<button data-c="linkedin" class="${r.LinkedIn ? 'on' : ''}">in LinkedIn</button>` : ''}<button data-c="email" class="${r.LinkedIn ? '' : 'on'}">✉ Email</button></div>
          <textarea id="lt" rows="3" placeholder="Optional: paste their latest message, so the AI answers it"></textarea>
          <div class="acts" style="margin:6px 0"><button class="btn sm" id="qd">✎ Write it for me (AI)</button></div>
          <input type="email" id="qe" value="${esc(r.Email)}" placeholder="Their email address" style="margin-bottom:6px">
          <textarea id="qt" rows="7" placeholder="Your reply…"></textarea>
          <div class="acts" style="margin-top:8px"><button class="btn sm primary" id="qs"></button><button class="btn sm hidden" id="qm">✓ I sent it on LinkedIn</button></div>
          <div class="sub" id="qh" style="margin-top:4px"></div></div>
        <div class="field"><div class="k">Conversation</div><div id="conv"><span class="spin"></span></div></div>
        ${fields(r, ['Business Name', 'Next Step', 'Owner', 'Our Replies'], ['Email', 'Phone', 'LinkedIn'])}`, '<button class="btn primary" id="sv">Save</button>');
      const id = encodeURIComponent(r['Lead ID']);
      let ch = r.LinkedIn ? 'linkedin' : 'email';
      const setCh = c => { ch = c; $$('#ch button', d).forEach(b => b.classList.toggle('on', b.dataset.c === c)); const li = c === 'linkedin';
        $('#qe', d).classList.toggle('hidden', li); $('#qm', d).classList.toggle('hidden', !li);
        $('#qs', d).innerHTML = li ? 'in&nbsp; Send on LinkedIn' : 'Send email';
        $('#qh', d).innerHTML = li ? 'Copies the reply and opens their LinkedIn in your browser (your own LinkedIn account). Click <b>Message</b>, Ctrl+V, Send. Then click <b>I sent it on LinkedIn</b> so it is saved here.' : 'Sent from your Gmail, in the same thread as earlier emails to them.'; };
      $$('#ch button', d).forEach(b => b.onclick = () => setCh(b.dataset.c)); setCh(ch);
      api('/leads/qualified/' + id + '/thread').then(t => {
        if (t.email && !$('#qe', d).value) $('#qe', d).value = t.email;
        if (t.emailHow) $('#qe', d).title = 'Found: ' + t.emailHow;
        if (!t.email && r.LinkedIn) $('#qe', d).placeholder = 'No email yet – the AI reply asks them for it on LinkedIn';
        $('#conv', d).innerHTML = t.messages.length ? t.messages.map(m => `<div class="msg" style="white-space:pre-wrap;${m.who === 'us' ? 'margin-left:24px;border-left:3px solid var(--gold, #c9a24a)' : 'margin-right:24px'}"><div class="sub" style="margin-bottom:4px">${m.who === 'us' ? 'We' : 'They'} · ${m.channel === 'linkedin' ? 'LinkedIn' : m.channel === 'email' ? 'Email' : ''}${m.when ? ' · ' + esc(m.when) : ''}${m.meta ? ' · ' + esc(m.meta) : ''}</div>${esc(m.text)}</div>`).join('') : '<div class="sub">No messages saved yet.</div>';
      }).catch(e => { $('#conv', d).innerHTML = `<div class="sub">${esc(e.message)}</div>`; });
      $('#qd', d).onclick = e => busy(e.currentTarget, async () => { const x = await api('/leads/qualified/' + id + '/draft', { method: 'POST', body: { channel: ch, latest: $('#lt', d).value.trim() } }); $('#qt', d).value = x.text; if (!x.ai) toast('AI not available right now, a simple reply was filled in', true); $('#qt', d).focus(); });
      const save = async () => api('/leads/qualified/' + id + '/reply', { method: 'POST', body: { channel: ch, to: $('#qe', d).value.trim(), text: $('#qt', d).value.trim() } });
      $('#qs', d).onclick = e => busy(e.currentTarget, async () => {
        const text = $('#qt', d).value.trim(); if (!text) throw new Error('Write the reply first (or click "Write it for me").');
        if (ch === 'linkedin') { copy(text); window.open(r.LinkedIn, '_blank', 'noopener'); return; }
        if (!confirm(`Send this email to ${$('#qe', d).value.trim()} now?`)) return;
        const x = await save(); toast('Sent: ' + x.where); closeLayer(); route();
      });
      $('#qm', d).onclick = e => busy(e.currentTarget, async () => { if (!$('#qt', d).value.trim()) throw new Error('The reply box is empty.'); await save(); toast('Saved as sent on LinkedIn'); closeLayer(); route(); });
      $('#sv', d).onclick = e => busy(e.currentTarget, async () => { await api('/leads/qualified/' + id, { method: 'PATCH', body: { 'Next Step': $('#nx', d).value, Owner: $('#ow', d).value, 'Lead Score': $('#sc', d).value, ...($('#qe', d).value.trim() ? { Email: $('#qe', d).value.trim() } : {}) } }); toast('Saved'); closeLayer(); route(); });
    } });
}

/* ------------------------------------------------------------ LinkedIn */
async function pageLinkedIn(el) {
  const rows = await api('/leads/linkedin');
  const view = sessionStorage.getItem('li_view') || 'tasks';
  const tasks = rows.filter(r => ['To Connect', 'Request Sent', 'Connected', 'Message Sent'].includes(r.Status) || (r['Their Reply'] && r['Suggested Reply'] && !['Interested', 'Not Interested'].includes(r.Status)))
    .sort((a, b) => { const p = r => r['Suggested Reply'] && r.Status === 'Replied' ? 0 : r.Status === 'Connected' ? 1 : r.Status === 'To Connect' ? 2 : 3; return p(a) - p(b) || Number(b['Fit Score'] || 0) - Number(a['Fit Score'] || 0); });
  el.innerHTML = head('LinkedIn tasks', 'The agent prepares every message. You send it on LinkedIn and click what happened, about 10 minutes a day (max 15–20 connection requests).', `<div class="seg"><button data-v="tasks" class="${view === 'tasks' ? 'on' : ''}">Today's tasks (${tasks.length})</button><button data-v="all" class="${view === 'all' ? 'on' : ''}">All prospects (${rows.length})</button></div>`) + '<div id="t"></div>';
  $$('.seg button').forEach(b => b.onclick = () => { sessionStorage.setItem('li_view', b.dataset.v); route(); });
  if (view === 'all') return table($('#t'), { rows, statusKey: 'Status', empty: ['No LinkedIn prospects yet', 'The agent adds founders and owners every 12 hours.'],
    cols: [{ k: 'Date Found', l: 'Found' }, { k: 'Name', l: 'Person', h: r => `<div class="strong">${esc(r.Name)}</div><div class="sub">${esc(r.Title)}</div>` }, { k: 'Company', l: 'Company' }, { k: 'Email', l: 'Email', h: r => r.Email ? esc(r.Email) : '<span class="sub">–</span>' }, { k: 'Location', l: 'Location' }, { k: 'Best Service', l: 'Best service' }, { k: 'Fit Score', l: 'Fit', num: true }, { k: 'Status', l: 'Status', h: r => tag(r.Status) }, { k: 'Handled By', l: 'Handled by' }],
    onRow: r => drawer(r.Name, tag(r.Status), fields(r, ['Name'], ['Connection Note', 'First Message', 'Suggested Reply', 'LinkedIn URL'])) });
  if (!tasks.length) { $('#t').innerHTML = '<div class="tablewrap"><div class="empty"><b>All done for now</b>New prospects arrive every 12 hours.</div></div>'; return; }
  $('#t').innerHTML = `<div class="tasks">${tasks.slice(0, 40).map((r, i) => {
    const rep = r['Their Reply'] && r['Suggested Reply'] && r.Status === 'Replied';
    const st = rep ? ['Reply to their message', r['Suggested Reply'], [['Message Sent', 'I replied'], ['Interested', 'They\'re interested ★'], ['Not Interested', 'Not interested']]]
      : r.Status === 'To Connect' ? ['1 · Send connection request', r['Connection Note'], [['Request Sent', 'Request sent']]]
      : r.Status === 'Request Sent' ? ['2 · Waiting for them to accept', r['Connection Note'], [['Connected', 'They accepted'], ['Not Interested', 'Ignored / declined']]]
      : r.Status === 'Connected' ? ['3 · Send the first message', r['First Message'], [['Message Sent', 'Message sent']]]
      : ['4 · Waiting for their reply', r['First Message'], [['Interested', 'They\'re interested ★'], ['Not Interested', 'Not interested']]];
    return `<article class="task" data-i="${i}"><div class="step">${st[0]}</div>
      <div class="top"><div><div class="strong">${esc(r.Name)}</div><div class="sub">${esc(r.Title)}${r.Company ? ' · ' + esc(r.Company) : ''} · ${esc(r.Location)}</div></div>${tag(r.Status)}</div>
      ${rep ? `<div class="sub">They said: “${esc(r['Their Reply'])}”</div>` : ''}
      <div class="sub" style="margin:4px 0">✉ ${r.Email ? `<b>${esc(r.Email)}</b>${r['Email Found How'] ? ' · ' + esc(r['Email Found How']) : ''}` : 'No email yet'} <button class="btn sm ghost" data-email>${r.Email ? 'Change' : 'Add email'}</button></div>
      <textarea class="limsg" rows="4" aria-label="Message (you can edit it)">${esc(st[1] || '')}</textarea>
      <div class="acts" style="margin-top:8px"><button class="btn sm primary" data-li>in&nbsp; Send on LinkedIn</button><button class="btn sm" data-copy>Copy message</button></div>
      <div class="sub" style="margin-top:4px">Copies the message and opens their LinkedIn. ${r.Status === 'To Connect' ? 'Click <b>Connect → Add a note</b>, press Ctrl+V, Send.' : 'Click <b>Message</b>, press Ctrl+V, Send.'} Then click what happened below.</div>
      <div class="acts">${st[2].map(([v, l]) => `<button class="btn sm" data-set="${v}">${l}</button>`).join('')}<button class="btn sm ghost" data-reply>Paste their reply</button></div>
      <div class="hidden" data-rbox><textarea placeholder="Paste exactly what they wrote on LinkedIn…"></textarea><div class="acts" style="margin-top:8px"><button class="btn sm primary" data-savereply>Save – the agent will suggest a reply</button></div></div></article>`;
  }).join('')}</div>`;
  $$('.task').forEach(card => {
    const r = tasks[+card.dataset.i];
    $('[data-copy]', card).onclick = () => copy($('.limsg', card).value);
    $('[data-email]', card).onclick = e => { const v = prompt(`Email address of ${r.Name}:`, r.Email || ''); if (v === null) return; busy(e.currentTarget, async () => { await api('/leads/linkedin/' + encodeURIComponent(r['Lead ID']), { method: 'PATCH', body: { Email: v.trim() } }); toast('Email saved'); route(); }); };
    $('[data-li]', card).onclick =() => { copy($('.limsg', card).value); if (r['LinkedIn URL']) window.open(r['LinkedIn URL'], '_blank', 'noopener'); else toast('No LinkedIn link saved for this person', true); };
    $$('[data-set]', card).forEach(b => b.onclick = () => busy(b, async () => { await api('/leads/linkedin/' + encodeURIComponent(r['Lead ID']), { method: 'PATCH', body: { Status: b.dataset.set } }); toast(b.dataset.set === 'Interested' ? 'Great! The team leader is being alerted.' : 'Updated'); route(); }));
    $('[data-reply]', card).onclick = () => { $('[data-rbox]', card).classList.toggle('hidden'); $('textarea', card).focus(); };
    $('[data-savereply]', card).onclick = e => busy(e.currentTarget, async () => { const t = $('textarea', card).value.trim(); if (!t) throw new Error('Paste their reply first.'); await api('/leads/linkedin/' + encodeURIComponent(r['Lead ID']), { method: 'PATCH', body: { 'Their Reply': t } }); toast('Saved. A suggested reply will appear in a minute.'); setTimeout(route, 1500); });
  });
}

/* ------------------------------------------------------------ import */
// Replies from client: two separate lists, Gmail (email replies) and LinkedIn (replies pasted from LinkedIn).
// Each shows who it is (with links to their email / LinkedIn profile), what they said, what we sent, and a box to answer them.
const RP_LABEL = { interested: 'Interested ★', question: 'Question', referral: 'Referral', not_interested: 'Not interested', unsubscribe: 'Unsubscribed', out_of_office: 'Out of office', other: 'Other' };
async function pageReplies(el) {
  const canMail = S.me.role !== 'linkedin';
  const [mailRows, liAll] = await Promise.all([canMail ? api('/replies') : [], api('/leads/linkedin')]);
  const liRows = liAll.filter(r => String(r['Their Reply'] || '').trim());
  const src = canMail ? (sessionStorage.getItem('rp_src') || 'gmail') : 'linkedin';
  const mailOpen = r => /please answer|Not sent/i.test(r['Reply Status'] || '');
  const liOpen = r => r.Status === 'Replied';
  el.innerHTML = head('Replies from client', 'Everything clients wrote back to us, with their contact links, what they said and what we sent. Answer them from here.',
    `<div class="seg">${canMail ? `<button data-s="gmail" class="${src === 'gmail' ? 'on' : ''}">✉ Gmail (${mailRows.length}${mailRows.some(mailOpen) ? ' · ' + mailRows.filter(mailOpen).length + ' waiting' : ''})</button>` : ''}<button data-s="linkedin" class="${src === 'linkedin' ? 'on' : ''}">in LinkedIn (${liRows.length}${liRows.some(liOpen) ? ' · ' + liRows.filter(liOpen).length + ' waiting' : ''})</button></div>`) + '<div id="sub"></div><div id="t"></div>';
  $$('.head .seg button').forEach(b => b.onclick = () => { sessionStorage.setItem('rp_src', b.dataset.s); route(); });
  return src === 'gmail' ? repliesGmail(mailRows, mailOpen) : repliesLinkedIn(liRows, liOpen);
}

function repliesGmail(rows, open) {
  const view = sessionStorage.getItem('rp_view') || (rows.some(open) ? 'open' : 'all');
  const list = view === 'open' ? rows.filter(open) : rows;
  $('#sub').innerHTML = `<div class="seg" style="margin-bottom:12px"><button data-v="open" class="${view === 'open' ? 'on' : ''}">Needs your answer (${rows.filter(open).length})</button><button data-v="all" class="${view === 'all' ? 'on' : ''}">All Gmail replies (${rows.length})</button></div>`;
  $$('#sub button').forEach(b => b.onclick = () => { sessionStorage.setItem('rp_view', b.dataset.v); route(); });
  if (!list.length) { $('#t').innerHTML = `<div class="tablewrap"><div class="empty"><b>${rows.length ? 'Nothing waiting for you' : 'No email replies yet'}</b>${rows.length ? 'The agent has answered everyone. See "All Gmail replies".' : 'When a client answers an email, it appears here within 5 minutes.'}</div></div>`; return; }
  $('#t').innerHTML = `<div class="tasks">${list.map((r, i) => `<article class="task" data-i="${i}">
      <div class="step">✉ Gmail · ${esc(r['Received On'])} · ${esc(RP_LABEL[r.Category] || r.Category || '')}</div>
      <div class="top"><div><div class="strong">${esc(r['Business Name'] || r.From)}</div>
        <div class="sub">${r['Contact Name'] ? esc(r['Contact Name']) + ' · ' : ''}<a href="mailto:${esc(r.From)}">${esc(r.From)}</a>${r.Inbox ? ' → our inbox ' + esc(r.Inbox) : ''}</div></div>${tag(r['Reply Status'])}</div>
      ${r.Summary ? `<div class="sub" style="margin-top:6px">Summary: ${esc(r.Summary)}</div>` : ''}
      <div class="sub" style="margin-top:8px">They wrote${r.Subject ? ' (' + esc(r.Subject) + ')' : ''}:</div>
      <div class="msg">${esc(r['Their Message'])}</div>
      ${r['Our Reply'] ? `<div class="sub">We answered:</div><div class="msg">${esc(r['Our Reply'])}</div>` : ''}
      <textarea placeholder="Write your answer to ${esc(r['Contact Name'] || r.From)}… (your signature is added automatically)" style="margin-top:8px"></textarea>
      <div class="acts" style="margin-top:8px"><button class="btn sm primary" data-send>Send reply</button><button class="btn sm" data-copy>Copy their email</button></div>
    </article>`).join('')}</div>`;
  $$('.task').forEach(card => {
    const r = list[+card.dataset.i];
    $('[data-copy]', card).onclick = () => copy(r.From);
    $('[data-send]', card).onclick = e => busy(e.currentTarget, async () => {
      const text = $('textarea', card).value.trim(); if (!text) throw new Error('Write your answer first.');
      if (!confirm(`Send this reply to ${r.From}?`)) return;
      await api('/replies/' + encodeURIComponent(r['Reply ID']) + '/answer', { method: 'POST', body: { text } });
      toast('Reply sent to ' + r.From); route();
    });
  });
}

function repliesLinkedIn(rows, open) {
  const canMail = S.me.role !== 'linkedin';
  const list = rows.slice().sort((a, b) => open(b) - open(a));
  $('#sub').innerHTML = '<div class="sub" style="margin-bottom:12px">LinkedIn does not let apps read your messages, so paste each reply on the <a href="#/linkedin">LinkedIn tasks</a> page ("Paste their reply"). It then appears here with a suggested answer.</div>';
  if (!list.length) { $('#t').innerHTML = '<div class="tablewrap"><div class="empty"><b>No LinkedIn replies yet</b>When someone answers you on LinkedIn, paste their message on the LinkedIn tasks page.</div></div>'; return; }
  $('#t').innerHTML = `<div class="tasks">${list.map((r, i) => `<article class="task" data-i="${i}">
      <div class="step">in LinkedIn${r['AI Category'] ? ' · ' + esc(RP_LABEL[r['AI Category']] || r['AI Category']) : ''}${open(r) ? ' · waiting for our answer' : ''}</div>
      <div class="top"><div><div class="strong">${esc(r.Name)}</div>
        <div class="sub">${esc([r.Title, r.Company, r.Location].filter(Boolean).join(' · '))}</div>
        <div class="sub">${r['LinkedIn URL'] ? `<a href="${esc(r['LinkedIn URL'])}" target="_blank" rel="noopener">LinkedIn profile</a>` : ''}${r.Email ? ` · <a href="mailto:${esc(r.Email)}">${esc(r.Email)}</a>` : ' · no email yet'}</div></div>${tag(r.Status)}</div>
      <div class="sub" style="margin-top:8px">They wrote:</div>
      <div class="msg">${esc(r['Their Reply'])}</div>
      <div class="sub">Your answer${r['Suggested Reply'] ? ' (suggested by the AI, edit as you like)' : ''}:</div>
      <textarea rows="4">${esc(r['Suggested Reply'] || '')}</textarea>
      <div class="acts" style="margin-top:8px"><button class="btn sm primary" data-li>in&nbsp; Send on LinkedIn</button><button class="btn sm" data-lidone>✓ I sent it on LinkedIn</button>${canMail ? `<button class="btn sm" data-mail>✉ Send by email</button>` : ''}</div>
      <div class="sub" style="margin-top:4px">Send on LinkedIn copies the answer and opens their profile in your browser (your own LinkedIn): click Message, Ctrl+V, Send, then "I sent it".</div>
    </article>`).join('')}</div>`;
  $$('.task').forEach(card => {
    const r = list[+card.dataset.i], id = encodeURIComponent(r['Lead ID']);
    const text = () => { const t = $('textarea', card).value.trim(); if (!t) throw new Error('Write your answer first.'); return t; };
    $('[data-li]', card).onclick = () => { const t = $('textarea', card).value.trim(); if (!t) return toast('Write your answer first.', true); copy(t); if (r['LinkedIn URL']) window.open(r['LinkedIn URL'], '_blank', 'noopener'); };
    $('[data-lidone]', card).onclick = e => busy(e.currentTarget, async () => { await api('/leads/linkedin/' + id + '/reply', { method: 'POST', body: { channel: 'linkedin', text: text() } }); toast('Saved as sent on LinkedIn'); route(); });
    if ($('[data-mail]', card)) $('[data-mail]', card).onclick = e => busy(e.currentTarget, async () => {
      const t = text(); let to = r.Email;
      if (!to) { to = (prompt(`No email saved for ${r.Name}. Their email address:`) || '').trim(); if (!to) return; }
      if (!confirm(`Send this answer by email to ${to}?`)) return;
      const x = await api('/leads/linkedin/' + id + '/reply', { method: 'POST', body: { channel: 'email', to, text: t } });
      toast('Sent: ' + x.where); route();
    });
  });
}

// Leads that email cannot reach (or that did not answer the email): a person sends a WhatsApp message or calls.
// Done by hand, so no WhatsApp or phone account can be banned.
async function pageCalls(el) {
  const d = await api('/leads/calls');
  el.innerHTML = head('Call / WhatsApp', 'Leads the email cannot reach, and leads who did not answer the email. Open WhatsApp (the message is filled in), press send, then click what happened. About 10–15 a day is plenty.', `<span class="sub">${d.done} handled so far</span>`) + '<div id="t"></div>';
  if (!d.tasks.length) { $('#t').innerHTML = '<div class="tablewrap"><div class="empty"><b>Nothing to call right now</b>Leads appear here when they have a phone number but no working email, or when they have not answered an email for 2 days.</div></div>'; return; }
  $('#t').innerHTML = `<div class="tasks">${d.tasks.map((r, i) => `<article class="task" data-i="${i}">
      <div class="step">${esc(r.why)}${r['Call Status'] === 'No Answer' ? ' · try again' : ''}</div>
      <div class="top"><div><div class="strong">${esc(r['Business Name'])}</div><div class="sub">${esc([r['Contact Name'], r.City, r.Phone].filter(Boolean).join(' · '))}</div></div>${tag(r.Status)}</div>
      <div class="msg">${esc(r.message)}</div>
      <div class="acts">${r.wa ? `<a class="btn sm primary" href="https://wa.me/${esc(r.wa)}?text=${encodeURIComponent(r.message)}" target="_blank" rel="noopener">Open WhatsApp</a>` : ''}<button class="btn sm" data-copy>Copy message</button><button class="btn sm" data-num>Copy number</button>${r.Website ? `<a class="btn sm ghost" href="${esc(r.Website)}" target="_blank" rel="noopener">Website</a>` : ''}</div>
      <div class="acts">${[['Messaged', 'WhatsApp sent'], ['No Answer', 'Called, no answer'], ['Interested', 'Interested ★'], ['Not Interested', 'Not interested'], ['Wrong Number', 'Wrong number']].map(([v, l]) => `<button class="btn sm" data-set="${v}">${l}</button>`).join('')}</div>
    </article>`).join('')}</div>`;
  $$('.task').forEach(card => {
    const r = d.tasks[+card.dataset.i];
    $('[data-copy]', card).onclick = () => copy(r.message);
    $('[data-num]', card).onclick = () => copy(r.Phone);
    $$('[data-set]', card).forEach(b => b.onclick = () => busy(b, async () => {
      const note = b.dataset.set === 'Interested' ? (prompt('What did they say? (optional, goes to the team leader)') || '') : '';
      await api('/leads/call/' + encodeURIComponent(r['Lead ID']), { method: 'PATCH', body: { status: b.dataset.set, note } });
      toast(b.dataset.set === 'Interested' ? 'Great! Added to Qualified leads, the team leader is alerted.' : 'Saved'); route();
    }));
  });
}

async function pageImport(el) {
  el.innerHTML = head('Import leads', 'Upload your own list (Excel or CSV). The agent emails every row that has an email address, using your templates and tone.') +
    `<div class="panel"><div class="drop" id="drop"><b style="font-size:15px;color:var(--text)">Choose an Excel or CSV file</b><br><span class="sub">or drop it here · .xlsx, .xls, .csv · up to 5,000 rows</span></div><input type="file" id="f" class="hidden" accept=".xlsx,.xls,.csv"></div><div id="step2" style="margin-top:14px"></div>`;
  const pick = () => $('#f').click();
  $('#drop').onclick = pick;
  $('#drop').ondragover = e => { e.preventDefault(); $('#drop').classList.add('over'); };
  $('#drop').ondragleave = () => $('#drop').classList.remove('over');
  $('#drop').ondrop = e => { e.preventDefault(); $('#drop').classList.remove('over'); load(e.dataTransfer.files[0]); };
  $('#f').onchange = e => load(e.target.files[0]);
  async function load(file) {
    if (!file) return;
    if (file.size > 15e6) return toast('File is too big (max 15 MB).', true);
    $('#step2').innerHTML = '<div class="empty"><span class="spin"></span> Reading file…</div>';
    const buf = await file.arrayBuffer(); let bin = ''; const bytes = new Uint8Array(buf); for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    try {
      const p = await api('/import/preview', { method: 'POST', body: { filename: file.name, base64: btoa(bin) } });
      const opt = f => `<select data-f="${esc(f)}"><option value="">— not in my file —</option>${p.headers.map(h => `<option ${p.mapping[f] === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select>`;
      $('#step2').innerHTML = `<div class="panel"><h2>${esc(p.filename)} · ${fmt(p.total)} rows</h2><div class="desc">Match your columns. We guessed what we could. Only Email (or Business Name) is required.</div>
        <div class="row2">${p.fields.map(f => `<label class="f"><span>${esc(f)}${f === 'Email' ? ' *' : ''}</span>${opt(f)}</label>`).join('')}</div>
        <div class="row2"><label class="f"><span>Default industry (if the file has none)</span><input type="text" id="dI" placeholder="e.g. dental clinic"></label><label class="f"><span>Default country</span><input type="text" id="dC" placeholder="e.g. AE"></label></div>
        <label class="f"><span>What should the agent do with these leads?</span><select id="dS"><option value="New">Email them automatically (Status New)</option><option value="Low Fit">Just save them, don't email yet</option></select></label>
        <div class="desc" style="margin-top:6px">Preview of the first rows:</div>
        <div class="tablewrap" style="max-height:260px;margin-bottom:14px"><table><thead><tr>${p.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${p.sample.map(r => `<tr>${p.headers.map(h => `<td>${esc(r[h])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <button class="btn primary" id="go">Import ${fmt(p.total)} leads</button> <span class="sub">Duplicates (same email or website) are skipped automatically.</span></div>`;
      $('#go').onclick = e => busy(e.currentTarget, async () => {
        const mapping = {}; $$('[data-f]').forEach(s => { if (s.value) mapping[s.dataset.f] = s.value; });
        if (!mapping.Email && !mapping['Business Name']) throw new Error('Match at least the Email or Business Name column.');
        const r = await api('/import/commit', { method: 'POST', body: { token: p.token, mapping, defaults: { industry: $('#dI').value, country: $('#dC').value, status: $('#dS').value } } });
        const when = r.sendingNow ? 'The agent is <b>emailing them now</b>, before all other leads (about one every 30–45 seconds, within today\'s daily limit; any left over go first tomorrow).'
          : r.agentOff ? 'The agent is switched off: switch it on (Dashboard) and they are emailed first.' : 'They are emailed first, before all other leads.';
        $('#step2').innerHTML = `<div class="notice ok"><b>Imported ${fmt(r.added)} leads, ${fmt(r.ready)} with an email.</b> ${when}${r.withWebsite ? ` For ${fmt(r.withWebsite)} rows with only a website, the agent looks for an email first.` : ''} Skipped ${fmt(r.duplicates)} duplicates and ${fmt(r.empty)} empty rows.</div><a class="btn" href="#/leads">See all leads</a> <a class="btn" href="#/activity">Watch it in Agent activity</a>`;
      });
    } catch (err) { $('#step2').innerHTML = `<div class="notice err">${esc(err.message)}</div>`; }
  }
}

/* ------------------------------------------------------------ templates & tone */
const TONE_INFO = { 'Warm & friendly': 'Helpful and human, like writing to someone you respect', 'Formal & professional': 'Polished and professional, never stiff', 'Short & direct': 'A few plain sentences, straight to the point', 'Consultative expert': 'Calm advisor sharing one sharp insight' };
const PH = ['{{first_name}}', '{{contact}}', '{{business}}', '{{service}}', '{{issue}}', '{{opportunity}}', '{{city}}', '{{industry}}', '{{sender}}', '{{company}}', '{{tip}}'];
async function pageTemplates(el) {
  const [{ templates, stages }, st] = await Promise.all([api('/templates'), api('/settings')]);
  const canEdit = ['owner', 'leader'].includes(S.me.role), owner = S.me.role === 'owner';
  const tone = st.values.TONE;
  el.innerHTML = head('Templates & tone', 'Choose how the agent sounds and give it your favourite messages. With "AI personalise" on, the AI keeps your template and adapts it to each lead.', canEdit ? '<button class="btn primary" id="new">New template</button>' : '') +
    `<div class="panel" style="margin-bottom:14px"><h2>Tone of voice</h2><div class="desc">${owner ? 'Click to change. Applies to every email, reply and LinkedIn message.' : 'Only the owner can change the tone.'}</div>
      <div class="tones">${Object.keys(TONE_INFO).map(t => `<div class="tone ${t === tone ? 'on' : ''}" data-t="${esc(t)}" tabindex="0"><b>${esc(t)}</b><span>${TONE_INFO[t]}</span></div>`).join('')}</div>
      <label class="f" style="margin:14px 0 0"><span>Extra instructions for the AI (optional)</span><textarea id="extra" ${owner ? '' : 'disabled'} placeholder="e.g. Always mention we work with clients in 12 countries. Never mention WordPress.">${esc(st.values.EXTRA_INSTRUCTIONS || '')}</textarea></label>
      ${owner ? '<button class="btn sm" id="saveExtra" style="margin-top:8px">Save instructions</button>' : ''}</div>` +
    stages.map(sg => { const list = templates.filter(t => t.Stage === sg); return `<h2 style="font-size:15px;margin:22px 0 10px">${esc(sg)} <span class="sub">· ${list.filter(t => t.Active === 'yes').length ? (list.filter(t => t.Active === 'yes').length > 1 ? 'active templates rotate (A/B test)' : 'uses this template') : 'no active template, AI writes it fresh'}</span></h2>
      ${list.length ? `<div class="tcards">${list.map(t => `<div class="tcard"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(t.Name)}</b>${tag(t.Active === 'yes' ? 'Active' : 'Off')}</div>${t.Subject ? `<div class="sub">Subject: ${esc(t.Subject)}</div>` : ''}<div class="body">${esc(t.Body)}</div>
        <div class="stats"><span>Sent <b>${t.stats.sent}</b></span><span>Replies <b>${t.stats.replied}</b> (${pct(t.stats.replied, t.stats.sent)})</span><span>Interested <b>${t.stats.interested}</b></span><span>AI personalise <b>${esc(t['AI Personalise'])}</b></span></div>
        ${canEdit ? `<div class="acts" style="display:flex;gap:8px"><button class="btn sm" data-edit="${esc(t['Template ID'])}">Edit &amp; preview</button></div>` : ''}</div>`).join('')}</div>` : '<div class="sub">No templates yet.</div>'}`; }).join('');
  if (owner) {
    $$('.tone').forEach(c => { const act = async () => { try { await api('/settings', { method: 'PUT', body: { TONE: c.dataset.t } }); toast('Tone changed to ' + c.dataset.t); route(); } catch (e) { toast(e.message, true); } }; c.onclick = act; c.onkeydown = e => { if (e.key === 'Enter') act(); }; });
    $('#saveExtra').onclick = e => busy(e.currentTarget, async () => { await api('/settings', { method: 'PUT', body: { EXTRA_INSTRUCTIONS: $('#extra').value } }); toast('Saved'); });
  }
  if ($('#new')) $('#new').onclick = () => editTemplate({ Stage: 'First email', 'AI Personalise': 'yes', Active: 'yes' }, stages, tone);
  $$('[data-edit]').forEach(b => b.onclick = () => editTemplate(templates.find(t => t['Template ID'] === b.dataset.edit), stages, tone));
}
function editTemplate(t, stages, tone) {
  const m = modal(t['Template ID'] ? 'Edit template' : 'New template', `
    <div class="row2"><label class="f"><span>Name</span><input type="text" id="tN" value="${esc(t.Name || '')}" placeholder="e.g. SEO observation"></label>
    <label class="f"><span>Used for</span><select id="tS">${stages.map(s => `<option ${s === t.Stage ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div>
    <label class="f" id="subjWrap"><span>Subject</span><input type="text" id="tSub" value="${esc(t.Subject || '')}" placeholder="quick idea for {{business}}"><small>Follow-ups reuse the first subject automatically.</small></label>
    <label class="f"><span>Message</span><textarea id="tB" style="min-height:180px">${esc(t.Body || '')}</textarea></label>
    <div class="sub">Click to insert a placeholder:</div><div class="chips">${PH.map(p => `<button class="chip" data-ph="${p}">${p}</button>`).join('')}</div>
    <div class="row2"><label class="f"><span>AI personalise</span><select id="tA"><option value="yes" ${t['AI Personalise'] !== 'no' ? 'selected' : ''}>Yes – AI adapts it to each lead (recommended)</option><option value="no" ${t['AI Personalise'] === 'no' ? 'selected' : ''}>No – send exactly as written</option></select></label>
    <label class="f"><span>Status</span><select id="tAc"><option value="yes" ${t.Active !== 'no' ? 'selected' : ''}>Active</option><option value="no" ${t.Active === 'no' ? 'selected' : ''}>Off</option></select></label></div>
    <div class="panel" style="background:var(--panel-2)"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px"><b>Preview</b><select id="pT" style="width:auto">${Object.keys(TONE_INFO).map(x => `<option ${x === tone ? 'selected' : ''}>${x}</option>`).join('')}</select><button class="btn sm" id="pv">Generate preview</button><span class="sub">Uses a real lead from your sheet.</span></div><div id="pvOut" class="sub">Click "Generate preview" to see how a real email will look.</div></div>`,
    `${t['Template ID'] ? '<button class="btn danger" id="del">Delete</button>' : ''}<button class="btn" id="cn">Cancel</button><button class="btn primary" id="sv">Save template</button>`);
  const body = $('#tB', m);
  const toggleSubj = () => $('#subjWrap', m).classList.toggle('hidden', $('#tS', m).value !== 'First email');
  toggleSubj(); $('#tS', m).onchange = toggleSubj;
  $$('[data-ph]', m).forEach(c => c.onclick = () => { const s = body.selectionStart ?? body.value.length; body.value = body.value.slice(0, s) + c.dataset.ph + body.value.slice(body.selectionEnd ?? s); body.focus(); body.selectionStart = body.selectionEnd = s + c.dataset.ph.length; });
  const data = () => ({ 'Template ID': t['Template ID'], Name: $('#tN', m).value.trim(), Stage: $('#tS', m).value, Subject: $('#tSub', m).value, Body: body.value, 'AI Personalise': $('#tA', m).value, Active: $('#tAc', m).value });
  $('#cn', m).onclick = closeLayer;
  $('#sv', m).onclick = e => busy(e.currentTarget, async () => { await api('/templates', { method: 'POST', body: data() }); toast('Template saved'); closeLayer(); route(); });
  if ($('#del', m)) $('#del', m).onclick = e => { if (confirm('Delete this template?')) busy(e.currentTarget, async () => { await api('/templates/' + encodeURIComponent(t['Template ID']), { method: 'DELETE' }); toast('Deleted'); closeLayer(); route(); }); };
  $('#pv', m).onclick = e => busy(e.currentTarget, async () => { const r = await api('/templates/preview', { method: 'POST', body: { ...data(), tone: $('#pT', m).value } }); $('#pvOut', m).innerHTML = `<div class="sub" style="margin-bottom:8px">For: ${esc(r.lead.name)}${r.lead.contact ? ' (' + esc(r.lead.contact) + ')' : ''}</div><div class="preview">${r.subject ? `<div class="subj">${esc(r.subject)}</div>` : ''}${esc(r.body)}</div>`; });
}

/* ------------------------------------------------------------ settings */
async function pageSettings(el) {
  const { values, fields, canEdit } = await api('/settings');
  const groups = [...new Set(fields.map(f => f.group))];
  const input = f => {
    const v = values[f.key] ?? '', dis = canEdit ? '' : 'disabled';
    if (f.type === 'switch') return `<label class="switch"><input type="checkbox" data-k="${f.key}" ${String(v).toLowerCase() === 'yes' ? 'checked' : ''} ${dis}><i></i><span>${String(v).toLowerCase() === 'yes' ? 'ON' : 'OFF'}</span></label>`;
    if (f.type === 'select') return `<select data-k="${f.key}" ${dis}>${f.options.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    if (f.type === 'textarea') return `<textarea data-k="${f.key}" ${dis}>${esc(v)}</textarea>`;
    return `<input type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}" data-k="${f.key}" value="${esc(v)}" ${dis}>`;
  };
  const label = k => k.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  el.innerHTML = head('Settings', canEdit ? 'Changes are saved to the Settings tab of your Google Sheet and used on the next run.' : 'Only the owner can change settings.', canEdit ? '<button class="btn primary" id="sv">Save changes</button>' : '') +
    groups.map(g => `<div class="panel" style="margin-bottom:14px"><h2>${g}</h2><div class="desc"></div><div class="row2">${fields.filter(f => f.group === g).map(f => `<label class="f" style="${f.type === 'textarea' ? 'grid-column:1/-1' : ''}"><span>${label(f.key)}</span>${input(f)}${f.help ? `<small>${esc(f.help)}</small>` : ''}</label>`).join('')}</div></div>`).join('');
  $$('.switch input').forEach(i => i.onchange = () => i.nextElementSibling.nextElementSibling.textContent = i.checked ? 'ON' : 'OFF');
  if ($('#sv')) $('#sv').onclick = e => busy(e.currentTarget, async () => { const b = {}; $$('[data-k]').forEach(i => b[i.dataset.k] = i.type === 'checkbox' ? (i.checked ? 'yes' : 'no') : i.value); await api('/settings', { method: 'PUT', body: b }); toast('Settings saved'); });
}

/* ------------------------------------------------------------ activity */
async function pageActivity(el) {
  const d = await api('/agent'); const owner = S.me.role === 'owner';
  const when = s => s ? new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–';
  el.innerHTML = head('Agent activity', 'What the agent is doing. It runs by itself; "Run now" is only for testing.', '<button class="btn" id="rf">Refresh</button>') +
    `<div class="tablewrap" style="margin-bottom:14px"><table><thead><tr><th>Job</th><th>Last run</th><th>Next run</th><th>Last result</th>${owner ? '<th></th>' : ''}</tr></thead><tbody>${d.jobs.map(j => `<tr><td class="strong">${esc(j.name)} ${j.running ? '<span class="spin" style="color:var(--gold)"></span>' : ''}</td><td>${when(j.lastRun)}</td><td>${j.nextRun === 'daily 20:30' ? 'Daily 8:30 PM' : when(j.nextRun)}</td><td style="white-space:normal;max-width:420px">${j.result ? `<span style="color:${j.result.ok ? 'var(--muted)' : 'var(--red)'}">${esc(j.result.msg)}</span>` : '<span class="sub">–</span>'}</td>${owner ? `<td><button class="btn sm" data-run="${j.id}" ${j.running ? 'disabled' : ''}>Run now</button></td>` : ''}</tr>`).join('')}</tbody></table></div>
    ${d.desktop && owner ? `<div class="panel" style="margin-bottom:14px;display:flex;align-items:center;gap:14px"><div style="flex:1"><h2>Start with Windows</h2><div class="desc" style="margin:0">Opens the agent quietly in the background every time this PC starts, so it never misses a day.</div></div><label class="switch"><input type="checkbox" id="as" ${d.autoStart ? 'checked' : ''}><i></i></label></div>` : ''}
    <div class="panel"><h2>Activity log</h2><div class="desc">Latest first</div><div class="log">${d.logs.length ? d.logs.map(l => `<div class="${l.level === 'error' ? 'err' : l.level === 'warn' ? 'warn' : ''}"><span>${when(l.at)}</span><span>${esc(l.job)}</span><span>${esc(l.msg)}</span></div>`).join('') : '<span class="sub">Nothing yet.</span>'}</div></div>`;
  $('#rf').onclick = () => route();
  $$('[data-run]').forEach(b => b.onclick = () => busy(b, async () => { const r = await api('/agent/run/' + b.dataset.run, { method: 'POST' }); toast(r.msg); setTimeout(route, 2500); }));
  if ($('#as')) $('#as').onchange = async e => { try { await api('/desktop/autostart', { method: 'POST', body: { on: e.target.checked } }); toast(e.target.checked ? 'Will start with Windows' : 'Auto-start off'); } catch (err) { toast(err.message, true); } };
}

/* ------------------------------------------------------------ team */
async function pageTeam(el) {
  const d = await api('/users');
  el.innerHTML = head('Team & logins', 'Give each person their own login. They see only what their role needs.', '<button class="btn primary" id="add">Add person</button>') +
    `<div class="notice ok"><b>How your team opens the app:</b> on any computer or phone in the same office Wi-Fi, open ${d.network.length ? d.network.map(u => `<code>${esc(u)}</code>`).join(' or ') : '<code>http://THIS-PC-IP:4780</code>'} in Chrome and log in. This PC must stay on with the app running. The first time, Windows may ask to allow network access: click <b>Allow</b>.</div>
    <div class="tablewrap"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Last login</th><th></th></tr></thead><tbody>${d.users.map(u => `<tr><td class="strong">${esc(u.name)}</td><td>${esc(u.username)}</td><td>${esc(ROLE_NAME[u.role] || u.role)}</td><td>${tag(u.active === 'yes' ? 'Active' : 'Blocked')}</td><td>${esc(u.lastLogin || '–')}</td><td><button class="btn sm" data-u="${esc(u.username)}">Edit</button></td></tr>`).join('')}</tbody></table></div>
    <div class="panel" style="margin-top:14px"><h2>Roles</h2>${Object.entries(d.roles).map(([k, v]) => `<div class="field"><b>${esc(ROLE_NAME[k])}</b><div class="sub">${esc(v)}</div></div>`).join('')}</div>`;
  const roleSel = (cur = 'linkedin') => `<select id="r">${Object.keys(d.roles).map(k => `<option value="${k}" ${k === cur ? 'selected' : ''}>${ROLE_NAME[k]}</option>`).join('')}</select>`;
  $('#add').onclick = () => { const m = modal('Add person', `<div class="row2"><label class="f"><span>Full name</span><input type="text" id="n"></label><label class="f"><span>Username</span><input type="text" id="un" placeholder="e.g. rohini"></label></div><div class="row2"><label class="f"><span>Role</span>${roleSel()}</label><label class="f"><span>Temporary password (8+)</span><input type="text" id="pw" value="${Math.random().toString(36).slice(2, 7)}-${Math.random().toString(36).slice(2, 7)}"><small>Share it privately. They can change it under My account.</small></label></div>`, '<button class="btn" id="cn">Cancel</button><button class="btn primary" id="sv">Add</button>');
    $('#cn', m).onclick = closeLayer; $('#sv', m).onclick = e => busy(e.currentTarget, async () => { await api('/users', { method: 'POST', body: { name: $('#n', m).value, username: $('#un', m).value.trim(), role: $('#r', m).value, password: $('#pw', m).value } }); toast('Added'); closeLayer(); route(); }); };
  $$('[data-u]').forEach(b => b.onclick = () => { const u = d.users.find(x => x.username === b.dataset.u); const m = modal('Edit ' + u.name, `<div class="row2"><label class="f"><span>Role</span>${roleSel(u.role)}</label><label class="f"><span>Access</span><select id="ac"><option value="yes" ${u.active === 'yes' ? 'selected' : ''}>Active</option><option value="no" ${u.active !== 'yes' ? 'selected' : ''}>Blocked</option></select></label></div><label class="f"><span>New password (leave empty to keep)</span><input type="text" id="pw"></label>`, '<button class="btn" id="cn">Cancel</button><button class="btn primary" id="sv">Save</button>');
    $('#cn', m).onclick = closeLayer; $('#sv', m).onclick = e => busy(e.currentTarget, async () => { const body = { role: $('#r', m).value, active: $('#ac', m).value === 'yes' }; if ($('#pw', m).value) body.password = $('#pw', m).value; await api('/users/' + encodeURIComponent(u.username), { method: 'PATCH', body }); toast('Saved'); closeLayer(); route(); }); });
}

/* ------------------------------------------------------------ connections + account */
async function pageConnections(el) {
  let c; try { c = await api('/connections'); } catch (e) { el.innerHTML = head('Connections') + `<div class="notice">${esc(e.message)}</div>`; return; }
  el.innerHTML = head('Connections', 'Private keys are stored only on this PC (encrypted), never in the Google Sheet.') +
    `<div class="panel"><div class="row2">
      <label class="f"><span>Google Sheet link</span><input type="url" id="sheetUrl" value="${esc(c.sheetUrl)}"></label>
      <label class="f"><span>Service account</span><input type="text" value="${esc(c.serviceAccountEmail)}" disabled><small>Replace the key: <a href="#" id="rk">upload a new .json</a></small><input type="file" id="saFile" class="hidden" accept=".json"></label>
      <label class="f"><span>Gmail address</span><input type="email" id="gmailUser" value="${esc(c.gmailUser)}"></label>
      <label class="f"><span>Gmail app password</span><input type="password" id="gmailAppPassword" value="${esc(c.gmailAppPassword)}" autocomplete="off"></label>
      <label class="f"><span>ChatGPT (OpenAI) API key</span><input type="password" id="openaiKey" value="${esc(c.openaiKey)}" placeholder="sk-…" autocomplete="off"><small>From platform.openai.com/api-keys (needs credit on your OpenAI account)${!c.openaiKey && c.geminiKey ? '. Until you add it, your old Gemini key is used.' : ''}</small></label>
      <label class="f"><span>Apify token</span><input type="password" id="apifyToken" value="${esc(c.apifyToken)}" autocomplete="off"></label></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary" id="sv">Save</button>${['sheet', 'gmail', 'openai', 'apify'].map(w => `<button class="btn" data-t="${w}">Test ${w === 'sheet' ? 'Google Sheet' : w === 'gmail' ? 'Gmail' : w === 'openai' ? 'ChatGPT' : 'Apify'}</button>`).join('')}</div><div id="msg" style="margin-top:14px"></div></div>`;
  const save = async () => { const b = {}; for (const id of ['sheetUrl', 'gmailUser', 'gmailAppPassword', 'openaiKey', 'apifyToken']) b[id] = $('#' + id).value.trim(); await api('/connections', { method: 'POST', body: b }); };
  $('#sv').onclick = e => busy(e.currentTarget, async () => { await save(); toast('Saved'); });
  $$('[data-t]').forEach(b => b.onclick = () => busy(b, async () => { try { await save(); const r = await api('/connections/test', { method: 'POST', body: { what: b.dataset.t } }); $('#msg').innerHTML = `<div class="notice ok">${esc(r.msg)}</div>`; } catch (err) { $('#msg').innerHTML = `<div class="notice err">${esc(err.message)}</div>`; } }));
  // extra sending inboxes: more inboxes = more emails a day without pushing any one account too hard
  const ib = document.createElement('div'); ib.className = 'panel'; ib.style.marginTop = '18px';
  ib.innerHTML = `<h3 style="margin-top:0">Extra sending inboxes</h3>
    <div class="how">Each inbox sends its own daily amount (starts at 20 a day and grows every week), so 3 inboxes send about 3× as many pitches without any single account looking like spam. Best: Google Workspace inboxes on a <b>separate domain</b> just for outreach. For each inbox: turn on 2-Step Verification, create an <b>App Password</b>, and turn on IMAP in Gmail settings.</div>
    ${(c.inboxes || []).length ? `<div class="tablewrap" style="margin:10px 0"><table><thead><tr><th>Inbox</th><th>Added</th><th></th></tr></thead><tbody>${c.inboxes.map(x => `<tr><td>${esc(x.user)}</td><td>${esc(x.added)}</td><td style="text-align:right"><button class="btn sm ghost" data-rm="${esc(x.user)}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="sub">Only the main Gmail above is sending right now.</p>'}
    <div class="row2"><label class="f"><span>Inbox email</span><input type="email" id="ibU" placeholder="sales@your-outreach-domain.com" autocomplete="off"></label>
    <label class="f"><span>App password (16 letters)</span><input type="password" id="ibP" placeholder="abcd efgh ijkl mnop" autocomplete="off"></label></div>
    <button class="btn primary" id="ibAdd">Test &amp; add inbox</button><div id="ibMsg" style="margin-top:12px"></div>`;
  el.appendChild(ib);
  $('#ibAdd').onclick = e => busy(e.currentTarget, async () => { try { const r = await api('/connections/inboxes', { method: 'POST', body: { user: $('#ibU').value, pass: $('#ibP').value } }); toast(r.msg); route(); } catch (err) { $('#ibMsg').innerHTML = `<div class="notice err">${esc(err.message)}</div>`; } });
  $$('[data-rm]', ib).forEach(b => b.onclick = () => busy(b, async () => { if (!confirm('Stop sending from ' + b.dataset.rm + '? Replies to its emails will no longer be read.')) return; await api('/connections/inboxes/' + encodeURIComponent(b.dataset.rm), { method: 'DELETE' }); toast('Removed'); route(); }));
  $('#rk').onclick = e => { e.preventDefault(); $('#saFile').click(); };
  $('#saFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { await api('/connections', { method: 'POST', body: { serviceAccountJson: await f.text() } }); toast('Key replaced'); route(); } catch (err) { toast(err.message, true); } };
}
async function pageAccount(el) {
  el.innerHTML = head('My account', `${esc(S.me.name)} · ${ROLE_NAME[S.me.role]}`, '<button class="btn" id="lo">Log out</button>') +
    `<div class="panel" style="max-width:520px"><h2>Change password</h2><div class="desc"></div><label class="f"><span>Current password</span><input type="password" id="c" autocomplete="current-password"></label><label class="f"><span>New password (8+)</span><input type="password" id="n" autocomplete="new-password"></label><button class="btn primary" id="sv">Change password</button></div>`;
  $('#lo').onclick = async () => { await api('/logout', { method: 'POST' }); S.me = null; location.hash = '#/login'; route(); };
  $('#sv').onclick = e => busy(e.currentTarget, async () => { await api('/me/password', { method: 'POST', body: { current: $('#c').value, next: $('#n').value } }); toast('Password changed'); $('#c').value = $('#n').value = ''; });
}

route();
setInterval(() => { const p = location.hash.replace(/^#\/?/, '') || 'dashboard'; if (S.me && ['dashboard', 'activity'].includes(p) && !document.querySelector('#scrim')) route(); }, 120000);
