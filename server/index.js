// AAVORAA Lead Agent - local web server (UI + API). Team members open http://<this-pc>:4780
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const XLSX = require('xlsx');
const config = require('./config');
const store = require('./store');
const engine = require('./engine');
const mail = require('./mail');
const { gemini } = require('./ai');
const { SETTINGS, STAGES, ROLES, TONES } = require('./schema');

const PORT = Number(process.env.AAVORAA_PORT || 4780);
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));
app.use((req, res, next) => { res.set('X-Frame-Options', 'DENY'); res.set('X-Content-Type-Options', 'nosniff'); next(); });

// ---------------------------------------------------------------- auth
const sessions = new Map();
const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) => `scrypt$${salt}$${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`;
const verify = (pw, stored) => { try { const [, salt, h] = String(stored).split('$'); const a = Buffer.from(crypto.scryptSync(String(pw), salt, 64).toString('hex')), b = Buffer.from(h); return a.length === b.length && crypto.timingSafeEqual(a, b); } catch (e) { return false; } };
const isLocal = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const cookie = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
function sessionUser(req) {
  const t = cookie(req).aav_s; const s = t && sessions.get(t);
  if (!s || s.exp < Date.now()) { if (t) sessions.delete(t); return null; }
  s.exp = Date.now() + 12 * 3600e3; return s.user;
}
const need = (...roles) => (req, res, next) => {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({ error: 'Please log in.' });
  if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: 'You do not have access to this.' });
  req.user = u; next();
};
const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => res.status(400).json({ error: e.message }));
const today = engine.today;
const yes = v => ['yes', 'on', 'true', '1'].includes(String(v || '').toLowerCase());

async function users() { return (await store.read('Users')).filter(u => u.Username); }
const loginTries = new Map();

app.get('/api/state', wrap(async (req, res) => {
  const configured = config.isConfigured();
  let needsOwner = false, sheetError = null;
  if (configured) { try { needsOwner = !(await users()).length; } catch (e) { sheetError = e.message; } }
  res.json({ configured, needsOwner, sheetError, isLocal: isLocal(req), user: sessionUser(req), roles: ROLES, version: require('../package.json').version });
}));

