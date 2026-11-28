// WhatsApp pitching through the OFFICIAL WhatsApp Cloud API (Meta). Needs, on the Connections page:
//   Phone number ID + access token (from developers.facebook.com → your app → WhatsApp → API setup)
// and in Settings: the name of an APPROVED message template (WhatsApp only allows templates for the first message).
// Without these, WhatsApp stays manual (Call / WhatsApp page: one click opens WhatsApp with the message ready).
const store = require('./store');
const config = require('./config');
const meter = require('./usage');

const CC = { IN: '91', AE: '971', SA: '966', QA: '974', OM: '968', KW: '965', BH: '973', GB: '44', UK: '44', IE: '353', US: '1', CA: '1', AU: '61', NZ: '64', SG: '65', MY: '60', ES: '34', PT: '351', DE: '49', NL: '31', BE: '32', FR: '33', IT: '39', PL: '48', CZ: '420', BR: '55', MX: '52', ZA: '27', KE: '254', NG: '234', LK: '94', BD: '880', PK: '92', NP: '977' };
const NAMES = { india: 'IN', 'united arab emirates': 'AE', uae: 'AE', 'saudi arabia': 'SA', qatar: 'QA', oman: 'OM', kuwait: 'KW', bahrain: 'BH', 'united kingdom': 'GB', england: 'GB', ireland: 'IE', 'united states': 'US', usa: 'US', canada: 'CA', australia: 'AU', 'new zealand': 'NZ', singapore: 'SG', malaysia: 'MY', spain: 'ES', portugal: 'PT', germany: 'DE', netherlands: 'NL', belgium: 'BE', france: 'FR', italy: 'IT', poland: 'PL', czechia: 'CZ', brazil: 'BR', mexico: 'MX', 'south africa': 'ZA', kenya: 'KE', nigeria: 'NG', 'sri lanka': 'LK' };
// "+971 4 399 0226;+971 50 515 9927" / "04-3990226" -> "971503990226" style (digits with country code), or '' if unsure
function normalize(phone, country) {
  const list = String(phone || '').split(/[;,/]| or /i).map(x => x.trim()).filter(Boolean);
  const pick = list.find(p => /^\+?\d[\d\s().-]{7,}$/.test(p) && /(\+|^00)/.test(p)) || list[0] || '';
  let d = pick.replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) return d.slice(1).length >= 8 ? d.slice(1) : '';
  if (d.startsWith('00')) return d.slice(2);
  const c = String(country || '').trim(), code = CC[c.toUpperCase()] || CC[NAMES[c.toLowerCase()] || ''];
  if (!code) return '';
  d = d.replace(/^0+/, '');
  return d.length >= 7 ? code + d : '';
}
// ---- several WhatsApp numbers: the main one (Connections) + extra numbers. Each has its own daily amount;
// when one is full for the day or has a problem (Meta limit, restricted, token expired), the next one takes over.
const fs = require('fs');
const path = require('path');
const HFILE = path.join(config.dir, 'whatsapp-numbers.json');
let health = {}; try { health = JSON.parse(fs.readFileSync(HFILE, 'utf8')) || {}; } catch (e) {}
const saveHealth = () => { try { fs.writeFileSync(HFILE, JSON.stringify(health)); } catch (e) {} };
function numbers() {
  const c = config.get(), out = [];
  if (c.waPhoneId && c.waToken) out.push({ id: String(c.waPhoneId), token: c.waToken, label: c.waLabel || '', main: true, added: '' });
  for (const x of c.waNumbers || []) {
    if (!x || !x.id || out.some(o => o.id === String(x.id))) continue;
    const token = x.token || c.waToken; // numbers in the same Meta business can share one token
    if (token) out.push({ id: String(x.id), token, label: x.label || '', main: false, added: x.added || '' });
  }
  return out;
}
const ready = () => numbers().length > 0;
const isPaused = id => !!(health[id] && health[id].pausedUntil > Date.now());
function pauseNumber(id, hours, reason) { health[id] = { ...(health[id] || {}), pausedUntil: Date.now() + hours * 3600e3, reason, fails: 0 }; saveHealth(); }
function resumeNumber(id) { if (health[id]) { health[id].pausedUntil = 0; health[id].fails = 0; saveHealth(); } }
const nameOf = n => n.label || ('number ID …' + String(n.id).slice(-4));

