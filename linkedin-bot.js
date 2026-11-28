// LinkedIn auto-connect (Windows app only).
// Uses YOUR LinkedIn and your team members' own LinkedIn accounts, each signed in once in its own window of the app
// (the app never sees or stores a password). When one account is full for the day or LinkedIn shows its limit, the next takes over.
// 1. Sends connection requests (with the AI-written note) to "To Connect" prospects, slowly and only in working hours.
// 2. Every hour checks which requests were accepted, marks them "Connected" and the app notifies you to message them.
// LinkedIn does not allow automation tools: keep the daily number low. The app caps it at 25 a day and 80 a week.
const { BrowserWindow, session, app } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./server/store');
const engine = require('./server/engine');
const config = require('./server/config');

const BASE = (process.env.AAVORAA_LI_BASE || 'https://www.linkedin.com').replace(/\/$/, '');
const PART = 'persist:linkedin';
const FILE = path.join(config.dir, 'linkedin-bot.json');
const MAX_DAY = 100, MAX_WEEK = 200, CHECK_EVERY = 60 * 60e3;
let HARD_DAY = 25, HARD_WEEK = 100; // updated from Settings on every run (LINKEDIN_CONNECT_PER_DAY / LINKEDIN_CONNECT_PER_WEEK)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => Math.round(a + Math.random() * (b - a));
const log = (msg, level) => engine.log('linkedin', msg, level);
const indiaNow = () => new Date(Date.now() + 5.5 * 3600e3); // same clock as the email sending hours

let st = { nextSendAt: 0, lastCheck: 0, pausedUntil: 0, profileChecked: {}, replyChecked: {}, fails: 0, lastResult: '', lastSignInWarn: '', acc: {} };
try { st = { ...st, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch (e) {}
st.replyChecked = st.replyChecked || {};
st.acc = st.acc || {};
if (!st.acc.main) st.acc.main = { pausedUntil: st.pausedUntil || 0, fails: st.fails || 0 }; // older versions had one account
const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(st)); } catch (e) {} };
let busy = false, timer = null, onChange = () => {}, uiParent = () => null;
const loginWins = {}, signedMap = {};

