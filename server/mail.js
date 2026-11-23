// Gmail via App Password: SMTP to send, IMAP to read replies and save drafts.
const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const config = require('./config');

const MOCK = process.env.AAVORAA_MOCK === '1';
const mockBox = { sent: [], inbox: [], drafts: [] };

let transporter = null, tkey = '';
function smtp() {
  const c = config.get();
  const k = c.gmailUser + c.gmailAppPassword;
  if (!transporter || tkey !== k) {
    transporter = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: c.gmailUser, pass: String(c.gmailAppPassword || '').replace(/\s+/g, '') } });
    tkey = k;
  }
  return transporter;
}
function imap() {
  const c = config.get();
  return new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, logger: false, auth: { user: c.gmailUser, pass: String(c.gmailAppPassword || '').replace(/\s+/g, '') } });
}

// send({to, subject, text, fromName, inReplyTo, references}) -> {messageId}
async function send(m) {
  const c = config.get();
  const msg = { from: { name: m.fromName || c.gmailUser, address: c.gmailUser }, to: m.to, subject: m.subject, text: m.text };
  if (m.inReplyTo) { msg.inReplyTo = m.inReplyTo; msg.references = m.references || m.inReplyTo; }
  if (MOCK) { const id = `<mock-${Date.now()}-${Math.random().toString(36).slice(2)}@aavoraa>`; mockBox.sent.push({ ...msg, messageId: id }); return { messageId: id }; }
  const info = await smtp().sendMail(msg);
  return { messageId: info.messageId };
}

async function saveDraft(m) {
  const c = config.get();
  const msg = { from: { name: m.fromName || c.gmailUser, address: c.gmailUser }, to: m.to, subject: m.subject, text: m.text };
  if (m.inReplyTo) { msg.inReplyTo = m.inReplyTo; msg.references = m.references || m.inReplyTo; }
  if (MOCK) { mockBox.drafts.push(msg); return true; }
  const raw = await new MailComposer(msg).compile().build();
  const client = imap();
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

// New inbox messages since `sinceDate`, skipping ones in `seen` (Set of Message-IDs). Does NOT mark them read.
async function fetchNew(sinceDate, seen) {
  if (MOCK) return mockBox.inbox.filter(m => !seen.has(m.messageId));
  const client = imap();
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
          references: Array.isArray(p.references) ? p.references : (p.references ? [p.references] : []), date: p.date,
        });
      }
    }
  } finally { lock.release(); await client.logout().catch(() => {}); }
  return out;
}

async function test() {
  if (MOCK) return 'ok';
  await smtp().verify();
  const client = imap(); await client.connect(); await client.logout();
  return 'ok';
}

module.exports = { send, saveDraft, fetchNew, test, mockBox };