app.post('/api/login', wrap(async (req, res) => {
  const ip = req.socket.remoteAddress, now = Date.now();
  const tries = (loginTries.get(ip) || []).filter(t => now - t < 10 * 60e3);
  if (tries.length >= 8) return res.status(429).json({ error: 'Too many attempts. Try again in 10 minutes.' });
  const { username, password } = req.body || {};
  const u = (await users()).find(x => String(x.Username).toLowerCase() === String(username || '').toLowerCase().trim());
  if (!u || String(u.Active).toLowerCase() !== 'yes' || !verify(password, u['Password Hash'])) { tries.push(now); loginTries.set(ip, tries); return res.status(401).json({ error: 'Wrong username or password.' }); }
  const token = crypto.randomBytes(32).toString('hex');
  const user = { username: u.Username, name: u.Name || u.Username, role: u.Role };
  sessions.set(token, { user, exp: now + 12 * 3600e3 });
  store.update('Users', 'Username', [{ key: u.Username, set: { 'Last Login': new Date().toISOString().slice(0, 16).replace('T', ' ') } }]).catch(() => {});
  res.set('Set-Cookie', `aav_s=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`);
  res.json({ user });
}));
app.post('/api/logout', (req, res) => { const t = cookie(req).aav_s; if (t) sessions.delete(t); res.set('Set-Cookie', 'aav_s=; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.post('/api/me/password', need(), wrap(async (req, res) => {
  const { current, next } = req.body || {};
  const u = (await users()).find(x => x.Username === req.user.username);
  if (!u || !verify(current, u['Password Hash'])) throw new Error('Current password is wrong.');
  if (String(next || '').length < 8) throw new Error('New password must be at least 8 characters.');
  await store.update('Users', 'Username', [{ key: u.Username, set: { 'Password Hash': hash(next) } }]);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- setup + connections
async function canEditConnections(req) {
  if (!isLocal(req)) return false;
  if (!config.isConfigured() || (sessionUser(req) || {}).role === 'owner') return true;
  try { return !(await users()).length; } catch (e) { return true; } // still in first-time setup
}
app.get('/api/connections', wrap(async (req, res) => {
  if (!(await canEditConnections(req))) return res.status(403).json({ error: 'Connections can only be changed by the owner on the main PC.' });
  const c = config.get(); const mask = v => v ? '•••• saved' : '';
  res.json({ waPhoneId: c.waPhoneId || '', waToken: mask(c.waToken), googlePlacesKey: mask(c.googlePlacesKey), tomtomKey: mask(c.tomtomKey), geoapifyKey: mask(c.geoapifyKey), hereKey: mask(c.hereKey), storage: c.storage === 'supabase' ? 'supabase' : 'sheet', supabaseUrl: c.supabaseUrl || '', supabaseKey: mask(c.supabaseKey), supabaseSql: require('./supabase').SETUP_SQL, sheetUrl: c.sheetUrl || '', serviceAccountEmail: c.serviceAccount ? c.serviceAccount.client_email : '', gmailUser: c.gmailUser || '', gmailAppPassword: mask(c.gmailAppPassword), aiProvider: c.aiProvider === 'openai' ? 'openai' : 'gemini', leadSource: c.leadSource === 'apify' ? 'apify' : 'free', openaiKey: mask(c.openaiKey), geminiKey: mask(c.geminiKey), apifyToken: mask(c.apifyToken), inboxes: (c.extraInboxes || []).map(x => ({ user: x.user, added: x.added })), network: lanUrls() });
}));
app.post('/api/connections', wrap(async (req, res) => {
  if (!(await canEditConnections(req))) return res.status(403).json({ error: 'Connections can only be changed by the owner on the main PC.' });
  const b = req.body || {}; const patch = {};
  if (b.sheetUrl) patch.sheetUrl = String(b.sheetUrl).trim();
  if (b.supabaseUrl !== undefined && String(b.supabaseUrl).trim()) {
    const u = String(b.supabaseUrl).trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(u) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u)) throw new Error('The Supabase Project URL looks like https://abcdefgh.supabase.co (Project Settings → Data API).');
    patch.supabaseUrl = u;
  }
  if (b.supabaseKey && !String(b.supabaseKey).startsWith('••')) {
    const k = String(b.supabaseKey).replace(/[\s\u200b-\u200d\ufeff"'`]/g, '');
    if (k.length < 30) throw new Error('That does not look like a full Supabase key. Copy the secret key from Project Settings → API Keys.');
    patch.supabaseKey = k;
  }
  // choosing Google Sheet again is allowed any time; moving to Supabase goes through "Move to Supabase" (it copies the data first)
  if (b.storage === 'sheet') patch.storage = 'sheet';
  if (b.serviceAccountJson) {
    let sa; try { sa = JSON.parse(b.serviceAccountJson); } catch (e) { throw new Error('That key file is not valid JSON. Upload the .json file Google gave you.'); }
    if (!sa.client_email || !sa.private_key) throw new Error('This JSON is not a service account key (missing client_email / private_key).');
    patch.serviceAccount = { client_email: sa.client_email, private_key: sa.private_key };
  }
  if (b.gmailUser) patch.gmailUser = String(b.gmailUser).trim();
  if (b.gmailAppPassword && !String(b.gmailAppPassword).startsWith('••')) patch.gmailAppPassword = String(b.gmailAppPassword).replace(/\s+/g, '');
  if (b.openaiKey && !String(b.openaiKey).startsWith('••')) {
    // forgive copy problems: spaces or line breaks inside, quotes around it, invisible characters
    const k = String(b.openaiKey).replace(/[\s​-‍﻿"'`]/g, '');
    if (!/^sk-[A-Za-z0-9_\-.]{20,}$/.test(k)) {
      const what = k ? `What was pasted starts with "${k.slice(0, 6)}…" and is ${k.length} characters long` : 'Nothing was pasted';
      throw new Error(`That is not a ChatGPT (OpenAI) API key. ${what}, but an OpenAI key starts with "sk-" and is much longer. ` +
        (/^AQ\.|^AIza/.test(k) ? 'This looks like the old Google Gemini key. ' : '') +
        'On the OpenAI page, select the whole key and press Ctrl+C (the Copy button may not reach Windows), then paste it here with Ctrl+V.');
    }
    patch.openaiKey = k;
  }
  if (b.geminiKey && !String(b.geminiKey).startsWith('••')) {
    const k = String(b.geminiKey).replace(/[\s\u200b-\u200d\ufeff"'`]/g, '');
    if (/^sk-/.test(k)) throw new Error('That is a ChatGPT (OpenAI) key. The free Gemini key comes from aistudio.google.com/apikey.');
    if (k.length < 20) throw new Error('That does not look like a full Gemini API key. Copy the whole key from aistudio.google.com/apikey.');
    patch.geminiKey = k;
  }
  if (b.aiProvider !== undefined) patch.aiProvider = b.aiProvider === 'openai' ? 'openai' : 'gemini';
  if (b.waPhoneId !== undefined) { const v = String(b.waPhoneId).replace(/D/g, ''); if (v && v.length < 8) throw new Error('The WhatsApp phone number ID is a long number (WhatsApp → API setup → Phone number ID).'); patch.waPhoneId = v; }
  if (b.waToken !== undefined && !String(b.waToken).startsWith('••')) { const v = String(b.waToken).replace(/s/g, ''); if (v && v.length < 40) throw new Error('That WhatsApp access token looks too short. Copy the whole token.'); patch.waToken = v; }
  for (const k of ['googlePlacesKey', 'tomtomKey', 'geoapifyKey', 'hereKey']) if (b[k] !== undefined && !String(b[k]).startsWith('••')) { const v = String(b[k]).replace(/[\s"'`]/g, ''); if (v && v.length < 10) throw new Error('That key looks too short. Copy the whole key.'); patch[k] = v; }
  if (b.leadSource !== undefined) patch.leadSource = b.leadSource === 'apify' ? 'apify' : 'free';
  if (b.apifyToken && !String(b.apifyToken).startsWith('••')) patch.apifyToken = String(b.apifyToken).trim();
  config.set(patch);
  res.json({ ok: true, serviceAccountEmail: config.get().serviceAccount ? config.get().serviceAccount.client_email : '' });
}));
// Extra sending inboxes (Gmail or Google Workspace, each with its own App Password). Each warms up from the day it is added.
app.post('/api/connections/inboxes', wrap(async (req, res) => {
  if (!(await canEditConnections(req))) return res.status(403).json({ error: 'Connections can only be changed by the owner on the main PC.' });
  const user = String((req.body || {}).user || '').trim().toLowerCase(), pass = String((req.body || {}).pass || '').replace(/\s+/g, '');
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(user)) throw new Error('Type the full email address of the inbox.');
  if (pass.length < 16) throw new Error('Paste the 16-letter App Password of that inbox (Google Account → Security → App passwords).');
  const c = config.get();
  if (user === String(c.gmailUser || '').toLowerCase() || (c.extraInboxes || []).some(x => x.user === user)) throw new Error('This inbox is already connected.');
  await mail.test({ user, pass });
  config.set({ extraInboxes: [...(c.extraInboxes || []), { user, pass, added: today() }] });
  res.json({ ok: true, msg: `${user} connected. It starts with ${(await store.settings().catch(() => ({}))).DAILY_START_LIMIT || 20} emails a day and grows each week.` });
}));
app.delete('/api/connections/inboxes/:user', wrap(async (req, res) => {
  if (!(await canEditConnections(req))) return res.status(403).json({ error: 'Connections can only be changed by the owner on the main PC.' });
  const u = String(req.params.user).toLowerCase();
  config.set({ extraInboxes: (config.get().extraInboxes || []).filter(x => x.user !== u) });
  res.json({ ok: true });
}));
app.post('/api/connections/test', wrap(async (req, res) => {
  if (!(await canEditConnections(req))) return res.status(403).json({ error: 'Not allowed.' });
  const what = (req.body || {}).what;
  if (what === 'sheet') { const r = await store.ensureTabs(); return res.json({ ok: true, msg: `Connected to "${r.title}". Tabs are ready.` }); }
  if (what === 'supabase') { await store.supabase().createTables(); return res.json({ ok: true, msg: 'Supabase connected. The tables are ready.' }); }
  if (what === 'gmail') { await mail.test(); return res.json({ ok: true, msg: 'Gmail connected (sending and reading).' }); }
  if (what === 'openai' || what === 'gemini') {
    const ai = require('./ai');
    if (what === 'openai' && !config.get().openaiKey) throw new Error('Paste your ChatGPT (OpenAI) API key first.');
    if (what === 'gemini' && !config.get().geminiKey) throw new Error('Paste your free Gemini API key first (aistudio.google.com/apikey).');
    if (ai.provider() !== (what === 'openai' ? 'openai' : 'gemini')) throw new Error(`Choose ${what === 'openai' ? 'ChatGPT' : 'Gemini (free)'} under "Which AI writes the emails" and save first.`);
    ai.configure(await store.settings().catch(() => ({})));
    const a = await gemini('Return ONLY this JSON: {"ok": true}', 'auto', { priority: 'reply' });
    if (!a) throw new Error(`${ai.aiName()} answered but not as expected.`);
    return res.json({ ok: true, msg: `${ai.aiName()} is working (model: ${ai.currentModel() || 'auto'}).` });
  }
  if (what === 'whatsapp') return res.json({ ok: true, msg: await require('./whatsapp').test() });
  if (['googlePlaces', 'tomtom', 'geoapify', 'here'].includes(what)) return res.json({ ok: true, msg: await require('./free').testSource(what) });
  if (what === 'free') {
    const n = await require('./free').testSearch();
    return res.json({ ok: true, msg: `Free lead finding works (a test web search found ${n} results). No key or payment needed.` });
  }
  if (what === 'apify') {
    if (process.env.AAVORAA_MOCK === '1') return res.json({ ok: true, msg: 'Apify connected.' });
    const r = await fetch('https://api.apify.com/v2/users/me?token=' + encodeURIComponent(config.get().apifyToken || ''));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Apify: ' + ((j.error && j.error.message) || 'token not accepted'));
    return res.json({ ok: true, msg: `Apify connected (${j.data && j.data.username}).` });
  }
  throw new Error('Unknown test');
}));
// Move all data to Supabase: create the tables, copy every tab from the Google Sheet (if one is connected), then switch over.
app.post('/api/connections/supabase/move', wrap(async (req, res) => {
  if (!(await canEditConnections(req))) return res.status(403).json({ error: 'Connections can only be changed by the owner on the main PC.' });
  const c = config.get();
  if (!c.supabaseUrl || !c.supabaseKey) throw new Error('Save the Supabase Project URL and secret key first.');
  if (c.storage === 'supabase') return res.json({ ok: true, msg: 'The app already saves to Supabase.' });
  const supa = store.supabase();
  let report = [];
  if (c.sheetUrl && c.serviceAccount) report = await supa.copyFrom(store.sheet, m => engine.log('agent', 'Moving to Supabase: ' + m));
  else { await supa.createTables(); await supa.seedDefaults(); report = ['No Google Sheet connected: Supabase starts empty.']; }
  config.set({ storage: 'supabase' });
  engine.log('agent', 'Data storage switched to Supabase. ' + report.join('; '));
  res.json({ ok: true, msg: 'Done. The app now saves everything to Supabase. ' + report.join(' · '), report });
}));
app.post('/api/setup/owner', wrap(async (req, res) => {
  if (!isLocal(req)) throw new Error('Create the owner account on the main PC.');
  if (!config.isConfigured()) throw new Error('Finish the connections first.');
  await store.ensureTabs();
  if ((await users()).length) throw new Error('An owner already exists. Please log in.');
  const { username, name, password } = req.body || {};
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(String(username || ''))) throw new Error('Username: 3-30 letters or numbers, no spaces.');
  if (String(password || '').length < 8) throw new Error('Password must be at least 8 characters.');
  await store.append('Users', [{ Username: username.trim(), Name: name || username, Role: 'owner', 'Password Hash': hash(password), Active: 'yes', 'Created On': today() }]);
  engine.start();
  res.json({ ok: true });
}));

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(`http://${n.address}:${PORT}`);
  return out;
}

// ---------------------------------------------------------------- dashboard
app.get('/api/dashboard', need(), wrap(async (req, res) => {
  const [s, raw, allQ, li, reps] = await Promise.all([store.settings(), store.read('Raw Leads'), store.read('Qualified Leads'), store.read('LinkedIn Leads'), store.read('Replies').catch(() => [])]);
  // a "reply" is a real person writing back (email or LinkedIn): bounces and automatic messages are counted separately
  const people = reps.filter(r => !['automatic', 'bounce'].includes(r.Category));
  const liReplied = li.filter(r => String(r['Their Reply'] || '').trim());
  const repliedLeads = new Set(people.map(r => r['Lead ID'] || r.From));
  for (const r of raw) if (r['Last Reply On'] && ['interested', 'question', 'referral', 'not_interested', 'unsubscribe', 'other'].includes(r['Reply Category']) && !reps.some(x => x['Lead ID'] === r['Lead ID'])) repliedLeads.add(r['Lead ID']); // replies from before the Replies page existed
  const qual = allQ.filter(r => r.Stage === 'Qualified'), hot = allQ.filter(r => r.Stage !== 'Qualified');
  const t = new Date(Date.now() + 5.5 * 3600e3);
  const series = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(t.getTime() - i * 86400000).toISOString().slice(0, 10);
    series.push({ date: d,
      found: raw.filter(r => r['Date Found'] === d).length + li.filter(r => r['Date Found'] === d).length,
      emailed: engine.sentOn(raw, d), replies: people.filter(r => String(r['Received On']).slice(0, 10) === d).length,
      qualified: qual.filter(r => r['Confirmed On'] === d).length, interested: hot.filter(r => r['Date Qualified'] === d).length });
  }
  const by = (arr, k) => arr.reduce((m, r) => { const v = String(r[k] || 'Unknown'); m[v] = (m[v] || 0) + 1; return m; }, {});
  const c = f => raw.filter(f).length;
  const lim = engine.dailyLimit(s);
  res.json({
    agent: { on: ['yes', 'on', 'true', '1'].includes(String(s.AGENT_ON).toLowerCase()), replyMode: s.REPLY_MODE, tone: s.TONE, todayLimit: lim.limit, sentToday: engine.sentOn(raw, today()), started: lim.started, startDate: s.START_DATE, sheetUrl: config.get().sheetUrl },
    totals: { raw: raw.length, withEmail: c(r => r.Email), emailed: c(r => r['Pitched On']), replied: repliedLeads.size + liReplied.length, repliedEmail: repliedLeads.size, repliedLinkedIn: liReplied.length, automatic: reps.filter(r => r.Category === 'automatic').length, waitingAnswer: people.filter(r => /please answer|Not sent/i.test(r['Reply Status'] || '')).length, interested: hot.length, qualified: qual.length, linkedin: li.length, linkedinToConnect: li.filter(r => r.Status === 'To Connect').length, bounced: c(r => r.Status === 'Bounced'), doNotContact: c(r => r.Status === 'Do Not Contact'), waiting: c(r => r.Status === 'New') },
    series, rawStatus: by(raw, 'Status'), services: allQ.length ? by(allQ, 'Service Needed') : by(raw.filter(r => r['Best Service']), 'Best Service'), countries: by(raw, 'Country'),
    recentQualified: qual.slice(-8).reverse(), recentInterested: hot.slice(-8).reverse(),
  });
}));

// ---------------------------------------------------------------- leads
const strip = rows => rows.map(({ _row, ...r }) => r);
app.get('/api/leads/raw', need('owner', 'leader'), wrap(async (req, res) => res.json(strip(await store.read('Raw Leads')).reverse())));
app.post('/api/leads/qualified/:id/confirm', need('owner', 'leader'), wrap(async (req, res) => res.json({ ok: true, ...(await engine.confirmQualified(req.params.id, req.body || {}, req.user.name)) })));
app.post('/api/leads/qualified/:id/unconfirm', need('owner', 'leader'), wrap(async (req, res) => { await engine.unconfirmQualified(req.params.id, req.user.name); res.json({ ok: true }); }));
app.get('/api/leads/qualified', need('owner', 'leader'), wrap(async (req, res) => res.json(strip(await store.read('Qualified Leads')).reverse())));
app.get('/api/leads/linkedin', need(), wrap(async (req, res) => res.json(strip(await store.read('LinkedIn Leads')).reverse())));
const RAW_STATUSES = ['New', 'Pitched', 'Follow-up 1', 'Follow-up 2', 'Replied', 'Interested', 'Not Interested', 'Do Not Contact', 'Bounced', 'No Email', 'Low Fit', 'Send Failed', 'Bad Email'];
const LI_STATUSES = ['To Connect', 'Request Sent', 'Connected', 'Message Sent', 'Replied', 'Interested', 'Not Interested'];
app.patch('/api/leads/raw/:id', need('owner', 'leader'), wrap(async (req, res) => {
  const b = req.body || {}, set = {};
  if (b.Status) { if (!RAW_STATUSES.includes(b.Status)) throw new Error('Unknown status'); set.Status = b.Status; }
  for (const k of ['Email', 'Contact Name', 'Best Service', 'Notes']) if (b[k] !== undefined) set[k] = String(b[k]).slice(0, 1500);
  await store.update('Raw Leads', 'Lead ID', [{ key: req.params.id, set }]); res.json({ ok: true });
}));
app.patch('/api/leads/qualified/:id', need('owner', 'leader'), wrap(async (req, res) => {
  const b = req.body || {}, set = {};
  for (const k of ['Next Step', 'Owner', 'Lead Score', 'Email']) if (b[k] !== undefined) set[k] = String(b[k]).trim().slice(0, 500);
  if (set.Email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(set.Email)) throw new Error('That email address does not look right.');
  await store.update('Qualified Leads', 'Lead ID', [{ key: req.params.id, set }]); res.json({ ok: true });
}));
app.get('/api/leads/qualified/:id/thread', need('owner', 'leader'), wrap(async (req, res) => res.json(await engine.qualifiedThread(req.params.id))));
app.post('/api/leads/qualified/:id/draft', need('owner', 'leader'), wrap(async (req, res) => {
  const b = req.body || {};
  res.json(await engine.qualifiedDraft(req.params.id, b.channel === 'linkedin' ? 'linkedin' : 'email', b.latest));
}));
app.post('/api/leads/qualified/:id/reply', need('owner', 'leader'), wrap(async (req, res) => {
  const b = req.body || {};
  res.json({ ok: true, ...(await engine.qualifiedReply(req.params.id, { channel: b.channel, to: b.to, text: String(b.text || '').slice(0, 20000) }, req.user.name)) });
}));
// What is new, for the red badges and the pop sound: ids of every client reply (Gmail, LinkedIn) and qualified lead
const liKey = r => r['Lead ID'] + ':' + String(r['Their Reply'] || '').length;
app.get('/api/notify', need(), wrap(async (req, res) => {
  const mailOk = req.user.role !== 'linkedin';
  const [rep, li, qual] = await Promise.all([mailOk ? store.read('Replies') : [], store.read('LinkedIn Leads'), mailOk ? store.read('Qualified Leads') : []]);
  res.json({
    gmail: rep.filter(r => r.Category !== 'automatic').map(r => ({ id: r['Reply ID'], who: r['Contact Name'] || r['Business Name'] || r.From, text: String(r['Their Message'] || '').slice(0, 120) })),
    linkedin: li.filter(r => String(r['Their Reply'] || '').trim()).map(r => ({ id: liKey(r), who: r.Name, text: String(r['Their Reply']).slice(0, 120) })),
    accepted: li.filter(r => r.Status === 'Connected').map(r => ({ id: r['Lead ID'], who: r.Name, text: 'Accepted your connection request. Send them the first message.' })),
    alarm: engine.alarms().slice(0, 60).map(a => ({ id: a.id, who: a.title, text: a.text })),
    qualified: qual.filter(r => r.Stage !== 'Qualified').map(r => ({ id: r['Lead ID'], who: r['Business Name'] || r['Contact Name'], text: r.Summary || r['Service Needed'] || '' })),
  });
}));

// LinkedIn auto-connect (runs in the Windows app on the main PC)
app.get('/api/linkedin/bot', need(), wrap(async (req, res) => res.json(global.liBot ? await global.liBot.status() : { available: false })));
app.post('/api/linkedin/bot/sendall', need(), wrap(async (req, res) => { if (!global.liBot) throw new Error('Only in the Windows app on the main PC.'); res.json({ ok: true, msg: await global.liBot.sendAll(req.user.name) }); }));
app.post('/api/linkedin/bot/run', need('owner'), wrap(async (req, res) => { if (!global.liBot) throw new Error('Only in the Windows app.'); res.json({ ok: true, msg: await global.liBot.runNow() }); }));
app.post('/api/linkedin/bot/signin', need('owner'), wrap(async (req, res) => { if (!global.liBot) throw new Error('Only in the Windows app.'); global.liBot.signIn(); res.json({ ok: true }); }));
app.post('/api/linkedin/bot/signout', need('owner'), wrap(async (req, res) => { if (!global.liBot) throw new Error('Only in the Windows app.'); await global.liBot.signOut(); res.json({ ok: true }); }));
app.post('/api/linkedin/bot/switch', need('owner'), wrap(async (req, res) => { await store.saveSettings({ LINKEDIN_AUTO_CONNECT: req.body && req.body.on ? 'yes' : 'no' }); res.json({ ok: true }); }));
// ---------------------------------------------------------------- alarms, inbox health, token dashboard, bills
// One button: pitch everyone on every channel (email + LinkedIn + WhatsApp)
app.post('/api/pitch/all', need('owner'), wrap(async (req, res) => res.json(await require('./pitch').pitchEverything(req.user.name))));
app.get('/api/pitch/status', need(), wrap(async (req, res) => res.json(require('./pitch').status())));
app.get('/api/alarms', need(), wrap(async (req, res) => res.json(engine.alarms())));
app.delete('/api/alarms', need('owner', 'leader'), wrap(async (req, res) => { engine.clearAlarms(); res.json({ ok: true }); }));
app.get('/api/inboxes', need('owner', 'leader'), wrap(async (req, res) => {
  const s = await store.settings(), raw = await store.read('Raw Leads'), day = today(), main = (require('./mail').accounts()[0] || {}).user;
  const list = engine.inboxHealth(s).map(i => ({ ...i, sentToday: raw.filter(r => String(r['Sent From'] || main).toLowerCase() === i.user && [r['Pitched On'], r['Follow-up 1 On'], r['Follow-up 2 On']].map(String).includes(day)).length }));
  const target = Number(s.EMAILS_PER_DAY_TARGET || 200), perInbox = Number(s.DAILY_MAX_LIMIT || 50);
  res.json({ list, target, perInbox, needed: Math.ceil(target / Math.max(1, perInbox)) });
}));
app.post('/api/inboxes/:user/resume', need('owner'), wrap(async (req, res) => { engine.resumeInbox(String(req.params.user).toLowerCase()); res.json({ ok: true }); }));
// Token & usage dashboard: everything the app uses (AI, mail, lead platforms), combined, and per lead
app.get('/api/usage', need('owner', 'leader'), wrap(async (req, res) => {
  const meter = require('./usage'), ai = require('./ai'), s = await store.settings(); ai.configure(s);
  const t = meter.sum(1), w = meter.sum(7), m = meter.sum(30), st = ai.aiStatus();
  const raw = await store.read('Raw Leads'), day = today();
  const leadsToday = raw.filter(r => String(r['Date Found']) === day).length;
  const inb = engine.inboxHealth(s), sentToday = raw.filter(r => [r['Pitched On'], r['Follow-up 1 On'], r['Follow-up 2 On']].map(String).includes(day)).length;
  const per = (x, n) => n ? Math.round(x / n) : 0;
  const leads30 = (m.leads && m.leads.found) || 0, aiTok30 = (m.ai && m.ai.tokens) || 0, aiReq30 = (m.ai && m.ai.requests) || 0;
  const srch = g => Object.values((g && g.search) || {}).reduce((a, b) => a + b, 0);
  res.json({
    ai: { provider: ai.aiName(), model: ai.currentModel(), requestsToday: st.used, requestsLeft: Math.max(0, st.limit - st.used), limit: st.limit, models: st.models || [], blockedUntil: st.blockedUntil,
      tokensToday: (t.ai && t.ai.tokens) || 0, tokens7: (w.ai && w.ai.tokens) || 0, tokens30: aiTok30 },
    mail: { sentToday, capacityToday: inb.filter(i => !i.paused).reduce((a, i) => a + i.limit, 0), inboxes: inb.length, paused: inb.filter(i => i.paused).length, sent30: (m.mail && m.mail.sent) || 0 },
    platform: { searchesToday: srch(t), searches30: srch(m), bySource: (m.search || {}), leadsBySource: (m.sourceLeads || {}), apify: config.get().leadSource === 'apify' },
    leads: { today: leadsToday, target: Number(s.LEADS_PER_DAY ?? 200), qualityToday: raw.filter(r => String(r['Date Found']) === day && r.Quality === 'yes').length, qualityTarget: '10-30', found30: leads30, analysed30: (m.leads && m.leads.analysed) || 0 },
    perLead: { tokens: per(aiTok30, leads30), aiRequests: Math.round((aiReq30 / Math.max(1, leads30)) * 10) / 10, searches: Math.round((srch(m) / Math.max(1, leads30)) * 100) / 100, emails: Math.round((((m.mail && m.mail.sent) || 0) / Math.max(1, leads30)) * 100) / 100 },
    series: meter.series(14).map(d => ({ day: d.day, tokens: (d.ai && d.ai.tokens) || 0, ai: (d.ai && d.ai.requests) || 0, sent: (d.mail && d.mail.sent) || 0, leads: (d.leads && d.leads.found) || 0 })),
  });
}));
// Bills: every tool's monthly cost in one place (ChatGPT API, mail, lead platforms, our service, Claude...)
const BILL_DEFAULTS = [['ChatGPT API (OpenAI)', 'https://platform.openai.com/settings/organization/billing'], ['Mail (Google Workspace / Gmail)', 'https://admin.google.com/ac/billing'], ['Platform charges (Apify, Google Places, ...)', 'https://console.apify.com/billing'], ['Our service charges', ''], ['Claude (optional)', 'https://claude.ai/settings/billing'], ['Supabase (database)', 'https://supabase.com/dashboard/org/_/billing']];
app.get('/api/bills', need('owner'), wrap(async (req, res) => {
  let rows = await store.read('Bills', true).catch(() => []);
  if (!rows.length) { await store.append('Bills', BILL_DEFAULTS.map(([Item, link]) => ({ Item, 'Monthly Amount (Rs)': '', 'Billing Link': link }))); rows = await store.read('Bills', true); }
  res.json(strip(rows));
}));
app.put('/api/bills', need('owner'), wrap(async (req, res) => {
  const list = Array.isArray(req.body) ? req.body.slice(0, 50) : [];
  const have = await store.read('Bills', true);
  const clean = o => ({ 'Monthly Amount (Rs)': String(o['Monthly Amount (Rs)'] ?? '').replace(/[^\d.]/g, '').slice(0, 12), 'Paid On': String(o['Paid On'] || '').slice(0, 20), 'Paid By': String(o['Paid By'] || '').slice(0, 60), Notes: String(o.Notes || '').slice(0, 300), 'Billing Link': /^https?:\/\//.test(o['Billing Link'] || '') ? String(o['Billing Link']).slice(0, 300) : '' });
  const upd = [], add = [];
  for (const o of list) { const it = String(o.Item || '').trim().slice(0, 80); if (!it) continue; (have.some(h => h.Item === it) ? upd : add).push(have.some(h => h.Item === it) ? { key: it, set: clean(o) } : { Item: it, ...clean(o) }); }
  if (upd.length) await store.update('Bills', 'Item', upd); if (add.length) await store.append('Bills', add);
  res.json({ ok: true });
}));
// ---------------------------------------------------------------- Aavo, the in-app assistant (chat + voice)
app.post('/api/assistant/chat', need(), wrap(async (req, res) => {
  const b = req.body || {}; const history = (Array.isArray(b.history) ? b.history : []).slice(-12).map(m => ({ role: m.role === 'user' ? 'user' : 'aavo', text: String(m.text || '').slice(0, 2000), draft: m.draft, confirm: m.confirm && typeof m.confirm === 'object' ? { name: String(m.confirm.name || ''), args: m.confirm.args || {} } : undefined, done: !!m.done }));
  res.json(await require('./assistant').chat(req.user, history, String(b.page || ''), b.auto === true));
}));
app.post('/api/assistant/confirm', need(), wrap(async (req, res) => {
  const b = req.body || {}; res.json(await require('./assistant').act(String(b.name || ''), b.args || {}, req.user, true));
}));
app.post('/api/assistant/voice', need(), express.json({ limit: '20mb' }), wrap(async (req, res) => {
  const b = req.body || {}; res.json({ text: await require('./ai').transcribe(String(b.audio || ''), String(b.mime || 'audio/webm')) });
}));
app.post('/api/leads/linkedin/:id/reply', need(), wrap(async (req, res) => {
  const b = req.body || {};
  if (b.channel === 'email' && req.user.role === 'linkedin') throw new Error('Only the owner or team leader can send emails.');
  res.json({ ok: true, ...(await engine.linkedinAnswer(req.params.id, { channel: b.channel, to: String(b.to || '').trim(), text: String(b.text || '').slice(0, 20000) }, req.user.name)) });
}));
app.patch('/api/leads/linkedin/:id', need(), wrap(async (req, res) => {
  const b = req.body || {}, set = { 'Handled By': req.user.name };
  if (b.Status) { if (!LI_STATUSES.includes(b.Status)) throw new Error('Unknown status'); set.Status = b.Status; }
  if (b['Their Reply'] !== undefined) {
    set['Their Reply'] = String(b['Their Reply']).slice(0, 3000); set['Suggested Reply'] = ''; if (!b.Status) set.Status = 'Replied';
    const shared = (set['Their Reply'].match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [])[0]; // they wrote their email in the reply
    if (shared) set.Email = shared.toLowerCase();
  }
  if (b.Email !== undefined) { const e = String(b.Email).trim(); if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('That email address does not look right.'); set.Email = e; }
  if (b.Notes !== undefined) set.Notes = String(b.Notes).slice(0, 1000);
  await store.update('LinkedIn Leads', 'Lead ID', [{ key: req.params.id, set }]);
  if (set.Email) await engine.syncQualifiedEmail(req.params.id, set.Email).catch(() => {});
  if (set['Their Reply'] || set.Status === 'Interested') engine.run('linkedinFollow').catch(() => {});
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- replies: everyone who wrote back, and our answers
app.get('/api/replies', need('owner', 'leader'), wrap(async (req, res) => res.json(strip(await store.read('Replies')).reverse())));
// Write / send an email to one lead straight from the app
app.get('/api/leads/raw/:id/draft', need('owner', 'leader'), wrap(async (req, res) => res.json(await engine.draftFor(req.params.id))));
app.post('/api/leads/raw/:id/email', need('owner', 'leader'), wrap(async (req, res) => {
  const b = req.body || {};
  res.json({ ok: true, ...(await engine.emailLead(req.params.id, { to: b.to, subject: String(b.subject || '').slice(0, 300), text: String(b.text || '').slice(0, 20000) }, req.user.name)) });
}));

app.post('/api/replies/answer-all', need('owner'), wrap(async (req, res) => res.json(await require('./assistant').act('answer_all_replies', {}, req.user, true))));
app.post('/api/replies/:id/draft', need('owner', 'leader'), wrap(async (req, res) => res.json(await engine.replyDraft(req.params.id))));
app.post('/api/replies/:id/answer', need('owner', 'leader'), wrap(async (req, res) => {
  await engine.answerReply(req.params.id, (req.body || {}).text, req.user.name);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- call / WhatsApp tasks (sent by a person, so no account can be banned)
const CALL_STATUSES = ['Messaged', 'No Answer', 'Interested', 'Ready to work', 'Not Interested', 'Wrong Number'];
const DIAL = { IN: '91', AU: '61', US: '1', CA: '1', GB: '44', UK: '44', AE: '971', SG: '65', MY: '60', SA: '966', QA: '974', OM: '968', BH: '973', KW: '965', IE: '353', NZ: '64', ES: '34', PT: '351', DE: '49', NL: '31', BE: '32', FR: '33', IT: '39', PL: '48', CZ: '420', BR: '55', MX: '52', ZA: '27', KE: '254', NG: '234', PH: '63', ID: '62', TH: '66', LK: '94', PK: '92', BD: '880', NP: '977', HK: '852', JP: '81' };
const CITY_COUNTRY = { dubai: 'AE', 'abu dhabi': 'AE', sharjah: 'AE', riyadh: 'SA', doha: 'QA', muscat: 'OM', london: 'GB', manchester: 'GB', birmingham: 'GB', dublin: 'IE', 'new york': 'US', 'los angeles': 'US', houston: 'US', chicago: 'US', miami: 'US', dallas: 'US', toronto: 'CA', vancouver: 'CA', sydney: 'AU', melbourne: 'AU', auckland: 'NZ', singapore: 'SG', 'kuala lumpur': 'MY', madrid: 'ES', barcelona: 'ES', lisbon: 'PT', berlin: 'DE', munich: 'DE', amsterdam: 'NL', brussels: 'BE', paris: 'FR', milan: 'IT', warsaw: 'PL', prague: 'CZ', 'sao paulo': 'BR', 'mexico city': 'MX', johannesburg: 'ZA', nairobi: 'KE', mumbai: 'IN', bengaluru: 'IN', chennai: 'IN', coimbatore: 'IN', hyderabad: 'IN', delhi: 'IN', pune: 'IN', kochi: 'IN' };
// "+61 2 9000 0000" -> "61290000000"; "02 9000 0000" + Australia -> "61290000000"
function waNumber(phone, country, city) {
  const raw = String(phone || '').trim(); let d = raw.replace(/[^\d]/g, '');
  if (!d) return '';
  if (raw.startsWith('+')) return d;
  if (raw.startsWith('00')) return d.slice(2);
  const cc = DIAL[String(country || '').toUpperCase()] || DIAL[CITY_COUNTRY[String(city || '').toLowerCase().trim()]] || '';
  if (!cc) return d;
  if (d.startsWith(cc) && d.length > 10) return d;
  return cc + d.replace(/^0+/, '');
}
function callMessage(s, r) {
  const first = r['Contact Name'] ? ' ' + String(r['Contact Name']).split(/\s+/)[0] : '';
  const biz = String(r['Business Name'] || '').split(/\s+[|:–-]\s+/)[0];
  return r['Pitched On']
    ? `Hi${first}, this is ${s.SENDER_NAME} from ${s.COMPANY} (${s.WEBSITE}). I sent you an email a few days ago about helping ${biz} get more enquiries online. Would a free 10-minute review of your website and Google listing be useful? Happy to share it here.`
    : `Hi${first}, this is ${s.SENDER_NAME} from ${s.COMPANY} (${s.WEBSITE}). We help businesses like ${biz} get more enquiries through a sharper website, better Google visibility and simple marketing. Would a free 10-minute review of your online presence be useful?`;
}
app.get('/api/leads/calls', need(), wrap(async (req, res) => {
  const s = await store.settings(), rows = await store.read('Raw Leads');
  const now = engine.today();
  const age = d => { const t = Date.parse(d); return isNaN(t) ? 0 : (Date.parse(now) - t) / 86400000; };
  const open = r => r.Phone && !['Interested', 'Not Interested', 'Wrong Number', 'Messaged'].includes(r['Call Status']) && !['Do Not Contact', 'Not Interested', 'Interested', 'Replied'].includes(r.Status);
  const noEmail = r => ['No Email', 'Bad Email', 'Bounced', 'Send Failed'].includes(r.Status);
  const quiet = r => r['Pitched On'] && !r['Last Reply On'] && age(r['Pitched On']) >= 2;
  const tasks = rows.filter(r => open(r) && (noEmail(r) || quiet(r)))
    .sort((a, b) => (noEmail(b) - noEmail(a)) || ((a['Call Status'] === 'No Answer') - (b['Call Status'] === 'No Answer')) || Number(b['Fit Score'] || 0) - Number(a['Fit Score'] || 0))
    .slice(0, 60).map(r => ({ ...strip([r])[0], why: noEmail(r) ? 'Cannot be reached by email' : `Emailed ${Math.floor(age(r['Pitched On']))} days ago, no reply`, wa: waNumber(r.Phone, r.Country, r.City), message: callMessage(s, r) }));
  res.json({ tasks, done: rows.filter(r => r['Call Status']).length });
}));
app.patch('/api/leads/call/:id', need(), wrap(async (req, res) => {
  const b = req.body || {};
  if (!CALL_STATUSES.includes(b.status)) throw new Error('Unknown result');
  await engine.callResult(req.params.id, b.status, String(b.note || '').slice(0, 500), req.user.name);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- import
const uploads = new Map();
const FIELD_GUESS = {
  'Business Name': ['business', 'company', 'business name', 'company name', 'organisation', 'organization', 'name of business', 'brand'],
  'Email': ['email', 'e-mail', 'email address', 'mail'],
  'Website': ['website', 'site', 'url', 'web', 'domain'],
  'Contact Name': ['contact', 'contact name', 'name', 'full name', 'owner', 'person', 'first name'],
  'Phone': ['phone', 'mobile', 'telephone', 'tel', 'whatsapp', 'contact number'],
  'Industry': ['industry', 'category', 'sector', 'niche', 'type'],
  'City': ['city', 'town', 'location'],
  'Country': ['country', 'nation'],
  'LinkedIn': ['linkedin', 'linkedin url', 'linkedin profile'],
  'Best Service': ['service', 'best service', 'service needed'],
  'Notes': ['notes', 'note', 'comments', 'remarks'],
};
app.post('/api/import/preview', need('owner', 'leader'), wrap(async (req, res) => {
  const { filename, base64 } = req.body || {};
  if (!base64) throw new Error('No file received.');
  const wb = XLSX.read(Buffer.from(base64, 'base64'), { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
  if (!rows.length) throw new Error('The file has no rows.');
  const headers = Object.keys(rows[0]);
  const mapping = {};
  for (const [field, guesses] of Object.entries(FIELD_GUESS)) {
    const h = headers.find(x => guesses.includes(String(x).toLowerCase().trim())) || headers.find(x => guesses.some(g => String(x).toLowerCase().includes(g)));
    if (h && !Object.values(mapping).includes(h)) mapping[field] = h;
  }
  const token = crypto.randomBytes(12).toString('hex');
  uploads.set(token, { rows: rows.slice(0, 5000), at: Date.now(), filename });
  res.json({ token, filename, total: rows.length, headers, mapping, sample: rows.slice(0, 8), fields: Object.keys(FIELD_GUESS) });
}));
app.post('/api/import/commit', need('owner', 'leader'), wrap(async (req, res) => {
  const { token, mapping = {}, defaults = {} } = req.body || {};
  const up = uploads.get(token); if (!up) throw new Error('Upload expired. Please choose the file again.');
  const existing = await store.read('Raw Leads', true);
  const dom = u => { try { const s = String(u || '').trim(); return s ? new URL(s.startsWith('http') ? s : 'https://' + s).hostname.replace(/^www\./, '').toLowerCase() : ''; } catch (e) { return ''; } };
  const seenE = new Set(existing.map(r => String(r.Email || '').toLowerCase().trim()).filter(Boolean));
  const seenD = new Set(existing.map(r => dom(r.Website)).filter(Boolean));
  const out = []; let dup = 0, empty = 0;
  for (const r of up.rows) {
    const g = f => mapping[f] ? String(r[mapping[f]] ?? '').trim() : '';
    const name = g('Business Name') || g('Contact Name');
    const email = g('Email').toLowerCase().split(/[;,\s]/)[0] || '';
    let website = g('Website'); if (website && !/^https?:\/\//i.test(website)) website = 'https://' + website;
    if (!name && !email) { empty++; continue; }
    const d = dom(website);
    if ((email && seenE.has(email)) || (!email && d && seenD.has(d))) { dup++; continue; }
    if (email) seenE.add(email); if (d) seenD.add(d);
    const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
    out.push({ 'Lead ID': 'L' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(), 'Date Found': today(), Source: 'Import: ' + String(up.filename || 'file').slice(0, 40),
      'Business Name': name, Industry: g('Industry') || defaults.industry || '', City: g('City'), Country: g('Country') || defaults.country || '', Website: website, Email: valid ? email : '', Phone: g('Phone'),
      'Contact Name': g('Contact Name'), LinkedIn: g('LinkedIn'), 'Best Service': g('Best Service') || defaults.service || '', 'Fit Score': '', Status: valid ? (defaults.status || 'New') : 'No Email', Notes: g('Notes') });
  }
  await store.append('Raw Leads', out);
  uploads.delete(token);
  // imported leads are emailed first, starting right now (unless they were imported as anything other than New)
  const s = await store.settings();
  const now = out.length && yes(s.AGENT_ON) && String(s.IMPORT_SEND_NOW || 'yes').toLowerCase() !== 'no';
  if (now) engine.run('importSend').catch(() => {});
  res.json({ added: out.length, duplicates: dup, empty, ready: out.filter(r => r.Status === 'New').length, withWebsite: out.filter(r => r.Status === 'No Email' && r.Website).length, sendingNow: !!now, agentOff: !yes(s.AGENT_ON) });
}));

// ---------------------------------------------------------------- templates
app.get('/api/templates', need(), wrap(async (req, res) => {
  const [tpl, raw] = await Promise.all([store.read('Templates'), store.read('Raw Leads')]);
  const stats = {};
  for (const r of raw) if (r['Template Used']) { const s = stats[r['Template Used']] = stats[r['Template Used']] || { sent: 0, replied: 0, interested: 0 }; s.sent++; if (r['Last Reply On']) s.replied++; if (r.Status === 'Interested') s.interested++; }
  res.json({ stages: STAGES, templates: strip(tpl).filter(t => String(t.Active).toLowerCase() !== 'deleted').map(t => ({ ...t, stats: stats[t.Name] || { sent: 0, replied: 0, interested: 0 } })) });
}));
app.post('/api/templates', need('owner', 'leader'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.Name || !b.Body) throw new Error('Name and message are required.');
  if (!STAGES.includes(b.Stage)) throw new Error('Choose when this template is used.');
  const row = { Name: String(b.Name).slice(0, 80), Stage: b.Stage, Subject: String(b.Subject || '').slice(0, 200), Body: String(b.Body).slice(0, 4000), 'AI Personalise': b['AI Personalise'] === 'no' ? 'no' : 'yes', Active: b.Active === 'no' ? 'no' : 'yes', 'Created By': req.user.name, 'Updated On': today() };
  if (b['Template ID']) await store.update('Templates', 'Template ID', [{ key: b['Template ID'], set: row }]);
  else await store.append('Templates', [{ 'Template ID': 'T' + Date.now().toString(36).toUpperCase(), ...row }]);
  res.json({ ok: true });
}));
app.delete('/api/templates/:id', need('owner', 'leader'), wrap(async (req, res) => { await store.update('Templates', 'Template ID', [{ key: req.params.id, set: { Active: 'deleted', 'Updated On': today() } }]); res.json({ ok: true }); }));
app.post('/api/templates/preview', need('owner', 'leader'), wrap(async (req, res) => {
  const b = req.body || {};
  const s = await store.settings(); if (b.tone) s.TONE = b.tone;
  const raw = await store.read('Raw Leads');
  const lead = raw.find(r => r['Lead ID'] === b.leadId) || raw.filter(r => r.Email).slice(-1)[0] || { 'Business Name': 'Sunrise Dental Clinic', 'Contact Name': 'Sarah Khan', Industry: 'Dental clinic', City: 'Dubai', Country: 'AE', Website: 'https://example.com', 'Website Issues': 'no meta description on the homepage ; footer still shows 2021', 'Best Service': 'SEO & AI Search Visibility', 'Pitch Angle': 'More patients finding them on Google Maps', 'Email Subject': 'quick idea for Sunrise Dental' };
  const stage = ['First email', 'Follow-up 1', 'Follow-up 2'].indexOf(b.Stage);
  const { fill, leadVars, clean, P } = require('./ai');
  let out;
  if (stage >= 0) {
    const tpl = { Name: b.Name || 'Preview', Subject: b.Subject || '', Body: b.Body || '', 'AI Personalise': b['AI Personalise'] || 'yes' };
    const vars = leadVars(lead, s);
    if (tpl['AI Personalise'] === 'no') out = { subject: fill(tpl.Subject || (stage === 0 ? 'quick idea for {{business}}' : ''), vars), body: fill(tpl.Body, vars) };
    else { const a = await gemini(P.email(s, lead, stage, tpl.Body ? { ...tpl, Body: fill(tpl.Body, vars), Subject: fill(tpl.Subject, vars) } : null), s.GEMINI_MODEL, { priority: 'send' }); if (!a) throw new Error('AI did not answer, try again.'); out = { subject: clean(a.subject), body: clean(a.body) }; }
    if (stage > 0) out.subject = 'Re: ' + (lead['Email Subject'] || 'quick idea');
  } else out = { subject: '', body: fill(b.Body, leadVars(lead, s)) };
  const sig = ['Warm regards,', s.SENDER_NAME, [s.SENDER_TITLE, s.COMPANY].filter(Boolean).join(' | '), [s.WEBSITE, s.COMPANY_ADDRESS].filter(Boolean).join(' | ')].join('\n');
  res.json({ lead: { name: lead['Business Name'], contact: lead['Contact Name'] }, subject: out.subject, body: out.body + (stage >= 0 ? '\n\n' + sig : '') });
}));

// ---------------------------------------------------------------- settings
app.get('/api/settings', need('owner', 'leader'), wrap(async (req, res) => res.json({ values: await store.settings(), fields: SETTINGS.map(([key, def, help, group, type, options]) => ({ key, def, help, group, type, options })), tones: Object.keys(TONES), canEdit: req.user.role === 'owner' })));
app.put('/api/settings', need('owner'), wrap(async (req, res) => {
  const b = req.body || {}; const allowed = new Set(SETTINGS.map(s => s[0])); const patch = {};
  for (const [k, v] of Object.entries(b)) if (allowed.has(k)) patch[k] = String(v ?? '').slice(0, 6000);
  if (patch.DAILY_MAX_LIMIT && Number(patch.DAILY_MAX_LIMIT) > 100) throw new Error('Keep the daily maximum at 100 or less to protect the Gmail account.');
  await store.saveSettings(patch); res.json({ ok: true });
}));
app.post('/api/agent/toggle', need('owner'), wrap(async (req, res) => { await store.saveSettings({ AGENT_ON: req.body && req.body.on ? 'yes' : 'no' }); res.json({ ok: true }); }));

// ---------------------------------------------------------------- users
app.get('/api/users', need('owner'), wrap(async (req, res) => res.json({ users: (await users()).map(u => ({ username: u.Username, name: u.Name, role: u.Role, active: u.Active, created: u['Created On'], lastLogin: u['Last Login'] })), roles: ROLES, network: lanUrls() })));
app.post('/api/users', need('owner'), wrap(async (req, res) => {
  const { username, name, role, password } = req.body || {};
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(String(username || ''))) throw new Error('Username: 3-30 letters or numbers, no spaces.');
  if (!ROLES[role]) throw new Error('Choose a role.');
  if (String(password || '').length < 8) throw new Error('Password must be at least 8 characters.');
  if ((await users()).find(u => String(u.Username).toLowerCase() === username.toLowerCase())) throw new Error('That username is taken.');
  await store.append('Users', [{ Username: username, Name: name || username, Role: role, 'Password Hash': hash(password), Active: 'yes', 'Created On': today() }]);
  res.json({ ok: true });
}));
app.patch('/api/users/:u', need('owner'), wrap(async (req, res) => {
  const b = req.body || {}, set = {};
  if (b.role) { if (!ROLES[b.role]) throw new Error('Unknown role'); set.Role = b.role; }
  if (b.active !== undefined) set.Active = b.active ? 'yes' : 'no';
  if (b.name) set.Name = b.name;
  if (b.password) { if (String(b.password).length < 8) throw new Error('Password must be at least 8 characters.'); set['Password Hash'] = hash(b.password); }
  if (req.params.u === req.user.username && (set.Active === 'no' || (set.Role && set.Role !== 'owner'))) throw new Error('You cannot remove your own owner access.');
  await store.update('Users', 'Username', [{ key: req.params.u, set }]);
  if (set.Active === 'no' || set.Role || set['Password Hash']) for (const [t, s] of sessions) if (s.user.username === req.params.u) sessions.delete(t);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- agent
app.get('/api/agent', need('owner', 'leader'), wrap(async (req, res) => res.json({ jobs: engine.status(), logs: engine.logs.slice(0, 200), desktop: !!global.desktop, autoStart: global.desktop ? global.desktop.getAutoStart() : false })));
app.post('/api/agent/run/:id', need('owner'), wrap(async (req, res) => {
  if (!engine.JOBS[req.params.id]) throw new Error('Unknown job');
  engine.run(req.params.id, { force: true }).catch(() => {});
  res.json({ ok: true, msg: 'Started. Watch the activity log.' });
}));
app.post('/api/desktop/autostart', need('owner'), wrap(async (req, res) => { if (!global.desktop) throw new Error('Only in the Windows app.'); global.desktop.setAutoStart(!!(req.body || {}).on); res.json({ ok: true }); }));

// ---------------------------------------------------------------- test helpers (mock mode only)
if (process.env.AAVORAA_MOCK === '1') {
  app.post('/api/_mock/reply', wrap(async (req, res) => {
    const raw = await store.read('Raw Leads', true);
    const lead = raw.find(r => r['Message ID']);
    if (!lead) throw new Error('no pitched lead');
    mail.mockBox.inbox.push({ messageId: '<r' + Date.now() + '@x>', from: lead.Email, subject: 'Re: ' + lead['Email Subject'], text: (req.body && req.body.text) || 'Yes, I am interested, can we have a call?', inReplyTo: lead['Message ID'], references: [lead['Message ID']] });
    res.json({ ok: true, lead: lead['Business Name'] });
  }));
  app.get('/api/_mock/mail', (req, res) => res.json(mail.mockBox));
}

// ---------------------------------------------------------------- static UI
app.use(express.static(path.join(__dirname, '..', 'ui'), { index: 'index.html', maxAge: 0 }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'ui', 'index.html')));

function listen() {
  return new Promise((resolve, reject) => {
    const srv = app.listen(PORT, '0.0.0.0', () => { engine.start(); resolve({ port: PORT, srv }); });
    srv.on('error', reject);
  });
}
if (require.main === module) listen().then(() => console.log(`AAVORAA Lead Agent on http://localhost:${PORT}`));
module.exports = { listen, PORT, app };
