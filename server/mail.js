// Gmail / Google Workspace via App Passwords: SMTP to send, IMAP to read replies and save drafts.
// Several sending inboxes are supported: the main one (Connections) plus "extra inboxes" added later.
const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const config = require('./config');

const MOCK = process.env.AAVORAA_MOCK === '1';
const mockBox = { sent: [], inbox: [], drafts: [] };
const clean = p => String(p || '').replace(/\s+/g, '');

// [{ user, pass, added, main }] - the main Gmail first, then extra inboxes
function accounts() {
  const c = config.get();
  const out = c.gmailUser ? [{ user: String(c.gmailUser).toLowerCase(), pass: c.gmailAppPassword, added: '', main: true }] : [];
  if (!out.length && MOCK) out.push({ user: 'agent@aavoraa.test', pass: 'x', added: '', main: true }); // tests
  for (const x of c.extraInboxes || []) if (x && x.user && !out.some(o => o.user === String(x.user).toLowerCase())) out.push({ user: String(x.user).toLowerCase(), pass: x.pass, added: x.added || '', main: false });
  return out;
}
const account = user => { const all = accounts(); return all.find(a => a.user === String(user || '').toLowerCase()) || all[0]; };

const transporters = {};
function smtp(a) {
  const k = a.user + a.pass;
  if (!transporters[a.user] || transporters[a.user].k !== k) {
    transporters[a.user] = { k, t: nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: a.user, pass: clean(a.pass) }, connectionTimeout: 30000, greetingTimeout: 30000, socketTimeout: 120000 }) };
  }
  return transporters[a.user].t;
}
const imap = a => new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, logger: false, auth: { user: a.user, pass: clean(a.pass) }, connectionTimeout: 30000, greetingTimeout: 30000, socketTimeout: 120000 });

// send({to, subject, text, fromName, inReplyTo, references, from}) -> {messageId, from}
async function send(m) {
  const a = account(m.from);
  const msg = { from: { name: m.fromName || a.user, address: a.user }, to: m.to, subject: m.subject, text: m.text };
  if (m.inReplyTo) { msg.inReplyTo = m.inReplyTo; msg.references = m.references || m.inReplyTo; }
  if (MOCK) { const id = `<mock-${Date.now()}-${Math.random().toString(36).slice(2)}@aavoraa>`; mockBox.sent.push({ ...msg, fromUser: a.user, messageId: id }); return { messageId: id, from: a.user }; }
  const info = await smtp(a).sendMail(msg);
  return { messageId: info.messageId, from: a.user };
}

async function saveDraft(m) {
  const a = account(m.from);
  const msg = { from: { name: m.fromName || a.user, address: a.user }, to: m.to, subject: m.subject, text: m.text };
  if (m.inReplyTo) { msg.inReplyTo = m.inReplyTo; msg.references = m.references || m.inReplyTo; }
  if (MOCK) { mockBox.drafts.push({ ...msg, fromUser: a.user }); return true; }
  const raw = await new MailComposer(msg).compile().build();
  const client = imap(a);
  await client.connect();
  try {
    let box = '[Gmail]/Drafts';
    const list = await client.list();
    const d = list.find(b => b.specialUse === '\\Drafts');
    if (d) box = d.path;
    await client.append(box, raw, ['\\Draft']);
  } finally { await client.logout().catch(() => {}); }
  return true;
}

// New inbox messages of one inbox since `sinceDate`, skipping ones in `seen` (Set of Message-IDs). Does NOT mark them read.
// Each message says which inbox it arrived in (`inbox`), so the answer goes out from the same address.
async function fetchNew(sinceDate, seen, user) {
  const a = account(user);
  if (!a) return [];
  if (MOCK) return mockBox.inbox.filter(m => !seen.has(m.messageId) && String(m.to || accounts()[0].user).toLowerCase() === a.user).map(m => ({ ...m, inbox: a.user }));
  const client = imap(a);
  const out = [];
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const uids = await client.search({ since: sinceDate }, { uid: true });
    const recent = (uids || []).slice(-150);
    if (recent.length) {
      for await (const msg of client.fetch(recent, { source: true, envelope: true }, { uid: true })) {
        const mid = msg.envelope && msg.envelope.messageId;
        if (mid && seen.has(mid)) continue;
        const p = await simpleParser(msg.source);
        out.push({
          messageId: p.messageId || mid, from: ((p.from && p.from.value && p.from.value[0]) || {}).address || '',
          fromName: ((p.from && p.from.value && p.from.value[0]) || {}).name || '',
          subject: p.subject || '', text: p.text || '', inReplyTo: p.inReplyTo || '',
          references: Array.isArray(p.references) ? p.references : (p.references ? [p.references] : []), date: p.date, inbox: a.user,
        });
      }
    }
  } finally { lock.release(); await client.logout().catch(() => {}); }
  return out;
}

// test() checks the main inbox; test({user, pass}) checks an inbox before it is saved
async function test(acct) {
  const a = acct ? { user: String(acct.user).toLowerCase(), pass: acct.pass } : accounts()[0];
  if (!a) throw new Error('Gmail is not connected yet.');
  if (MOCK) return 'ok';
  const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: a.user, pass: clean(a.pass) }, connectionTimeout: 30000 });
  try { await t.verify(); } catch (e) { throw new Error(`${a.user}: could not log in to send (${e.message}). Use an App Password, with 2-Step Verification on.`); }
  const client = imap(a);
  try { await client.connect(); await client.logout(); } catch (e) { throw new Error(`${a.user}: could not log in to read email (${e.message}). Turn on IMAP in Gmail settings.`); }
  return 'ok';
}

module.exports = { send, saveDraft, fetchNew, test, accounts, mockBox };
