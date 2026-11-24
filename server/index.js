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
  res.json({ sheetUrl: c.sheetUrl || '', serviceAccountEmail: c.serviceAccount ? c.serviceAccount.client_email : '', gmailUser: c.gmailUser || '', gmailAppPassword: mask(c.gmailAppPassword), openaiKey: mask(c.openaiKey), geminiKey: mask(c.geminiKey), apifyToken: mask(c.apifyToken), network: lanUrls() });
}));
app.post('/api/connections', wrap(async (req, res) => {
  if (!(await canEditConnections(req))) return res.status(403).json({ error: 'Connections can only be changed by the owner on the main PC.' });
  const b = req.body || {}; const patch = {};
  if (b.sheetUrl) patch.sheetUrl = String(b.sheetUrl).trim();
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
  if (b.geminiKey && !String(b.geminiKey).startsWith('••')) patch.geminiKey = String(b.geminiKey).trim();
  if (b.apifyToken && !String(b.apifyToken).startsWith('••')) patch.apifyToken = String(b.apifyToken).trim();
  config.set(patch);
  res.json({ ok: true, serviceAccountEmail: config.get().serviceAccount ? config.get().serviceAccount.client_email : '' });
}));
app.post('/api/connections/test', wrap(async (req, res) => {
  if (!(await canEditConnections(req))) return res.status(403).json({ error: 'Not allowed.' });
  const what = (req.body || {}).what;
  if (what === 'sheet') { const r = await store.ensureTabs(); return res.json({ ok: true, msg: `Connected to "${r.title}". Tabs are ready.` }); }
  if (what === 'gmail') { await mail.test(); return res.json({ ok: true, msg: 'Gmail connected (sending and reading).' }); }
  if (what === 'openai' || what === 'gemini') {
    const ai = require('./ai');
    if (what === 'openai' && !config.get().openaiKey) throw new Error('Paste your ChatGPT (OpenAI) API key first.');
    ai.configure(await store.settings().catch(() => ({})));
    const a = await gemini('Return ONLY this JSON: {"ok": true}', 'auto', { priority: 'reply' });
    if (!a) throw new Error(`${ai.aiName()} answered but not as expected.`);
    return res.json({ ok: true, msg: `${ai.aiName()} is working (model: ${ai.currentModel() || 'auto'}).` });
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
  const [s, raw, qual, li] = await Promise.all([store.settings(), store.read('Raw Leads'), store.read('Qualified Leads'), store.read('LinkedIn Leads')]);
  const t = new Date(Date.now() + 5.5 * 3600e3);
  const series = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(t.getTime() - i * 86400000).toISOString().slice(0, 10);
    series.push({ date: d,
      found: raw.filter(r => r['Date Found'] === d).length + li.filter(r => r['Date Found'] === d).length,
      emailed: engine.sentOn(raw, d), replies: raw.filter(r => r['Last Reply On'] === d).length,
      qualified: qual.filter(r => r['Date Qualified'] === d).length });
  }
  const by = (arr, k) => arr.reduce((m, r) => { const v = String(r[k] || 'Unknown'); m[v] = (m[v] || 0) + 1; return m; }, {});
  const c = f => raw.filter(f).length;
  const lim = engine.dailyLimit(s);
  res.json({
    agent: { on: ['yes', 'on', 'true', '1'].includes(String(s.AGENT_ON).toLowerCase()), replyMode: s.REPLY_MODE, tone: s.TONE, todayLimit: lim.limit, sentToday: engine.sentOn(raw, today()), started: lim.started, startDate: s.START_DATE, sheetUrl: config.get().sheetUrl },
    totals: { raw: raw.length, withEmail: c(r => r.Email), emailed: c(r => r['Pitched On']), replied: c(r => r['Last Reply On']), interested: c(r => r.Status === 'Interested'), qualified: qual.length, linkedin: li.length, linkedinToConnect: li.filter(r => r.Status === 'To Connect').length, bounced: c(r => r.Status === 'Bounced'), doNotContact: c(r => r.Status === 'Do Not Contact'), waiting: c(r => r.Status === 'New') },
    series, rawStatus: by(raw, 'Status'), services: qual.length ? by(qual, 'Service Needed') : by(raw.filter(r => r['Best Service']), 'Best Service'), countries: by(raw, 'Country'),
    recentQualified: qual.slice(-8).reverse(),
  });
}));

// ---------------------------------------------------------------- leads
const strip = rows => rows.map(({ _row, ...r }) => r);
app.get('/api/leads/raw', need('owner', 'leader'), wrap(async (req, res) => res.json(strip(await store.read('Raw Leads')).reverse())));
app.get('/api/leads/qualified', need('owner', 'leader'), wrap(async (req, res) => res.json(strip(await store.read('Qualified Leads')).reverse())));
app.get('/api/leads/linkedin', need(), wrap(async (req, res) => res.json(strip(await store.read('LinkedIn Leads')).reverse())));
const RAW_STATUSES = ['New', 'Pitched', 'Follow-up 1', 'Follow-up 2', 'Replied', 'Interested', 'Not Interested', 'Do Not Contact', 'Bounced', 'No Email', 'Low Fit', 'Send Failed'];
const LI_STATUSES = ['To Connect', 'Request Sent', 'Connected', 'Message Sent', 'Replied', 'Interested', 'Not Interested'];
app.patch('/api/leads/raw/:id', need('owner', 'leader'), wrap(async (req, res) => {
  const b = req.body || {}, set = {};
  if (b.Status) { if (!RAW_STATUSES.includes(b.Status)) throw new Error('Unknown status'); set.Status = b.Status; }
  for (const k of ['Email', 'Contact Name', 'Best Service', 'Notes']) if (b[k] !== undefined) set[k] = String(b[k]).slice(0, 1500);
  await store.update('Raw Leads', 'Lead ID', [{ key: req.params.id, set }]); res.json({ ok: true });
}));
app.patch('/api/leads/qualified/:id', need('owner', 'leader'), wrap(async (req, res) => {
  const b = req.body || {}, set = {};
  for (const k of ['Next Step', 'Owner', 'Lead Score']) if (b[k] !== undefined) set[k] = String(b[k]).slice(0, 500);
  await store.update('Qualified Leads', 'Lead ID', [{ key: req.params.id, set }]); res.json({ ok: true });
}));
app.patch('/api/leads/linkedin/:id', need(), wrap(async (req, res) => {
  const b = req.body || {}, set = { 'Handled By': req.user.name };
  if (b.Status) { if (!LI_STATUSES.includes(b.Status)) throw new Error('Unknown status'); set.Status = b.Status; }
  if (b['Their Reply'] !== undefined) { set['Their Reply'] = String(b['Their Reply']).slice(0, 3000); set['Suggested Reply'] = ''; if (!b.Status) set.Status = 'Replied'; }
  if (b.Notes !== undefined) set.Notes = String(b.Notes).slice(0, 1000);
  await store.update('LinkedIn Leads', 'Lead ID', [{ key: req.params.id, set }]);
  if (set['Their Reply'] || set.Status === 'Interested') engine.run('linkedinFollow').catch(() => {});
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
  res.json({ added: out.length, duplicates: dup, empty, ready: out.filter(r => r.Status === 'New').length });
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