async function api(p, body, token) {
  const r = await fetch('https://graph.facebook.com/v21.0/' + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + (token || config.get().waToken), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = j.error || {}; throw Object.assign(new Error('WhatsApp: ' + (e.error_user_msg || e.message || r.status)), { code: e.code }); }
  return j;
}
// test one number (default: the main one). Returns { msg, label }
async function testNumber(n) {
  n = n || numbers()[0];
  if (!n || !n.id || !n.token) throw new Error('Paste the WhatsApp phone number ID and access token first.');
  if (process.env.AAVORAA_MOCK === '1') return { msg: 'WhatsApp connected (test).', label: '+00 test ' + String(n.id).slice(-4) };
  const j = await api(encodeURIComponent(n.id) + '?fields=display_phone_number,verified_name,quality_rating', null, n.token);
  return { msg: `WhatsApp connected: ${j.verified_name || ''} ${j.display_phone_number || ''} (quality: ${j.quality_rating || 'unknown'}).`, label: j.display_phone_number || '' };
}
async function test() {
  const r = await testNumber();
  if (r.label && !config.get().waLabel) config.set({ waLabel: r.label });
  return r.msg;
}
async function sendTemplate(to, s, name, n) {
  n = n || numbers()[0];
  if (process.env.AAVORAA_MOCK === '1') {
    const fail = (global.__waFail || {})[n.id]; if (fail) throw Object.assign(new Error('WhatsApp: ' + fail.msg), { code: fail.code });
    (global.__waSent = global.__waSent || []).push({ to, name, from: n.id }); return { id: 'wamid.mock' };
  }
  const params = String(s.WHATSAPP_TEMPLATE_PARAMS || 'name').toLowerCase() === 'none' ? [] : [{ type: 'body', parameters: [{ type: 'text', text: String(name || 'there').slice(0, 60) }] }];
  const j = await api(encodeURIComponent(n.id) + '/messages', { messaging_product: 'whatsapp', to, type: 'template', template: { name: s.WHATSAPP_TEMPLATE, language: { code: s.WHATSAPP_TEMPLATE_LANG || 'en' }, ...(params.length ? { components: params } : {}) } }, n.token);
  meter.add('mail', 'whatsapp');
  return { id: (j.messages && j.messages[0] && j.messages[0].id) || '' };
}
// What a WhatsApp error means for the NUMBER: pause it (and switch to the next) or only skip this one lead
function numberProblem(n, e) {
  const c = e.code, m = String(e.message || '');
  if (c === 190) return pauseNumber(n.id, 6, 'access token expired or wrong'), true;
  if (c === 131031 || c === 368) return pauseNumber(n.id, 48, 'number restricted or locked by WhatsApp'), true;
  if (c === 131048 || /spam rate|messaging limit|limit (reached|hit)|tier/i.test(m)) return pauseNumber(n.id, 24, 'WhatsApp sending limit reached'), true;
  if (c === 130429 || c === 80007 || c === 4) return pauseNumber(n.id, 1, 'too many messages too fast'), true;
  if ([131056, 131049, 131047, 131026, 131021, 131051].includes(c)) return false; // about this lead only (pair limit, not on WhatsApp, ...)
  const h = health[n.id] = health[n.id] || {}; h.fails = (h.fails || 0) + 1; saveHealth();
  if (h.fails >= 3) return pauseNumber(n.id, 2, '3 messages failed in a row: ' + m.slice(0, 100)), true;
  return false;
}
// who gets a WhatsApp pitch: by default only leads that showed interest (WhatsApp's rules: people should expect your message)
function targets(rows, s) {
  const mode = String(s.WHATSAPP_PITCH_TO || 'interested').toLowerCase();
  return rows.filter(r => r.Phone && !r['WhatsApp Sent On'] && !['Do Not Contact', 'Not Interested', 'Bounced'].includes(r.Status) && !['Wrong Number', 'Not Interested'].includes(r['Call Status'])
    && (mode === 'all' ? true : mode === 'pitched' ? !!r['Pitched On'] : ['Interested', 'Replied'].includes(r.Status)));
}
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const perNumber = s => Math.max(0, Math.min(Number(s.WHATSAPP_PER_DAY || 50), 1000));
const sentFromToday = (rows, nums, id, day) => rows.filter(r => r['WhatsApp Sent On'] === day && String(r['WhatsApp From'] || (nums[0] && nums[0].id)) === id).length;
// dashboard: every number with today's count, its limit and whether it is paused
function numberStatus(rows, s) {
  const nums = numbers(), day = today(), lim = perNumber(s);
  return nums.map(n => ({ id: n.id, label: nameOf(n), main: n.main, sentToday: sentFromToday(rows, nums, n.id, day), limit: lim, paused: isPaused(n.id), reason: isPaused(n.id) ? health[n.id].reason : '', pausedUntil: isPaused(n.id) ? new Date(health[n.id].pausedUntil).toISOString() : '' }));
}
async function pitchAll(s, log = () => {}, opts = {}) {
  const nums = numbers();
  if (!nums.length) return { sent: 0, skipped: 0, note: 'not set up (Connections → WhatsApp Cloud API). Manual: Call / WhatsApp page.' };
  if (!String(s.WHATSAPP_TEMPLATE || '').trim()) return { sent: 0, skipped: 0, note: 'no approved message template name in Settings → WhatsApp.' };
  const rows = await store.read('Raw Leads', true), day = today(), lim = perNumber(s);
  const cap = {};
  for (const n of nums) cap[n.id] = isPaused(n.id) ? 0 : Math.max(0, lim - sentFromToday(rows, nums, n.id, day));
  const total = Object.values(cap).reduce((a, b) => a + b, 0);
  // opts.ids: exactly these leads (the "To contact" list on the Call / WhatsApp page), in that order
  const pick0 = opts.ids ? opts.ids.map(id => rows.find(r => r['Lead ID'] === id)).filter(r => r && r.Phone && !r['WhatsApp Sent On'] && !['Do Not Contact', 'Not Interested', 'Bounced'].includes(r.Status) && !['Wrong Number', 'Not Interested'].includes(r['Call Status'])) : targets(rows, s);
  const list = pick0.slice(0, total);
  let sent = 0, skipped = 0, stopped = '';
  const pick = () => nums.filter(n => cap[n.id] > 0 && !isPaused(n.id)).sort((a, b) => cap[b.id] - cap[a.id])[0];
  for (const r of list) {
    const to = normalize(r.Phone, r.Country);
    if (!to) { skipped++; if (opts.onSkip) opts.onSkip(r); continue; }
    let done = false;
    while (!done) {
      const n = pick();
      if (!n) { stopped = 'every WhatsApp number is full for today or paused'; break; }
      try {
        await sendTemplate(to, s, r['Contact Name'] || r['Business Name'], n);
        cap[n.id]--; sent++; done = true; if (opts.onSent) opts.onSent(r);
        if (health[n.id] && health[n.id].fails) { health[n.id].fails = 0; saveHealth(); }
        await store.update('Raw Leads', 'Lead ID', [{ key: r['Lead ID'], set: { 'WhatsApp Sent On': day, 'WhatsApp From': n.id, 'Call Status': 'Messaged', 'Called By': 'WhatsApp (auto)', Notes: [r.Notes, `${day}: WhatsApp pitch sent from ${nameOf(n)} (template ${s.WHATSAPP_TEMPLATE})`].filter(Boolean).join(' | ').slice(0, 1500) } }]);
      } catch (e) {
        log(`WhatsApp to ${r['Business Name']} from ${nameOf(n)}: ${e.message}`);
        if (numberProblem(n, e)) { cap[n.id] = 0; log(`WhatsApp ${nameOf(n)} paused (${health[n.id].reason}). Switching to the next number.`); continue; } // same lead, next number
        skipped++; done = true; if (opts.onSkip) opts.onSkip(r);
      }
    }
    if (stopped) break;
    await new Promise(res => setTimeout(res, process.env.AAVORAA_MOCK === '1' ? 10 : 4000 + Math.random() * 5000));
  }
  const note = stopped ? 'stopped: ' + stopped : list.length ? '' : (total ? 'nobody to message (only leads that showed interest, see Settings → WhatsApp)' : 'today\'s WhatsApp limit is reached on every number');
  return { sent, skipped, note, numbers: nums.length };
}
// One click on Call / WhatsApp: pitch every lead in the "To contact" list, in the background
let job = { running: false, total: 0, done: 0, skipped: 0, last: '' };
const canAuto = s => ready() && !!String(s.WHATSAPP_TEMPLATE || '').trim();
function pitchList(ids, s, log = () => {}) {
  if (job.running) return `Already sending: ${job.done} of ${job.total} done.`;
  if (!ready()) throw new Error('Connect the official WhatsApp Cloud API first (Connections page).');
  if (!String(s.WHATSAPP_TEMPLATE || '').trim()) throw new Error('Add the name of your approved WhatsApp message template first (Settings → WhatsApp).');
  if (!ids.length) return 'Nobody to message right now.';
  job = { running: true, total: ids.length, done: 0, skipped: 0, last: '' };
  (async () => {
    try { const r = await pitchAll(s, log, { ids, onSent: () => job.done++, onSkip: () => job.skipped++ }); job.last = `Sent ${r.sent} WhatsApp pitch(es)${r.skipped ? ', ' + r.skipped + ' skipped (no usable number)' : ''}${r.note ? ' - ' + r.note : ''}.`; const left = ids.length - r.sent - r.skipped; if (left > 0) job.last += ` ${left} more wait for tomorrow (daily limit per number; add another WhatsApp number to send more a day).`; }
    catch (e) { job.last = 'Stopped: ' + e.message; }
    job.running = false; log('Pitch all (Call / WhatsApp): ' + job.last);
  })();
  return `Sending the WhatsApp pitch to ${ids.length} lead(s) in the background, one every few seconds, within each number's daily limit. Progress shows on this page.`;
}
module.exports = { canAuto, pitchList, job: () => job, ready, test, testNumber, pitchAll, normalize, targets, numbers, numberStatus, resumeNumber, pauseNumber, perNumber };
