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
const ready = () => !!(config.get().waToken && config.get().waPhoneId);
async function api(path, body) {
  const c = config.get();
  const r = await fetch('https://graph.facebook.com/v21.0/' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + c.waToken, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = j.error || {}; throw Object.assign(new Error('WhatsApp: ' + (e.error_user_msg || e.message || r.status)), { code: e.code }); }
  return j;
}
async function test() {
  if (!ready()) throw new Error('Paste the WhatsApp phone number ID and access token first.');
  if (process.env.AAVORAA_MOCK === '1') return 'WhatsApp connected (test).';
  const j = await api(encodeURIComponent(config.get().waPhoneId) + '?fields=display_phone_number,verified_name,quality_rating');
  return `WhatsApp connected: ${j.verified_name || ''} ${j.display_phone_number || ''} (quality: ${j.quality_rating || 'unknown'}).`;
}
async function sendTemplate(to, s, name) {
  if (process.env.AAVORAA_MOCK === '1') { (global.__waSent = global.__waSent || []).push({ to, name }); return { id: 'wamid.mock' }; }
  const params = String(s.WHATSAPP_TEMPLATE_PARAMS || 'name').toLowerCase() === 'none' ? [] : [{ type: 'body', parameters: [{ type: 'text', text: String(name || 'there').slice(0, 60) }] }];
  const j = await api(encodeURIComponent(config.get().waPhoneId) + '/messages', { messaging_product: 'whatsapp', to, type: 'template', template: { name: s.WHATSAPP_TEMPLATE, language: { code: s.WHATSAPP_TEMPLATE_LANG || 'en' }, ...(params.length ? { components: params } : {}) } });
  meter.add('mail', 'whatsapp');
  return { id: (j.messages && j.messages[0] && j.messages[0].id) || '' };
}
// who gets a WhatsApp pitch: by default only leads that showed interest (WhatsApp's rules: people should expect your message)
function targets(rows, s) {
  const mode = String(s.WHATSAPP_PITCH_TO || 'interested').toLowerCase();
  return rows.filter(r => r.Phone && !r['WhatsApp Sent On'] && !['Do Not Contact', 'Not Interested', 'Bounced'].includes(r.Status) && !['Wrong Number', 'Not Interested'].includes(r['Call Status'])
    && (mode === 'all' ? true : mode === 'pitched' ? !!r['Pitched On'] : ['Interested', 'Replied'].includes(r.Status)));
}
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
async function pitchAll(s, log = () => {}) {
  if (!ready()) return { sent: 0, skipped: 0, note: 'not set up (Connections → WhatsApp Cloud API). Manual: Call / WhatsApp page.' };
  if (!String(s.WHATSAPP_TEMPLATE || '').trim()) return { sent: 0, skipped: 0, note: 'no approved message template name in Settings → WhatsApp.' };
  const rows = await store.read('Raw Leads', true), day = today();
  const doneToday = rows.filter(r => r['WhatsApp Sent On'] === day).length, cap = Math.max(0, Math.min(Number(s.WHATSAPP_PER_DAY || 50), 250) - doneToday);
  const list = targets(rows, s).slice(0, cap);
  let sent = 0, skipped = 0;
  for (const r of list) {
    const to = normalize(r.Phone, r.Country);
    if (!to) { skipped++; continue; }
    try {
      await sendTemplate(to, s, r['Contact Name'] || r['Business Name']);
      sent++;
      await store.update('Raw Leads', 'Lead ID', [{ key: r['Lead ID'], set: { 'WhatsApp Sent On': day, 'Call Status': 'Messaged', 'Called By': 'WhatsApp (auto)', Notes: [r.Notes, `${day}: WhatsApp pitch sent (template ${s.WHATSAPP_TEMPLATE})`].filter(Boolean).join(' | ').slice(0, 1500) } }]);
    } catch (e) {
      log(`WhatsApp to ${r['Business Name']}: ${e.message}`);
      if ([190, 131031, 131048, 131056, 368].includes(e.code)) return { sent, skipped, note: 'stopped: ' + e.message };
      skipped++;
    }
    await new Promise(res => setTimeout(res, process.env.AAVORAA_MOCK === '1' ? 10 : 4000 + Math.random() * 5000));
  }
  return { sent, skipped, note: list.length ? '' : (cap ? 'nobody to message (only leads that showed interest, see Settings → WhatsApp)' : 'today\'s WhatsApp limit is reached') };
}
module.exports = { ready, test, pitchAll, normalize, targets };