// ---------------------------------------------------------------- team LinkedIn accounts
// The main LinkedIn + one LinkedIn per team member. Each signs in once in its own private window (own cookies, the app
// never sees a password). New requests go from the account with the most room left today; when one is full or LinkedIn
// shows its limit, the next account takes over. A lead always stays with the account that connected to it
// (messages, accepted checks and replies use that same account).
const MAX_ACCOUNTS = 10;
function accounts() {
  const c = config.get();
  return [{ id: 'main', name: c.liMainName || 'Main LinkedIn', part: PART, main: true, added: '' },
    ...(c.liAccounts || []).filter(x => x && x.id).map(x => ({ id: x.id, name: x.name || 'Team LinkedIn', part: 'persist:linkedin-' + x.id, main: false, added: x.added || '' }))];
}
const accOf = id => accounts().find(a => a.id === String(id || 'main'));
const rowAcc = r => String(r['LinkedIn Account'] || 'main');
const ast = id => (st.acc[id] = st.acc[id] || { pausedUntil: 0, fails: 0 });
const isPaused = a => Date.now() < (ast(a.id).pausedUntil || 0);
const who = a => a.main ? 'your LinkedIn' : `${a.name}'s LinkedIn`;
const uaDone = new Set();
const ses = (a = accounts()[0]) => {
  const s = session.fromPartition(a.part);
  if (!uaDone.has(a.part)) { uaDone.add(a.part); try { s.setUserAgent(app.userAgentFallback.replace(/\s(Electron|aavoraa[^\s]*|AAVORAA[^\s]*)\/\S+/gi, '')); } catch (e) {} } // look like normal Chrome
  return s;
};
async function checkSignedIn(a = accounts()[0]) {
  let ok = false;
  try { ok = (await ses(a).cookies.get({ name: 'li_at' })).some(c => c.value); } catch (e) { ok = false; }
  signedMap[a.id] = ok; return ok;
}
async function signedAccounts() { const out = []; for (const a of accounts()) if (await checkSignedIn(a)) out.push(a); return out; }
const slug = u => { const m = String(u || '').match(/\/in\/([^/?#]+)/i); try { return m ? decodeURIComponent(m[1]).toLowerCase() : ''; } catch (e) { return m ? m[1].toLowerCase() : ''; } };
const profileUrl = u => { const s = String(u || '').match(/\/in\/[^/?#]+/i); return s ? BASE + s[0] + '/' : ''; };

function settings(s) {
  const hours = String(s.LINKEDIN_CONNECT_HOURS || '10-18').match(/(\d+)\s*-\s*(\d+)/) || [0, 10, 18];
  return {
    on: String(s.LINKEDIN_AUTO_CONNECT || 'no').toLowerCase() === 'yes' && String(s.AGENT_ON || 'yes').toLowerCase() !== 'no',
    perDay: (HARD_DAY = Math.max(1, Math.min(MAX_DAY, Number(s.LINKEDIN_CONNECT_PER_DAY) || 15)), HARD_WEEK = Math.max(1, Math.min(MAX_WEEK, Number(s.LINKEDIN_CONNECT_PER_WEEK) || 100)), HARD_DAY),
    autoMessage: String(s.LINKEDIN_AUTO_MESSAGE || 'yes').toLowerCase() !== 'no',
    msgPerDay: Math.max(1, Math.min(150, Number(s.LINKEDIN_MESSAGES_PER_DAY) || 60)),
    note: String(s.LINKEDIN_CONNECT_NOTE || 'yes').toLowerCase() !== 'no',
    from: Number(hours[1]), to: Number(hours[2]),
  };
}
// requests sent today / this week: by one account (id) or by all of them
function counts(rows, id) {
  const day = engine.today(), week = new Date(Date.now() + 5.5 * 3600e3 - 7 * 86400e3).toISOString().slice(0, 10);
  const sent = rows.filter(r => !id || rowAcc(r) === id).map(r => String(r['Request Sent On'] || '')).filter(Boolean);
  return { today: sent.filter(d => d === day).length, week: sent.filter(d => d > week).length };
}
// how many more requests this account may send today (its own daily and weekly limit)
function room(a, rows, s) {
  if (isPaused(a) || !signedMap[a.id]) return 0;
  const c = counts(rows, a.id);
  return Math.max(0, Math.min(s.perDay - c.today, HARD_WEEK - c.week));
}
const usable = (rows, s) => accounts().filter(a => room(a, rows, s) > 0).sort((x, y) => room(y, rows, s) - room(x, rows, s));

// ---------------------------------------------------------------- the hidden LinkedIn page
function pageWindow(a = accounts()[0]) {
  ses(a);
  const w = new BrowserWindow({ show: process.env.AAVORAA_LI_SHOW === '1', width: 1280, height: 900, webPreferences: { partition: a.part, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  w.__acc = a; return w;
}
async function open(w, url) {
  try { await w.loadURL(url); } catch (e) { if (!/ERR_ABORTED/.test(e.message)) throw e; }
  await sleep(rand(3500, 6500));
  const at = w.webContents.getURL();
  const a = w.__acc || accounts()[0];
  if (/\/(login|authwall|checkpoint|uas\/login)/i.test(at)) { signedMap[a.id] = false; throw Object.assign(new Error(`LinkedIn signed out ${who(a)}. Click "Sign in" next to ${a.name} on the LinkedIn tasks page.`), { signOut: true, acc: a.id }); }
  if (/\/404|unavailable/i.test(at)) throw new Error('This LinkedIn profile is not available.');
}
// Runs a function inside the LinkedIn page with small helpers that also look inside LinkedIn's pop-up layers (shadow DOM).
// Works with LinkedIn's 2026 profile layout (name in the page title, actions next to "More", Connect/Message as links)
// and the older one (name in <h1>, buttons in the top card).
const LIB = `
  const all = () => { const out = []; const walk = n => { for (const el of n.querySelectorAll('*')) { out.push(el); if (el.shadowRoot) walk(el.shadowRoot); } }; walk(document); return out; };
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const txt = el => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
  const lab = el => ((el.getAttribute('aria-label') || '') + ' | ' + txt(el)).trim();
  const btns = root => (root ? [...root.querySelectorAll('*')] : all()).filter(el => (/^(BUTTON|A)$/.test(el.tagName) || /^(button|menuitem)$/.test(el.getAttribute('role') || '')) && vis(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
  const h1 = document.querySelector('main h1') || document.querySelector('h1');
  const title = document.title.replace(/^\\(\\d+\\+?\\)\\s*/, '');
  const name = (h1 && txt(h1)) || (title.includes('|') ? title.split('|')[0].trim() : '');
  const first = name.split(/\\s+/)[0] || '';
  // the profile's own action buttons sit next to the left-most "More" (LinkedIn repeats them in a sticky bar on the right)
  const mores = btns().filter(el => /^more$/i.test(txt(el)) || /^more actions$/i.test((el.getAttribute('aria-label') || '').trim())).sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);
  let top = null;
  if (mores[0]) { top = mores[0].parentElement; for (let i = 0; top && i < 6 && top.querySelectorAll('a,button').length < 2; i++) top = top.parentElement; }
  if (!top && h1) { top = h1; for (let i = 0; top && i < 12 && !(top.tagName === 'SECTION' || (top.querySelectorAll && top.querySelectorAll('button').length >= 2)); i++) top = top.parentElement; }
  top = top || document.querySelector('main') || document.body;
  const card = (() => { let c = top; for (let i = 0; i < 6 && c.parentElement; i++) c = c.parentElement; return c; })();
  const isConnect = el => /invite .* to connect/i.test(el.getAttribute('aria-label') || '') || /^connect$/i.test(txt(el)) || /custom-invite/.test(el.getAttribute('href') || '');
  const isMessage = el => /^message$/i.test(txt(el)) || /^message\\b/i.test(el.getAttribute('aria-label') || '') || /messaging\\/compose/.test(el.getAttribute('href') || '');
  const isMine = el => { const a = el.getAttribute('aria-label') || ''; return !/invite .* to connect/i.test(a) || !first || a.toLowerCase().includes(first.toLowerCase()); };
  const click = el => { el.scrollIntoView({ block: 'center' }); el.click(); };
  const say = t => all().some(el => el.children.length === 0 && vis(el) && t.test(el.textContent || ''));
`;
const run = (w, body, arg) => w.webContents.executeJavaScript(`(() => { ${LIB} const arg = ${JSON.stringify(arg || null)}; ${body} })()`, true);
// wait until something appears on the page (LinkedIn loads in pieces)
async function waitFor(w, body, ms = 12000) { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await run(w, body).catch(() => null); if (v) return v; await sleep(700); } return v; }

// what the profile's top card says: connected (1st), pending, or can connect
const STATE_JS = `
  const b = btns(top), L = b.map(lab).join(' || ');
  if (/\\bpending\\b|withdraw/i.test(L)) return { state: 'pending', name };
  const hasConnect = b.some(isConnect), hasMsg = b.some(isMessage);
  const wide = txt(card);
  if (!hasConnect && (/(^|[^a-z])1st([^a-z]|$)/i.test(wide) || (hasMsg && !/(^|\\|\\s)follow\\b/i.test(L)))) return { state: 'connected', name };
  return { state: 'other', name, hasConnect, hasMsg };
`;

async function sendRequest(r, note, a) {
  const w = pageWindow(a || accOf(rowAcc(r)) || accounts()[0]);
  try {
    await open(w, profileUrl(r['LinkedIn URL']));
    let s = await waitFor(w, `const s = (() => { ${STATE_JS} })(); return s.name ? s : null;`, 10000) || await run(w, STATE_JS);
    if (s.state === 'pending' || s.state === 'connected') return { result: s.state };
    // 1. open LinkedIn's own invite box for this profile (works whether "Connect" is on the card or hidden under "More")
    await open(w, BASE + '/preload/custom-invite/?vanityName=' + encodeURIComponent(slug(r['LinkedIn URL'])));
    const dlg = await waitFor(w, `
      if (say(/enter (their|his|her) email|know .* outside of linkedin|how do you know/i)) return 'email';
      if (say(/weekly invitation limit|reached the weekly limit|too many invitations/i)) return 'limit';
      const t = btns().map(lab).join(' || ');
      return /add a note/i.test(t) ? 'note' : /send without a note/i.test(t) ? 'send' : '';`, 12000);
    if (dlg === 'email') return { result: 'needs-email' };
    if (dlg === 'limit') return { result: 'limit' };
    if (!dlg) return { result: 'noconnect' };
    let withNote = false;
    if (note && dlg === 'note') {
      await run(w, `const b = btns().find(el => /add a note/i.test(lab(el))); if (b) click(b);`);
      const box = await waitFor(w, `const t = all().find(el => el.tagName === 'TEXTAREA' && vis(el)); if (!t) return false; t.focus(); t.value = ''; return true;`, 6000);
      if (box) {
        w.webContents.insertText(note.slice(0, 200)); // free accounts allow 200 characters
        await sleep(rand(1200, 2200));
        withNote = await run(w, `const b = btns().find(el => /^(send|send invitation|send now)$/i.test((el.getAttribute('aria-label') || '').trim()) || /^send$/i.test(txt(el))); if (b) { click(b); return true; } return false;`);
      }
      if (!withNote) { // out of free notes (Premium pop-up): open the invite box again and send without a note
        await open(w, BASE + '/preload/custom-invite/?vanityName=' + encodeURIComponent(slug(r['LinkedIn URL'])));
        await waitFor(w, `return /send without a note/i.test(btns().map(lab).join(' '));`, 10000);
      }
    }
    if (!withNote) {
      const ok = await run(w, `const b = btns().find(el => /send without a note/i.test(lab(el))) || btns().find(el => /^(send|send now)$/i.test(txt(el))); if (b) { click(b); return true; } return false;`);
      if (!ok) return { result: 'nosend' };
    }
    await sleep(rand(2500, 4000));
    if (await run(w, `return say(/weekly invitation limit|reached the weekly limit|too many invitations/i);`)) return { result: 'limit' };
    await open(w, profileUrl(r['LinkedIn URL']));
    s = await waitFor(w, `const s = (() => { ${STATE_JS} })(); return s.name ? s : null;`, 8000) || {};
    return { result: 'sent', withNote, verified: s.state === 'pending' };
  } finally { w.destroy(); }
}

async function profileState(r, a) {
  const w = pageWindow(a || accOf(rowAcc(r)) || accounts()[0]);
  try { await open(w, profileUrl(r['LinkedIn URL'])); const s = await waitFor(w, `const s = (() => { ${STATE_JS} })(); return s.name ? s : null;`, 10000); return s ? s.state : ''; } finally { w.destroy(); }
}
async function recentConnections(a) {
  const w = pageWindow(a);
  try {
    await open(w, BASE + '/mynetwork/invite-connect/connections/');
    for (let i = 0; i < 4; i++) { await run(w, `window.scrollTo(0, document.body.scrollHeight); return 1;`); await sleep(rand(1500, 2500)); }
    return await run(w, `return [...new Set(all().filter(a => a.tagName === 'A' && /\\/in\\//.test(a.href || '')).map(a => a.href))];`);
  } finally { w.destroy(); }
}

const note = (r, ...t) => [r.Notes, `${engine.today()}: ${t.join(' ')}`].filter(Boolean).join(' | ').slice(0, 1000);
async function setRow(r, set) { await store.update('LinkedIn Leads', 'Lead ID', [{ key: r['Lead ID'], set }]); onChange(); }

// ---------------------------------------------------------------- the two jobs
async function checkAccepted(rows) {
  const waitingAll = rows.filter(r => r.Status === 'Request Sent' && slug(r['LinkedIn URL']));
  st.lastCheck = Date.now(); save();
  if (!waitingAll.length) return 0;
  let n = 0;
  const accepted = async (r, a) => { await setRow(r, { Status: 'Connected', 'Connected On': engine.today(), Notes: note(r, `accepted the connection request${a.main ? '' : ' (' + a.name + ')'}`) }); n++; log(`${r.Name} accepted ${a.main ? 'your' : a.name + "'s"} connection request - send them the first message`); };
  for (const a of accounts()) {
    const waiting = waitingAll.filter(r => rowAcc(r) === a.id);
    if (!waiting.length || !(await checkSignedIn(a))) continue; // that account is signed out: checked again after it signs in
    const links = new Set((await recentConnections(a).catch(() => [])).map(slug));
    const perCheck = links.size ? 3 : 8; // LinkedIn's 2026 connections page no longer lists links: look at more profiles instead
    for (const r of waiting) if (links.has(slug(r['LinkedIn URL']))) await accepted(r, a);
    // older requests that are not in the recent list: look at a few profiles a check
    const old = waiting.filter(r => !links.has(slug(r['LinkedIn URL'])) && (Date.now() - (st.profileChecked[r['Lead ID']] || 0)) > 12 * 3600e3 && (Date.now() - new Date(String(r['Request Sent On'] || '2000-01-01')).getTime()) > 6 * 3600e3).slice(0, perCheck);
    for (const r of old) {
      await sleep(FAST ? 200 : rand(20e3, 45e3));
      st.profileChecked[r['Lead ID']] = Date.now(); save();
      if (!signedMap[a.id]) break; // signed out while checking
      const s = await profileState(r, a).catch(() => '');
      if (s === 'connected') await accepted(r, a);
    }
  }
  return n;
}

// sends the next request in the queue from account a (default: the account with the most room left today)
async function connectNext(s, rows, a) {
  if (!a) { await signedAccounts(); a = usable(rows, s)[0]; }
  if (!a) return '';
  const queue = rows.filter(r => r.Status === 'To Connect' && slug(r['LinkedIn URL']) && !/auto-connect skipped \(v2\)/i.test(String(r.Notes || '')))
    .sort((x, y) => Number(y['Fit Score'] || 0) - Number(x['Fit Score'] || 0));
  const r = queue[0]; if (!r) return '';
  const tag = a.main ? '' : ` (from ${a.name}'s LinkedIn)`;
  let res;
  try { res = await sendRequest(r, s.note ? String(r['Connection Note'] || '').trim() : '', a); }
  catch (e) { if (e.signOut) throw e; res = { result: /not available|404/i.test(e.message) ? 'unavailable' : 'error:' + e.message.slice(0, 80) }; }
  const day = engine.today(), A = ast(a.id);
  if (res.result === 'sent' || res.result === 'pending') {
    A.fails = 0; save();
    await setRow(r, { Status: 'Request Sent', 'Request Sent On': day, 'LinkedIn Account': a.id, 'Handled By': 'Auto-connect' + (a.main ? '' : ` (${a.name})`), Notes: note(r, res.result === 'pending' ? 'request was already pending' : `connection request sent automatically${res.withNote ? ' with the note' : ' without a note'}${tag}`) });
    return `Connection request sent to ${r.Name}${tag}${res.result === 'sent' && !res.withNote && s.note ? ' (without a note: LinkedIn allows only a few notes a month on free accounts)' : ''}`;
  }
  if (res.result === 'connected') { await setRow(r, { Status: 'Connected', 'Connected On': day, 'LinkedIn Account': a.id, Notes: note(r, 'already connected' + tag) }); return `${r.Name} is already a connection${tag} - send them the first message`; }
  if (res.result === 'limit') {
    A.pausedUntil = Date.now() + 7 * 86400e3; save();
    const next = accounts().find(x => x.id !== a.id && signedMap[x.id] && !isPaused(x));
    log(`LinkedIn says ${who(a)} reached its weekly invitation limit. That account is paused for 7 days${next ? `; ${next.name} takes over` : ''}.`, 'warn');
    return `LinkedIn weekly limit reached on ${who(a)} - paused for 7 days${next ? ', switching to ' + next.name : ''}`;
  }
  const why = { unavailable: 'this LinkedIn profile is not available any more (deleted or private)', noconnect: 'no Connect button (they may only allow Follow)', 'needs-email': 'LinkedIn asks for their email address', nosend: 'could not find the Send button' }[res.result] || res.result;
  A.fails = (A.fails || 0) + 1; save();
  await setRow(r, { Notes: note(r, `auto-connect skipped (v2): ${why} - please send this request yourself`) });
  if (A.fails >= 4) { A.pausedUntil = Date.now() + 24 * 3600e3; A.fails = 0; save(); log(`Auto-connect failed 4 times in a row on ${who(a)} (LinkedIn may have changed its page). That account is paused for 24 hours.`, 'warn'); }
  return `Skipped ${r.Name}: ${why}`;
}


// ---------------------------------------------------------------- one-click: send every prepared LinkedIn message
// "Send all" = the first message to everyone who accepted + the AI's suggested answer to everyone who replied.
// Sent one by one, 40-90 seconds apart, at most 40 messages a day. The app also reads new replies on LinkedIn
// (people we messaged), saves them, and the AI prepares the next answer for the next click.
let HARD_MSG_DAY = 60; const FAST = process.env.AAVORAA_LI_FAST === '1'; // FAST: tests only
let msgJob = { running: false, total: 0, done: 0, failed: 0, current: '', startedAt: 0, last: '' };
const OPEN_MSG = `
  const b = btns(top).find(el => /^message\\b/i.test((el.getAttribute('aria-label') || '').trim()) || /^message$/i.test((el.innerText || '').trim()));
  if (b) { click(b); return true; } return false;`;
const BOX = `all().find(el => el.getAttribute('contenteditable') === 'true' && vis(el) && (/msg-form|message/i.test(el.className + ' ' + (el.getAttribute('aria-label') || '')) || el.getAttribute('role') === 'textbox'))`;
async function openThread(w, r) {
  await open(w, profileUrl(r['LinkedIn URL']));
  const s = await waitFor(w, `const s = (() => { ${STATE_JS} })(); return s.name ? s : null;`, 10000);
  if (!s) return { ok: false, why: 'could not read the profile page' };
  if (s.state !== 'connected') return { ok: false, why: 'not connected yet' };
  const href = await run(w, `const m = btns(top).find(isMessage); return m && /^(https?:|\\/)/.test(m.getAttribute('href') || '') ? m.href : '';`);
  if (href) await open(w, href); // 2026 layout: Message is a link to the conversation
  else if (!(await run(w, OPEN_MSG))) return { ok: false, why: 'no Message button' };
  const ready = await waitFor(w, `return !!(${BOX});`, 15000);
  if (!ready) return { ok: false, why: 'message box did not open' };
  return { ok: true, name: s.name };
}
// the last message in the open conversation: who wrote it and what
const LAST_MSG = `
  const names = all().filter(el => /msg-s-message-group__name|message-group__name/.test(el.className) && vis(el));
  const bodies = all().filter(el => /msg-s-event-listitem__body|event-listitem__body/.test(el.className) && vis(el));
  return { who: names.length ? names[names.length - 1].innerText.trim() : '', text: bodies.length ? bodies[bodies.length - 1].innerText.trim() : '', count: bodies.length };`;
async function sendMessage(r, text, a) {
  a = a || accOf(rowAcc(r));
  if (!a) return { result: 'skip', why: 'the LinkedIn account that connected to them was removed from the app' };
  const w = pageWindow(a);
  try {
    const t = await openThread(w, r); if (!t.ok) return { result: 'skip', why: t.why };
    const box = await run(w, `const b = ${BOX}; if (!b) return false; b.focus(); return true;`);
    if (!box) return { result: 'skip', why: 'message box did not open' };
    w.webContents.insertText(String(text).slice(0, 7900));
    await sleep(rand(1500, 2600));
    const sent = await waitFor(w, `const s = btns().find(el => /msg-form__send|send-button/.test(String(el.className)) || (el.type === 'submit' && /send/i.test(lab(el))) || /^send$/i.test(txt(el)) || /^send$/i.test((el.getAttribute('aria-label') || '').trim())); if (s) { click(s); return true; } return false;`, 6000);
    if (!sent) return { result: 'skip', why: 'could not find the Send button' };
    await sleep(rand(2000, 3200));
    const last = await run(w, LAST_MSG);
    return { result: 'sent', verified: last.text && String(text).slice(0, 40).trim().startsWith(last.text.slice(0, 40).trim().slice(0, 20)) };
  } finally { w.destroy(); }
}
function messageTasks(rows) {
  const out = [];
  for (const r of rows) {
    if (!slug(r['LinkedIn URL'])) continue;
    if (r.Status === 'Connected' && String(r['First Message'] || '').trim()) out.push({ r, text: r['First Message'], kind: 'first message' });
    else if (String(r['Queued Message'] || '').trim()) out.push({ r, text: r['Queued Message'], kind: 'follow-up' });
    else if (r.Status === 'Replied' && String(r['Their Reply'] || '').trim() && String(r['Suggested Reply'] || '').trim()) out.push({ r, text: r['Suggested Reply'], kind: 'reply' });
  }
  return out;
}
const msgToday = (rows, id) => rows.filter(r => (!id || rowAcc(r) === id) && String(r['Message Sent On'] || '') === engine.today()).length;
async function sendAll(by) {
  if (msgJob.running) return `Already sending: ${msgJob.done} of ${msgJob.total} done.`;
  const signed = await signedAccounts();
  if (!signed.length) throw new Error('Sign in to LinkedIn first (button above).');
  const rows = await store.read('LinkedIn Leads', true);
  HARD_MSG_DAY = settings(await store.settings()).msgPerDay;
  // each message goes from the account that is connected to that person, within that account's daily message limit
  const left = {}; for (const a of signed) left[a.id] = Math.max(0, HARD_MSG_DAY - msgToday(rows, a.id));
  const all = messageTasks(rows), tasks = [];
  let waitSignIn = 0, full = 0;
  for (const t of all) { const id = rowAcc(t.r); if (!(id in left)) { waitSignIn++; continue; } if (left[id] <= 0) { full++; continue; } left[id]--; tasks.push({ ...t, a: accOf(id) }); }
  if (!tasks.length) return full ? `Daily limit reached (${HARD_MSG_DAY} LinkedIn messages a day per account). The rest go tomorrow.` : waitSignIn ? `${waitSignIn} message(s) wait for a team LinkedIn account that is signed out. Sign it in again on the LinkedIn tasks page.` : 'Nothing to send: no accepted connections or replies waiting.';
  msgJob = { running: true, total: tasks.length, done: 0, failed: 0, current: '', startedAt: Date.now(), last: '' };
  (async () => {
    for (const [i, t] of tasks.entries()) {
      while (busy) await sleep(3000); // auto-connect is using the LinkedIn window: wait for it
      busy = true; msgJob.current = t.r.Name;
      try {
        if (!signedMap[t.a.id]) { msgJob.failed++; continue; } // that account was signed out during the run
        const res = await sendMessage(t.r, t.text, t.a);
        if (res.result === 'sent') {
          await engine.linkedinAnswer(t.r['Lead ID'], { channel: 'linkedin', text: t.text }, by + ' (one-click)');
          await store.update('LinkedIn Leads', 'Lead ID', [{ key: t.r['Lead ID'], set: { 'Message Sent On': engine.today(), 'Suggested Reply': '', 'Queued Message': '', Notes: note(t.r, `${t.kind} sent on LinkedIn (one-click)`) } }]);
          msgJob.done++; log(`Sent the ${t.kind} to ${t.r.Name} on LinkedIn${t.a.main ? '' : ` (from ${t.a.name}'s LinkedIn)`}`);
        } else { msgJob.failed++; await store.update('LinkedIn Leads', 'Lead ID', [{ key: t.r['Lead ID'], set: { Notes: note(t.r, `one-click send skipped: ${res.why} - please send it yourself`) } }]); log(`Skipped ${t.r.Name}: ${res.why}`, 'warn'); }
      } catch (e) {
        msgJob.failed++; log(`Could not message ${t.r.Name}: ${e.message}`, 'warn');
        if (e.signOut) msgJob.last = e.message; // only that account stops; the others carry on
      } finally { busy = false; onChange(); }
      if (i < tasks.length - 1) await sleep(FAST ? 300 : rand(40e3, 90e3)); // slow, like a person
    }
    msgJob.running = false; msgJob.current = '';
    msgJob.last = `Sent ${msgJob.done} of ${msgJob.total}${msgJob.failed ? `, ${msgJob.failed} skipped (left for you in the task list)` : ''}.`;
    log('One-click LinkedIn: ' + msgJob.last); st.lastResult = msgJob.last; save(); onChange();
  })();
  return `Sending ${tasks.length} message(s) on LinkedIn, one every 1-2 minutes. You can keep working; the page shows the progress.`;
}
// Reads new replies from people we messaged: they land in the app, the AI suggests an answer, the next "Send all" sends it.
async function readReplies(rows, max = 6) {
  await signedAccounts();
  const due = rows.filter(r => r.Status === 'Message Sent' && slug(r['LinkedIn URL']) && signedMap[rowAcc(r)] && Date.now() - (st.replyChecked[r['Lead ID']] || 0) > 6 * 3600e3).slice(0, max);
  let n = 0;
  for (const r of due) {
    const a = accOf(rowAcc(r)); if (!a || !signedMap[a.id]) continue;
    st.replyChecked[r['Lead ID']] = Date.now(); save();
    const w = pageWindow(a);
    try {
      const t = await openThread(w, r); if (!t.ok) continue;
      const last = await run(w, LAST_MSG);
      const first = String(r.Name || '').split(/\s+/)[0].toLowerCase();
      if (last.text && first && last.who.toLowerCase().includes(first) && last.text !== String(r['Their Reply'] || '')) {
        const shared = (last.text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [])[0];
        await store.update('LinkedIn Leads', 'Lead ID', [{ key: r['Lead ID'], set: { 'Their Reply': last.text.slice(0, 3000), 'Suggested Reply': '', Status: 'Replied', ...(shared ? { Email: shared.toLowerCase() } : {}), Notes: note(r, 'replied on LinkedIn (read automatically)') } }]);
        n++; log(`${r.Name} replied on LinkedIn - the AI is preparing an answer`);
      }
    } catch (e) { if (e.signOut) log(e.message, 'warn'); } finally { w.destroy(); }
    await sleep(FAST ? 300 : rand(15e3, 35e3));
  }
  if (n) engine.run('linkedinFollow').catch(() => {});
  return n;
}

// "Connect 10 people now" (Aavo or the button): sends the next requests in the queue one by one, 1-2 minutes apart, within the daily limits
let connJob = { running: false, total: 0, done: 0, last: '' };
async function connectBatch(n) {
  if (connJob.running) return `Already sending connection requests: ${connJob.done} of ${connJob.total} done.`;
  const signed = await signedAccounts();
  if (!signed.length) return 'Sign in to LinkedIn first (LinkedIn tasks → Sign in to LinkedIn).';
  const s = settings(await store.settings()), rows = await store.read('LinkedIn Leads', true), c = counts(rows);
  if (n === 'all' || !(Number(n) > 0)) n = 10000;
  // room left on every signed-in account; when one is full (or LinkedIn shows its limit) the next takes over
  const left = {}; for (const a of signed) left[a.id] = room(a, rows, s);
  const roomAll = Object.values(left).reduce((x, y) => x + y, 0);
  const queue = rows.filter(r => r.Status === 'To Connect' && slug(r['LinkedIn URL']) && !/auto-connect skipped \(v2\)/i.test(String(r.Notes || ''))).length;
  if (roomAll <= 0) {
    if (signed.every(isPaused)) return 'LinkedIn showed a limit earlier, so connecting is paused until ' + new Date(Math.min(...signed.map(a => ast(a.id).pausedUntil))).toLocaleString() + '.';
    return `The limit is reached on ${signed.length > 1 ? `all ${signed.length} LinkedIn accounts` : 'your LinkedIn'} (${HARD_DAY} a day, ${HARD_WEEK} a week each). The rest go out ${c.week >= HARD_WEEK * signed.length ? 'next week' : 'tomorrow'} by themselves. Add a team member's LinkedIn or raise the limits in Settings → LinkedIn auto-connect.`;
  }
  if (!queue) return 'Nobody is waiting to be connected. Say "find LinkedIn prospects" to add more.';
  const total = Math.min(roomAll, queue, n);
  connJob = { running: true, total, done: 0, last: '' };
  (async () => {
    let i = 0;
    while (i < total) {
      const a = accounts().filter(x => left[x.id] > 0 && signedMap[x.id] && !isPaused(x)).sort((x, y) => left[y.id] - left[x.id])[0];
      if (!a) { log('Every signed-in LinkedIn account is full for today or paused; the rest go out by themselves later.'); break; }
      while (busy) await sleep(3000);
      busy = true;
      let m = '';
      try { m = await connectNext(s, await store.read('LinkedIn Leads', true), a); if (m) { log(m); if (/^Connection request sent/.test(m)) connJob.done++; } }
      catch (e) { log('Connect: ' + e.message, 'warn'); if (e.signOut) left[a.id] = 0; } // only that account stops
      finally { busy = false; onChange(); }
      if (!m && left[a.id] > 0 && !isPaused(a) && signedMap[a.id] !== false) break; // queue is empty
      if (/weekly limit/i.test(m || '') || isPaused(a)) { left[a.id] = 0; continue; } // switch to the next account at once
      if (m) { left[a.id]--; i++; }
      if (i < total) await sleep(FAST ? 300 : rand(40e3, 80e3));
    }
    connJob.running = false; connJob.last = `Sent ${connJob.done} of ${total} connection requests${signed.length > 1 ? ` from ${signed.length} LinkedIn accounts` : ''}.`; st.lastResult = connJob.last; save(); log(connJob.last); onChange();
  })();
  const more = queue - total;
  return `✓ Connecting ${total} people now, one about every minute, with your AI-written note${signed.length > 1 ? `, shared across ${signed.length} LinkedIn accounts (when one is full, the next takes over)` : ''}. Progress shows on LinkedIn tasks.` + (more > 0 ? ` The other ${more} go out by themselves on the next days (limit: ${HARD_DAY} a day, ${HARD_WEEK} a week per account).` : '') + ' When someone accepts, the first message goes out automatically.';
}

async function tick(force) {
  if (busy) return 'Auto-connect is already working.';
  busy = true;
  try {
    const s = settings(await store.settings());
    if (!s.on && !force) return '';
    const signed = await signedAccounts();
    if (!signed.length) {
      if (s.on && st.lastSignInWarn !== engine.today()) { st.lastSignInWarn = engine.today(); save(); log('Auto-connect is on, but LinkedIn is not signed in. Open LinkedIn tasks and click "Sign in to LinkedIn".', 'warn'); }
      return 'Sign in to LinkedIn first.';
    }
    let rows = await store.read('LinkedIn Leads', true), out = [];
    const now = indiaNow(), h = now.getUTCHours(), workday = now.getUTCDay() !== 0;
    if (force || Date.now() - st.lastCheck > CHECK_EVERY) {
      const n = await checkAccepted(rows); if (n) out.push(`${n} accepted`);
      const rep = await readReplies(rows).catch(e => { if (e.signOut) throw e; return 0; }); if (rep) out.push(`${rep} new LinkedIn repl${rep > 1 ? 'ies' : 'y'}`);
      rows = await store.read('LinkedIn Leads', true);
    }
    if (s.autoMessage && !msgJob.running && messageTasks(rows).length && (force || (workday && h >= s.from && h < s.to))) { busy = false; const m = await sendAll('Auto (accepted)').catch(e => e.message); busy = true; if (m && !/^Nothing/.test(m)) out.push('LinkedIn messages: ' + m); }
    await signedAccounts(); // a sign-out found while checking is noticed here
    const a = usable(rows, s)[0]; // the signed-in account with the most room left today
    if (a && (force || (workday && h >= s.from && h < s.to && Date.now() >= st.nextSendAt))) {
      const roomAll = accounts().reduce((t, x) => t + room(x, rows, s), 0);
      let m = '';
      try { m = await connectNext(s, rows, a); } catch (e) { if (!e.signOut) throw e; log(e.message, 'warn'); }
      if (m) { log(m); out.push(m); }
      // spread the rest of today's requests (all accounts together) over the remaining hours, never closer than 4 minutes
      const left = Math.max(1, roomAll - 1), mins = Math.max(4, ((s.to - h) * 60 - now.getUTCMinutes()) / left);
      st.nextSendAt = Date.now() + rand(mins * 0.6, mins * 1.2) * 60e3; save();
    }
    st.lastResult = out.join('. ') || st.lastResult; save();
    return out.join('. ') || (force ? 'Nothing to do right now.' : '');
  } catch (e) {
    log('Auto-connect: ' + e.message, 'warn'); st.lastResult = e.message; save();
    return e.message;
  } finally { busy = false; }
}

// ---------------------------------------------------------------- sign in (you type your own password in LinkedIn's page)
// Each account signs in in its own window; the team member types their own password in LinkedIn's page.
function signIn(parent, id = 'main') {
  const a = accOf(id); if (!a) throw new Error('That LinkedIn account is not in the app any more.');
  const old = loginWins[a.id];
  if (old && !old.isDestroyed()) { old.show(); old.focus(); return; }
  ses(a);
  const win = loginWins[a.id] = new BrowserWindow({ width: 520, height: 760, parent: parent || undefined, title: `Sign in to LinkedIn - ${a.name}`, autoHideMenuBar: true, webPreferences: { partition: a.part, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.loadURL(BASE + '/login');
  const done = async () => { if (await checkSignedIn(a) && !win.isDestroyed() && !/\/(login|checkpoint|uas)/i.test(win.webContents.getURL())) { log(`Signed in to LinkedIn for auto-connect (${a.name})`); win.close(); onChange(); } };
  win.webContents.on('did-navigate', done);
  win.webContents.on('did-navigate-in-page', done);
  win.on('closed', () => { delete loginWins[a.id]; checkSignedIn(a).then(onChange); });
}
async function signOut(id = 'main') { const a = accOf(id); if (!a) return; await ses(a).clearStorageData(); signedMap[a.id] = false; onChange(); }
// a team member's LinkedIn: added by the owner, then that person signs in to their OWN LinkedIn in the window that opens
function addAccount(name) {
  name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (name.length < 2) throw new Error('Type the team member\'s name (whose LinkedIn this is).');
  const c = config.get(), list = c.liAccounts || [];
  if (list.length + 1 >= MAX_ACCOUNTS) throw new Error(`At most ${MAX_ACCOUNTS} LinkedIn accounts.`);
  if (accounts().some(a => a.name.toLowerCase() === name.toLowerCase())) throw new Error('There is already a LinkedIn account with that name.');
  const id = 'acc' + Date.now().toString(36);
  config.set({ liAccounts: [...list, { id, name, added: engine.today() }] });
  log(`Added ${name}'s LinkedIn - waiting for them to sign in`);
  signIn(uiParent(), id);
  return id;
}
async function removeAccount(id) {
  const a = accOf(id); if (!a || a.main) throw new Error('The main LinkedIn cannot be removed (use Sign out).');
  try { await ses(a).clearStorageData(); } catch (e) {}
  config.set({ liAccounts: (config.get().liAccounts || []).filter(x => x.id !== id) });
  delete st.acc[id]; delete signedMap[id]; save();
  log(`Removed ${a.name}'s LinkedIn from the app (people it connected with stay in the list; message them yourself)`); onChange();
}
function renameMain(name) { name = String(name || '').trim().slice(0, 40); config.set({ liMainName: name || '' }); onChange(); }

async function status() {
  const s = settings(await store.settings().catch(() => ({})));
  const rows = await store.read('LinkedIn Leads').catch(() => []);
  const c = counts(rows);
  const list = [];
  for (const a of accounts()) {
    const ca = counts(rows, a.id), signed = await checkSignedIn(a);
    list.push({ id: a.id, name: a.name, main: a.main, added: a.added, signedIn: signed, today: ca.today, week: ca.week, msgToday: msgToday(rows, a.id),
      waiting: rows.filter(r => r.Status === 'Request Sent' && rowAcc(r) === a.id).length,
      pausedUntil: isPaused(a) ? new Date(ast(a.id).pausedUntil).toISOString() : '', full: signed && !isPaused(a) && room(a, rows, s) <= 0 });
  }
  const signed = list.filter(x => x.signedIn), active = signed.filter(x => !x.pausedUntil);
  return {
    available: true, on: s.on, signedIn: signed.length > 0, busy, perDay: s.perDay, hours: `${s.from}-${s.to}`, note: s.note,
    today: c.today, week: c.week, weekMax: HARD_WEEK, queue: rows.filter(r => r.Status === 'To Connect' && slug(r['LinkedIn URL'])).length,
    perDayAll: s.perDay * Math.max(1, signed.length), weekMaxAll: HARD_WEEK * Math.max(1, signed.length),
    waiting: rows.filter(r => r.Status === 'Request Sent').length,
    pausedUntil: signed.length && !active.length ? signed.map(x => x.pausedUntil).sort()[0] : '',
    nextSendAt: st.nextSendAt > Date.now() ? new Date(st.nextSendAt).toISOString() : '',
    lastCheck: st.lastCheck ? new Date(st.lastCheck).toISOString() : '', lastResult: st.lastResult,
    toSend: messageTasks(rows).length, connJob, msgToday: msgToday(rows), msgMax: HARD_MSG_DAY, msgJob,
    accounts: list, maxAccounts: MAX_ACCOUNTS,
  };
}

function start(opts = {}) {
  onChange = opts.onChange || onChange;
  uiParent = () => (opts.parent && opts.parent()) || null;
  for (const a of accounts()) checkSignedIn(a); // also sets each account's normal-Chrome user agent
  if (!timer) { timer = setInterval(() => tick(false), 60e3); setTimeout(() => tick(false), 20e3); }
  global.liBot = { status, sendAll, connectBatch, runNow: () => tick(true), signIn: id => signIn(uiParent(), id || 'main'), signOut, addAccount, removeAccount, renameMain };
}
module.exports = { start, _t: { LIB, STATE_JS, BOX, tick, sendAll, sendMessage, readReplies, messageTasks, msgJob: () => msgJob, sendRequest, checkAccepted, slug, settings, counts, st, accounts, connectBatch, connJob: () => connJob, status, addAccount, removeAccount, signedMap, ast } };
