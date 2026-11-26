// LinkedIn auto-connect (Windows app only).
// Uses YOUR LinkedIn, signed in once in the app's own LinkedIn window (the app never sees or stores your password).
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
const HARD_DAY = 25, HARD_WEEK = 80, CHECK_EVERY = 60 * 60e3;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => Math.round(a + Math.random() * (b - a));
const log = (msg, level) => engine.log('linkedin', msg, level);
const indiaNow = () => new Date(Date.now() + 5.5 * 3600e3); // same clock as the email sending hours

let st = { nextSendAt: 0, lastCheck: 0, pausedUntil: 0, profileChecked: {}, replyChecked: {}, fails: 0, lastResult: '', lastSignInWarn: '' };
try { st = { ...st, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch (e) {}
st.replyChecked = st.replyChecked || {};
const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(st)); } catch (e) {} };
let busy = false, signedIn = false, loginWin = null, timer = null, onChange = () => {};

const ses = () => session.fromPartition(PART);
async function checkSignedIn() {
  try { signedIn = (await ses().cookies.get({ name: 'li_at' })).some(c => c.value); } catch (e) { signedIn = false; }
  return signedIn;
}
const slug = u => { const m = String(u || '').match(/\/in\/([^/?#]+)/i); try { return m ? decodeURIComponent(m[1]).toLowerCase() : ''; } catch (e) { return m ? m[1].toLowerCase() : ''; } };
const profileUrl = u => { const s = String(u || '').match(/\/in\/[^/?#]+/i); return s ? BASE + s[0] + '/' : ''; };

function settings(s) {
  const hours = String(s.LINKEDIN_CONNECT_HOURS || '10-18').match(/(\d+)\s*-\s*(\d+)/) || [0, 10, 18];
  return {
    on: String(s.LINKEDIN_AUTO_CONNECT || 'no').toLowerCase() === 'yes' && String(s.AGENT_ON || 'yes').toLowerCase() !== 'no',
    perDay: Math.max(1, Math.min(HARD_DAY, Number(s.LINKEDIN_CONNECT_PER_DAY) || 15)),
    note: String(s.LINKEDIN_CONNECT_NOTE || 'yes').toLowerCase() !== 'no',
    from: Number(hours[1]), to: Number(hours[2]),
  };
}
function counts(rows) {
  const day = engine.today(), week = new Date(Date.now() + 5.5 * 3600e3 - 7 * 86400e3).toISOString().slice(0, 10);
  const sent = rows.map(r => String(r['Request Sent On'] || '')).filter(Boolean);
  return { today: sent.filter(d => d === day).length, week: sent.filter(d => d > week).length };
}

// ---------------------------------------------------------------- the hidden LinkedIn page
function pageWindow() {
  return new BrowserWindow({ show: process.env.AAVORAA_LI_SHOW === '1', width: 1280, height: 900, webPreferences: { partition: PART, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
}
async function open(w, url) {
  try { await w.loadURL(url); } catch (e) { if (!/ERR_ABORTED/.test(e.message)) throw e; }
  await sleep(rand(3500, 6500));
  const at = w.webContents.getURL();
  if (/\/(login|authwall|checkpoint|uas\/login)/i.test(at)) { signedIn = false; throw Object.assign(new Error('LinkedIn signed you out. Click "Sign in to LinkedIn" on the LinkedIn tasks page.'), { signOut: true }); }
  if (/\/404|unavailable/i.test(at)) throw new Error('This LinkedIn profile is not available.');
}
// Runs a function inside the LinkedIn page with small helpers that also look inside LinkedIn's pop-up layers (shadow DOM).
const LIB = `
  const all = () => { const out = []; const walk = n => { for (const el of n.querySelectorAll('*')) { out.push(el); if (el.shadowRoot) walk(el.shadowRoot); } }; walk(document); return out; };
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const lab = el => ((el.getAttribute('aria-label') || '') + ' | ' + (el.innerText || el.textContent || '')).replace(/\\s+/g, ' ').trim();
  const btns = root => (root ? [...root.querySelectorAll('*')] : all()).filter(el => (/^(BUTTON|A)$/.test(el.tagName) || /^(button|menuitem)$/.test(el.getAttribute('role') || '')) && vis(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
  const h1 = document.querySelector('main h1') || document.querySelector('h1');
  const name = h1 ? h1.innerText.trim() : '';
  const first = name.split(/\\s+/)[0] || '';
  let top = h1; for (let i = 0; top && i < 12 && !(top.tagName === 'SECTION' || (top.querySelectorAll && [...top.querySelectorAll('button')].length >= 2)); i++) top = top.parentElement;
  top = top || document.querySelector('main') || document.body;
  const isMine = el => { const a = el.getAttribute('aria-label') || ''; return !/invite .* to connect/i.test(a) || !first || a.toLowerCase().includes(first.toLowerCase()); };
  const click = el => { el.scrollIntoView({ block: 'center' }); el.click(); };
  const say = t => all().some(el => el.children.length === 0 && vis(el) && t.test(el.textContent || ''));
`;
const run = (w, body, arg) => w.webContents.executeJavaScript(`(() => { ${LIB} const arg = ${JSON.stringify(arg || null)}; ${body} })()`, true);

// what the profile's top card says: connected (1st), pending, or can connect
const STATE_JS = `
  const text = (top.innerText || '').replace(/\\s+/g, ' ');
  const b = btns(top);
  if (b.some(el => /\\bpending\\b|withdraw/i.test(lab(el)))) return { state: 'pending', name };
  if (/(^|[^a-z])1st([^a-z]|$)/i.test(text) && !b.some(el => /\\bconnect\\b/i.test(lab(el)) && !/connections/i.test(lab(el)))) return { state: 'connected', name };
  return { state: 'other', name };
`;

async function sendRequest(r, note) {
  const w = pageWindow();
  try {
    await open(w, profileUrl(r['LinkedIn URL']));
    let s = await run(w, STATE_JS);
    if (!s.name) throw new Error('Could not read the profile page (LinkedIn may have changed its layout).');
    if (s.state !== 'other') return { result: s.state };
    // 1. the Connect button: on the profile card, or inside "More"
    let how = await run(w, `
      const direct = btns(top).find(el => isMine(el) && (/invite .* to connect/i.test(el.getAttribute('aria-label') || '') || /^connect$/i.test((el.innerText || '').trim())));
      if (direct) { click(direct); return 'direct'; }
      const more = btns(top).find(el => /more actions|^more$/i.test((el.getAttribute('aria-label') || '').trim()) || /^more$/i.test((el.innerText || '').trim()));
      if (more) { click(more); return 'more'; }
      return '';`);
    if (how === 'more') {
      await sleep(rand(900, 1600));
      how = await run(w, `
        const c = btns().find(el => isMine(el) && (/invite .* to connect/i.test(el.getAttribute('aria-label') || '') || /^connect$/i.test((el.innerText || '').trim())));
        if (c) { click(c); return 'more'; } return '';`);
    }
    if (!how) return { result: 'noconnect' };
    // 2. the invitation pop-up
    await sleep(rand(1500, 2600));
    const dlg = await run(w, `
      if (say(/enter (their|his|her) email|know .* outside of linkedin|how do you know/i)) return 'email';
      const t = btns().map(lab).join(' || ');
      return /add a note/i.test(t) ? 'note' : /send without a note|send now|^send\\b|\\| send$/i.test(t) ? 'send' : '';`);
    if (dlg === 'email') return { result: 'needs-email' };
    let withNote = false;
    if (note && dlg === 'note') {
      await run(w, `const b = btns().find(el => /add a note/i.test(lab(el))); if (b) click(b);`);
      await sleep(rand(1200, 2000));
      const box = await run(w, `const t = all().find(el => el.tagName === 'TEXTAREA' && vis(el)); if (!t) return false; t.focus(); t.value = ''; return true;`);
      if (box) {
        w.webContents.insertText(note.slice(0, 200)); // free accounts allow 200 characters
        await sleep(rand(1200, 2200));
        withNote = await run(w, `const b = btns().find(el => /^(send|send invitation|send now)$/i.test((el.getAttribute('aria-label') || '').trim()) || /^send$/i.test((el.innerText || '').trim())); if (b) { click(b); return true; } return false;`);
      }
      if (!withNote) { // out of free notes (Premium pop-up): close it and send without a note
        await run(w, `const x = btns().find(el => /dismiss|close|cancel/i.test(lab(el))); if (x) click(x);`);
        await sleep(1200);
        await run(w, `const c = btns().find(el => isMine(el) && (/invite .* to connect/i.test(el.getAttribute('aria-label') || '') || /^connect$/i.test((el.innerText || '').trim()))); if (c) click(c);`);
        await sleep(rand(1500, 2500));
      }
    }
    if (!withNote) {
      const ok = await run(w, `const b = btns().find(el => /send without a note|^send now$/i.test(lab(el).replace(/\\s*\\|.*$/, '')) || /send without a note/i.test(lab(el))) || btns().find(el => /^(send|send now)$/i.test((el.innerText || '').trim())); if (b) { click(b); return true; } return false;`);
      if (!ok) return { result: 'nosend' };
    }
    await sleep(rand(2500, 4000));
    if (await run(w, `return say(/weekly invitation limit|reached the weekly limit|too many invitations/i);`)) return { result: 'limit' };
    s = await run(w, STATE_JS);
    return { result: 'sent', withNote, verified: s.state === 'pending' };
  } finally { w.destroy(); }
}

async function profileState(r) {
  const w = pageWindow();
  try { await open(w, profileUrl(r['LinkedIn URL'])); return (await run(w, STATE_JS)).state; } finally { w.destroy(); }
}
async function recentConnections() {
  const w = pageWindow();
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
  const waiting = rows.filter(r => r.Status === 'Request Sent' && slug(r['LinkedIn URL']));
  st.lastCheck = Date.now(); save();
  if (!waiting.length) return 0;
  const links = new Set((await recentConnections()).map(slug));
  let n = 0;
  for (const r of waiting) if (links.has(slug(r['LinkedIn URL']))) { await setRow(r, { Status: 'Connected', 'Connected On': engine.today(), Notes: note(r, 'accepted the connection request') }); n++; log(`${r.Name} accepted your connection request - send them the first message`); }
  // older requests that are not in the recent list: look at up to 3 profiles a check
  const old = waiting.filter(r => !links.has(slug(r['LinkedIn URL'])) && (Date.now() - (st.profileChecked[r['Lead ID']] || 0)) > 24 * 3600e3 && String(r['Request Sent On'] || '') < engine.today()).slice(0, 3);
  for (const r of old) {
    await sleep(rand(20e3, 45e3));
    st.profileChecked[r['Lead ID']] = Date.now(); save();
    const s = await profileState(r).catch(() => '');
    if (s === 'connected') { await setRow(r, { Status: 'Connected', 'Connected On': engine.today(), Notes: note(r, 'accepted the connection request') }); n++; log(`${r.Name} accepted your connection request - send them the first message`); }
  }
  return n;
}

async function connectNext(s, rows) {
  const queue = rows.filter(r => r.Status === 'To Connect' && slug(r['LinkedIn URL']) && !/auto-connect skipped/i.test(String(r.Notes || '')))
    .sort((a, b) => Number(b['Fit Score'] || 0) - Number(a['Fit Score'] || 0));
  const r = queue[0]; if (!r) return '';
  const res = await sendRequest(r, s.note ? String(r['Connection Note'] || '').trim() : '');
  const day = engine.today();
  if (res.result === 'sent' || res.result === 'pending') {
    st.fails = 0;
    await setRow(r, { Status: 'Request Sent', 'Request Sent On': day, 'Handled By': 'Auto-connect', Notes: note(r, res.result === 'pending' ? 'request was already pending' : `connection request sent automatically${res.withNote ? ' with the note' : ' without a note'}`) });
    return `Connection request sent to ${r.Name}${res.result === 'sent' && !res.withNote && s.note ? ' (without a note: LinkedIn allows only a few notes a month on free accounts)' : ''}`;
  }
  if (res.result === 'connected') { await setRow(r, { Status: 'Connected', 'Connected On': day, Notes: note(r, 'already connected') }); return `${r.Name} is already a connection - send them the first message`; }
  if (res.result === 'limit') { st.pausedUntil = Date.now() + 7 * 86400e3; save(); log('LinkedIn says you reached the weekly invitation limit. Auto-connect is paused for 7 days.', 'warn'); return 'LinkedIn weekly limit reached - paused for 7 days'; }
  const why = { noconnect: 'no Connect button (they may only allow Follow)', 'needs-email': 'LinkedIn asks for their email address', nosend: 'could not find the Send button' }[res.result] || res.result;
  st.fails++; save();
  await setRow(r, { Notes: note(r, `auto-connect skipped: ${why} - please send this request yourself`) });
  if (st.fails >= 4) { st.pausedUntil = Date.now() + 24 * 3600e3; st.fails = 0; save(); log('Auto-connect failed 4 times in a row (LinkedIn may have changed its page). Paused for 24 hours; send requests yourself from the LinkedIn tasks page.', 'warn'); }
  return `Skipped ${r.Name}: ${why}`;
}


// ---------------------------------------------------------------- one-click: send every prepared LinkedIn message
// "Send all" = the first message to everyone who accepted + the AI's suggested answer to everyone who replied.
// Sent one by one, 40-90 seconds apart, at most 40 messages a day. The app also reads new replies on LinkedIn
// (people we messaged), saves them, and the AI prepares the next answer for the next click.
const HARD_MSG_DAY = 40, FAST = process.env.AAVORAA_LI_FAST === '1'; // FAST: tests only
let msgJob = { running: false, total: 0, done: 0, failed: 0, current: '', startedAt: 0, last: '' };
const OPEN_MSG = `
  const b = btns(top).find(el => /^message\\b/i.test((el.getAttribute('aria-label') || '').trim()) || /^message$/i.test((el.innerText || '').trim()));
  if (b) { click(b); return true; } return false;`;
const BOX = `all().find(el => el.getAttribute('contenteditable') === 'true' && vis(el) && (/msg-form|message/i.test(el.className + ' ' + (el.getAttribute('aria-label') || '')) || el.getAttribute('role') === 'textbox'))`;
async function openThread(w, r) {
  await open(w, profileUrl(r['LinkedIn URL']));
  const s = await run(w, STATE_JS);
  if (!s.name) throw new Error('Could not read the profile page');
  if (s.state !== 'connected') return { ok: false, why: 'not connected yet' };
  if (!(await run(w, OPEN_MSG))) return { ok: false, why: 'no Message button' };
  await sleep(rand(2200, 3500));
  return { ok: true, name: s.name };
}
// the last message in the open conversation: who wrote it and what
const LAST_MSG = `
  const names = all().filter(el => /msg-s-message-group__name|message-group__name/.test(el.className) && vis(el));
  const bodies = all().filter(el => /msg-s-event-listitem__body|event-listitem__body/.test(el.className) && vis(el));
  return { who: names.length ? names[names.length - 1].innerText.trim() : '', text: bodies.length ? bodies[bodies.length - 1].innerText.trim() : '', count: bodies.length };`;
async function sendMessage(r, text) {
  const w = pageWindow();
  try {
    const t = await openThread(w, r); if (!t.ok) return { result: 'skip', why: t.why };
    const box = await run(w, `const b = ${BOX}; if (!b) return false; b.focus(); return true;`);
    if (!box) return { result: 'skip', why: 'message box did not open' };
    w.webContents.insertText(String(text).slice(0, 7900));
    await sleep(rand(1500, 2600));
    const sent = await run(w, `const s = btns().find(el => /msg-form__send|send-button/.test(el.className) || /^send$/i.test((el.innerText || '').trim()) || /^send$/i.test((el.getAttribute('aria-label') || '').trim())); if (s) { click(s); return true; } return false;`);
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
    else if (r.Status === 'Replied' && String(r['Their Reply'] || '').trim() && String(r['Suggested Reply'] || '').trim()) out.push({ r, text: r['Suggested Reply'], kind: 'reply' });
  }
  return out;
}
const msgToday = rows => rows.filter(r => String(r['Message Sent On'] || '') === engine.today()).length;
async function sendAll(by) {
  if (msgJob.running) return `Already sending: ${msgJob.done} of ${msgJob.total} done.`;
  if (!(await checkSignedIn())) throw new Error('Sign in to LinkedIn first (button above).');
  const rows = await store.read('LinkedIn Leads', true);
  const left = HARD_MSG_DAY - msgToday(rows);
  const tasks = messageTasks(rows).slice(0, Math.max(0, left));
  if (!tasks.length) return left <= 0 ? `Daily limit reached (${HARD_MSG_DAY} LinkedIn messages a day). The rest go tomorrow.` : 'Nothing to send: no accepted connections or replies waiting.';
  msgJob = { running: true, total: tasks.length, done: 0, failed: 0, current: '', startedAt: Date.now(), last: '' };
  (async () => {
    for (const [i, t] of tasks.entries()) {
      while (busy) await sleep(3000); // auto-connect is using the LinkedIn window: wait for it
      busy = true; msgJob.current = t.r.Name;
      try {
        const res = await sendMessage(t.r, t.text);
        if (res.result === 'sent') {
          await engine.linkedinAnswer(t.r['Lead ID'], { channel: 'linkedin', text: t.text }, by + ' (one-click)');
          await store.update('LinkedIn Leads', 'Lead ID', [{ key: t.r['Lead ID'], set: { 'Message Sent On': engine.today(), 'Suggested Reply': '', Notes: note(t.r, `${t.kind} sent on LinkedIn (one-click)`) } }]);
          msgJob.done++; log(`Sent the ${t.kind} to ${t.r.Name} on LinkedIn`);
        } else { msgJob.failed++; await store.update('LinkedIn Leads', 'Lead ID', [{ key: t.r['Lead ID'], set: { Notes: note(t.r, `one-click send skipped: ${res.why} - please send it yourself`) } }]); log(`Skipped ${t.r.Name}: ${res.why}`, 'warn'); }
      } catch (e) {
        msgJob.failed++; log(`Could not message ${t.r.Name}: ${e.message}`, 'warn');
        if (e.signOut) { msgJob.last = e.message; break; }
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
  const due = rows.filter(r => r.Status === 'Message Sent' && slug(r['LinkedIn URL']) && Date.now() - (st.replyChecked[r['Lead ID']] || 0) > 6 * 3600e3).slice(0, max);
  let n = 0;
  for (const r of due) {
    st.replyChecked[r['Lead ID']] = Date.now(); save();
    const w = pageWindow();
    try {
      const t = await openThread(w, r); if (!t.ok) continue;
      const last = await run(w, LAST_MSG);
      const first = String(r.Name || '').split(/\s+/)[0].toLowerCase();
      if (last.text && first && last.who.toLowerCase().includes(first) && last.text !== String(r['Their Reply'] || '')) {
        const shared = (last.text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [])[0];
        await store.update('LinkedIn Leads', 'Lead ID', [{ key: r['Lead ID'], set: { 'Their Reply': last.text.slice(0, 3000), 'Suggested Reply': '', Status: 'Replied', ...(shared ? { Email: shared.toLowerCase() } : {}), Notes: note(r, 'replied on LinkedIn (read automatically)') } }]);
        n++; log(`${r.Name} replied on LinkedIn - the AI is preparing an answer`);
      }
    } catch (e) { if (e.signOut) throw e; } finally { w.destroy(); }
    await sleep(FAST ? 300 : rand(15e3, 35e3));
  }
  if (n) engine.run('linkedinFollow').catch(() => {});
  return n;
}

async function tick(force) {
  if (busy) return 'Auto-connect is already working.';
  busy = true;
  try {
    const s = settings(await store.settings());
    if (!s.on && !force) return '';
    if (!(await checkSignedIn())) {
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
    const c = counts(rows);
    const canSend = Date.now() >= st.pausedUntil && c.today < s.perDay && c.week < HARD_WEEK;
    if (canSend && (force || (workday && h >= s.from && h < s.to && Date.now() >= st.nextSendAt))) {
      const m = await connectNext(s, rows);
      if (m) { log(m); out.push(m); }
      // spread the rest of today's requests over the remaining hours, never closer than 4 minutes
      const left = Math.max(1, s.perDay - c.today - 1), mins = Math.max(4, ((s.to - h) * 60 - now.getUTCMinutes()) / left);
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
function signIn(parent) {
  if (loginWin && !loginWin.isDestroyed()) { loginWin.show(); loginWin.focus(); return; }
  loginWin = new BrowserWindow({ width: 520, height: 760, parent, title: 'Sign in to LinkedIn', autoHideMenuBar: true, webPreferences: { partition: PART, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  loginWin.loadURL(BASE + '/login');
  const done = async () => { if (await checkSignedIn() && loginWin && !loginWin.isDestroyed() && !/\/(login|checkpoint|uas)/i.test(loginWin.webContents.getURL())) { log('Signed in to LinkedIn for auto-connect'); loginWin.close(); onChange(); } };
  loginWin.webContents.on('did-navigate', done);
  loginWin.webContents.on('did-navigate-in-page', done);
  loginWin.on('closed', () => { loginWin = null; checkSignedIn().then(onChange); });
}
async function signOut() { await ses().clearStorageData(); signedIn = false; onChange(); }

async function status() {
  const s = settings(await store.settings().catch(() => ({})));
  const rows = await store.read('LinkedIn Leads').catch(() => []);
  const c = counts(rows);
  return {
    available: true, on: s.on, signedIn: await checkSignedIn(), busy, perDay: s.perDay, hours: `${s.from}-${s.to}`, note: s.note,
    today: c.today, week: c.week, weekMax: HARD_WEEK, queue: rows.filter(r => r.Status === 'To Connect' && slug(r['LinkedIn URL'])).length,
    waiting: rows.filter(r => r.Status === 'Request Sent').length,
    pausedUntil: st.pausedUntil > Date.now() ? new Date(st.pausedUntil).toISOString() : '',
    nextSendAt: st.nextSendAt > Date.now() ? new Date(st.nextSendAt).toISOString() : '',
    lastCheck: st.lastCheck ? new Date(st.lastCheck).toISOString() : '', lastResult: st.lastResult,
    toSend: messageTasks(rows).length, msgToday: msgToday(rows), msgMax: HARD_MSG_DAY, msgJob,
  };
}

function start(opts = {}) {
  onChange = opts.onChange || onChange;
  const ua = app.userAgentFallback.replace(/\s(Electron|aavoraa[^\s]*|AAVORAA[^\s]*)\/\S+/gi, ''); // look like normal Chrome
  ses().setUserAgent(ua);
  checkSignedIn();
  if (!timer) { timer = setInterval(() => tick(false), 60e3); setTimeout(() => tick(false), 20e3); }
  global.liBot = { status, sendAll, runNow: () => tick(true), signIn: () => signIn(opts.parent && opts.parent()), signOut };
}
module.exports = { start, _t: { tick, sendAll, sendMessage, readReplies, messageTasks, msgJob: () => msgJob, sendRequest, checkAccepted, slug, settings, counts, st } };
