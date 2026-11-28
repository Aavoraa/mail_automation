// One button: pitch everyone waiting, on every channel - email, LinkedIn and WhatsApp - all within the safe daily limits.
// Each channel also keeps its own manual options (All email leads, LinkedIn tasks, Call / WhatsApp).
const store = require('./store');
const engine = require('./engine');
const whatsapp = require('./whatsapp');
const validEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim());
let job = { running: false, startedAt: 0, result: null };

async function pitchEverything(by) {
  if (job.running) return { running: true, text: 'Already pitching. Results appear in Agent activity.' };
  const s = await store.settings();
  const out = [];
  if (!/^(yes|on|true|1)$/i.test(String(s.AGENT_ON))) { await store.saveSettings({ AGENT_ON: 'yes' }); out.push('Agent switched ON'); }
  // email: imported leads first, then everyone waiting, then follow-ups due
  const raw = await store.read('Raw Leads', true);
  const waiting = raw.filter(r => ['New', 'Low Fit'].includes(r.Status) && validEmail(r.Email)).length;
  const imported = raw.filter(r => /^Import/i.test(String(r.Source || '')) && ['New', 'Low Fit'].includes(r.Status) && validEmail(r.Email)).length;
  job = { running: true, startedAt: Date.now(), result: null };
  (async () => {
    const res = {};
    try { res.email = await engine.run(imported ? 'importSend' : 'send', { force: true }); } catch (e) { res.email = 'Email: ' + e.message; }
    if (imported) { try { res.email2 = await engine.run('send', { force: true }); } catch (e) {} }
    try { const w = await whatsapp.pitchAll(await store.settings(), m => engine.log('whatsapp', m)); res.whatsapp = w; engine.log('whatsapp', `Pitch everything: ${w.sent} WhatsApp sent, ${w.skipped} skipped${w.note ? ' - ' + w.note : ''}`); } catch (e) { res.whatsapp = { sent: 0, note: e.message }; }
    job = { running: false, startedAt: job.startedAt, result: res };
    engine.log('pitch', 'Pitch everything finished: ' + JSON.stringify({ email: res.email, whatsapp: res.whatsapp && res.whatsapp.sent }));
  })();
  out.push(`✉ Email: pitching ${waiting} waiting lead(s)${imported ? ` (your ${imported} imported leads first)` : ''} + follow-ups due, one by one from your inboxes, up to today's limit`);
  // LinkedIn: connection requests up to today's safe limit + every prepared message (first messages, AI replies)
  if (global.liBot) {
    const c = await global.liBot.connectBatch('all').catch(e => e.message);
    const m = await global.liBot.sendAll(by + ' (pitch everything)').catch(e => e.message);
    out.push('in LinkedIn: ' + String(c).replace(/^✓\s*/, '') + ' ' + String(m));
  } else out.push('in LinkedIn: runs only in the Windows app on the main PC');
  out.push(whatsapp.ready() ? `🟢 WhatsApp: sending your approved template to leads (${String(s.WHATSAPP_PITCH_TO || 'interested') === 'all' ? 'all with a phone number' : 'who showed interest'}), up to ${(Number(s.WHATSAPP_PER_DAY) || 50) * whatsapp.numbers().length} today across ${whatsapp.numbers().length} number${whatsapp.numbers().length > 1 ? 's' : ''} (switches to the next number when one is full)` : '🟢 WhatsApp: not connected yet, so it stays manual (Call / WhatsApp page: one click opens WhatsApp with the message ready). Connect the official WhatsApp Cloud API on the Connections page to send automatically.');
  return { running: true, text: '⚡ Pitching everything now:\n• ' + out.join('\n• ') + '\nProgress shows in Agent activity.' };
}
module.exports = { pitchEverything, status: () => job };
