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

/* ------------------------------------------------------------ brand (any company) */
const BR = () => (S.state && S.state.brand) || { name: 'AAVORAA', tagline: 'Beyond Possibilities', logo: '' };
const isAav = () => String(BR().name || '').trim().toUpperCase() === 'AAVORAA';
const brandWord = () => isAav() ? '<span class="wordmark" aria-label="AAVORAA">ΛΛVORΛΛ</span>' : `<span class="wordmark plain">${esc(BR().name)}</span>`;
const brandMark = cls => BR().logo ? `<img class="${cls}" src="${esc(BR().logo)}" alt="">` : isAav() ? `<img class="${cls}" src="/logo-mark.png" alt="">` : `<span class="${cls} initial">${esc(String(BR().name || 'L').trim().charAt(0).toUpperCase())}</span>`;
const brandWordBig = () => isAav() ? '<span class="word" aria-label="AAVORAA">ΛΛVORΛΛ</span>' : `<span class="word plain">${esc(BR().name)}</span>`;

/* ------------------------------------------------------------ routing */
const PAGES = {
  dashboard: { title: 'Dashboard', ic: '◈', roles: ['owner', 'leader', 'linkedin'], render: pageDashboard, sec: 'Work' },
  linkedin: { title: 'LinkedIn tasks', ic: 'in', roles: ['owner', 'leader', 'linkedin'], render: pageLinkedIn, sec: 'Work' },
  calls: { title: 'Call / WhatsApp', ic: '☎', roles: ['owner', 'leader', 'linkedin'], render: pageCalls, sec: 'Work' },
  replies: { title: 'Replies from client', ic: '↩', roles: ['owner', 'leader', 'linkedin'], render: pageReplies, sec: 'Work' },
  interested: { title: 'Interested leads', ic: '★', roles: ['owner', 'leader'], render: el => pageQualified(el, 'interested'), sec: 'Work' },
  qualified: { title: 'Qualified leads', ic: '✓', roles: ['owner', 'leader'], render: el => pageQualified(el, 'qualified'), sec: 'Work' },
  leads: { title: 'All email leads', ic: '✉', roles: ['owner', 'leader'], render: pageLeads, sec: 'Work' },
  profiles: { title: 'Products & services', ic: '◆', roles: ['owner', 'leader'], render: pageProfiles, sec: 'Grow' },
  social: { title: 'Social media', ic: '✦', roles: ['owner', 'leader', 'linkedin'], render: pageSocial, sec: 'Grow' },
  import: { title: 'Import leads', ic: '⇪', roles: ['owner', 'leader'], render: pageImport, sec: 'Grow' },
  templates: { title: 'Templates & tone', ic: '✎', roles: ['owner', 'leader'], render: pageTemplates, sec: 'Grow' },
  settings: { title: 'Settings', ic: '⚙', roles: ['owner', 'leader'], render: pageSettings, sec: 'Manage' },
  activity: { title: 'Agent activity', ic: '◷', roles: ['owner', 'leader'], render: pageActivity, sec: 'Manage' },
  team: { title: 'Team & logins', ic: '◎', roles: ['owner'], render: pageTeam, sec: 'Manage' },
  usage: { title: 'Tokens & usage', ic: '◔', roles: ['owner', 'leader'], render: pageUsage, sec: 'Manage' },
  bills: { title: 'Bills & payments', ic: '₹', roles: ['owner'], render: pageBills, sec: 'Manage' },
  connections: { title: 'Connections', ic: '⇄', roles: ['owner'], render: pageConnections, sec: 'Manage' },
  account: { title: 'My account', ic: '○', roles: ['owner', 'leader', 'linkedin'], render: pageAccount, hidden: true },
};
async function route() {
  try { S.state = await api('/state'); } catch (e) { root().innerHTML = `<div class="center"><div class="authcard"><span class="word">Lead Agent</span><p class="notice err">Cannot reach the agent: ${esc(e.message)}</p></div></div>`; return; }
  S.me = S.state.user;
  const page = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'dashboard';
  if (!S.state.configured || S.state.needsOwner) return S.state.isLocal ? pageSetup() : pageNotReady();
  if (!S.me) return pageLogin();
  const p = PAGES[page];
  if (!p || !p.roles.includes(S.me.role)) { location.hash = '#/' + (S.me.role === 'linkedin' ? 'linkedin' : 'dashboard'); return; }
  // same page again (auto refresh, Refresh button): keep the layout and scroll position, no flash, no replayed animations
  const same = page === S.lastPage && $('#page') && $('.shell');
  S.lastPage = page;
  document.body.classList.toggle('refreshing', !!same);
  const y = window.scrollY, h = same ? $('#page').offsetHeight : 0;
  if (!same) shell(page); else $('#page').style.minHeight = h + 'px';
  try { await p.render($('#page')); } catch (e) { $('#page').innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
  if (same) { $('#page').style.minHeight = ''; window.scrollTo(0, y); } else window.scrollTo(0, 0);
  if (!same) countUp(); autoSeen(); drawBadges(); startNotify();
}
window.addEventListener('hashchange', route);
// the person is writing something (typed text not sent yet, or a box is open): never re-draw the page under them
const typing = () => !!document.querySelector('#scrim') || $$('#page textarea, #page input[type=text], #page input[type=email]').some(t => t.matches(':focus') || (t.value.trim() && t.value !== t.defaultValue));
// KPI numbers count up when a page opens (motion), e.g. 0 -> 1,284
function countUp() {
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const el of $$('.kpi .value')) {
    const m = el.textContent.match(/^([\d,]+)(.*)$/); if (!m) continue;
    const end = Number(m[1].replace(/,/g, '')), rest = m[2]; if (!end || end > 1e7) continue;
    const t0 = performance.now(), dur = 900;
    const tick = now => { const k = Math.min(1, (now - t0) / dur), v = Math.round(end * (1 - Math.pow(1 - k, 3))); el.textContent = v.toLocaleString('en-IN') + rest; if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
}

/* ------------------------------------------------------------ notifications: red badges, pop sound, pop-up */
// A red circle with the number of new items sits on the menu item (and tab) where they arrived; it clears when you open it.
// Each new client reply or qualified lead plays a short "pop" and shows a Windows pop-up.
const N = { data: null, seen: null, known: null, user: '', timer: null };
const NSECS = ['gmail', 'linkedin', 'qualified', 'accepted', 'alarm'];
const NLABEL = { gmail: 'New Gmail reply', linkedin: 'New LinkedIn reply', qualified: 'New interested lead (Hot / Warm)', accepted: 'Accepted on LinkedIn', alarm: '⚠ ALARM' };
const NPAGE = { gmail: 'replies', linkedin: 'replies', qualified: 'interested', accepted: 'linkedin', alarm: 'dashboard' };
const seenKey = () => 'aav_seen_' + ((S.me && (S.me.username || S.me.name)) || '');
const store_ = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
const unseen = sec => (N.data && N.data[sec] || []).filter(x => !(N.seen && (N.seen[sec] || []).includes(x.id)));
function markSeen(sec) { if (!N.data || !N.seen || !N.data[sec]) return; N.seen[sec] = N.data[sec].map(x => x.id); store_.set(seenKey(), N.seen); drawBadges(); }
// what you are looking at right now counts as seen (only while the window is really in front of you)
function autoSeen() {
  if (!N.data || document.visibilityState !== 'visible' || !document.hasFocus()) return;
  const page = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'dashboard';
  if (page === 'interested') markSeen('qualified');
  if (page === 'linkedin') markSeen('accepted');
  if (page === 'dashboard') markSeen('alarm');
  if (page === 'replies') markSeen(S.me.role === 'linkedin' ? 'linkedin' : (sessionStorage.getItem('rp_src') || 'gmail'));
}
function badgeOn(el, n) {
  if (!el) return; let b = $('.nbadge', el);
  if (!n) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('span'); b.className = 'nbadge'; el.appendChild(b); }
  b.textContent = n > 99 ? '99+' : n; b.title = n + ' new';
}
function drawBadges() {
  const g = unseen('gmail').length, l = unseen('linkedin').length, q = unseen('qualified').length, a = unseen('accepted').length;
  badgeOn($('.nav a[href="#/replies"]'), g + l); badgeOn($('.nav a[href="#/interested"]'), q); badgeOn($('.nav a[href="#/linkedin"]'), a); const al = unseen('alarm').length; badgeOn($('.nav a[href="#/dashboard"]'), al);
  badgeOn($('.head .seg button[data-s="gmail"]'), g); badgeOn($('.head .seg button[data-s="linkedin"]'), l);
  badgeOn($('#menuBtn'), g + l + q + a + al);
  const total = g + l + q + a + al;
  document.title = (total ? `(${total}) ` : '') + BR().name + ' Lead Agent';
  if (window.aavDesktop) window.aavDesktop.badge(total);
}
let actx = null;
function pop() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(300, t + 0.12);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.22);
  } catch (e) {}
}
function siren() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    for (let k = 0; k < 3; k++) {
      const t = actx.currentTime + k * 0.32, o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(660, t + 0.14);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.3);
    }
  } catch (e) {}
}
function popup(items) {
  const one = items.length === 1, x = items[0];
  const title = one ? `${NLABEL[x.sec]}: ${x.who || ''}` : `${items.length} new: ` + NSECS.map(s => [s, items.filter(i => i.sec === s).length]).filter(a => a[1]).map(([s, n]) => `${n} ${s === 'qualified' ? 'interested' : s === 'gmail' ? 'Gmail' : s === 'accepted' ? 'accepted on LinkedIn' : s === 'alarm' ? 'ALARM' : 'LinkedIn'}`).join(', ');
  const body = one ? x.text || '' : items.slice(0, 3).map(i => `${i.who}: ${i.text}`).join('\n');
  const page = NPAGE[x.sec];
  if (window.aavDesktop) return window.aavDesktop.notify({ title, body, page, src: x.sec });
  toast(title);
  try { if ('Notification' in window && Notification.permission === 'granted') { const n = new Notification(title, { body, silent: true }); n.onclick = () => { window.focus(); if (NPAGE[x.sec] === 'replies') sessionStorage.setItem('rp_src', x.sec); location.hash = '#/' + page; }; } } catch (e) {}
}
async function pollNotify() {
  if (!S.me) return;
  let d; try { d = await api('/notify'); } catch (e) { return; }
  N.data = d;
  if (N.user !== seenKey()) { N.user = seenKey(); N.seen = store_.get(seenKey()); N.known = null; if (!N.seen) N.seen = {}; }
  // a section seen for the first time (new user or new kind of alert) starts with everything already there counted as seen
  if (NSECS.some(s => !N.seen[s] && d[s])) { NSECS.forEach(s => { if (!N.seen[s] && d[s]) N.seen[s] = d[s].map(x => x.id); }); store_.set(seenKey(), N.seen); }
  const fresh = [];
  if (N.known) for (const s of NSECS) for (const x of d[s] || []) if (!N.known[s].has(x.id) && !(N.seen[s] || []).includes(x.id)) fresh.push({ sec: s, ...x });
  N.known = {}; NSECS.forEach(s => N.known[s] = new Set((d[s] || []).map(x => x.id)));
  if (fresh.length) {
    if (fresh.some(f => f.sec === 'alarm')) siren(); else pop(); popup(fresh);
    // refresh the page you are on if the new item belongs there and you are not typing
    const page = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'dashboard';
    if (fresh.some(f => NPAGE[f.sec] === page) && !typing()) { route(); return; }
  }
  autoSeen(); drawBadges();
}
function startNotify() {
  if (N.timer || !S.me) return;
  try { if (!window.aavDesktop && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
  pollNotify(); N.timer = setInterval(pollNotify, 20000);
}
window.addEventListener('focus', () => { autoSeen(); drawBadges(); });
document.addEventListener('visibilitychange', () => { autoSeen(); drawBadges(); });
if (window.aavDesktop && window.aavDesktop.onOpen) window.aavDesktop.onOpen(o => { if (o.page === 'replies' && o.src) sessionStorage.setItem('rp_src', o.src); if (location.hash === '#/' + o.page) route(); else location.hash = '#/' + o.page; });

function shell(active) {
  let nav = '', sec = '';
  for (const [id, p] of Object.entries(PAGES)) {
    if (p.hidden || !p.roles.includes(S.me.role)) continue;
    if (p.sec !== sec) { sec = p.sec; nav += `<div class="sec">${sec}</div>`; }
    nav += `<a href="#/${id}" class="${id === active ? 'on' : ''}"><span class="ic">${p.ic}</span>${p.title}</a>`;
  }
  root().innerHTML = `<div class="shell">
    <aside class="side" id="side"><div class="brand">${brandMark('mark')}${brandWord()}${BR().tagline ? `<span class="tagline">${esc(BR().tagline)}</span>` : ''}<small>Lead Agent</small></div>
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
  const done = { 1: conn.storage === 'supabase' ? !!conn.supabaseUrl && !!conn.supabaseKey : !!conn.serviceAccountEmail && !!conn.sheetUrl, 2: !!conn.gmailUser && !!conn.gmailAppPassword, 3: !!(conn.openaiKey || conn.geminiKey), 4: true };
  const names = ['Google Sheet', 'Gmail', 'Free AI (Gemini)', 'Lead finding', 'Owner account'];
  const go = n => { sessionStorage.setItem('aav_step', n); pageSetup(); };
  const body = {
    1: `<h2>1. Connect your Google Sheet</h2>
      <div class="how">Leads, settings, templates and logins are all saved in one Google Sheet you own. One-time setup, about 10 minutes:
      <ol><li>Create a new, empty Google Sheet (sheets.new) while signed in with your company Google account and copy its link.</li>
      <li>Open <b>console.cloud.google.com</b> → New project → name it <code>Lead Agent</code>.</li>
      <li>APIs &amp; Services → Library → search <b>Google Sheets API</b> → Enable.</li>
      <li>APIs &amp; Services → Credentials → Create credentials → <b>Service account</b> → name <code>lead-agent</code> → Done.</li>
      <li>Click the new service account → Keys → Add key → Create new key → <b>JSON</b>. A file downloads. Upload it below.</li>
      <li>In your Google Sheet click <b>Share</b> and add the service account email (shown below after upload) as <b>Editor</b>.</li></ol></div>
      <label class="f"><span>Google Sheet link</span><input type="url" id="sheetUrl" value="${esc(conn.sheetUrl || '')}" placeholder="https://docs.google.com/spreadsheets/d/…"></label>
      <label class="f"><span>Service account key (.json file)</span><div class="drop" id="drop">${conn.serviceAccountEmail ? '✓ Key saved. Click to replace.' : 'Click to choose the .json file, or drop it here'}</div><input type="file" id="saFile" accept=".json,application/json" class="hidden"></label>
      ${conn.serviceAccountEmail ? `<div class="notice">Share your Google Sheet with this email as <b>Editor</b>: <code>${esc(conn.serviceAccountEmail)}</code> <button class="copy" data-c="${esc(conn.serviceAccountEmail)}">Copy</button></div>` : ''}
      <div class="sub" style="margin:10px 0">Prefer a database? You can use <b>Supabase</b> instead: finish setup, then open <b>Connections → Data storage</b>.</div>`,
    2: `<h2>2. Connect your sending Gmail</h2>
      <div class="how">The agent sends and reads email with a Gmail <b>App Password</b> (safer than your real password, and you can cancel it any time).
      <ol><li>Open <b>myaccount.google.com</b> signed in to your sending Gmail → Security → turn on <b>2-Step Verification</b>.</li>
      <li>Search <b>App passwords</b> at the top of that page → app name <code>Lead Agent</code> → Create.</li>
      <li>Copy the 16-letter password and paste it below.</li>
      <li>In Gmail → Settings → See all settings → Forwarding and POP/IMAP → <b>Enable IMAP</b> → Save.</li></ol></div>
      <div class="row2"><label class="f"><span>Gmail address</span><input type="email" id="gmailUser" value="${esc(conn.gmailUser || '')}" placeholder="sales@yourcompany.com"></label>
      <label class="f"><span>App password (16 letters)</span><input type="password" id="gmailAppPassword" value="${esc(conn.gmailAppPassword || '')}" placeholder="abcd efgh ijkl mnop" autocomplete="off"></label></div>`,
    3: `<h2>3. Free AI: Google Gemini (optional)</h2>
      <div class="how">Gemini writes the emails and replies. The key is <b>free</b>, no card needed.<ol><li>Open <b>aistudio.google.com/apikey</b> and sign in with any Google account.</li><li>Click <b>Create API key</b> → copy it and paste it below.</li></ol>The free key allows a limited number of requests a day. When they are used up, or if you skip this, the app uses your email templates instead.</div>
      <label class="f"><span>Gemini API key (free)</span><input type="password" id="geminiKey" value="${esc(conn.geminiKey || '')}" autocomplete="off"></label>`,
    4: `<h2>4. Lead finding (free)</h2>
      <div class="how">Nothing to set up. The app finds businesses on <b>OpenStreetMap</b> (free open map data) and with a free web search, and finds LinkedIn prospects the same way. No key and no payment.</div>`,
    5: `<h2>5. Create your owner login</h2>
      <div class="how">This is your login. You can add your team (Team Leader, LinkedIn Executive) afterwards under <b>Team &amp; logins</b>.</div>
      <div class="row2"><label class="f"><span>Your name</span><input type="text" id="oName" value="Rennie Priya"></label><label class="f"><span>Username</span><input type="text" id="oUser" value="rennie" autocomplete="username"></label></div>
      <label class="f"><span>Password (8+ characters)</span><input type="password" id="oPass" autocomplete="new-password"></label>`,
  };
  root().innerHTML = `<div class="center"><div class="wizard panel" style="padding:30px">
    <span class="word">Lead Agent</span> <span class="sub" style="letter-spacing:.2em;text-transform:uppercase;margin-left:8px">first-time setup</span>
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
    for (const id of ['sheetUrl', 'gmailUser', 'gmailAppPassword', 'geminiKey']) if ($('#' + id)) b[id] = $('#' + id).value.trim();
    if (step === 3) b.aiProvider = 'gemini';
    await api('/connections', { method: 'POST', body: b });
  };
  const testName = { 1: 'sheet', 2: 'gmail', 3: 'gemini', 4: 'free' }[step];
  const test = async () => { await save(); if (step === 3 && !$('#geminiKey').value.trim()) { msg('No key: the app uses your templates. You can add a free Gemini key later on the Connections page.', 'ok'); return {}; } const r = await api('/connections/test', { method: 'POST', body: { what: testName } }); msg(r.msg, 'ok'); return r; };
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
function pageNotReady() { root().innerHTML = `<div class="center"><div class="authcard"><div class="halo">${brandMark('')}</div>${brandWordBig()}<div class="tag2">${BR().tagline ? esc(BR().tagline) + ' · ' : ''}Lead Agent</div><div class="notice">The owner hasn't finished setting up the app on the main PC yet.</div></div></div>`; }

/* ------------------------------------------------------------ login */
function pageLogin() {
  root().innerHTML = `<div class="center"><form class="authcard" id="lf"><div class="halo">${brandMark('')}</div>${brandWordBig()}<div class="tag2">${BR().tagline ? esc(BR().tagline) + ' · ' : ''}Lead Agent</div>
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
      ${isOwner ? `<button class="btn primary" id="pitchAll" title="Pitch everyone waiting on email, LinkedIn and WhatsApp, within the safe daily limits">⚡ Pitch everything now</button>` : ''}
      ${isOwner ? `<label class="switch" style="margin-left:auto"><input type="checkbox" id="onoff" ${a.on ? 'checked' : ''}><i></i><span>${a.on ? 'ON' : 'OFF'}</span></label>` : ''}</div>
    <section class="kpis">
      ${kpi('Leads found', fmt(t.raw + t.linkedin), `+${fmt(last7('found'))} in 7 days`, '', 'leads')}
      ${kpi('Emailed', fmt(t.emailed), `${fmt(t.waiting)} waiting · ${fmt(t.bounced)} bounced`, '', 'leads')}
      ${kpi('Replies', fmt(t.replied), `from people (${fmt(t.repliedEmail)} email · ${fmt(t.repliedLinkedIn)} LinkedIn) · ${pct(t.replied, t.emailed)} reply rate${t.waitingAnswer ? ` · <b>${fmt(t.waitingAnswer)} waiting for you</b>` : ''}${t.automatic ? ` · ${fmt(t.automatic)} automatic messages` : ''}`, '', 'replies')}
      ${kpi('Qualified leads', fmt(t.qualified), `confirmed, ready to work · ${fmt(t.interested)} interested (hot / warm)`, 'gold', 'qualified')}
      ${kpi('LinkedIn to connect', fmt(t.linkedinToConnect), `${fmt(t.linkedin)} prospects total`, '', 'linkedin')}
      <div class="kpi go" data-go="activity" role="link" tabindex="0" title="Open Agent activity"><div class="label">Emails sent today</div><div class="value">${fmt(a.sentToday)} / ${fmt(a.todayLimit)}</div><div class="bar"><i style="width:${Math.min(100, a.todayLimit ? a.sentToday / a.todayLimit * 100 : 0)}%"></i></div><div class="hint">limit grows each week</div></div>
    </section>
    <section id="limitsBox"></section>
    <section class="grid"><div class="panel"><h2>Last 14 days</h2><div class="desc">What the agent did each day</div><div class="legend" id="lg"></div><div id="chart" style="height:240px"></div></div>
      <div class="panel"><h2>Pipeline</h2><div class="desc">From found to qualified, all time</div>${funnel([['Leads found', t.raw], ['Email found', t.withEmail], ['Emailed', t.emailed], ['Replied (people)', t.replied], ['Interested', t.interested + t.qualified], ['Qualified', t.qualified]])}
      <div class="sub" style="margin-top:12px">Reply rate ${pct(t.replied, t.emailed)} · Interested from replies ${pct(t.interested + t.qualified, t.replied)} · Qualified from interested ${pct(t.qualified, t.interested + t.qualified)}</div></div></section>
    <section class="grid3"><div class="panel"><h2>Lead status</h2><div class="desc">Email leads</div>${blist(d.rawStatus, '#7a1f35', 8)}</div>
      <div class="panel"><h2>Services in demand</h2><div class="desc">${t.qualified ? 'What qualified leads want' : 'Best-fit service picked by AI'}</div>${blist(d.services, '#5b7a5f')}</div>
      <div class="panel"><h2>Newest qualified leads</h2><div class="desc">Confirmed after the call: ready to work with ${esc(BR().name)}</div>${d.recentQualified.length ? d.recentQualified.map(q => `<div class="field"><div class="strong">${esc(q['Business Name'] || q['Contact Name'])} ${tag(q['Lead Score'])}</div><div class="sub">${esc(q['Service Needed'])} · ${esc(q.Source)} · ${esc(q['Date Qualified'])}</div></div>`).join('') : '<div class="sub">None yet. They appear when someone says yes.</div>'}</div></section>`;
  chart($('#chart'), $('#lg'), s);
  if (S.me.role !== 'linkedin') renderLimits($('#limitsBox'), ['email', 'linkedin', 'whatsapp'], { email: a.sentToday, emailToday: a.todayLimit });
  if (S.me.role !== 'linkedin') dashExtras(el, isOwner);
  $('#rf').onclick = () => route();
  $$('.kpi.go[data-go]').forEach(k => { const go = () => { if (k.dataset.go === 'replies') { sessionStorage.setItem('rp_src', 'gmail'); sessionStorage.setItem('rp_view', 'all'); } location.hash = '#/' + k.dataset.go; }; k.onclick = go; k.onkeydown = e => { if (e.key === 'Enter') go(); }; });
  if ($('#pitchAll')) $('#pitchAll').onclick = e => { if (!confirm('Pitch everyone waiting now?\n\n• Email: imported leads first, then all waiting leads and follow-ups\n• LinkedIn: connection requests + prepared messages\n• WhatsApp: approved template (if connected)\n\nAll within the safe daily limits.')) return; busy(e.currentTarget, async () => { const r = await api('/pitch/all', { method: 'POST', body: {} }); modal('Pitching everything', `<div class="msg" style="white-space:pre-wrap">${esc(r.text)}</div>`, '<a class="btn primary" href="#/activity" onclick="closeLayer()">See progress</a>'); }); };
  if ($('#onoff')) $('#onoff').onchange = async e => { try { await api('/agent/toggle', { method: 'POST', body: { on: e.target.checked } }); toast(e.target.checked ? 'Agent switched ON' : 'Agent paused'); route(); } catch (err) { toast(err.message, true); } };
}
// Alarms (problems to look at), sending inboxes (auto-switch + how many are needed), today's lead target
async function dashExtras(el, isOwner) {
  const box = document.createElement('section'); box.className = 'grid'; box.style.marginTop = '18px'; el.appendChild(box);
  const [al, ib, us] = await Promise.all([api('/alarms').catch(() => []), api('/inboxes').catch(() => null), api('/usage').catch(() => null)]);
  const when = iso => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  box.innerHTML = `<div class="panel alarmpanel"><h2>⚠ Alarms ${al.length ? `<span class="tag red">${al.length}</span>` : ''}</h2><div class="desc">Emails not delivered (address not found), inboxes paused, replies that could not be sent</div>
      ${al.length ? `<div class="alarms">${al.slice(0, 12).map(a => `<div class="alarm ${esc(a.kind)}"><div class="strong">${esc(a.title)}</div><div class="sub">${esc(a.text)}</div><div class="sub">${when(a.at)}</div></div>`).join('')}</div>${isOwner || S.me.role === 'leader' ? '<button class="btn sm ghost" id="clrAl" style="margin-top:10px">Clear all alarms</button>' : ''}` : '<div class="sub">✓ No problems. Everything is running.</div>'}</div>
    <div class="panel"><h2>Sending inboxes</h2><div class="desc">${ib && ib.order === 'one-by-one' ? 'One by one: each inbox sends until its own daily limit, then the next takes over' : 'Every inbox sends a little all day'}; an inbox with a problem is paused and the others take over. ${ib ? `Today: up to <b>${fmt(ib.capacity)}</b> emails across ${ib.list.length} inboxes.` : ''}</div>
      ${ib ? `<div class="ilist">${ib.list.map(i => `<div class="irow"><span class="dot ${i.paused ? 'off' : 'on'}"></span><div style="flex:1;min-width:0"><div class="strong" style="overflow:hidden;text-overflow:ellipsis">${ib.order === 'one-by-one' ? i.order + '. ' : ''}${esc(i.user)}${i.main ? ' <span class="sub">(main)</span>' : ''}${ib.active === i.user ? ' <span class="tag green">sending now</span>' : ''}</div><div class="sub">${i.paused ? `Paused: ${esc(i.reason)} (until ${when(i.pausedUntil)})` : `Sent today ${i.sentToday} / ${i.limit}${i.sentToday >= i.limit ? ' · <b>full for today</b>, the other inboxes take over' : ''}`}</div></div>${i.paused && isOwner ? `<button class="btn sm" data-resume="${esc(i.user)}">Resume</button>` : ''}</div>${isOwner ? `<div class="ilim" data-ilim="${esc(i.user)}"><label>Per day <input type="number" min="1" max="500" value="${esc(i.perDay)}" placeholder="${esc(ib.perInbox)}"></label><select title="Warm-up"><option value="" ${!i.warmup ? 'selected' : ''}>Warm-up: as in Settings</option><option value="no" ${i.warmup === 'no' ? 'selected' : ''}>Old account: full from day one</option><option value="yes" ${i.warmup === 'yes' ? 'selected' : ''}>New account: warm up slowly</option></select><button class="btn sm">Save</button></div>` : ''}`).join('')}</div>
      ${(ib.wa || []).length ? `<h3 style="margin:14px 0 6px">WhatsApp numbers</h3><div class="ilist">${ib.wa.map(n => `<div class="irow"><span class="dot ${n.paused ? 'off' : 'on'}"></span><div style="flex:1;min-width:0"><div class="strong">${esc(n.label)}${n.main ? ' <span class="sub">(main)</span>' : ''}</div><div class="sub">${n.paused ? `Paused: ${esc(n.reason)} (until ${when(n.pausedUntil)})` : `Sent today ${n.sentToday} / ${n.limit}${n.sentToday >= n.limit ? ' · <b>full for today</b>, the other numbers take over' : ''}`}</div></div>${n.paused && isOwner ? `<button class="btn sm" data-waresume="${esc(n.id)}">Resume</button>` : ''}</div>`).join('')}</div>` : ''}
      <div class="notice" style="margin-top:12px">Your target: <b>${fmt(ib.target)}</b> emails a day. Your ${ib.list.length} inboxes can send <b>${fmt(ib.capacity)}</b> today.${ib.capacity < ib.target ? ` To reach the target, add about ${Math.ceil((ib.target - ib.capacity) / 100)} more old Gmail account(s) at 100 a day (Connections → Extra sending inboxes), or raise an inbox's "Per day" above.` : ' ✓ Enough to reach the target.'}</div>` : '<div class="sub">–</div>'}</div>
    ${us ? `<div class="panel"><h2>Leads today</h2><div class="desc">Daily target and best-fit leads · click a card to see the leads</div>
      <div class="kpis" style="grid-template-columns:1fr 1fr;margin:0"><div class="kpi go" data-lv="today" role="link" tabindex="0" title="See the leads found today"><div class="label">Leads found today</div><div class="value">${fmt(us.leads.today)} / ${fmt(us.leads.target)}</div><div class="bar"><i style="width:${Math.min(100, us.leads.target ? us.leads.today / us.leads.target * 100 : 0)}%"></i></div></div>
      <div class="kpi gold go" data-lv="quality-today" role="link" tabindex="0" title="See today's best-fit leads"><div class="label">★ Best-fit (quality) leads today</div><div class="value">${fmt(us.leads.qualityToday)}</div><div class="hint">target ${us.leads.qualityTarget} · good match, not contacted yet</div></div></div></div>
    <div class="panel"><h2>Tokens today</h2><div class="desc">Full details on <a href="#/usage">Tokens &amp; usage</a></div>
      ${tokbar('AI requests', us.ai.requestsToday, us.ai.limit)}${tokbar('Emails', us.mail.sentToday, us.mail.capacityToday)}<div class="sub" style="margin-top:8px">${fmt(us.ai.tokensToday)} AI tokens today · about ${fmt(us.perLead.tokens)} tokens per lead</div></div>` : ''}`;
  $$('[data-lv]', box).forEach(k => { const go = () => { try { sessionStorage.setItem('leads_view', k.dataset.lv); } catch (e) {} location.hash = '#/leads'; }; k.onclick = go; k.onkeydown = e => { if (e.key === 'Enter') go(); }; });
  if ($('#clrAl')) $('#clrAl').onclick = e => busy(e.currentTarget, async () => { if (!confirm('Clear all alarms?')) return; await api('/alarms', { method: 'DELETE' }); route(); });
  $$('[data-ilim]').forEach(row => { const b = $('button', row); b.onclick = () => busy(b, async () => { await api('/inboxes/' + encodeURIComponent(row.dataset.ilim), { method: 'PATCH', body: { perDay: $('input', row).value, warmup: $('select', row).value } }); toast('Saved: ' + row.dataset.ilim); route(); }); });
  $$('[data-waresume]').forEach(b => b.onclick = () => busy(b, async () => { await api('/wa-numbers/' + encodeURIComponent(b.dataset.waresume) + '/resume', { method: 'POST', body: {} }); toast('WhatsApp number resumed'); route(); }));
  $$('[data-resume]').forEach(b => b.onclick = () => busy(b, async () => { await api('/inboxes/' + encodeURIComponent(b.dataset.resume) + '/resume', { method: 'POST', body: {} }); toast('Inbox resumed'); route(); }));
}
const tokbar = (l, used, max) => `<div style="margin-top:10px"><div class="sub" style="display:flex"><span>${l}</span><span style="margin-left:auto">${fmt(used)} used · ${fmt(Math.max(0, max - used))} left</span></div><div class="bar"><i style="width:${Math.min(100, max ? used / max * 100 : 0)}%"></i></div></div>`;

// Token & usage dashboard: AI (ChatGPT / Gemini), mail, lead platforms - combined, and per lead
async function pageUsage(el) {
  const u = await api('/usage');
  const SRC = { osm: 'OpenStreetMap', ddg: 'Web search (DuckDuckGo)', googlePlaces: 'Google Places', tomtom: 'TomTom', geoapify: 'Geoapify', here: 'HERE', apify: 'Apify' };
  const maxS = Math.max(1, ...u.series.map(d => d.tokens));
  el.innerHTML = head('Tokens & usage', 'Everything the app uses (AI, email, lead platforms) in one place, and what one lead costs on average.') +
    `<section class="kpis">
      ${kpi('AI requests left today', fmt(u.ai.requestsLeft), `${fmt(u.ai.requestsToday)} used of ${fmt(u.ai.limit)} · ${esc(u.ai.provider)}`)}
      ${kpi('AI tokens used', fmt(u.ai.tokensToday), `${fmt(u.ai.tokens7)} in 7 days · ${fmt(u.ai.tokens30)} in 30 days`)}
      ${kpi('Emails left today', fmt(Math.max(0, u.mail.capacityToday - u.mail.sentToday)), `${fmt(u.mail.sentToday)} sent of ${fmt(u.mail.capacityToday)} · ${u.mail.inboxes} inboxes${u.mail.paused ? ', ' + u.mail.paused + ' paused' : ''}`)}
      ${kpi('Platform searches', fmt(u.platform.searchesToday), `${fmt(u.platform.searches30)} in 30 days`)}
      ${kpi('Tokens per lead', fmt(u.perLead.tokens), `${u.perLead.aiRequests} AI requests · ${u.perLead.searches} searches · ${u.perLead.emails} emails per lead (30 days)`, 'gold')}
      ${kpi('Leads (30 days)', fmt(u.leads.found30), `${fmt(u.leads.analysed30)} analysed by the AI agent`)}
    </section>
    <section class="grid"><div class="panel"><h2>AI tokens, last 14 days</h2><div class="desc">Every AI request the app made (writing emails, replies, analysing leads)</div>
      <div class="bars">${u.series.map(d => `<div class="bcol" title="${d.day}: ${fmt(d.tokens)} tokens, ${d.ai} requests, ${d.sent} emails, ${d.leads} leads"><i style="height:${Math.max(2, d.tokens / maxS * 100)}%"></i><span>${d.day.slice(8)}</span></div>`).join('')}</div></div>
      <div class="panel"><h2>Free AI models</h2><div class="desc">When one model's free requests run out, the next one is used</div>
      ${(u.ai.models || []).length ? (u.ai.models || []).map(m => `<div class="irow"><span class="dot ${m.free ? 'on' : 'off'}"></span><span>${esc(m.model)}</span><span class="sub" style="margin-left:auto">${m.free ? 'available' : 'used up today'}</span></div>`).join('') : `<div class="sub">${esc(u.ai.provider)}${u.ai.model ? ' · ' + esc(u.ai.model) : ''}</div>`}</div></section>
    <section class="grid"><div class="panel"><h2>Lead platforms (30 days)</h2><div class="desc">Searches made on each source, and the businesses each one returned</div>
      ${Object.keys(SRC).filter(k => u.platform.bySource[k] || u.platform.leadsBySource[SRC[k]] || u.platform.leadsBySource[k]).map(k => `<div class="irow"><span>${SRC[k]}</span><span class="sub" style="margin-left:auto">${fmt(u.platform.bySource[k] || 0)} searches · ${fmt(u.platform.leadsBySource[SRC[k]] || u.platform.leadsBySource[k] || 0)} businesses</span></div>`).join('') || '<div class="sub">No searches yet</div>'}</div>
      <div class="panel"><h2>How "per lead" is worked out</h2><div class="desc">All usage of the last 30 days divided by the leads found in those 30 days</div>
      <div class="sub">AI tokens ${fmt(u.ai.tokens30)} ÷ ${fmt(u.leads.found30)} leads = <b>${fmt(u.perLead.tokens)}</b> tokens per lead. Money per lead: see <a href="#/bills">Bills &amp; payments</a>.</div></div></section>`;
}

// Bills & payments: every tool's monthly cost in one place, with the total
async function pageBills(el) {
  const rows = await api('/bills');
  const num = v => Number(String(v || '').replace(/[^\d.]/g, '')) || 0;
  const draw = () => {
    el.innerHTML = head('Bills & payments', 'Every tool this app uses and what it costs each month: ChatGPT API, mail, lead platforms, your service charges, Claude. Fill in the amounts; the total is worked out for you.') +
      `<div class="tablewrap"><table class="tbl"><thead><tr><th>No.</th><th>Item</th><th>Monthly amount (Rs)</th><th>Paid on</th><th>Paid by</th><th>Notes</th><th>Pay / billing page</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr data-i="${i}"><td>${i + 1}</td><td><input type="text" data-k="Item" value="${esc(r.Item)}"></td><td><input type="text" inputmode="decimal" data-k="Monthly Amount (Rs)" value="${esc(r['Monthly Amount (Rs)'])}" placeholder="0"></td>
        <td><input type="date" data-k="Paid On" value="${esc(r['Paid On'])}"></td><td><input type="text" data-k="Paid By" value="${esc(r['Paid By'])}"></td><td><input type="text" data-k="Notes" value="${esc(r.Notes)}"></td>
        <td>${r['Billing Link'] ? `<a href="${esc(r['Billing Link'])}" target="_blank" rel="noopener">Open ↗</a>` : '<span class="sub">–</span>'}</td></tr>`).join('')}
      <tr class="total"><td></td><td><b>Total price of this software</b></td><td><b id="tot">Rs. ${fmt(rows.reduce((a, r) => a + num(r['Monthly Amount (Rs)']), 0))}</b></td><td colspan="4" class="sub">per month</td></tr></tbody></table></div>
      <div class="acts" style="margin-top:12px"><button class="btn" id="addB">+ Add a bill</button><button class="btn primary" id="saveB">Save</button></div>
      <div class="sub" style="margin-top:8px">Payments are made on each company's own billing page (the "Open" links). The app keeps the amounts in one place; it never stores card details.</div>`;
    $$('tbody input').forEach(inp => inp.oninput = () => { rows[+inp.closest('tr').dataset.i][inp.dataset.k] = inp.value; $('#tot').textContent = 'Rs. ' + fmt(rows.reduce((a, r) => a + num(r['Monthly Amount (Rs)']), 0)); });
    $('#addB').onclick = () => { rows.push({ Item: '', 'Monthly Amount (Rs)': '' }); draw(); };
    $('#saveB').onclick = e => busy(e.currentTarget, async () => { await api('/bills', { method: 'PUT', body: rows }); toast('Bills saved'); route(); });
  };
  draw();
}
const kpi = (l, v, h, cls = '', go = '') => `<div class="kpi ${cls}${go ? ' go' : ''}"${go ? ` data-go="${go}" role="link" tabindex="0" title="Open ${esc((PAGES[go] || {}).title || go)}"` : ''}><div class="label">${l}</div><div class="value">${v}</div><div class="hint">${h}</div></div>`;
function funnel(steps) { const max = Math.max(1, steps[0][1]); return `<div class="funnel">${steps.map(([n, v]) => `<div class="frow"><span class="l">${n}</span><div class="ftrack"><div class="ffill" style="width:${Math.max(2, v / max * 100)}%"></div></div><span class="n">${fmt(v)}</span></div>`).join('')}</div>`; }
function blist(obj, color, n = 7) { const e = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, n); if (!e.length) return '<div class="sub">No data yet</div>'; const m = e[0][1]; return `<div class="blist">${e.map(([k, v]) => `<div class="bi"><div class="t"><span class="nm" title="${esc(k)}">${esc(k)}</span><span class="bb"><i style="width:${v / m * 100}%;background:${color}"></i></span></div><span class="v">${fmt(v)}</span></div>`).join('')}</div>`; }
function chart(el, lg, s) {
  const SR = [{ k: 'found', n: 'Leads found', c: '#8ab4ff' }, { k: 'emailed', n: 'Emails sent', c: '#7a1f35' }, { k: 'replies', n: 'Replies', c: '#ff7a6b' }, { k: 'interested', n: 'Interested', c: '#8f9c8c' }, { k: 'qualified', n: 'Qualified', c: '#5b7a5f' }];
  lg.innerHTML = SR.map(x => `<span><i style="background:${x.c}"></i>${x.n}</span>`).join('');
  const W = el.clientWidth || 700, H = 240, P = { l: 34, r: 12, t: 10, b: 26 };
  const max = Math.max(4, ...s.flatMap(r => SR.map(x => r[x.k]))), step = Math.ceil(max / 4), top = step * 4;
  const x = i => P.l + (W - P.l - P.r) * (i / (s.length - 1)), y = v => P.t + (H - P.t - P.b) * (1 - v / top);
  let g = '';
  for (let i = 0; i <= 4; i++) { const yy = y(i * step); g += `<line x1="${P.l}" x2="${W - P.r}" y1="${yy}" y2="${yy}" stroke="#ece3d1"/><text x="${P.l - 8}" y="${yy + 4}" text-anchor="end">${i * step}</text>`; }
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
  const [all, profs] = await Promise.all([api('/leads/raw'), api('/profiles').catch(() => [])]);
  const pname = Object.fromEntries(profs.map(p => [p['Profile ID'], p.Name]));
  let view = 'all'; try { view = sessionStorage.getItem('leads_view') || 'all'; } catch (e) {}
  const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10), best = r => r.Quality === 'yes';
  const VIEWS = { all: ['All', () => true], today: ['Found today', r => r['Date Found'] === day], quality: ['★ Best-fit (quality)', best], 'quality-today': ['★ Best-fit today', r => best(r) && r['Date Found'] === day] };
  if (!VIEWS[view]) view = 'all';
  const rows = all.filter(VIEWS[view][1]);
  el.innerHTML = head('All email leads', view.startsWith('quality') ? 'Best-fit (quality) leads: businesses with an email that the AI scored as a good match for ${esc(BR().name)}. They are NOT clients yet: the agent emails them first. Clients who said yes after a call are on Qualified leads.' : 'Every business the agent found or you imported. Click a row for details.', `<div class="seg">${Object.entries(VIEWS).map(([k, [l, f]]) => `<button data-lv="${k}" class="${view === k ? 'on' : ''}">${l} (${fmt(all.filter(f).length)})</button>`).join('')}</div> <a class="btn" href="#/import">Import leads</a>`) + '<div id="t"></div>';
  $$('[data-lv]', el).forEach(b => b.onclick = () => { try { sessionStorage.setItem('leads_view', b.dataset.lv); } catch (e) {} route(); });
  // one click: pitch the waiting leads of this view now (best-fit first), within today's limits
  const toPitch = rows.filter(r => ['New', 'Low Fit'].includes(r.Status) && /@/.test(r.Email || '')).sort((a, b) => Number(b['Fit Score'] || 0) - Number(a['Fit Score'] || 0));
  if (toPitch.length) {
    const pb = document.createElement('div'); pb.className = 'panel ansbar'; pb.style.marginBottom = '14px';
    pb.innerHTML = `<button class="btn primary" id="pitchView">⚡ Pitch these ${fmt(toPitch.length)} now</button><span class="sub">${view.startsWith('quality') ? 'Emails your best-fit leads first, instead of waiting behind the imported list. ' : ''}Highest fit score first, one by one from your inboxes, within today's sending limit. If there are more than today's limit, click again tomorrow for the rest.</span>`;
    $('#t').before(pb);
    $('#pitchView').onclick = e => { if (!confirm(`Send the first email to these ${toPitch.length} lead(s) now?\n\nThey go out one by one within today's sending limit (click again tomorrow for any left over).`)) return; busy(e.currentTarget, async () => { const r = await api('/leads/pitch', { method: 'POST', body: { ids: toPitch.map(r => r['Lead ID']) } }); toast(r.msg); }); };
  }
  const statuses = ['New', 'Pitched', 'Follow-up 1', 'Follow-up 2', 'Replied', 'Interested', 'Not Interested', 'Do Not Contact', 'Bounced', 'No Email', 'Low Fit', 'Send Failed'];
  // Don't contact: tick leads (or paste emails / domains, or pick an imported file) -> they never get another email
  const sel = new Set();
  const dbar = document.createElement('div'); dbar.className = 'panel ansbar'; dbar.style.marginBottom = '14px';
  dbar.innerHTML = '<button class="btn" id="dncSel" disabled>🚫 Don\'t contact selected (0)</button><button class="btn ghost sm" id="selAll">Select all shown</button><button class="btn ghost sm" id="selNone">Clear</button><button class="btn ghost" id="dncMore">🚫 Don\'t contact by email, domain or file…</button><span class="sub">Marked leads stay in the list as "Do Not Contact" and never get another email.</span>';
  $('#t').before(dbar);
  const upd = () => { $('#dncSel').disabled = !sel.size; $('#dncSel').textContent = `🚫 Don't contact selected (${sel.size})`; };
  $('#t').addEventListener('change', e => { if (e.target.classList.contains('sel')) { e.target.checked ? sel.add(e.target.dataset.id) : sel.delete(e.target.dataset.id); upd(); } });
  $('#selAll').onclick = () => { $$('#t .sel').forEach(c => { c.checked = true; sel.add(c.dataset.id); }); upd(); };
  $('#selNone').onclick = () => { sel.clear(); $$('#t .sel').forEach(c => c.checked = false); upd(); };
  $('#dncSel').onclick = e => { if (!confirm(`Never email these ${sel.size} lead(s) again?\n\nThey stay in the list, marked "Do Not Contact". Any follow-ups stop.`)) return; busy(e.currentTarget, async () => { const r = await api('/leads/dnc', { method: 'POST', body: { ids: [...sel] } }); toast(r.msg); route(); }); };
  $('#dncMore').onclick = async () => {
    const src = await api('/leads/sources').catch(() => []);
    const d = drawer("Don't contact", 'These leads never get another email', `<label class="f"><span>Email addresses or domains, one per line</span><textarea id="dncList" rows="7" placeholder="name@company.com\ncompany.com"></textarea><small>A domain (company.com) blocks everyone at that company. The list is kept (Settings → Do not contact), so new or re-imported leads with these are skipped too.</small></label>
      ${src.length ? `<label class="f"><span>Or every lead from an imported file</span><select id="dncSrc"><option value="">— choose a file —</option>${src.map(x => `<option value="${esc(x.source)}">${esc(x.source.replace(/^Import:\s*/i, ''))} (${x.open} of ${x.total} still contactable)</option>`).join('')}</select></label>` : ''}`, '<button class="btn primary" id="dncGo">🚫 Don\'t contact</button>');
    $('#dncGo', d).onclick = e => busy(e.currentTarget, async () => {
      const list = $('#dncList', d).value.trim(), source = $('#dncSrc', d) ? $('#dncSrc', d).value : '';
      if (!list && !source) throw new Error('Paste emails / domains, or choose a file.');
      if (!confirm('Never email these leads again?')) return;
      const r = await api('/leads/dnc', { method: 'POST', body: { list, source } }); toast(r.msg); closeLayer(); route();
    });
  };
  table($('#t'), { rows, statusKey: 'Status', empty: ['No leads yet', 'The agent adds new businesses every few hours, or import your own list.'],
    cols: [{ k: '_sel', l: '✓', h: r => `<input type="checkbox" class="sel" data-id="${esc(r['Lead ID'])}" ${sel.has(r['Lead ID']) ? 'checked' : ''} onclick="event.stopPropagation()" aria-label="Select ${esc(r['Business Name'])}">` }, { k: 'Date Found', l: 'Found' }, { k: 'Business Name', l: 'Business', h: r => `<div class="strong">${r.Quality === 'yes' ? '<span title="Best-fit (quality) lead" style="color:var(--accent)">★</span> ' : ''}${esc(r['Business Name'])}</div><div class="sub">${esc(r.Industry)}${r.Profile && pname[r.Profile] ? ` · <span class="tag">◆ ${esc(pname[r.Profile])}</span>` : ''}</div>` }, { k: 'Country', l: 'Location', h: r => `${esc(r.City)}<div class="sub">${esc(r.Country)}</div>` }, { k: 'Email', l: 'Email', h: r => r.Email ? esc(r.Email) : '<span class="sub">not found</span>' }, { k: 'Best Service', l: 'Best service' }, { k: 'Fit Score', l: 'Fit', num: true, h: r => r['Fit Score'] ? `${esc(r['Fit Score'])}<span class="sub">/10</span>` : '<span class="sub">–</span>' }, { k: 'Status', l: 'Status', h: r => tag(r.Status) }, { k: 'Pitched On', l: 'Emailed' }],
    onRow: r => {
      const d = drawer(r['Business Name'], tag(r.Status) + ' <span class="sub">' + esc(r['Lead ID']) + '</span>', `<label class="f"><span>Change status</span><select id="ns">${statuses.map(s => `<option ${s === r.Status ? 'selected' : ''}>${s}</option>`).join('')}</select><small>Tip: "Do Not Contact" stops all emails to this lead forever. "New" puts it back in the queue.</small></label>
        <label class="f"><span>Email</span><input type="email" id="ne" value="${esc(r.Email)}"></label>
        <div class="field"><div class="k">Send an email now</div>
          <div class="acts" style="margin:6px 0"><button class="btn sm" id="wd">✎ Write it for me (AI)</button><span class="sub">${r['Message ID'] ? 'Goes in the same email thread as before' : 'Sent as their first email'}</span></div>
          <input type="text" id="es" placeholder="Subject${r['Message ID'] ? ' (leave empty to reply in the same thread)' : ''}" style="margin-bottom:6px">
          <textarea id="eb" rows="8" placeholder="Write your email… your signature is added automatically"></textarea>
          <div class="acts" style="margin-top:8px">${r.Status === 'Do Not Contact' ? '' : '<button class="btn sm" id="dnc1">🚫 Don\'t contact this lead</button>'}<button class="btn sm primary" id="se" ${r.Status === 'Do Not Contact' ? 'disabled title="This lead asked not to be contacted"' : ''}>Send email</button></div></div>
        ${fields(r, ['Business Name', 'Message ID', 'Thread ID'], ['Email', 'Phone', 'Website'])}`, '<button class="btn primary" id="sv">Save</button>');
      const id = encodeURIComponent(r['Lead ID']);
      $('#sv', d).onclick = e => busy(e.currentTarget, async () => { await api('/leads/raw/' + id, { method: 'PATCH', body: { Status: $('#ns', d).value, Email: $('#ne', d).value.trim() } }); toast('Saved'); closeLayer(); route(); });
      if ($('#dnc1', d)) $('#dnc1', d).onclick = e => busy(e.currentTarget, async () => { if (!confirm('Never email ' + r['Business Name'] + ' again?')) return; const x = await api('/leads/dnc', { method: 'POST', body: { ids: [r['Lead ID']] } }); toast(x.msg); closeLayer(); route(); });
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
// Interested leads = said yes / showed interest (Hot / Warm), from email, LinkedIn or calls.
// Qualified leads = confirmed after the call: they want to work with AAVORAA and their requirement is filled in.
async function pageQualified(el, mode = 'qualified') {
  const all = await api('/leads/qualified'), conf = r => r.Stage === 'Qualified';
  const rows = all.filter(r => mode === 'qualified' ? conf(r) : !conf(r));
  el.innerHTML = head(mode === 'qualified' ? 'Qualified leads' : 'Interested leads',
    mode === 'qualified' ? `Confirmed clients: after the call they want to work with ${esc(BR().name)} and their requirement is filled in. From email, LinkedIn and calls.`
      : 'Hot and warm leads who showed interest (email, LinkedIn, calls). After the call, open one and click <b>✓ Confirm as qualified</b> when they are ready to work with us.') + '<div id="t"></div>';
  if (mode !== 'qualified') {
    // follow-up 1 / 2 to interested leads who went quiet: one per row, or all that are due in one click
    const st = await api('/leads/interested/followup-status').catch(() => ({ job: {}, due: 0 }));
    const fb = document.createElement('div'); fb.className = 'panel ansbar'; fb.style.marginBottom = '14px';
    fb.innerHTML = `<button class="btn primary" id="fuAll" ${st.due && !(st.job && st.job.running) ? '' : 'disabled'}>⚡ Follow up all due (${st.due})</button><span class="sub">${st.job && st.job.running ? `Sending… ${st.job.done} of ${st.job.total}` : st.job && st.job.last ? 'Last: ' + esc(st.job.last) : 'Follow-up 1 goes 3 quiet days after their last contact, follow-up 2 four days after follow-up 1. Or use the buttons on each row any time.'}</span>`;
    $('#t').before(fb);
    $('#fuAll').onclick = e => { if (!confirm(`Send a follow-up to the ${st.due} interested lead(s) that are due?\n\nThe AI writes each one. Email when we have their address; LinkedIn otherwise.`)) return; busy(e.currentTarget, async () => { const r = await api('/leads/interested/followup-all', { method: 'POST', body: {} }); toast(r.msg); setTimeout(route, 1500); }); };
    if (st.job && st.job.running) setTimeout(() => { if (location.hash === '#/interested' && !typing()) route(); }, 8000);
    $('#t').addEventListener('click', e => { const b = e.target.closest('[data-fu]'); if (!b) return; e.stopPropagation();
      if (!confirm(`Send follow-up ${b.dataset.fu} to ${b.dataset.n}?\n\nThe AI writes it; it goes by email (or on LinkedIn when there is no email).`)) return;
      busy(b, async () => { const r = await api('/leads/qualified/' + encodeURIComponent(b.dataset.id) + '/followup', { method: 'POST', body: { n: Number(b.dataset.fu) } }); toast(r.msg); route(); }); }, true);
  }
  table($('#t'), { rows, statusKey: 'Lead Score', empty: mode === 'qualified' ? ['No qualified leads yet', 'Confirm an interested lead after the call and it moves here.'] : ['No interested leads yet', 'When someone replies "yes, interested", they appear here.'],
    cols: [{ k: 'Date Qualified', l: 'Date' }, { k: 'Business Name', l: 'Business', h: r => `<div class="strong">${esc(r['Business Name'] || r['Contact Name'])}</div><div class="sub">${esc(r['Contact Name'])}</div>` }, ...(mode === 'qualified' ? [] : [{ k: 'Follow-up 1 On', l: 'Follow-up', h: r => [1, 2].map(n => r[`Follow-up ${n} On`] ? `<span class="tag green" title="Follow-up ${n} sent">FU${n} ✓ ${esc(String(r[`Follow-up ${n} On`]).slice(5))}</span>` : `<button class="btn sm" data-fu="${n}" data-id="${esc(r['Lead ID'])}" data-n="${esc(r['Business Name'] || r['Contact Name'])}" ${n === 2 && !r['Follow-up 1 On'] ? 'disabled title="Send follow-up 1 first"' : ''}>Follow-up ${n}</button>`).join(' ') }]), { k: 'Source', l: 'Source', h: r => tag(r.Source === 'LinkedIn' ? 'LinkedIn' : 'Email') }, { k: 'Service Needed', l: 'Service needed' }, { k: 'Lead Score', l: 'Score', h: r => tag(r['Lead Score']) }, { k: 'Country', l: 'Country' }, { k: 'Next Step', l: 'Next step' }, { k: 'Owner', l: 'Owner' }, { k: 'Last Contact On', l: 'Last contact', h: r => r['Last Contact On'] ? `${esc(r['Last Contact On'])}<div class="sub">${esc(r['Last Contact By'])}</div>` : '<span class="sub">not yet</span>' }],
    onRow: r => {
      const d = drawer(r['Business Name'] || r['Contact Name'], tag(r['Lead Score']) + ' ' + tag(r.Source), `<div class="row2"><label class="f"><span>Next step</span><input type="text" id="nx" value="${esc(r['Next Step'])}"></label><label class="f"><span>Owner</span><input type="text" id="ow" value="${esc(r.Owner)}"></label></div>
        <label class="f"><span>Score</span><select id="sc">${['Hot', 'Warm', 'Cold'].map(s => `<option ${s === r['Lead Score'] ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        ${conf(r) ? `<div class="field confirmed"><div class="k">✓ Qualified: confirmed by ${esc(r['Confirmed By'] || '-')} on ${esc(r['Confirmed On'] || '-')}</div>
            <div class="sub">Call on ${esc(r['Call Done On'] || '-')} · Service: <b>${esc(r['Service Needed'] || '-')}</b> · Budget: ${esc(r.Budget || '-')} · Timeline: ${esc(r.Timeline || '-')} · Decision maker: ${esc(r['Decision Maker'] || '-')}</div>
            <div class="msg" style="margin-top:6px">${esc(r['Requirement Details'] || '')}</div>
            <button class="btn sm ghost" id="unq" style="margin-top:8px">Move back to interested</button></div>`
          : `<details class="field confirmbox"><summary class="strong" style="cursor:pointer">✓ Confirm as qualified (after the call)</summary>
            <div class="sub" style="margin:6px 0 10px">Fill this in when they are ready to work with ${esc(BR().name)}. The lead then moves to Qualified leads and the team leader gets an email.</div>
            <label class="switch" style="margin-bottom:12px"><input type="checkbox" id="cfReady"><i></i><span>They want to work with ${esc(BR().name)}</span></label>
            <div class="row2"><label class="f"><span>Call done on</span><input type="date" id="cfCall" value="${new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)}"></label>
              <label class="f"><span>Service they want *</span><input type="text" id="cfSvc" value="${esc(r['Service Needed'])}"></label>
              <label class="f"><span>Budget</span><input type="text" id="cfBud" value="${esc(r.Budget)}"></label>
              <label class="f"><span>Timeline</span><input type="text" id="cfTime" value="${esc(r.Timeline)}"></label></div>
            <label class="f"><span>Decision maker (name / role)</span><input type="text" id="cfDm" value="${esc(r['Decision Maker'] || r['Contact Name'])}"></label>
            <label class="f"><span>Their requirement *</span><textarea id="cfReq" rows="4" placeholder="What exactly they need, from the call">${esc(r['Requirement Details'] || '')}</textarea></label>
            <label class="f"><span>Next step</span><input type="text" id="cfNext" value="${esc(r['Next Step'])}" placeholder="e.g. send proposal by Friday"></label>
            <button class="btn primary" id="cfGo">✓ Confirm as qualified</button></details>`}
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
        $('#conv', d).innerHTML = t.messages.length ? t.messages.map(m => `<div class="msg" style="white-space:pre-wrap;${m.who === 'us' ? 'margin-left:24px;border-left:3px solid var(--gold, #d4a24c)' : 'margin-right:24px'}"><div class="sub" style="margin-bottom:4px">${m.who === 'us' ? 'We' : 'They'} · ${m.channel === 'linkedin' ? 'LinkedIn' : m.channel === 'email' ? 'Email' : ''}${m.when ? ' · ' + esc(m.when) : ''}${m.meta ? ' · ' + esc(m.meta) : ''}</div>${esc(m.text)}</div>`).join('') : '<div class="sub">No messages saved yet.</div>';
      }).catch(e => { $('#conv', d).innerHTML = `<div class="sub">${esc(e.message)}</div>`; });
      $('#qd', d).onclick = e => busy(e.currentTarget, async () => { const x = await api('/leads/qualified/' + id + '/draft', { method: 'POST', body: { channel: ch, latest: $('#lt', d).value.trim() } }); $('#qt', d).value = x.text; if (!x.ai) toast('AI not available right now, a simple reply was filled in', true); $('#qt', d).focus(); });
      const save = async () => api('/leads/qualified/' + id + '/reply', { method: 'POST', body: { channel: ch, to: $('#qe', d).value.trim(), text: $('#qt', d).value.trim() } });
      $('#qs', d).onclick = e => busy(e.currentTarget, async () => {
        const text = $('#qt', d).value.trim(); if (!text) throw new Error('Write the reply first (or click "Write it for me").');
        if (ch === 'linkedin') { copy(text); window.open(r.LinkedIn, '_blank', 'noopener'); return; }
        if (!confirm(`Send this email to ${$('#qe', d).value.trim()} now?`)) return;
        const x = await save(); toast('Sent: ' + x.where); closeLayer(); route();
      });
      if ($('#cfGo', d)) $('#cfGo', d).onclick = e => busy(e.currentTarget, async () => {
        await api('/leads/qualified/' + id + '/confirm', { method: 'POST', body: { readyToWork: $('#cfReady', d).checked, callOn: $('#cfCall', d).value, service: $('#cfSvc', d).value, budget: $('#cfBud', d).value, timeline: $('#cfTime', d).value, decisionMaker: $('#cfDm', d).value, requirement: $('#cfReq', d).value, nextStep: $('#cfNext', d).value } });
        toast('Confirmed. It is now in Qualified leads.'); closeLayer(); route();
      });
      if ($('#unq', d)) $('#unq', d).onclick = e => busy(e.currentTarget, async () => { if (!confirm('Move this lead back to Interested leads?')) return; await api('/leads/qualified/' + id + '/unconfirm', { method: 'POST', body: {} }); toast('Moved back to interested'); closeLayer(); route(); });
      $('#qm', d).onclick = e => busy(e.currentTarget, async () => { if (!$('#qt', d).value.trim()) throw new Error('The reply box is empty.'); await save(); toast('Saved as sent on LinkedIn'); closeLayer(); route(); });
      $('#sv', d).onclick = e => busy(e.currentTarget, async () => { await api('/leads/qualified/' + id, { method: 'PATCH', body: { 'Next Step': $('#nx', d).value, Owner: $('#ow', d).value, 'Lead Score': $('#sc', d).value, ...($('#qe', d).value.trim() ? { Email: $('#qe', d).value.trim() } : {}) } }); toast('Saved'); closeLayer(); route(); });
    } });
}

/* ------------------------------------------------------------ LinkedIn */
async function pageLinkedIn(el) {
  const [rows, bot] = await Promise.all([api('/leads/linkedin'), api('/linkedin/bot').catch(() => ({ available: false }))]);
  const view = sessionStorage.getItem('li_view') || 'tasks';
  const auto = bot.available && bot.on && bot.signedIn, owner = S.me.role === 'owner';
  const tasks = rows.filter(r => ['To Connect', 'Request Sent', 'Connected', 'Message Sent'].includes(r.Status) || (r['Their Reply'] && r['Suggested Reply'] && !['Interested', 'Not Interested'].includes(r.Status)))
    .sort((a, b) => { const p = r => r['Suggested Reply'] && r.Status === 'Replied' ? 0 : r.Status === 'Connected' ? 1 : r.Status === 'To Connect' ? 2 : 3; return p(a) - p(b) || Number(b['Fit Score'] || 0) - Number(a['Fit Score'] || 0); });
  el.innerHTML = head('LinkedIn tasks', auto ? 'Connection requests go out automatically. When someone accepts you get a pop-up: send them the first message here.' : 'The agent prepares every message. You send it on LinkedIn and click what happened, about 10 minutes a day (max 15–20 connection requests).', `<div class="seg"><button data-v="tasks" class="${view === 'tasks' ? 'on' : ''}">Today's tasks (${tasks.length})</button><button data-v="all" class="${view === 'all' ? 'on' : ''}">All prospects (${rows.length})</button></div>`) + liBotPanel(bot, owner) + '<div id="limitsBox"></div><div id="t"></div>';
  liBotWire(bot);
  if (S.me.role !== 'linkedin') renderLimits($('#limitsBox'), ['linkedin'], { liToday: bot.today, liWeek: bot.week, liMsg: bot.msgToday });
  $$('.seg button').forEach(b => b.onclick = () => { sessionStorage.setItem('li_view', b.dataset.v); route(); });
  if (view === 'all') return table($('#t'), { rows, statusKey: 'Status', empty: ['No LinkedIn prospects yet', 'The agent adds founders and owners every 12 hours.'],
    cols: [{ k: 'Date Found', l: 'Found' }, { k: 'Name', l: 'Person', h: r => `<div class="strong">${esc(r.Name)}</div><div class="sub">${esc(r.Title)}</div>` }, { k: 'Company', l: 'Company' }, { k: 'Email', l: 'Email', h: r => r.Email ? esc(r.Email) : '<span class="sub">–</span>' }, { k: 'Location', l: 'Location' }, { k: 'Best Service', l: 'Best service' }, { k: 'Fit Score', l: 'Fit', num: true }, { k: 'Status', l: 'Status', h: r => tag(r.Status) }, { k: 'Handled By', l: 'Handled by' }],
    onRow: r => drawer(r.Name, tag(r.Status), fields(r, ['Name'], ['Connection Note', 'First Message', 'Suggested Reply', 'LinkedIn URL'])) });
  if (!tasks.length) { $('#t').innerHTML = '<div class="tablewrap"><div class="empty"><b>All done for now</b>New prospects arrive every 12 hours.</div></div>'; return; }
  $('#t').innerHTML = `<div class="tasks">${tasks.slice(0, 40).map((r, i) => {
    const rep = r['Their Reply'] && r['Suggested Reply'] && r.Status === 'Replied';
    const st = rep ? ['Reply to their message', r['Suggested Reply'], [['Message Sent', 'I replied'], ['Interested', 'They\'re interested ★'], ['Not Interested', 'Not interested']]]
      : r.Status === 'To Connect' ? [/auto-connect skipped/i.test(r.Notes || '') ? '1 · Send connection request – the agent could not send this one' : auto ? '1 · Connection request – the agent sends it automatically (or send it yourself)' : '1 · Send connection request', r['Connection Note'], [['Request Sent', 'Request sent']]]
      : r.Status === 'Request Sent' ? ['2 · Waiting for them to accept', r['Connection Note'], [['Connected', 'They accepted'], ['Not Interested', 'Ignored / declined']]]
      : r.Status === 'Connected' ? ['3 · They accepted ✓ Send the first message', r['First Message'], [['Message Sent', 'Message sent']]]
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

// LinkedIn auto-connect panel: on/off, LinkedIn sign-in, today's numbers
function liBotPanel(b, owner) {
  if (!b.available) return owner ? '<div class="notice" style="margin-bottom:14px">LinkedIn auto-connect runs in the Windows app on the main PC. Open the app there to sign in to LinkedIn and switch it on.</div>' : '';
  const t = iso => iso ? new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const state = !b.on ? 'Off. You send the requests yourself.' : !b.signedIn ? '<b style="color:#e5383b">Waiting for LinkedIn sign-in.</b>' : b.pausedUntil ? `Paused until ${t(b.pausedUntil)}.` : b.busy ? 'Working on LinkedIn now…' : b.today >= (b.perDayAll || b.perDay) ? 'Done for today.' : b.nextSendAt ? `Next request around ${t(b.nextSendAt)} (sends ${b.hours} India time, Mon–Sat).` : `Sends ${b.hours} India time, Mon–Sat.`;
  return `<div class="panel" style="margin-bottom:14px"><div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
    <div style="flex:1;min-width:260px"><h2>Auto-connect</h2><div class="desc" style="margin:0">${state}</div>
      <div class="sub" style="margin-top:6px">Sent today <b>${b.today}/${b.perDayAll || b.perDay}</b> · this week ${b.week}/${b.weekMaxAll || b.weekMax}${(b.accounts || []).filter(a => a.signedIn).length > 1 ? ` (${b.accounts.filter(a => a.signedIn).length} accounts)` : ''} · ${b.waiting} waiting to accept · ${b.queue} in the queue · LinkedIn ${b.signedIn ? '<b>signed in</b>' : 'not signed in'}</div>
      ${b.lastResult ? `<div class="sub" style="margin-top:2px">Last: ${esc(b.lastResult)}</div>` : ''}
      ${b.signedIn ? `<div class="oneclick"><button class="btn" id="connAll" ${b.connJob && b.connJob.running || !b.queue ? 'disabled' : ''}>in&nbsp; Connect all (${b.queue})</button><button class="btn primary" id="sendAll" ${b.msgJob && b.msgJob.running || !b.toSend ? 'disabled' : ''}>⚡ Send all on LinkedIn (${b.toSend})</button>
        <span class="sub">${b.connJob && b.connJob.running ? `Connecting… ${b.connJob.done} of ${b.connJob.total} sent · ` : ''}${b.msgJob && b.msgJob.running ? `Sending… ${b.msgJob.done + b.msgJob.failed} of ${b.msgJob.total} done${b.msgJob.current ? ' · now: ' + esc(b.msgJob.current) : ''}` : `One click sends every first message (people who accepted) and every AI reply (people who answered). Today ${b.msgToday}/${b.msgMax}.`}</span></div>` : ''}</div>
    ${owner ? `<div class="acts" style="margin:0">${b.signedIn ? '<button class="btn sm" data-bot="run">Send one now</button><button class="btn sm ghost" data-bot="signout">Sign out of LinkedIn</button>' : '<button class="btn sm primary" data-bot="signin">in&nbsp; Sign in to LinkedIn</button>'}
      <label class="switch"><input type="checkbox" id="botsw" ${b.on ? 'checked' : ''}><i></i><span>${b.on ? 'ON' : 'OFF'}</span></label></div>` : ''}</div>
    ${liAccountsBox(b, owner)}
    ${owner && !b.on ? '<div class="sub" style="margin-top:8px">Uses your own LinkedIn. LinkedIn does not allow automation tools, so the app goes slowly (15 a day by default, never more than 25 a day / 80 a week, only in working hours) and stops if LinkedIn shows a limit. A small risk of a LinkedIn restriction remains.</div>' : ''}</div>`;
}
// Team LinkedIn accounts: each sends its own daily amount; when one is full or LinkedIn shows its limit, the next takes over.
function liAccountsBox(b, owner) {
  const list = b.accounts || []; if (!list.length) return '';
  const t = iso => iso ? new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  return `<div class="liacc"><h3 style="margin:16px 0 4px">LinkedIn accounts <span class="sub">(${list.filter(a => a.signedIn).length} signed in)</span></h3>
    <div class="sub">New requests go from the account with the most room left. When one is full for the day, or LinkedIn shows its limit, the next account takes over. Each person you connect with stays with the account that connected to them (messages and replies go from that same account).</div>
    <div class="ilist" style="margin-top:8px">${list.map(a => `<div class="irow"><span class="dot ${a.signedIn && !a.pausedUntil ? 'on' : 'off'}"></span><div style="flex:1;min-width:0"><div class="strong">${esc(a.name)}${a.main ? ' <span class="sub">(main)</span>' : ''}</div>
      <div class="sub">${!a.signedIn ? '<b>Not signed in</b>' : a.pausedUntil ? `Paused (LinkedIn limit) until ${t(a.pausedUntil)}` : `Requests today ${a.today}/${b.perDay} · week ${a.week}/${b.weekMax} · messages today ${a.msgToday}/${b.msgMax}${a.full ? ' · <b>full for today</b>, the next account takes over' : ''}`} · ${a.waiting} waiting to accept</div></div>
      ${owner ? `<div class="acts" style="margin:0">${a.signedIn ? `<button class="btn sm ghost" data-lio="${esc(a.id)}">Sign out</button>` : `<button class="btn sm primary" data-lii="${esc(a.id)}">Sign in</button>`}${a.main ? '' : `<button class="btn sm ghost" data-lir="${esc(a.id)}" data-n="${esc(a.name)}">Remove</button>`}</div>` : ''}</div>`).join('')}</div>
    ${owner && list.length < (b.maxAccounts || 10) ? `<div class="row2" style="margin-top:10px;align-items:end"><label class="f" style="margin:0"><span>Add a team member's LinkedIn</span><input type="text" id="liNewName" placeholder="Team member's name, e.g. Priya" autocomplete="off"></label><div><button class="btn" id="liAdd">in&nbsp; Add &amp; sign in</button></div></div>
    <div class="sub" style="margin-top:6px">Only real team members' own LinkedIn accounts. Each person signs in to their own account in the window that opens. LinkedIn allows one account per person: extra or fake accounts run by one person usually get every account banned, including the main one.</div>` : ''}</div>`;
}
function liBotWire(b) {
  const call = (el, fn, msg) => busy(el, async () => { const r = await fn(); toast((r && r.msg) || msg); route(); });
  $$('[data-lii]').forEach(el => el.onclick = () => call(el, () => api('/linkedin/bot/signin', { method: 'POST', body: { id: el.dataset.lii } }), 'A LinkedIn window opened on the main PC. Sign in there; it closes by itself.'));
  $$('[data-lio]').forEach(el => el.onclick = () => confirm('Sign this LinkedIn account out of the app? It stops sending until it signs in again; the other accounts carry on.') && call(el, () => api('/linkedin/bot/signout', { method: 'POST', body: { id: el.dataset.lio } }), 'Signed out'));
  $$('[data-lir]').forEach(el => el.onclick = () => confirm(`Remove ${el.dataset.n}'s LinkedIn from the app?\n\nPeople it already connected with stay in the list, but their messages must then be sent by ${el.dataset.n} personally.`) && call(el, () => api('/linkedin/accounts/' + encodeURIComponent(el.dataset.lir), { method: 'DELETE' }), 'Removed'));
  if ($('#liAdd')) $('#liAdd').onclick = e => { const name = $('#liNewName').value.trim(); if (!name) return toast('Type the team member\'s name first', true); if (!confirm(`Add ${name}'s LinkedIn?\n\nA LinkedIn window opens on this PC. ${name} signs in there with THEIR OWN LinkedIn account (the app never sees the password). Use only real team members' own accounts.`)) return; call(e.currentTarget, () => api('/linkedin/accounts', { method: 'POST', body: { name } })); };
  const go = (el, path, msg) => busy(el, async () => { const r = await api('/linkedin/bot/' + path, { method: 'POST', body: {} }); toast(r.msg || msg); route(); });
  $$('[data-bot]').forEach(el => el.onclick = () => el.dataset.bot === 'signin' ? go(el, 'signin', 'A LinkedIn window opened on the main PC. Sign in there; it closes by itself.')
    : el.dataset.bot === 'signout' ? (confirm('Sign out of LinkedIn in the app? Auto-connect stops until you sign in again.') && go(el, 'signout', 'Signed out of LinkedIn'))
    : go(el, 'run', 'Done'));
  if ($('#botsw')) $('#botsw').onchange = async e => {
    if (e.target.checked && !confirm('Send LinkedIn connection requests automatically from your LinkedIn account?\n\nLinkedIn does not allow automation tools. The app sends only a few a day, slowly, in working hours, but LinkedIn could still restrict the account.')) { e.target.checked = false; return; }
    try { await api('/linkedin/bot/switch', { method: 'POST', body: { on: e.target.checked } }); toast(e.target.checked ? (b.signedIn ? 'Auto-connect is ON' : 'Auto-connect is ON. Now click "Sign in to LinkedIn".') : 'Auto-connect is OFF'); route(); } catch (err) { toast(err.message, true); }
  };
  if ($('#connAll')) $('#connAll').onclick = e => { if (!confirm(`Send connection requests to all ${b.queue} people waiting?\n\nThey go out about one a minute, up to your limit (${b.perDay} a day, ${b.weekMax} a week; change it in Settings → LinkedIn auto-connect). The rest go out by themselves on the next days. When someone accepts, the first message is sent automatically.`)) return; busy(e.currentTarget, async () => { const r = await api('/assistant/confirm', { method: 'POST', body: { name: 'linkedin_connect_now', args: { count: 'all' } } }); toast(r.text.split('.')[0]); route(); }); };
  if ($('#sendAll')) $('#sendAll').onclick = e => { if (!confirm(`Send ${b.toSend} prepared message(s) on LinkedIn now from your LinkedIn account?\n\nThey go out one by one, 1-2 minutes apart. Check the messages in the cards below first if you want to change any.`)) return; busy(e.currentTarget, async () => { const r = await api('/linkedin/bot/sendall', { method: 'POST', body: {} }); toast(r.msg); route(); }); };
  if (b.busy || (b.msgJob && b.msgJob.running) || (b.connJob && b.connJob.running)) setTimeout(() => { if (location.hash === '#/linkedin' && !typing()) route(); }, 8000);
}

/* ------------------------------------------------------------ import */
// Replies from client: two separate lists, Gmail (email replies) and LinkedIn (replies pasted from LinkedIn).
// Each shows who it is (with links to their email / LinkedIn profile), what they said, what we sent, and a box to answer them.
const RP_LABEL = { new: 'New reply', automatic: 'Automatic message', interested: 'Interested ★', question: 'Question', referral: 'Referral', not_interested: 'Not interested', unsubscribe: 'Unsubscribed', out_of_office: 'Out of office', other: 'Other' };
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
  const list = (view === 'open' ? rows.filter(open) : rows).slice().sort((a, b) => (a.blocked === true) - (b.blocked === true));
  const nOpen = rows.filter(open).length, nAuto = rows.filter(r => r.Category === 'automatic').length, autoOpen = rows.filter(r => r.Category === 'automatic' && !r.blocked);
  $('#sub').innerHTML = (S.me.role === 'owner' ? `<div class="ansbar"><button class="btn primary" id="ansAll" ${nOpen ? '' : 'disabled'}>⚡ Answer all with AI${nOpen ? ' (' + nOpen + ')' : ''}</button><span class="sub">${nOpen ? `The AI writes and sends an answer to the ${nOpen} client(s) waiting, from the same inbox they wrote to.` : `Nothing is waiting: the AI already answers real replies by itself within minutes.${nAuto ? ` ${nAuto} of these are automatic messages (out of office, ticket systems) that need no answer; you can still answer one yourself below.` : ''}`}</span></div>` : '') + `<div class="seg" style="margin-bottom:12px"><button data-v="open" class="${view === 'open' ? 'on' : ''}">Needs your answer (${rows.filter(open).length})</button><button data-v="all" class="${view === 'all' ? 'on' : ''}">All Gmail replies (${rows.length})</button></div>`;
  if (autoOpen.length && S.me.role !== 'linkedin') { $('#sub').insertAdjacentHTML('beforeend', `<div class="ansbar"><button class="btn" id="dncAuto">🚫 Don't contact all automatic senders (${autoOpen.length})</button><span class="sub">Ticket systems, out-of-office and "no longer with us" replies: those leads get no more emails (follow-ups stop).</span></div>`);
    $('#dncAuto').onclick = e => { if (!confirm(`Never email these ${autoOpen.length} lead(s) again?\n\nTheir follow-ups stop and their addresses go on the Do not contact list.`)) return; busy(e.currentTarget, async () => { const r = await api('/leads/dnc', { method: 'POST', body: { ids: autoOpen.map(r => r['Lead ID']).filter(Boolean), list: autoOpen.map(r => r.From).join('\n') } }); toast(r.msg); route(); }); }; }
  $$('#sub .seg button').forEach(b => b.onclick = () => { sessionStorage.setItem('rp_view', b.dataset.v); route(); });
  if ($('#ansAll')) $('#ansAll').onclick = e => { if (!confirm(`Let the AI write and send an answer to all ${nOpen} waiting replies now?`)) return; busy(e.currentTarget, async () => { const r = await api('/replies/answer-all', { method: 'POST', body: {} }); toast(r.text.split('\n')[0]); route(); }); };
  if (!list.length) { $('#t').innerHTML = `<div class="tablewrap"><div class="empty"><b>${rows.length ? 'Nothing waiting for you' : 'No email replies yet'}</b>${rows.length ? 'The agent has answered everyone. See "All Gmail replies".' : 'When a client answers an email, it appears here within 5 minutes.'}</div></div>`; return; }
  $('#t').innerHTML = `<div class="tasks">${list.map((r, i) => `<article class="task${r.blocked ? ' blocked' : ''}" data-i="${i}">
      <div class="step">✉ Gmail · ${esc(r['Received On'])} · ${esc(RP_LABEL[r.Category] || r.Category || '')}${r.blocked ? ' · <b>Do not contact</b>' : ''}</div>
      <div class="top"><div><div class="strong">${esc(r['Business Name'] || r.From)}</div>
        <div class="sub">${r['Contact Name'] ? esc(r['Contact Name']) + ' · ' : ''}<a href="mailto:${esc(r.From)}">${esc(r.From)}</a>${r.Inbox ? ' → our inbox ' + esc(r.Inbox) : ''}</div></div>${tag(r['Reply Status'])}</div>
      ${r.Summary ? `<div class="sub" style="margin-top:6px">Summary: ${esc(r.Summary)}</div>` : ''}
      <div class="sub" style="margin-top:8px">They wrote${r.Subject ? ' (' + esc(r.Subject) + ')' : ''}:</div>
      <div class="msg">${esc(r['Their Message'])}</div>
      ${r['Our Reply'] ? `<div class="sub">We answered:</div><div class="msg">${esc(r['Our Reply'])}</div>` : ''}
      <textarea placeholder="Write your answer to ${esc(r['Contact Name'] || r.From)}… (your signature is added automatically)" style="margin-top:8px"></textarea>
      ${r.Category === 'automatic' ? '<div class="sub" style="margin-top:6px">Automatic message: usually no answer is needed. You can still write one.</div>' : ''}${`<div class="acts" style="margin-top:8px"><button class="btn sm" data-ai>✨ Write it with AI</button><button class="btn sm primary" data-send>Send reply</button><button class="btn sm" data-copy>Copy their email</button>${r.blocked ? '' : '<button class="btn sm ghost" data-dnc>🚫 Don\'t contact</button>'}</div>`}
    </article>`).join('')}</div>`;
  $$('.task').forEach(card => {
    const r = list[+card.dataset.i];
    if (!$('[data-send]', card)) return;
    $('[data-copy]', card).onclick = () => copy(r.From);
    if ($('[data-dnc]', card)) $('[data-dnc]', card).onclick = e => busy(e.currentTarget, async () => { if (!confirm(`Never email ${r['Business Name'] || r.From} again?\n\nFollow-ups stop and ${r.From} goes on the Do not contact list.`)) return; const x = await api('/leads/dnc', { method: 'POST', body: { ids: r['Lead ID'] ? [r['Lead ID']] : [], list: r.From } }); toast(x.msg); route(); });
    $('[data-ai]', card).onclick = e => busy(e.currentTarget, async () => {
      const ta = $('textarea', card);
      if (ta.value.trim() && !confirm('Replace what you wrote with the AI answer?')) return;
      const d = await api('/replies/' + encodeURIComponent(r['Reply ID']) + '/draft', { method: 'POST', body: {} });
      ta.value = d.text; ta.style.height = Math.min(420, ta.scrollHeight + 4) + 'px'; ta.focus(); toast('AI answer ready. Check it, then click Send reply.');
    });
    $('[data-send]', card).onclick = e => busy(e.currentTarget, async () => {
      const text = $('textarea', card).value.trim(); if (!text) throw new Error('Write your answer first (or click ✨ Write it with AI).');
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
  let tab = 'contact'; try { tab = sessionStorage.getItem('cw_tab') || 'contact'; } catch (e) {}
  const [d, w] = await Promise.all([api('/leads/calls'), api('/leads/whatsapp-replies').catch(() => ({ list: [], waiting: 0, replied: 0 }))]);
  const seg = `<div class="seg"><button data-cw="contact" class="${tab === 'contact' ? 'on' : ''}">☎ To contact (${d.tasks.length})</button><button data-cw="replies" class="${tab === 'replies' ? 'on' : ''}">💬 Replies (${w.replied}${w.waiting ? ' · ' + w.waiting + ' waiting' : ''})${w.waiting ? '<span class="nbadge">' + w.waiting + '</span>' : ''}</button></div>`;
  el.innerHTML = head('Call / WhatsApp', tab === 'contact' ? 'Leads the email cannot reach, and leads who did not answer the email. Open WhatsApp (the message is filled in), press send, then click what happened. About 10–15 a day is plenty.' : 'Everyone you messaged on WhatsApp. When a client answers on WhatsApp, paste what they wrote: the AI writes the answer, one click opens WhatsApp with it.', seg + ` <span class="sub">${d.done} handled so far</span>`) + '<div id="t"></div>';
  $$('[data-cw]').forEach(b => b.onclick = () => { try { sessionStorage.setItem('cw_tab', b.dataset.cw); } catch (e) {} route(); });
  if (tab === 'replies') return waReplies(w);
  pitchBar(d);
  if (!d.tasks.length) { $('#t').innerHTML = '<div class="tablewrap"><div class="empty"><b>Nothing to call right now</b>Leads appear here when they have a phone number but no working email, or when they have not answered an email for 2 days.</div></div>'; return; }
  $('#t').innerHTML = `<div class="tasks">${d.tasks.map((r, i) => `<article class="task" data-i="${i}">
      <div class="step" data-lead="${esc(r['Lead ID'])}">${esc(r.why)}${r['Call Status'] === 'No Answer' ? ' · try again' : ''}</div>
      <div class="top"><div><div class="strong">${esc(r['Business Name'])}</div><div class="sub">${esc([r['Contact Name'], r.City, r.Phone].filter(Boolean).join(' · '))}</div></div>${tag(r.Status)}</div>
      <div class="msg">${esc(r.message)}</div>
      <div class="acts">${r.wa ? `<a class="btn sm primary" href="https://wa.me/${esc(r.wa)}?text=${encodeURIComponent(r.message)}" target="_blank" rel="noopener">Open WhatsApp</a>` : ''}<button class="btn sm" data-copy>Copy message</button><button class="btn sm" data-num>Copy number</button>${r.Website ? `<a class="btn sm ghost" href="${esc(r.Website)}" target="_blank" rel="noopener">Website</a>` : ''}</div>
      <div class="acts">${[['Messaged', 'WhatsApp sent'], ['No Answer', 'Called, no answer'], ['Interested', 'Interested ★'], ['Ready to work', 'Ready to work ✓ (qualified)'], ['Not Interested', 'Not interested'], ['Wrong Number', 'Wrong number']].map(([v, l]) => `<button class="btn sm" data-set="${v}">${l}</button>`).join('')}</div>
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

// One click "Pitch all" on the To contact tab. With the WhatsApp Cloud API: fully automatic in the background.
// Without it, WhatsApp needs a person to press Send, so the app goes lead by lead: one click opens the next chat with the message ready.
function pitchBar(d) {
  if (!d.tasks.length) return;
  const bar = document.createElement('div'); bar.className = 'panel pitchbar'; bar.style.marginBottom = '16px';
  const j = d.job || {}, n = d.total || d.tasks.length;
  bar.innerHTML = d.auto
    ? `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><div style="flex:1;min-width:240px"><h2 style="margin:0">⚡ Pitch all on WhatsApp</h2><div class="sub">${j.running ? `Sending… ${j.done} sent${j.skipped ? ', ' + j.skipped + ' skipped' : ''} of ${j.total}` : (j.last ? 'Last: ' + esc(j.last) : `Sends your approved WhatsApp template to all ${n} leads below, automatically, within each number's daily limit.`)}</div></div>
      <button class="btn primary" id="pitchAll" ${j.running ? 'disabled' : ''}>⚡ Pitch all ${n}</button></div>`
    : `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><div style="flex:1;min-width:240px"><h2 style="margin:0">⚡ Pitch all on WhatsApp</h2><div class="sub">One click per lead: the app opens WhatsApp with the message ready, you press Send, it marks the lead and moves to the next. (Fully automatic needs the official WhatsApp Cloud API: Connections page.)</div></div>
      <button class="btn primary" id="quickGo">⚡ Start pitching all ${d.tasks.length}</button></div><div id="quick"></div>`;
  $('#t').before(bar);
  if ($('#pitchAll')) $('#pitchAll').onclick = e => { if (!confirm(`Send the WhatsApp pitch to all ${n} leads now?\n\nIt uses your approved template from the official WhatsApp Cloud API, one every few seconds, within each number's daily limit. Messaging many people who do not expect it can get a WhatsApp number blocked.`)) return; busy(e.currentTarget, async () => { const r = await api('/whatsapp/pitch-calls', { method: 'POST', body: {} }); toast(r.msg); route(); }); };
  if (d.auto && j.running) setTimeout(() => { if (location.hash === '#/calls' && !typing()) route(); }, 8000);
  if ($('#quickGo')) $('#quickGo').onclick = () => quickPitch(d.tasks.filter(r => r.wa));
}
function quickPitch(list) {
  let i = 0, sent = 0; const box = $('#quick');
  if (!list.length) return toast('None of these leads has a WhatsApp number', true);
  $('#quickGo').disabled = true;
  const show = () => {
    if (i >= list.length) { box.innerHTML = `<div class="notice ok" style="margin-top:12px">Done: ${sent} WhatsApp pitch(es) opened and marked as sent. Replies show in the Replies tab once you paste them.</div>`; setTimeout(route, 2500); return; }
    const r = list[i];
    box.innerHTML = `<div class="quick"><div class="sub">Lead ${i + 1} of ${list.length} · ${sent} sent</div><div class="strong" style="margin:4px 0 2px">${esc(r['Business Name'])}</div><div class="sub">${esc([r['Contact Name'], r.City, r.Phone].filter(Boolean).join(' · '))}</div>
      <div class="msg" style="margin:10px 0">${esc(r.message)}</div>
      <div class="acts"><button class="btn primary" id="qOpen">Open WhatsApp &amp; next ▶</button><button class="btn" id="qSkip">Skip</button><button class="btn ghost" id="qStop">Stop</button></div>
      <div class="sub" style="margin-top:6px">After WhatsApp opens, press Send there, then come back and click again for the next lead.</div></div>`;
    $('#qOpen').onclick = async () => {
      window.open(`https://wa.me/${r.wa}?text=${encodeURIComponent(r.message)}`, '_blank', 'noopener');
      try { await api('/leads/call/' + encodeURIComponent(r['Lead ID']), { method: 'PATCH', body: { status: 'Messaged' } }); sent++; } catch (e) { toast(e.message, true); }
      const card = document.querySelector(`.task[data-i] [data-lead="${CSS.escape(r['Lead ID'])}"]`); if (card) card.closest('.task').remove();
      i++; show();
    };
    $('#qSkip').onclick = () => { i++; show(); };
    $('#qStop').onclick = () => { box.innerHTML = ''; toast(`Stopped. ${sent} sent.`); route(); };
  };
  show(); bar0();
  function bar0() { box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

// WhatsApp conversations: paste their reply → AI answer → Open WhatsApp with it (saved as sent)
function waReplies(w) {
  if (!w.list.length) { $('#t').innerHTML = '<div class="tablewrap"><div class="empty"><b>No WhatsApp conversations yet</b>When you click "WhatsApp sent" on a lead (To contact tab), it moves here. When they answer on WhatsApp, paste their reply here and the AI writes your answer.</div></div>'; return; }
  const bubble = m => `<div class="wab ${m.who}"><div class="sub">${m.who === 'them' ? 'They wrote' : 'We sent' + (m.by ? ' (' + esc(m.by) + ')' : '')}${m.when ? ' · ' + esc(m.when) : ''}</div>${esc(m.text)}</div>`;
  $('#t').innerHTML = `<div class="notice" style="margin-bottom:14px">WhatsApp does not let any app read your own WhatsApp chats, so client replies arrive in <b>your WhatsApp</b> (phone or WhatsApp Web). Copy their reply and paste it on their card below: the AI writes the answer and the lead is saved as replied (their follow-up emails stop).</div>
    <div class="tasks">${w.list.map((r, i) => `<article class="task" data-w="${i}">
      <div class="step">${r.waiting ? '<b style="color:var(--accent)">Replied: answer them</b>' : r.replied ? 'Conversation' : 'Waiting for their reply'}</div>
      <div class="top"><div><div class="strong">${esc(r['Business Name'])}</div><div class="sub">${esc([r['Contact Name'], r.City, r.Phone].filter(Boolean).join(' · '))}</div></div>${tag(r['Call Status'] || r.Status)}</div>
      <div class="wachat">${r.chat.length ? r.chat.map(bubble).join('') : bubble({ who: 'us', when: r['WhatsApp Sent On'] || '', by: r['Called By'] || '', text: r.first })}</div>
      ${r['WhatsApp Suggested'] ? `<label class="f" style="margin:10px 0 0"><span>Answer (written by the AI, change it if you like)</span><textarea data-ans rows="4">${esc(r['WhatsApp Suggested'])}</textarea></label>
        <div class="acts">${r.wa ? '<a class="btn sm primary" data-open href="#" rel="noopener">Open WhatsApp with this answer</a>' : ''}<button class="btn sm" data-copyans>Copy answer</button><button class="btn sm ghost" data-markans>I sent it</button><button class="btn sm ghost" data-redraft>Write again</button></div>` : ''}
      <label class="f" style="margin:10px 0 0"><span>Paste their new WhatsApp reply</span><textarea data-in rows="2" placeholder="Paste what they wrote on WhatsApp…"></textarea></label>
      <div class="acts"><button class="btn sm ${r['WhatsApp Suggested'] ? '' : 'primary'}" data-save>Save reply &amp; let AI answer</button>${r.wa ? `<a class="btn sm ghost" href="https://wa.me/${esc(r.wa)}" target="_blank" rel="noopener">Open chat</a>` : ''}</div>
      <div class="acts">${[['Interested', 'Interested ★'], ['Ready to work', 'Ready to work ✓ (qualified)'], ['Not Interested', 'Not interested']].map(([v, l]) => `<button class="btn sm" data-set="${v}">${l}</button>`).join('')}</div>
    </article>`).join('')}</div>`;
  $$('[data-w]').forEach(card => {
    const r = w.list[+card.dataset.w], ans = () => ($('[data-ans]', card) || {}).value || '';
    const sent = async () => { await api('/leads/wa/' + encodeURIComponent(r['Lead ID']) + '/sent', { method: 'POST', body: { text: ans() } }); };
    $('[data-save]', card).onclick = e => busy(e.currentTarget, async () => { const t = $('[data-in]', card).value.trim(); if (!t) return toast('Paste their WhatsApp reply first', true); const x = await api('/leads/wa/' + encodeURIComponent(r['Lead ID']) + '/reply', { method: 'POST', body: { text: t } }); toast(x.interested ? 'Saved. They sound interested: the AI answer is ready (mark them Interested ★ if so).' : 'Saved. The answer is ready.'); route(); });
    if ($('[data-open]', card)) $('[data-open]', card).onclick = e => { e.preventDefault(); const t = ans().trim(); if (!t) return toast('The answer is empty', true); window.open(`https://wa.me/${r.wa}?text=${encodeURIComponent(t)}`, '_blank', 'noopener'); sent().then(() => { toast('WhatsApp opened with the answer: press send there. Saved here as sent.'); route(); }).catch(err => toast(err.message, true)); };
    if ($('[data-copyans]', card)) $('[data-copyans]', card).onclick = () => copy(ans());
    if ($('[data-markans]', card)) $('[data-markans]', card).onclick = e => busy(e.currentTarget, async () => { await sent(); toast('Saved as sent'); route(); });
    if ($('[data-redraft]', card)) $('[data-redraft]', card).onclick = e => busy(e.currentTarget, async () => { await api('/leads/wa/' + encodeURIComponent(r['Lead ID']) + '/redraft', { method: 'POST', body: {} }); route(); });
    $$('[data-set]', card).forEach(b => b.onclick = () => busy(b, async () => {
      await api('/leads/call/' + encodeURIComponent(r['Lead ID']), { method: 'PATCH', body: { status: b.dataset.set, note: (r.chat.filter(m => m.who === 'them').pop() || {}).text || '' } });
      toast(b.dataset.set === 'Not Interested' ? 'Saved' : 'Added to Qualified leads, the team leader is alerted.'); route();
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
  if (canEdit) { teamSenders(el); brandPanel(el); }
  if ($('#sv')) $('#sv').onclick = e => busy(e.currentTarget, async () => { const b = {}; $$('.panel:not(.tsend) [data-k]').forEach(i => b[i.dataset.k] = i.type === 'checkbox' ? (i.checked ? 'yes' : 'no') : i.value); await api('/settings', { method: 'PUT', body: b }); toast('Settings saved'); });
}

// Team senders (Settings): one sender per sending Gmail. Each member's emails are written and signed in their own name,
// title and LinkedIn link. "Add a team member" adds their Gmail (App Password) and their sender in one go.
async function teamSenders(el) {
  let c; try { c = await api('/connections'); } catch (e) { return; }
  const sender = [...el.querySelectorAll('.panel h2')].find(h => /^sender$/i.test(h.textContent.trim()));
  const box = document.createElement('div'); box.className = 'panel tsend'; box.style.marginBottom = '14px';
  const rows = [{ ...(c.mainSender || {}), main: true }, ...(c.inboxes || [])].filter(x => x.user);
  box.innerHTML = `<h2>Team senders</h2><div class="desc">Each team member sends from their own Gmail, in their own name, with their title and LinkedIn link in the signature. Main Gmail empty = the Sender above.</div>
    <div class="senders">${rows.map(x => `<div class="snd" data-snd="${esc(x.user)}"><div class="strong" style="grid-column:1/-1">${esc(x.user)}${x.main ? ' <span class="sub">(main)</span>' : ''}</div><input type="text" data-s="senderName" placeholder="Name" value="${esc(x.senderName)}"><input type="text" data-s="senderTitle" placeholder="Title" value="${esc(x.senderTitle)}"><input type="url" data-s="senderLinkedIn" placeholder="LinkedIn link (https://www.linkedin.com/in/…)" value="${esc(x.senderLinkedIn)}"><div class="acts" style="margin:0"><button class="btn sm primary" data-sv>Save</button></div></div>`).join('')}</div>
    <details class="addmember"><summary class="btn">+ Add a team member</summary><div class="how" style="margin-top:10px">Their Gmail needs 2-Step Verification, an <b>App Password</b> (myaccount.google.com/apppasswords) and IMAP on. They (or you) paste the 16-letter App Password; it is stored only on this PC.</div>
      <div class="row2"><label class="f"><span>Their Gmail</span><input type="email" id="tmU" autocomplete="off"></label><label class="f"><span>App password (16 letters)</span><input type="password" id="tmP" autocomplete="off"></label>
      <label class="f"><span>Name</span><input type="text" id="tmN" placeholder="e.g. Priya Sharma"></label><label class="f"><span>Title</span><input type="text" id="tmT" placeholder="e.g. Business Development Executive"></label>
      <label class="f"><span>LinkedIn link</span><input type="url" id="tmL" placeholder="https://www.linkedin.com/in/…"></label></div>
      <button class="btn primary" id="tmAdd">Test &amp; add team member</button><div id="tmMsg" style="margin-top:10px"></div></details>`;
  if (sender) sender.closest('.panel').after(box); else el.appendChild(box);
  $$('[data-snd]', box).forEach(row => { $('[data-sv]', row).onclick = e => busy(e.currentTarget, async () => { const body = {}; $$('[data-s]', row).forEach(i => body[i.dataset.s] = i.value.trim()); await api('/inboxes/' + encodeURIComponent(row.dataset.snd), { method: 'PATCH', body }); toast('Saved: ' + (body.senderName || row.dataset.snd)); }); });
  $('#tmAdd', box).onclick = e => busy(e.currentTarget, async () => { try { const r = await api('/connections/inboxes', { method: 'POST', body: { user: $('#tmU', box).value, pass: $('#tmP', box).value, senderName: $('#tmN', box).value, senderTitle: $('#tmT', box).value, senderLinkedIn: $('#tmL', box).value } }); toast(r.msg); route(); } catch (err) { $('#tmMsg', box).innerHTML = `<div class="notice err">${esc(err.message)}</div>`; } });
}

// Brand (Settings): the company's own logo; its name and tagline come from Settings → Sender (Company, Tagline)
function brandPanel(el) {
  const box = document.createElement('div'); box.className = 'panel'; box.style.marginBottom = '14px';
  box.innerHTML = `<h2>Brand</h2><div class="desc">The app shows your company: its name and tagline come from <b>Company</b> and <b>Tagline</b> below; add your logo here.</div>
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap"><div class="logoprev">${brandMark('lp')}</div><input type="file" id="lgF" accept="image/png,image/jpeg,image/webp,image/svg+xml" class="hidden"><button class="btn" id="lgB">Upload logo</button>${BR().logo ? '<button class="btn ghost" id="lgX">Remove logo</button>' : ''}<span class="sub">PNG / JPG / SVG under 300 KB, square works best.</span></div>`;
  const head0 = el.querySelector('.panel'); if (head0) head0.before(box); else el.appendChild(box);
  $('#lgB', box).onclick = () => $('#lgF', box).click();
  $('#lgF', box).onchange = e => { const f = e.target.files[0]; if (!f) return; if (f.size > 300000) return toast('Use an image under 300 KB', true); const rd = new FileReader(); rd.onload = async () => { try { await api('/brand/logo', { method: 'POST', body: { dataUrl: rd.result } }); S.state.brand = { ...BR(), logo: rd.result }; toast('Logo saved'); location.reload(); } catch (err) { toast(err.message, true); } }; rd.readAsDataURL(f); };
  if ($('#lgX', box)) $('#lgX', box).onclick = async () => { await api('/brand/logo', { method: 'POST', body: { dataUrl: '' } }); location.reload(); };
}

/* ------------------------------------------------------------ products & services (business profiles) */
// Each profile = one product or service to pitch, for any company and sector: what it is, who buys it, where to find them.
// The agent finds leads for the active profiles in turn and pitches each lead with its own profile's offer.
const PF = [['Name', 'Name of this offer', 'text', 'e.g. Organic coffee beans for cafes'], ['Offer Type', 'Product or service', 'select'], ['Company', 'Company (empty = from Settings)', 'text', ''], ['Website', 'Website (empty = from Settings)', 'text', ''],
  ['What We Sell', 'What you sell *', 'text', 'e.g. single-origin coffee beans, wholesale packs'], ['Details', 'Key benefits / facts the AI may use', 'textarea', 'Only true facts: quality, prices, delivery, offers…'], ['Ideal Customer', 'Ideal customer', 'text', 'e.g. independent cafes and bakeries'],
  ['Industries', 'Businesses to find (map / LinkedIn search words) *', 'textarea', 'cafe, coffee shop, bakery, restaurant'], ['Cities', 'Cities or countries *', 'textarea', 'Chennai, Bangalore, Dubai'], ['Call To Action', 'Next step to offer', 'text', 'e.g. a free sample pack'], ['Address', 'Company address for the email signature (empty = from Settings, or none for another company)', 'text', '']];
async function pageProfiles(el) {
  const list = await api('/profiles'); const owner = S.me.role === 'owner';
  el.innerHTML = head('Products & services', 'What the agent pitches. Add any product or service, for any company and sector: the agent finds the right businesses for it and pitches each lead with that offer by email, LinkedIn and WhatsApp. With no profile, it uses Settings (Your offer).', owner ? '<button class="btn primary" id="pfNew">+ Add product or service</button>' : '') + '<div id="t"></div>';
  $('#t').innerHTML = list.length ? `<div class="tasks">${list.map((p, i) => `<article class="task" data-p="${i}"><div class="step">${esc(p['Offer Type'] || 'service')} · ${p.Active === 'no' ? 'paused' : '<b style="color:var(--accent)">active</b>'}</div>
      <div class="top"><div><div class="strong">◆ ${esc(p.Name)}</div><div class="sub">${esc(p.Company || BR().name)}${p.Website ? ' · ' + esc(p.Website) : ''}</div></div>${tag(p.Active === 'no' ? 'Paused' : 'Active')}</div>
      <div class="msg">${esc(p['What We Sell'])}${p['Ideal Customer'] ? '\nFor: ' + esc(p['Ideal Customer']) : ''}${p['Call To Action'] ? '\nOffer: ' + esc(p['Call To Action']) : ''}</div>
      <div class="sub">Finds: ${esc(String(p.Industries).slice(0, 120))} · in ${esc(String(p.Cities).slice(0, 80))}</div>
      <div class="sub" style="margin-top:4px">${p.stats.leads} leads · ${p.stats.pitched} pitched · ${p.stats.replied} replied${p.stats.linkedin ? ' · ' + p.stats.linkedin + ' LinkedIn' : ''}</div>
      ${owner ? `<div class="acts"><button class="btn sm primary" data-find>Find leads now</button><button class="btn sm" data-edit>Edit</button><button class="btn sm ghost" data-tog>${p.Active === 'no' ? 'Activate' : 'Pause'}</button><button class="btn sm ghost" data-rm>Remove</button><a class="btn sm ghost" href="#/social">Social posts</a></div>` : ''}</article>`).join('')}</div>`
    : `<div class="tablewrap"><div class="empty"><b>No products or services yet</b>The agent now pitches what is in Settings (${esc(BR().name)}). Add a product or service to pitch something else, for your company or a client.</div></div>`;
  const form = (p = {}) => {
    const d = drawer(p['Profile ID'] ? 'Edit ' + (p.Name || '') : 'Add a product or service', 'The AI uses only what you write here', `<div class="field"><div class="k">✨ Let the AI fill it in</div><textarea id="pfDesc" rows="3" placeholder="Describe it in a sentence or two, e.g. 'We make eco-friendly paper cups and sell them wholesale to cafes in South India'"></textarea><div class="row2"><input type="text" id="pfReg" placeholder="Region (optional), e.g. Tamil Nadu"><button class="btn sm" id="pfAi">✨ Fill with AI</button></div></div>
      ${PF.map(([k, l, t, ph]) => `<label class="f"><span>${l}</span>${t === 'select' ? `<select data-f="${k}">${['product', 'service', 'both'].map(o => `<option ${(p[k] || 'product') === o ? 'selected' : ''}>${o}</option>`).join('')}</select>` : t === 'textarea' ? `<textarea data-f="${k}" rows="3" placeholder="${esc(ph)}">${esc(p[k] || '')}</textarea>` : `<input type="text" data-f="${k}" value="${esc(p[k] || '')}" placeholder="${esc(ph)}">`}</label>`).join('')}`, '<button class="btn primary" id="pfSave">Save</button>');
    $('#pfAi', d).onclick = e => busy(e.currentTarget, async () => { const x = await api('/profiles/suggest', { method: 'POST', body: { description: $('#pfDesc', d).value, region: $('#pfReg', d).value, type: $('[data-f="Offer Type"]', d).value, company: $('[data-f="Company"]', d).value, website: $('[data-f="Website"]', d).value } }); for (const [k, v] of Object.entries(x)) { const f = $(`[data-f="${k}"]`, d); if (f && v && !(k === 'Name' && f.value)) f.value = v; } toast('Filled in: check it, then Save'); });
    $('#pfSave', d).onclick = e => busy(e.currentTarget, async () => { const b = {}; $$('[data-f]', d).forEach(f => b[f.dataset.f] = f.value); if (p['Profile ID']) await api('/profiles/' + p['Profile ID'], { method: 'PATCH', body: b }); else await api('/profiles', { method: 'POST', body: b }); toast('Saved'); closeLayer(); route(); });
  };
  if ($('#pfNew')) $('#pfNew').onclick = () => form();
  $$('[data-p]').forEach(card => { const p = list[+card.dataset.p]; if (!$('[data-edit]', card)) return;
    $('[data-edit]', card).onclick = () => form(p);
    $('[data-find]', card).onclick = e => busy(e.currentTarget, async () => { const r = await api('/profiles/' + p['Profile ID'] + '/find', { method: 'POST', body: {} }); toast(r.msg); });
    $('[data-tog]', card).onclick = e => busy(e.currentTarget, async () => { await api('/profiles/' + p['Profile ID'], { method: 'PATCH', body: { Active: p.Active === 'no' ? 'yes' : 'no' } }); route(); });
    $('[data-rm]', card).onclick = e => { if (!confirm('Remove "' + p.Name + '"? Its leads stay; the agent stops finding new ones for it.')) return; busy(e.currentTarget, async () => { await api('/profiles/' + p['Profile ID'], { method: 'DELETE' }); route(); }); };
  });
}

/* ------------------------------------------------------------ social media */
const SHARE = { LinkedIn: t => 'https://www.linkedin.com/feed/?shareActive=true&text=' + encodeURIComponent(t), X: t => 'https://x.com/intent/tweet?text=' + encodeURIComponent(t.slice(0, 280)), Facebook: () => 'https://www.facebook.com/', Instagram: () => 'https://www.instagram.com/' };
async function pageSocial(el) {
  let tab = 'posts'; try { tab = sessionStorage.getItem('so_tab') || 'posts'; } catch (e) {}
  el.innerHTML = head('Social media', tab === 'posts' ? 'Free posts that work like an ad: the AI writes them for each product or service; post them yourself, schedule them, or let the app post to your own pages.' : 'Leads whose website links to Instagram, Facebook, X or TikTok. One click opens their chat and copies your message; you press Send (automatic DMs get accounts banned).', `<div class="seg"><button data-st="posts" class="${tab === 'posts' ? 'on' : ''}">✍ Posts</button><button data-st="dms" class="${tab === 'dms' ? 'on' : ''}">💬 DMs to leads</button></div>`) + '<div id="t"></div>';
  $$('[data-st]').forEach(b => b.onclick = () => { try { sessionStorage.setItem('so_tab', b.dataset.st); } catch (e) {} route(); });
  return tab === 'posts' ? socialPosts() : socialDms();
}
async function socialPosts() {
  const [d, profs] = await Promise.all([api('/social/posts'), api('/profiles').catch(() => [])]);
  const pname = Object.fromEntries(profs.map(p => [p['Profile ID'], p.Name])), can = S.me.role !== 'linkedin';
  const full = p => [p.Text, p.Hashtags].filter(Boolean).join('\n\n');
  $('#t').innerHTML = (can ? `<div class="panel" style="margin-bottom:14px"><h2>Write new posts</h2><div class="row2">
      <label class="f"><span>For</span><select id="spP"><option value="">${esc(BR().name)} (Settings)</option>${profs.map(p => `<option value="${esc(p['Profile ID'])}">◆ ${esc(p.Name)}</option>`).join('')}</select></label>
      <label class="f"><span>How many per platform</span><select id="spN">${[1, 2, 3, 5].map(n => `<option>${n}</option>`).join('')}</select></label></div>
      <div class="acts" style="margin:4px 0 8px">${['Instagram', 'Facebook', 'LinkedIn', 'X'].map(p => `<label class="chk"><input type="checkbox" data-pl="${p}" checked> ${p}${d.ready[p] ? ' <span class="tag green">auto</span>' : ''}</label>`).join('')}</div>
      <label class="f"><span>Angle or campaign (optional)</span><input type="text" id="spA" placeholder="e.g. Diwali offer, new product launch, customer tip of the week"></label>
      <button class="btn primary" id="spGo">✨ Write posts</button> <span class="sub">Auto-posting needs your page keys on Connections → Social media; otherwise each post opens the platform with the text ready.</span></div>` : '') +
    (d.posts.length ? `<div class="tasks">${d.posts.map((p, i) => `<article class="task" data-sp="${i}"><div class="step">${esc(p.Platform)} · ${esc(p.Status)}${p.Status === 'Scheduled' ? ' for ' + esc(p['Scheduled For']) : ''}${p.Profile && pname[p.Profile] ? ' · ◆ ' + esc(pname[p.Profile]) : ''}</div>
        <textarea data-k="Text" rows="5">${esc(p.Text)}</textarea><input type="text" data-k="Hashtags" value="${esc(p.Hashtags)}" placeholder="#hashtags" style="margin-top:6px">
        ${p['Image Idea'] ? `<div class="sub" style="margin-top:6px">🖼 Image idea: ${esc(p['Image Idea'])}</div>` : ''}
        <input type="url" data-k="Image URL" value="${esc(p['Image URL'])}" placeholder="Image link (https://…jpg) - needed to auto-post on Instagram" style="margin-top:6px">
        ${p['Post Link'] ? `<div class="sub" style="margin-top:6px"><a href="${esc(p['Post Link'])}" target="_blank" rel="noopener">See the post</a></div>` : ''}${/not posted/.test(p.Notes || '') ? `<div class="notice err" style="margin-top:6px">${esc(String(p.Notes).split('not posted: ').pop())}</div>` : ''}
        ${can ? `<div class="acts"><button class="btn sm" data-copy>Copy</button><a class="btn sm" data-open href="#" rel="noopener">Open ${esc(p.Platform)}</a>${d.ready[p.Platform] ? '<button class="btn sm primary" data-post>Post now</button>' : ''}<input type="datetime-local" data-when value="${esc(String(p['Scheduled For'] || '').replace(' ', 'T'))}" title="Schedule"><button class="btn sm ghost" data-sched>${d.ready[p.Platform] ? 'Schedule' : 'Remind'}</button><button class="btn sm ghost" data-done>Mark posted</button><button class="btn sm ghost" data-skip>Skip</button><button class="btn sm ghost" data-save>Save edits</button></div>` : ''}</article>`).join('')}</div>`
      : '<div class="tablewrap"><div class="empty"><b>No posts yet</b>Pick a product or service and click "Write posts".</div></div>');
  if ($('#spGo')) $('#spGo').onclick = e => busy(e.currentTarget, async () => { const platforms = $$('[data-pl]').filter(c => c.checked).map(c => c.dataset.pl); const r = await api('/social/generate', { method: 'POST', body: { profile: $('#spP').value, platforms, count: $('#spN').value, angle: $('#spA').value } }); toast(r.n + ' post(s) written'); route(); });
  $$('[data-sp]').forEach(card => { const p = d.posts[+card.dataset.sp]; if (!$('[data-copy]', card)) return;
    const cur = () => ({ ...p, Text: $('[data-k="Text"]', card).value, Hashtags: $('[data-k="Hashtags"]', card).value });
    const save = (extra = {}) => api('/social/posts/' + p['Post ID'], { method: 'PATCH', body: { Text: $('[data-k="Text"]', card).value, Hashtags: $('[data-k="Hashtags"]', card).value, 'Image URL': $('[data-k="Image URL"]', card).value, ...extra } });
    $('[data-copy]', card).onclick = () => copy(full(cur()));
    $('[data-open]', card).onclick = e => { e.preventDefault(); copy(full(cur())); window.open(SHARE[p.Platform](full(cur())), '_blank', 'noopener'); toast('Text copied: paste it there if it is not filled in, then post. Then click "Mark posted".'); };
    if ($('[data-post]', card)) $('[data-post]', card).onclick = e => busy(e.currentTarget, async () => { await save(); const r = await api('/social/posts/' + p['Post ID'] + '/post', { method: 'POST', body: {} }); toast('Posted on ' + p.Platform); route(); });
    $('[data-sched]', card).onclick = e => busy(e.currentTarget, async () => { const w = $('[data-when]', card).value; if (!w) throw new Error('Pick a date and time first.'); await save({ 'Scheduled For': w }); toast(d.ready[p.Platform] ? 'Scheduled: the app posts it then (keep the app running).' : 'Saved with a date: post it yourself then.'); route(); });
    $('[data-done]', card).onclick = e => busy(e.currentTarget, async () => { await save({ Status: 'Posted' }); route(); });
    $('[data-skip]', card).onclick = e => busy(e.currentTarget, async () => { await save({ Status: 'Skipped' }); route(); });
    $('[data-save]', card).onclick = e => busy(e.currentTarget, async () => { await save(); toast('Saved'); });
  });
}
async function socialDms() {
  const d = await api('/social/dms'); const open = d.list.filter(x => !x.sentOn);
  $('#t').innerHTML = `<div class="panel ansbar" style="margin-bottom:14px">${S.me.role !== 'linkedin' ? '<button class="btn" id="scanSo">🔎 Find social profiles of my leads</button>' : ''}<span class="sub">${d.scan && d.scan.running ? `Checking websites… ${d.scan.done} of ${d.scan.total}, ${d.scan.found} found` : `${open.length} lead(s) to message · ${d.list.length - open.length} done. New leads get their social links automatically.`}</span></div>` +
    (d.list.length ? `<div class="tasks">${d.list.map((r, i) => `<article class="task" data-dm="${i}"${r.sentOn ? ' style="opacity:.6"' : ''}><div class="step">${r.sentOn ? `Sent on ${esc(r.sentVia)} · ${esc(r.sentOn)}` : 'To message'}</div>
        <div class="top"><div><div class="strong">${esc(r.business)}</div><div class="sub">${esc(r.city || '')}${r.links.map(l => ` · <a href="${esc(l.profile)}" target="_blank" rel="noopener">${l.channel}</a>`).join('')}</div></div>${tag(r.status)}</div>
        <textarea data-msg rows="3">${esc(r.message)}</textarea>
        <div class="acts">${r.links.map(l => `<button class="btn sm ${l.channel === 'Instagram' ? 'primary' : ''}" data-go="${esc(l.url)}" data-ch="${l.channel}">Copy &amp; open ${l.channel}</button>`).join('')}</div></article>`).join('')}</div>`
      : '<div class="tablewrap"><div class="empty"><b>No social profiles found yet</b>Click "Find social profiles of my leads": the app looks at their websites for Instagram, Facebook, X and TikTok links.</div></div>');
  if ($('#scanSo')) $('#scanSo').onclick = e => busy(e.currentTarget, async () => { const r = await api('/social/scan', { method: 'POST', body: {} }); toast(r.msg); setTimeout(route, 8000); });
  if (d.scan && d.scan.running) setTimeout(() => { if (location.hash === '#/social' && !typing()) route(); }, 8000);
  $$('[data-dm]').forEach(card => { const r = d.list[+card.dataset.dm];
    $$('[data-go]', card).forEach(b => b.onclick = async () => { copy($('[data-msg]', card).value); window.open(b.dataset.go, '_blank', 'noopener'); try { await api('/social/dms/' + encodeURIComponent(r.id) + '/sent', { method: 'POST', body: { channel: b.dataset.ch } }); } catch (e) {} toast(`Message copied: paste it in the ${b.dataset.ch} chat and press Send.`); card.style.opacity = '.6'; $('.step', card).textContent = 'Sent on ' + b.dataset.ch; });
  });
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

/* ------------------------------------------------------------ sending limits: see and change them in one place */
const LIMITS = {
  email: [['DAILY_MAX_LIMIT', 'Emails per day, per inbox', 500, u => u.email != null ? `${fmt(u.email)} sent today (today's limit for all inboxes: ${fmt(u.emailToday)})` : ''], ['EMAIL_WARMUP', 'Slow start (warm-up)', 'select'], ['SEND_ORDER', 'Inbox order', 'order'], ['DAILY_START_LIMIT', 'Warm-up: per day in week 1, per inbox', 50], ['WEEKLY_INCREASE', 'Warm-up: added each week', 25]],
  linkedin: [['LINKEDIN_CONNECT_PER_DAY', 'LinkedIn requests per day, per account', 100, u => u.liToday != null ? `${fmt(u.liToday)} sent today` : ''], ['LINKEDIN_CONNECT_PER_WEEK', 'LinkedIn requests per week, per account', 200, u => u.liWeek != null ? `${fmt(u.liWeek)} this week` : ''], ['LINKEDIN_MESSAGES_PER_DAY', 'LinkedIn messages per day, per account', 150, u => u.liMsg != null ? `${fmt(u.liMsg)} sent today` : '']],
  whatsapp: [['WHATSAPP_PER_DAY', 'WhatsApp messages per day, per number', 1000]],
};
async function renderLimits(box, kinds, used = {}) {
  if (!box) return;
  let d; try { d = await api('/settings'); } catch (e) { return; }
  const v = d.values || {}, can = d.canEdit;
  const rows = kinds.flatMap(k => LIMITS[k]);
  box.className = 'panel limits'; box.style.marginBottom = '18px';
  box.innerHTML = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h2 style="margin:0">Sending limits</h2><span class="sub">How much goes out. ${can ? 'Change a number and click Save.' : 'Only the owner can change them.'}</span>${can ? '<button class="btn primary sm" id="limSave" style="margin-left:auto">Save limits</button>' : ''}</div>
    <div class="limgrid">${rows.map(([k, label, max, note]) => `<label class="f"><span>${label}</span>${max === 'order' ? `<select data-lim="${k}" ${can ? '' : 'disabled'}><option value="spread" ${v[k] !== 'one-by-one' ? 'selected' : ''}>Spread: every inbox a little all day (safest)</option><option value="one-by-one" ${v[k] === 'one-by-one' ? 'selected' : ''}>One by one: fill each inbox, then the next</option></select>` : max === 'select'
      ? `<select data-lim="${k}" ${can ? '' : 'disabled'}><option value="yes" ${v[k] !== 'no' ? 'selected' : ''}>On: start low, grow each week (safest)</option><option value="no" ${v[k] === 'no' ? 'selected' : ''}>Off: full limit from day one</option></select>`
      : `<input type="number" min="0" max="${max}" data-lim="${k}" value="${esc(v[k] || '')}" ${can ? '' : 'disabled'}>`}<small>${note ? esc(note(used)) + ' · ' : ''}${max === 'select' || max === 'order' ? '' : 'max ' + max}</small></label>`).join('')}</div>
    ${kinds.includes('email') ? '<div class="sub">Safest for cold email on Gmail: 20–50 a day per inbox, warm-up on. Many bounces (over 5%) or a high number get the inbox paused or blocked by Gmail: more inboxes is safer than a higher number. </div>' : ''}${kinds.includes('linkedin') ? '<div class="sub">LinkedIn itself allows about 100 invitations a week on a free account; going over can get the account restricted (the app pauses 7 days when LinkedIn shows its limit).</div>' : ''}`;
  if ($('#limSave', box)) $('#limSave', box).onclick = e => busy(e.currentTarget, async () => {
    const body = {};
    for (const el of $$('[data-lim]', box)) if (String(el.value) !== String(v[el.dataset.lim] || '')) body[el.dataset.lim] = el.value;
    if (!Object.keys(body).length) return toast('Nothing changed');
    await api('/settings', { method: 'PUT', body }); toast('Limits saved: ' + Object.keys(body).length + ' changed'); route();
  });
}

/* ------------------------------------------------------------ connections + account */
// Data storage: Google Sheet or Supabase (moving copies all data across first)
function storagePanel(c) {
  const supa = c.storage === 'supabase';
  return `<div class="panel" style="margin-bottom:18px"><h2>Data storage</h2>
    <div class="desc">${supa ? '✓ All leads, replies, settings, templates and logins are saved in <b>Supabase</b>.' : 'All data is saved in your <b>Google Sheet</b>. You can move it to <b>Supabase</b> (a free Postgres database).'}</div>
    <details ${supa ? '' : 'open'} style="margin-top:8px"><summary class="strong" style="cursor:pointer">${supa ? 'Supabase connection' : 'Move to Supabase'}</summary>
    <div class="how" style="margin-top:8px"><ol>
      <li>Sign up free at <b>supabase.com</b> → <b>New project</b> (any name, save the database password somewhere safe).</li>
      <li>Open <b>SQL Editor</b> → <b>New query</b> → paste the setup SQL below → <b>Run</b>. (One time only. It lets the app create its own tables.)</li>
      <li><b>Project Settings → Data API</b>: copy the <b>Project URL</b>. <b>Project Settings → API Keys</b>: copy the <b>secret key</b> (sb_secret_… or the service_role key). Paste both below.</li>
      <li>Click <b>Save &amp; test</b>, then <b>Move my data to Supabase</b>. Everything in the Google Sheet is copied across and the app switches over. The Sheet is left as it is, as a backup.</li></ol></div>
    <label class="f"><span>Setup SQL <button class="copy" type="button" id="cpSql">Copy</button></span><textarea readonly rows="6" style="font-family:monospace;font-size:12px">${esc(c.supabaseSql)}</textarea></label>
    <div class="row2"><label class="f"><span>Supabase Project URL</span><input type="url" id="supabaseUrl" value="${esc(c.supabaseUrl)}" placeholder="https://abcdefgh.supabase.co"></label>
    <label class="f"><span>Supabase secret key</span><input type="password" id="supabaseKey" value="${esc(c.supabaseKey)}" placeholder="sb_secret_…" autocomplete="off"><small>Keep it private: it can read and change all data. Stored only on this PC, encrypted.</small></label></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" id="supTest">Save &amp; test</button>${supa ? `<button class="btn ghost" id="toSheet">Go back to the Google Sheet</button>` : `<button class="btn primary" id="supMove">Move my data to Supabase</button>`}</div>
    <div id="supMsg" style="margin-top:12px"></div></details></div>`;
}
function storageWire(c) {
  const m = (t, cls) => { $('#supMsg').innerHTML = `<div class="notice ${cls}">${esc(t)}</div>`; };
  const save = () => api('/connections', { method: 'POST', body: { supabaseUrl: $('#supabaseUrl').value.trim(), supabaseKey: $('#supabaseKey').value.trim() } });
  $('#cpSql').onclick = () => copy(c.supabaseSql);
  $('#supTest').onclick = e => busy(e.currentTarget, async () => { try { await save(); const r = await api('/connections/test', { method: 'POST', body: { what: 'supabase' } }); m(r.msg, 'ok'); } catch (err) { m(err.message, 'err'); } });
  if ($('#supMove')) $('#supMove').onclick = e => {
    if (!confirm('Copy all data from the Google Sheet to Supabase and save to Supabase from now on?\n\nThe Google Sheet is not changed (it stays as a backup). This can take a minute.')) return;
    busy(e.currentTarget, async () => { try { await save(); const r = await api('/connections/supabase/move', { method: 'POST', body: {} }); m(r.msg, 'ok'); toast('Now saving to Supabase'); setTimeout(route, 2500); } catch (err) { m(err.message, 'err'); } });
  };
  if ($('#toSheet')) $('#toSheet').onclick = e => {
    if (!confirm('Save to the Google Sheet again?\n\nData added in Supabase since the move is NOT copied back to the Sheet.')) return;
    busy(e.currentTarget, async () => { await api('/connections', { method: 'POST', body: { storage: 'sheet' } }); toast('Now saving to the Google Sheet'); route(); });
  };
}
async function pageConnections(el) {
  let c; try { c = await api('/connections'); } catch (e) { el.innerHTML = head('Connections') + `<div class="notice">${esc(e.message)}</div>`; return; }
  el.innerHTML = head('Connections', 'Private keys are stored only on this PC (encrypted), never in the Google Sheet or Supabase.') + storagePanel(c) +
    `<div class="panel"><div class="row2">
      <label class="f"><span>Google Sheet link</span><input type="url" id="sheetUrl" value="${esc(c.sheetUrl)}"></label>
      <label class="f"><span>Service account</span><input type="text" value="${esc(c.serviceAccountEmail)}" disabled><small>Replace the key: <a href="#" id="rk">upload a new .json</a></small><input type="file" id="saFile" class="hidden" accept=".json"></label>
      <label class="f"><span>Gmail address</span><input type="email" id="gmailUser" value="${esc(c.gmailUser)}"></label>
      <label class="f"><span>Gmail app password</span><input type="password" id="gmailAppPassword" value="${esc(c.gmailAppPassword)}" autocomplete="off"></label>
      <label class="f"><span>Which AI writes the emails</span><select id="aiProvider"><option value="gemini" ${c.aiProvider !== 'openai' ? 'selected' : ''}>Google Gemini (free)</option><option value="openai" ${c.aiProvider === 'openai' ? 'selected' : ''}>ChatGPT (paid)</option></select><small>Without a key (or when the free daily requests are used up) your email templates are used.</small></label>
      <label class="f" data-ai="gemini"><span>Gemini API key (free)</span><input type="password" id="geminiKey" value="${esc(c.geminiKey)}" autocomplete="off"><small>Free, no card: aistudio.google.com/apikey → Create API key</small></label>
      <label class="f" data-ai="openai"><span>ChatGPT (OpenAI) API key</span><input type="password" id="openaiKey" value="${esc(c.openaiKey)}" placeholder="sk-…" autocomplete="off"><small>Paid: needs credit on your OpenAI account</small></label>
      <label class="f"><span>WhatsApp phone number ID (optional)</span><input type="text" id="waPhoneId" value="${esc(c.waPhoneId)}" autocomplete="off"><small>Official WhatsApp Cloud API: developers.facebook.com → your app → WhatsApp → API setup → Phone number ID</small></label>
      <label class="f"><span>WhatsApp access token (optional)</span><input type="password" id="waToken" value="${esc(c.waToken)}" autocomplete="off"><small>A permanent token (System user token in Meta Business settings). Without it, WhatsApp stays manual.</small></label>
      <label class="f"><span>Google Places API key (optional)</span><input type="password" id="googlePlacesKey" value="${esc(c.googlePlacesKey)}" autocomplete="off"><small>More leads with ratings: console.cloud.google.com → Places API (New) → Credentials. Free monthly allowance.</small></label>
      <label class="f"><span>TomTom API key (optional)</span><input type="password" id="tomtomKey" value="${esc(c.tomtomKey)}" autocomplete="off"><small>developer.tomtom.com → free 2,500 searches a day, no card.</small></label>
      <label class="f"><span>Geoapify API key (optional)</span><input type="password" id="geoapifyKey" value="${esc(c.geoapifyKey)}" autocomplete="off"><small>myprojects.geoapify.com → free 3,000 credits a day, no card.</small></label>
      <label class="f"><span>HERE API key (optional)</span><input type="password" id="hereKey" value="${esc(c.hereKey)}" autocomplete="off"><small>platform.here.com → free monthly allowance.</small></label>
      <label class="f"><span>Where to find new leads</span><select id="leadSource"><option value="free" ${c.leadSource !== 'apify' ? 'selected' : ''}>Free: OpenStreetMap + web search (no key)</option><option value="apify" ${c.leadSource === 'apify' ? 'selected' : ''}>Apify Google Maps (paid)</option></select></label>
      <label class="f" data-src="apify"><span>Apify token</span><input type="password" id="apifyToken" value="${esc(c.apifyToken)}" autocomplete="off"></label></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary" id="sv">Save</button>${[['sheet', 'Google Sheet'], ['gmail', 'Gmail'], ['gemini', 'Gemini', 'gemini'], ['openai', 'ChatGPT', 'openai'], ['free', 'free lead finding', '', 'free'], ['whatsapp', 'WhatsApp'], ['googlePlaces', 'Google Places'], ['tomtom', 'TomTom'], ['geoapify', 'Geoapify'], ['here', 'HERE'], ['apify', 'Apify', '', 'apify']].map(([w, l, ai, src]) => `<button class="btn" data-t="${w}"${ai ? ` data-ai="${ai}"` : ''}${src ? ` data-src="${src}"` : ''}>Test ${l}</button>`).join('')}</div><div id="msg" style="margin-top:14px"></div></div>`;
  const show = () => { $$('[data-ai]').forEach(x => x.classList.toggle('hidden', x.dataset.ai !== $('#aiProvider').value)); $$('[data-src]').forEach(x => x.classList.toggle('hidden', x.dataset.src !== $('#leadSource').value)); };
  $('#aiProvider').onchange = show; $('#leadSource').onchange = show; show();
  storageWire(c);
  const save = async () => { const b = {}; for (const id of ['sheetUrl', 'gmailUser', 'gmailAppPassword', 'geminiKey', 'openaiKey', 'apifyToken', 'aiProvider', 'leadSource', 'googlePlacesKey', 'tomtomKey', 'geoapifyKey', 'hereKey', 'waPhoneId', 'waToken']) b[id] = $('#' + id).value.trim(); await api('/connections', { method: 'POST', body: b }); };
  $('#sv').onclick = e => busy(e.currentTarget, async () => { await save(); toast('Saved'); });
  $$('[data-t]').forEach(b => b.onclick = () => busy(b, async () => { try { await save(); const r = await api('/connections/test', { method: 'POST', body: { what: b.dataset.t } }); $('#msg').innerHTML = `<div class="notice ok">${esc(r.msg)}</div>`; } catch (err) { $('#msg').innerHTML = `<div class="notice err">${esc(err.message)}</div>`; } }));
  // extra sending inboxes: more inboxes = more emails a day without pushing any one account too hard
  const ib = document.createElement('div'); ib.className = 'panel'; ib.style.marginTop = '18px';
  ib.innerHTML = `<h3 style="margin-top:0">Sending inboxes and senders</h3>
    <div class="how">Each inbox sends its own daily amount (starts at 20 a day and grows every week), so 3 inboxes send about 3× as many pitches without any single account looking like spam. Best: Google Workspace inboxes on a <b>separate domain</b> just for outreach. For each inbox: turn on 2-Step Verification, create an <b>App Password</b>, and turn on IMAP in Gmail settings.</div>
    <h4 style="margin:14px 0 4px">Sender for each inbox</h4><div class="sub">Emails from an inbox are written and signed in that person's name, with their title and LinkedIn link. Empty = the sender in Settings (${esc(c.mainSender && c.mainSender.senderName || 'Settings → Sender')}).</div>
    <div class="senders">${[{ ...(c.mainSender || {}), main: true }, ...(c.inboxes || [])].filter(x => x.user).map(x => `<div class="snd" data-snd="${esc(x.user)}"><div class="strong" style="grid-column:1/-1">${esc(x.user)}${x.main ? ' <span class="sub">(main)</span>' : ` <span class="sub">added ${esc(x.added || '')}</span>`}</div><input type="text" data-k="senderName" placeholder="Sender name" value="${esc(x.senderName)}"><input type="text" data-k="senderTitle" placeholder="Title (e.g. Business Development Executive)" value="${esc(x.senderTitle)}"><input type="url" data-k="senderLinkedIn" placeholder="LinkedIn link (https://www.linkedin.com/in/…)" value="${esc(x.senderLinkedIn)}"><div class="acts" style="margin:0"><button class="btn sm primary" data-sv>Save sender</button>${x.main ? '' : `<button class="btn sm ghost" data-rm="${esc(x.user)}">Remove inbox</button>`}</div></div>`).join('')}</div>
    ${(c.inboxes || []).length ? '' : '<p class="sub">Only the main Gmail above is sending right now.</p>'}
    <div class="row2"><label class="f"><span>Inbox email</span><input type="email" id="ibU" placeholder="sales@your-outreach-domain.com" autocomplete="off"></label>
    <label class="f"><span>App password (16 letters)</span><input type="password" id="ibP" placeholder="abcd efgh ijkl mnop" autocomplete="off"></label>
    <label class="f"><span>Sender name (optional)</span><input type="text" id="ibN" placeholder="e.g. Priya"></label><label class="f"><span>Sender title (optional)</span><input type="text" id="ibT" placeholder="e.g. Business Development Executive"></label>
    <label class="f"><span>Sender LinkedIn link (optional)</span><input type="url" id="ibL" placeholder="https://www.linkedin.com/in/…"></label></div>
    <button class="btn primary" id="ibAdd">Test &amp; add inbox</button><div id="ibMsg" style="margin-top:12px"></div>`;
  el.appendChild(ib);
  $('#ibAdd').onclick = e => busy(e.currentTarget, async () => { try { const r = await api('/connections/inboxes', { method: 'POST', body: { user: $('#ibU').value, pass: $('#ibP').value, senderName: $('#ibN').value, senderTitle: $('#ibT').value, senderLinkedIn: $('#ibL').value } }); toast(r.msg); route(); } catch (err) { $('#ibMsg').innerHTML = `<div class="notice err">${esc(err.message)}</div>`; } });
  $$('[data-snd]', ib).forEach(row => { $('[data-sv]', row).onclick = e => busy(e.currentTarget, async () => { const body = {}; $$('[data-k]', row).forEach(i => body[i.dataset.k] = i.value.trim()); await api('/inboxes/' + encodeURIComponent(row.dataset.snd), { method: 'PATCH', body }); toast('Sender saved for ' + row.dataset.snd); }); });
  $$('[data-rm]', ib).forEach(b => b.onclick = () => busy(b, async () => { if (!confirm('Stop sending from ' + b.dataset.rm + '? Replies to its emails will no longer be read.')) return; await api('/connections/inboxes/' + encodeURIComponent(b.dataset.rm), { method: 'DELETE' }); toast('Removed'); route(); }));
  const wn = document.createElement('div'); wn.className = 'panel'; wn.style.marginTop = '18px';
  wn.innerHTML = `<h3 style="margin-top:0">Extra WhatsApp numbers</h3>
    <div class="how">Each number sends its own daily amount (Settings → WhatsApp per day). When one number is full for the day, or WhatsApp limits or restricts it, the next number takes over by itself. Add numbers in Meta first: <b>business.facebook.com → WhatsApp Manager → Phone numbers → Add phone number</b>, then copy its <b>Phone number ID</b> from developers.facebook.com → your app → WhatsApp → API setup. Numbers in the same Meta business can use the main access token (leave the token empty). Note: Meta counts its daily limit for the whole business, so extra numbers spread the sending and protect each number, but do not raise Meta's own total.</div>
    ${(c.waNumbers || []).length ? `<div class="tablewrap" style="margin:10px 0"><table><thead><tr><th>Number</th><th>Phone number ID</th><th>Added</th><th></th></tr></thead><tbody>${c.waNumbers.map(x => `<tr><td>${esc(x.label || '-')}</td><td>${esc(x.id)}</td><td>${esc(x.added)}</td><td style="text-align:right"><button class="btn sm ghost" data-warm="${esc(x.id)}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : `<p class="sub">${c.waPhoneId ? 'Only the main WhatsApp number above is sending right now.' : 'Connect the main WhatsApp number above first.'}</p>`}
    <div class="row2"><label class="f"><span>Phone number ID</span><input type="text" id="wnId" placeholder="1234567890123456" autocomplete="off"></label>
    <label class="f"><span>Access token (leave empty to use the main one)</span><input type="password" id="wnTok" autocomplete="off"></label></div>
    <button class="btn primary" id="wnAdd">Test &amp; add number</button><div id="wnMsg" style="margin-top:12px"></div>`;
  el.appendChild(wn);
  $('#wnAdd').onclick = e => busy(e.currentTarget, async () => { try { const r = await api('/connections/wa-numbers', { method: 'POST', body: { id: $('#wnId').value, token: $('#wnTok').value } }); toast(r.msg); route(); } catch (err) { $('#wnMsg').innerHTML = `<div class="notice err">${esc(err.message)}</div>`; } });
  $$('[data-warm]', wn).forEach(b => b.onclick = () => busy(b, async () => { if (!confirm('Stop sending WhatsApp pitches from this number?')) return; await api('/connections/wa-numbers/' + encodeURIComponent(b.dataset.warm), { method: 'DELETE' }); toast('Removed'); route(); }));
  const so = document.createElement('div'); so.className = 'panel'; so.style.marginTop = '18px';
  so.innerHTML = `<h3 style="margin-top:0">Social media: auto-post to your own pages (optional)</h3>
    <div class="how">Without these, the Social media page still writes every post and opens each platform with the text ready. To post automatically:<br>
    <b>Facebook Page + Instagram Business</b>: developers.facebook.com → your app → Graph API Explorer → a <b>Page access token</b> (long-lived) with pages_manage_posts, instagram_content_publish; the <b>Page ID</b> (Page → About); the <b>Instagram business account ID</b> (Page → Settings → Linked accounts). Instagram only posts with an image link.<br>
    <b>X</b>: developer.x.com → your app → Keys and tokens (Read and write): API key + secret, Access token + secret.<br>
    <b>LinkedIn</b>: LinkedIn does not allow automatic posting without its approval, so the app opens LinkedIn with the post ready.</div>
    <div class="row2"><label class="f"><span>Facebook Page ID</span><input type="text" id="fbPageId" value="${esc(c.fbPageId)}" autocomplete="off"></label><label class="f"><span>Instagram business account ID</span><input type="text" id="igUserId" value="${esc(c.igUserId)}" autocomplete="off"></label>
    <label class="f"><span>Page access token (Facebook + Instagram)</span><input type="password" id="fbPageToken" value="${esc(c.fbPageToken)}" autocomplete="off"></label><span></span>
    <label class="f"><span>X API key</span><input type="password" id="xApiKey" value="${esc(c.xApiKey)}" autocomplete="off"></label><label class="f"><span>X API key secret</span><input type="password" id="xApiSecret" value="${esc(c.xApiSecret)}" autocomplete="off"></label>
    <label class="f"><span>X access token</span><input type="password" id="xAccessToken" value="${esc(c.xAccessToken)}" autocomplete="off"></label><label class="f"><span>X access token secret</span><input type="password" id="xAccessSecret" value="${esc(c.xAccessSecret)}" autocomplete="off"></label></div>
    <div class="acts"><button class="btn primary" id="soSave">Save</button>${['Facebook', 'Instagram', 'X'].map(p => `<button class="btn" data-sot="${p}">Test ${p}</button>`).join('')}</div><div id="soMsg" style="margin-top:10px"></div>`;
  el.appendChild(so);
  const soSave = async () => { const b = {}; for (const id of ['fbPageId', 'igUserId', 'fbPageToken', 'xApiKey', 'xApiSecret', 'xAccessToken', 'xAccessSecret']) b[id] = $('#' + id, so).value.trim(); await api('/connections', { method: 'POST', body: b }); };
  $('#soSave', so).onclick = e => busy(e.currentTarget, async () => { await soSave(); toast('Saved'); });
  $$('[data-sot]', so).forEach(b => b.onclick = () => busy(b, async () => { try { await soSave(); const r = await api('/connections/test', { method: 'POST', body: { what: b.dataset.sot } }); $('#soMsg', so).innerHTML = `<div class="notice ok">${esc(r.msg)}</div>`; } catch (err) { $('#soMsg', so).innerHTML = `<div class="notice err">${esc(err.message)}</div>`; } }));
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
setInterval(() => { const p = location.hash.replace(/^#\/?/, '') || 'dashboard'; if (S.me && ['dashboard', 'activity'].includes(p) && !document.querySelector('#scrim') && !typing()) route(); }, 120000);
