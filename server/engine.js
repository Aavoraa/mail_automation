// The agent: scheduled jobs that find, pitch, follow up, read replies and qualify.
const store = require('./store');
const config = require('./config');
const mail = require('./mail');
const web = require('./web');
const ai = require('./ai');
const { gemini, P, clean, fill, leadVars, aiUnavailable } = ai;

// ---------------------------------------------------------------- helpers
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const istHour = () => new Date(Date.now() + 5.5 * 3600e3).getUTCHours();
const istMinutes = () => { const d = new Date(Date.now() + 5.5 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const toISO = v => { const s = String(v || '').trim(); let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
const days = (a, b) => { const x = new Date(toISO(a)), y = new Date(toISO(b)); return (isNaN(x) || isNaN(y)) ? 0 : Math.floor((y - x) / 86400000); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const newId = p => p + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
const list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const pick = a => a[Math.floor(Math.random() * a.length)];
const yes = v => ['yes', 'on', 'true', '1'].includes(String(v || '').toLowerCase());
const validEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim());
const signature = s => ['Warm regards,', s.SENDER_NAME, [s.SENDER_TITLE, s.COMPANY].filter(Boolean).join(' | '), [s.WEBSITE, s.COMPANY_ADDRESS].filter(Boolean).join(' | ')].filter(Boolean).join('\n');
const senderName = s => `${s.SENDER_NAME} | ${s.COMPANY}`;

function dailyLimit(s) {
  const start = toISO(s.START_DATE) || today();
  const weeks = Math.max(0, Math.floor(days(start, today()) / 7));
  return { started: days(start, today()) >= 0, limit: Math.min(Number(s.DAILY_MAX_LIMIT || 50), Number(s.DAILY_START_LIMIT || 20) + weeks * Number(s.WEEKLY_INCREASE || 10)) };
}
function sentOn(rows, d) { return rows.filter(r => [r['Pitched On'], r['Follow-up 1 On'], r['Follow-up 2 On']].map(String).includes(d)).length; }

// ---------------------------------------------------------------- state + log
const state = Object.assign({ lastRun: {}, lastResult: {}, seen: [], reportDay: '', tries: {}, firstSeen: {} }, config.loadState());
state.tries = state.tries || {}; state.firstSeen = state.firstSeen || {}; state.rechecked = state.rechecked || {};
const running = {};
const logs = [];
function log(job, msg, level = 'info') {
  logs.unshift({ at: new Date().toISOString(), job, msg, level });
  if (logs.length > 400) logs.pop();
  if (level === 'error') console.error(`[${job}] ${msg}`); else console.log(`[${job}] ${msg}`);
}
const persist = () => { state.seen = state.seen.slice(-3000); config.saveState(state); };

async function templates(stage) {
  const all = await store.read('Templates');
  return all.filter(t => t.Stage === stage && yes(t.Active) && String(t.Body || '').trim());
}

// ---------------------------------------------------------------- 01 find leads
const apifyEmails = p => [...(p.emails || []), ...((p.contactDetails && p.contactDetails.emails) || []), p.email].filter(Boolean).map(e => String(e).toLowerCase().trim());
// Best email for a business: what Apify found, then the site itself (home, contact, about pages, hidden addresses), then info@domain
async function discoverEmail(s, website, domain, fromApify = []) {
  const site = await web.findEmails(website);
  const pool = [...new Set([...fromApify.filter(e => web.emailsFrom(e).length), ...site.emails])];
  if (pool.length) return { email: web.bestEmail(pool, domain), how: fromApify.length ? 'found by Apify' : 'website', html: site.html, contactHtml: site.contactHtml };
  if (yes(s.GUESS_EMAILS ?? 'yes')) { const g = await web.guessEmail(domain); if (g) return { email: g, how: 'guessed (info@ of their domain, which accepts email)', html: site.html, contactHtml: site.contactHtml }; }
  return { email: '', how: '', html: site.html, contactHtml: site.contactHtml };
}

async function findLeads(s, opts = {}) {
  const industries = list(s.INDUSTRIES), cities = list(s.CITIES);
  if (!industries.length || !cities.length) throw new Error('Add industries and cities in Settings.');
  const industry = opts.industry || pick(industries), city = opts.city || pick(cities);
  const max = Number(opts.max || s.LEADS_PER_SEARCH || 10);
  log('find', `Searching Google Maps: "${industry}" in ${city}`);
  const places = await web.mapsSearch(industry, city, max, yes(s.APIFY_CONTACTS ?? 'yes'));
  const existing = await store.read('Raw Leads');
  const seen = new Set();
  for (const r of existing) { const d = web.domainOf(r.Website); if (d) seen.add(d); if (r['Business Name']) seen.add('n:' + String(r['Business Name']).toLowerCase().trim()); }
  const skip = ['facebook.com', 'instagram.com', 'linkedin.com', 'wa.me', 'whatsapp.com', 'google.com', 'youtube.com', 'twitter.com', 'x.com', 'linktr.ee', 'business.site', 'tiktok.com'];
  const rows = [];
  for (const p of places) {
    if (!p || !p.title || !p.website) continue;
    const d = web.domainOf(p.website);
    if (!d || skip.some(x => d === x || d.endsWith('.' + x))) continue;
    const nk = 'n:' + String(p.title).toLowerCase().trim();
    if (seen.has(d) || seen.has(nk)) continue;
    seen.add(d); seen.add(nk);
    const website = String(p.website).startsWith('http') ? p.website : 'https://' + p.website;
    // emails Apify found on the site (contact enrichment) + our own search of the site + info@ fallback
    const found = await discoverEmail(s, website, d, apifyEmails(p));
    const html = found.html, contact = found.contactHtml;
    const emails = found.email ? [found.email] : [];
    const L = { name: p.title, category: p.categoryName || industry, city: p.city || city, country: p.countryCode || '', website, rating: p.totalScore ?? '', reviews: p.reviewsCount ?? '', checks: web.checkSite(website, html), siteText: web.strip(html).slice(0, 2500) };
    let a = null;
    // lead analysis is "nice to have": it only uses the AI when enough is left for emails and customer replies
    if (ai.canUse('low')) { try { a = await gemini(P.analyse(s, L), s.GEMINI_MODEL, { priority: 'low' }); } catch (e) { log('find', 'AI analysis skipped: ' + e.message, 'warn'); } }
    a = a || {};
    if (a.is_real_business === false) continue;
    const email = web.bestEmail(emails, d);
    const fit = Number(a.fit_score || 0);
    rows.push({
      'Lead ID': newId('L'), 'Date Found': today(), Source: 'Google Maps', 'Business Name': p.title, Industry: L.category, City: L.city, Country: L.country,
      Website: website, Email: email, Phone: p.phone || p.phoneUnformatted || '', 'Contact Name': a.contact_name || '', LinkedIn: web.linkedinIn(html + contact) || (p.linkedIns || [])[0] || '',
      'Google Rating': L.rating, Reviews: L.reviews, 'Website Issues': a.website_issues || '', 'Best Service': a.best_service || '', 'Pitch Angle': a.pitch_angle || '',
      // every lead with an email is emailed; the fit score only decides the order (best first)
      'Fit Score': fit || '', Status: email ? 'New' : 'No Email',
      Notes: [a.language ? 'Site language: ' + a.language : '', found.how && found.how !== 'website' ? `Email ${found.how}` : ''].filter(Boolean).join(' | '),
    });
  }
  await store.append('Raw Leads', rows);
  const msg = `Added ${rows.length} new leads (${rows.filter(r => r.Status === 'New').length} ready to email, ${rows.filter(r => r.Status === 'No Email').length} without any email) from "${industry}" in ${city}`;
  log('find', msg); return msg;
}

// ---------------------------------------------------------------- 02 pitch + follow-ups
// Plain emails used when the AI is not available and the lead's template still has empty {{placeholders}}.
const PLAIN = [
  { Subject: 'quick idea for {{business}}', Body: 'Hi {{first_name}},\n\nI\'m {{sender}} from {{company}} ({{website}}). We help businesses like {{business}} get more enquiries through a sharper website, better Google and AI search visibility, and simple marketing that brings in customers.\n\nWould a free 10-minute review of your online presence be useful? Happy to send it over.\n\nIf this isn\'t relevant, just reply \'no\' and I won\'t email again.' },
  { Subject: '', Body: 'Hi {{first_name}}, just following up on my note. A quick review usually finds two or three easy wins on a website and Google listing that bring in more enquiries.\n\nWould it help if I sent a few ideas for {{business}}?' },
  { Subject: '', Body: 'Hi {{first_name}}, I don\'t want to fill your inbox, so this is my last note. If growing {{business}} online becomes a priority later, I\'m just a reply away. Wishing you a great season.' },
];
// "Marley Fans Bangalore | Industrial HVLS Fan Manufacturer" -> "Marley Fans Bangalore" (Google Maps names are often long)
const shortName = n => String(n || '').split(/\s+[|:–-]\s+/)[0].trim() || String(n || '').trim();
function fromTemplate(tpl, vars, stage) {
  vars = { ...vars, business: shortName(vars.business) };
  const subject = fill(tpl.Subject || (stage === 0 ? 'quick idea for {{business}}' : ''), vars);
  const body = fill(tpl.Body, vars).replace(/\{\{\s*\w+\s*\}\}/g, '').replace(/[ \t]+\n/g, '\n');
  return { subject, body, tpl };
}
const unfilled = (tpl, vars) => /\{\{\s*\w+\s*\}\}/.test(fill(String(tpl.Subject || '') + String(tpl.Body || ''), vars));

async function writeEmail(s, lead, stage) {
  const stageName = ['First email', 'Follow-up 1', 'Follow-up 2'][stage];
  const tpls = await templates(stageName);
  const tpl = tpls.length ? pick(tpls) : null;
  const vars = leadVars(lead, s);
  if (tpl && !yes(tpl['AI Personalise'])) return fromTemplate(tpl, vars, stage);
  try {
    const a = await gemini(P.email(s, lead, stage, tpl ? { ...tpl, Body: fill(tpl.Body, vars), Subject: fill(tpl.Subject, vars) } : null), s.GEMINI_MODEL, { priority: 'send' });
    if (a && a.body) return { subject: clean(a.subject), body: clean(a.body), tpl };
    if (!a) throw new ai.AIUnavailable('AI answered but not as expected', 'bad_answer');
  } catch (e) {
    if (!aiUnavailable(e) || String(s.AI_FALLBACK || 'template').toLowerCase() === 'wait') throw e;
    // AI is out for now: send the template as written (or a plain, safe email) so pitching never stops
    const plain = { ...PLAIN[stage], Name: 'Plain (AI unavailable)' };
    const use = tpl && !unfilled(tpl, vars) ? tpl : plain;
    return { ...fromTemplate(use, vars, stage), tpl: use, noAI: true };
  }
  return null;
}

async function sendEmails(s, opts = {}) {
  const [h1, h2] = String(s.SEND_HOURS || '8-20').split('-').map(Number);
  if (!opts.force && !isNaN(h1) && !isNaN(h2) && !(istHour() >= h1 && istHour() < h2)) return 'Outside sending hours, waiting';
  const { started, limit } = dailyLimit(s);
  if (!started) return `Sending starts on ${s.START_DATE}`;
  const rows = await store.read('Raw Leads', true);
  const slots = Math.min(opts.max || Math.ceil(limit / 6), limit - sentOn(rows, today()));
  if (slots <= 0) return `Today's limit reached (${limit})`;
  const f1 = Number(s.FOLLOWUP_1_DAYS || 3), f2 = Number(s.FOLLOWUP_2_DAYS || 7);
  const due = [];
  for (const r of rows) {
    if (!validEmail(r.Email) || !r['Message ID'] || !r['Pitched On']) continue;
    const age = days(r['Pitched On'], today());
    if (r.Status === 'Pitched' && age >= f1) due.push({ lead: r, stage: 1 });
    else if (r.Status === 'Follow-up 1' && age >= f2) due.push({ lead: r, stage: 2 });
  }
  // leads that "failed" only because the AI was out of requests or offline (older versions) are tried again
  const retry = r => r.Status === 'Send Failed' && !r['Pitched On'] && /Gemini|ChatGPT|fetch failed|AI /i.test(String(r.Notes || '').split(' | ').pop());
  const waiting = r => r.Status === 'New' || r.Status === 'Low Fit' || retry(r); // low-fit leads are emailed too, just after the best ones
  const contacted = new Set(rows.filter(r => r.Status && !waiting(r)).map(r => String(r.Email || '').toLowerCase().trim()));
  const fresh = [];
  for (const r of rows.filter(r => waiting(r) && validEmail(r.Email)).sort((a, b) => Number(b['Fit Score'] || 0) - Number(a['Fit Score'] || 0))) {
    const e = String(r.Email).toLowerCase().trim(); if (contacted.has(e)) continue; contacted.add(e); fresh.push({ lead: r, stage: 0 });
  }
  const jobs = [...due, ...fresh].slice(0, slots);
  let sent = 0;
  if (jobs.length) log('send', `Emailing ${jobs.length} lead(s) now (${due.length} follow-ups due, ${fresh.length} new waiting, ${slots} allowed this hour)`);
  for (const [i, { lead, stage }] of jobs.entries()) {
    if (!yes((await store.settings()).AGENT_ON)) { log('send', 'Agent switched off, stopping'); break; }
    log('send', `${i + 1}/${jobs.length}: writing ${['first email', 'follow-up 1', 'follow-up 2'][stage]} for ${lead['Business Name']}`);
    let e;
    try { e = await writeEmail(s, lead, stage); } catch (err) {
      if (aiUnavailable(err)) { log('send', `Waiting for the AI before emailing more leads: ${err.message}`, 'warn'); break; } // lead stays as it is and is tried next hour
      log('send', `Could not write an email for ${lead['Business Name']}: ${err.message}, will retry later`, 'warn'); continue;
    }
    if (!e) { log('send', `AI could not write an email for ${lead['Business Name']}, will retry later`, 'warn'); continue; }
    if (e.noAI) log('send', `AI not available, using the "${e.tpl.Name || 'template'}" email for ${lead['Business Name']}`, 'warn');
    try {
      const text = e.body + '\n\n' + signature(s);
      const to = String(lead.Email).trim();
      if (stage === 0) {
        const r = await mail.send({ to, subject: e.subject || ('quick idea for ' + lead['Business Name']), text, fromName: senderName(s) });
        await store.update('Raw Leads', 'Lead ID', [{ key: lead['Lead ID'], set: { Status: 'Pitched', 'Pitched On': today(), 'Email Subject': e.subject, 'Message ID': r.messageId, 'Thread ID': r.messageId, 'Template Used': e.tpl ? e.tpl.Name : 'AI' } }]);
      } else {
        const subj = 'Re: ' + String(lead['Email Subject'] || '').replace(/^re:\s*/i, '');
        await mail.send({ to, subject: subj, text, fromName: senderName(s), inReplyTo: lead['Message ID'], references: lead['Message ID'] });
        const col = stage === 1 ? 'Follow-up 1 On' : 'Follow-up 2 On';
        await store.update('Raw Leads', 'Lead ID', [{ key: lead['Lead ID'], set: { Status: stage === 1 ? 'Follow-up 1' : 'Follow-up 2', [col]: today() } }]);
      }
      sent++;
      log('send', `${['Pitched', 'Follow-up 1 to', 'Follow-up 2 to'][stage]} ${lead['Business Name']} (${to})`);
    } catch (err) {
      log('send', `Could not email ${lead['Business Name']}: ${err.message}`, 'error');
      await store.update('Raw Leads', 'Lead ID', [{ key: lead['Lead ID'], set: { Status: 'Send Failed', Notes: [lead.Notes, `${today()}: ${err.message}`.slice(0, 200)].filter(Boolean).join(' | ') } }]).catch(() => {});
    }
    if (i < jobs.length - 1) await sleep(opts.fast ? 50 : 45000 + Math.random() * 60000);
  }
  return `Sent ${sent} emails (limit today ${limit})`;
}

// ---------------------------------------------------------------- 03 replies
// Reply without AI: only safe, factual sentences. Never a pitch to someone who said stop, never an answer to an auto-reply.
function safeReply(s, lead, m, text) {
  const t = (String(m.subject || '') + '\n' + text).toLowerCase();
  const name = ai.firstName(lead['Contact Name'] || m.fromName || '');
  const base = { lead_score: 'Warm', safe: true, next_step: 'Answer them personally from Gmail' };
  if (/unsubscribe|remove (me|us)|take (me|us) off|stop (emailing|sending|contacting)|do ?n[o']t (contact|email|send)|^\s*(no|stop)\.?\s*$/.test(text.toLowerCase()) || /unsubscribe/.test(t))
    return { ...base, category: 'unsubscribe', reply: '', summary: 'Asked us to stop emailing' };
  if (/out of (the )?office|automatic reply|auto[- ]?reply|autoreply|on (annual |maternity |paternity )?leave|away (from|until)|vacation|limited access to (my )?e-?mail/.test(t))
    return { ...base, category: 'out_of_office', reply: '', summary: 'Automatic out-of-office reply' };
  if (/not interested|no,? thanks|no thank you|not (a )?(right )?fit|we('| a)re (all )?(set|good)|already (have|work with)|not (looking|needed)|no need/.test(t))
    return { ...base, category: 'not_interested', summary: 'Not interested', reply: `Hi ${name}, thank you for letting me know. I won't email again. Wishing you and ${shortName(lead['Business Name'])} all the best.` };
  const interested = /interest|yes|sure|call|meet|meeting|price|pricing|quote|cost|budget|details|more info|tell me more|send (me|over)|proposal|audit|demo|available|when can/.test(t);
  const booking = s.BOOKING_LINK ? `\n\nIf it's easier, you can pick a time for a short call here: ${s.BOOKING_LINK}` : '';
  return { ...base, category: interested ? 'interested' : 'question', summary: 'Replied while the AI was unavailable, holding reply sent, please answer personally',
    reply: `Hi ${name}, thank you for getting back to me. ${s.TEAM_LEADER_NAME ? s.TEAM_LEADER_NAME + ' from our team' : 'Someone from our team'} will reply to you personally with the details very shortly.${booking}` };
}

async function checkReplies(s) {
  const since = new Date(Date.now() - 3 * 86400000);
  const seen = new Set(state.seen);
  const msgs = await mail.fetchNew(since, seen);
  if (!msgs.length) return 'No new emails';
  const rows = await store.read('Raw Leads', true);
  const byEmail = {}, byMsg = {}, byDomain = {};
  const free = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|aol|proton|protonmail|zoho|gmx|mail|yandex|rediffmail)\./;
  const domainOf = e => String(e || '').toLowerCase().trim().split('@')[1] || '';
  for (const r of rows) {
    if (r.Email) { byEmail[String(r.Email).toLowerCase().trim()] = r; const d = domainOf(r.Email); if (d && !free.test(d) && r['Pitched On']) byDomain[d] = r; }
    if (r['Message ID']) byMsg[r['Message ID']] = r;
  }
  const me = String(config.get().gmailUser || '').toLowerCase();
  const done = m => { state.seen.push(m.messageId); persist(); };
  let handled = 0, waiting = 0;
  for (const m of msgs) {
    const from = String(m.from || '').toLowerCase();
    if (!from || from === me) { done(m); continue; }
    if (/mailer-daemon|postmaster/.test(from)) {
      const low = String(m.text).toLowerCase();
      const lead = rows.find(r => r.Email && low.includes(String(r.Email).toLowerCase().trim()));
      if (lead) { await store.update('Raw Leads', 'Lead ID', [{ key: lead['Lead ID'], set: { Status: 'Bounced', 'Last Reply On': today(), 'Reply Category': 'bounce' } }]); log('replies', `Bounced: ${lead.Email}`); }
      done(m); continue;
    }
    // match by email thread first, then by their address, then by a colleague at the same company domain
    const lead = [m.inReplyTo, ...(m.references || [])].map(x => byMsg[x]).find(Boolean) || byEmail[from] || (!free.test(domainOf(from)) && byDomain[domainOf(from)]);
    if (!lead || lead.Status === 'Do Not Contact') { done(m); continue; }
    const text = String(m.text || '').split(/\n\s*On [^\n]{5,200}wrote:|\n-{2,}\s*Original Message|\nFrom: [^\n]*\n(?:Sent|Date): /i)[0].split('\n').filter(l => !l.trim().startsWith('>')).join('\n').trim().slice(0, 3000);
    const tpls = await templates('Reply to interested lead');
    const ask = () => gemini(P.reply(s, { lead, subject: m.subject, text }, tpls.length ? pick(tpls) : null), s.GEMINI_MODEL, { priority: 'reply' });
    let a;
    try { a = (await ask()) || (await ask()); } catch (e) {
      if (aiUnavailable(e)) {
        // wait for the AI first (best answer); if it is still out after REPLY_FALLBACK_MINUTES, send a safe reply without it
        if (!state.firstSeen[m.messageId]) { state.firstSeen[m.messageId] = Date.now(); persist(); }
        const got = Math.min(state.firstSeen[m.messageId], new Date(m.date || Date.now()).getTime() || Date.now());
        const waited = (Date.now() - got) / 60000, limit = Number(s.REPLY_FALLBACK_MINUTES ?? 60);
        if (!(limit >= 0) || waited < limit) {
          // NOT marked as read: answered on a later check
          waiting++; log('replies', `Reply from ${lead['Business Name']} (${from}) is waiting for the AI${limit >= 0 ? ` (a short reply goes out after ${limit} min if the AI is still out)` : ''}: ${e.message}`, 'warn');
          continue;
        }
        log('replies', `AI still unavailable after ${Math.round(waited)} min, answering ${from} without it`, 'warn');
        a = safeReply(s, lead, m, text);
      } else { log('replies', 'AI error: ' + e.message, 'warn'); a = null; }
    }
    a = a || { category: 'other', reply: '', summary: 'AI could not read this reply - please check it in Gmail.' };
    const reply = clean(a.reply);
    const needsReply = !!reply && !['unsubscribe', 'out_of_office'].includes(a.category);
    const draft = String(s.REPLY_MODE || 'send').toLowerCase() === 'draft';
    let replied = false;
    if (needsReply) {
      const msg = { to: from, subject: 'Re: ' + String(m.subject || '').replace(/^re:\s*/i, ''), text: reply + '\n\n' + signature(s), fromName: senderName(s), inReplyTo: m.messageId, references: [...(m.references || []), m.messageId].join(' ') };
      try { if (draft) await mail.saveDraft(msg); else await mail.send(msg); replied = true; } catch (e) {
        const tries = state.tries[m.messageId] = (state.tries[m.messageId] || 0) + 1; persist();
        if (tries < 4) { log('replies', `Could not send the reply to ${from}: ${e.message}, will try again`, 'error'); waiting++; continue; } // retried on the next check
        log('replies', `Gave up replying to ${from} after ${tries} tries: ${e.message}. Please answer them from Gmail.`, 'error');
        a.summary = (a.summary || '') + ' (reply could not be sent, please answer from Gmail)';
      }
    }
    done(m); handled++; delete state.tries[m.messageId]; delete state.firstSeen[m.messageId];
    const map = { interested: 'Interested', question: 'Replied', referral: 'Replied', other: 'Replied', not_interested: 'Not Interested', unsubscribe: 'Do Not Contact' };
    const set = { 'Last Reply On': today(), 'Reply Category': a.category, Notes: [lead.Notes, `${today()}: ${a.summary || a.category} (${replied ? (draft ? 'reply saved as draft' : 'agent replied') : 'no reply sent'})`].filter(Boolean).join(' | ').slice(0, 1500) };
    if (map[a.category]) set.Status = map[a.category];
    await store.update('Raw Leads', 'Lead ID', [{ key: lead['Lead ID'], set }]);
    log('replies', `${lead['Business Name']}: ${a.category}${replied ? (draft ? ', draft saved' : ', replied') : ''}`);
    if (a.category === 'interested') {
      const alert = yes(s.ALERT_TEAM_FOR_EMAIL_LEADS) && s.TEAM_LEADER_EMAIL;
      const q = { 'Lead ID': lead['Lead ID'], 'Date Qualified': today(), Source: lead.Source || 'Email', 'Business Name': lead['Business Name'], 'Contact Name': lead['Contact Name'], Email: lead.Email, LinkedIn: lead.LinkedIn, Phone: lead.Phone, Website: lead.Website, Country: lead.Country, 'Service Needed': a.service_needed || lead['Best Service'], Budget: a.budget || '', Timeline: a.timeline || '', 'Lead Score': a.lead_score || 'Warm', 'Their Message': text.slice(0, 1500), Summary: a.summary || '', 'Next Step': a.next_step || '', Owner: s.TEAM_LEADER_NAME || '', 'Team Alerted': alert ? today() : '' };
      await upsertQualified(q);
      if (alert) await alertTeam(s, `Hot lead (email): ${q['Business Name']} - ${q['Service Needed']}`,
        `A lead replied to our email and is interested.\n\nBusiness: ${q['Business Name']}\nContact: ${q['Contact Name'] || '-'} | ${q.Email} | ${q.Phone || '-'}\nWebsite: ${q.Website}\nLinkedIn: ${q.LinkedIn || '-'}\nCountry: ${q.Country}\nService needed: ${q['Service Needed']}\nLead score: ${q['Lead Score']}\nBudget: ${q.Budget || '-'} | Timeline: ${q.Timeline || '-'}\n\nWhat they said:\n${q['Their Message']}\n\nSummary: ${q.Summary}\nSuggested next step: ${q['Next Step']}`);
    } else if (a.safe && replied && a.category === 'question' && s.TEAM_LEADER_EMAIL) {
      // the AI could not answer properly: a person must follow up
      await alertTeam(s, `Lead replied, please answer: ${lead['Business Name']}`,
        `${lead['Business Name']} (${from}) replied while the AI was unavailable. The agent sent a short holding reply saying our team will get back to them.\n\nWhat they said:\n${text.slice(0, 1500)}\n\nPlease answer them personally from Gmail (aavoraa.marketing@gmail.com).`);
    }
  }
  return `Checked ${msgs.length} new emails, ${handled} from leads answered` + (waiting ? `, ${waiting} waiting to be answered` : '');
}
async function upsertQualified(q) {
  const rows = await store.read('Qualified Leads', true);
  if (rows.find(r => r['Lead ID'] === q['Lead ID'])) { const { 'Lead ID': id, ...set } = q; await store.update('Qualified Leads', 'Lead ID', [{ key: id, set }]); }
  else await store.append('Qualified Leads', [q]);
}
async function alertTeam(s, subject, body) {
  try {
    await mail.send({ to: s.TEAM_LEADER_EMAIL, subject, text: `Hi ${s.TEAM_LEADER_NAME || 'team'},\n\n${body}\n\nSaved in Qualified Leads.\n- ${s.COMPANY} Lead Agent`, fromName: `${s.COMPANY} Lead Agent` });
    log('alerts', 'Team leader alerted: ' + subject);
  } catch (e) { log('alerts', 'Could not alert team leader: ' + e.message, 'error'); }
}

// ---------------------------------------------------------------- 04 LinkedIn prospects
// "Simon Lockyer - and CEO @ The British School of Milan | LinkedIn" -> name, title, company
function parseLinkedIn(title, snippet) {
  const parts = String(title || '').replace(/\s*[|\-–]\s*LinkedIn.*$/i, '').split(/\s+[-–|]\s+/).map(x => x.trim());
  const name = parts[0] || '', role = parts[1] || '';
  let company = ((role.match(/(?:@|\bat)\s+(.+)$/i) || [])[1] || '').trim() || parts[2] || '';
  if (!company) company = ((String(snippet || '').match(/Experience:\s*([^·|•\n]+)/i) || [])[1] || '').trim();
  return { name, title: role.replace(/^and\s+/i, ''), company: company.replace(/\s*[|·•].*$/, '').replace(/\.\.\.$/, '').trim() };
}
// Messages written without AI, so every prospect always has something ready to send
function linkedinPlain(s, p) {
  const first = ai.firstName(p.name);
  return {
    connection_note: `Hi ${first}, I help businesses${p.location ? ' in ' + p.location : ''} grow with sharper websites, search visibility and marketing. Would be glad to connect.`.slice(0, 250),
    first_message: `Thanks for connecting, ${first}. I'm ${s.SENDER_NAME} from ${s.COMPANY} (${s.WEBSITE}). We help ${p.company ? 'companies like ' + p.company : 'businesses like yours'} get more enquiries through a sharper website, better Google and AI search visibility, and simple marketing.\n\nWould a free 10-minute review of your online presence be useful?`,
  };
}

async function linkedinProspects(s, opts = {}) {
  const industry = opts.industry || pick(list(s.INDUSTRIES)), city = opts.city || pick(list(s.CITIES));
  const query = `site:linkedin.com/in ("founder" OR "co-founder" OR "CEO" OR "owner" OR "managing director") "${industry}" "${city}"`;
  log('linkedin', `Searching LinkedIn via Google: ${industry} in ${city}`);
  const pages = await web.googleSearch(query);
  const keyOf = u => (String(u || '').toLowerCase().split('/in/')[1] || '').split(/[/?#]/)[0];
  const existing = new Set((await store.read('LinkedIn Leads')).map(r => keyOf(r['LinkedIn URL'])).filter(Boolean));
  const max = Number(s.LINKEDIN_PER_RUN || 10);
  const people = [];
  for (const page of pages) for (const r of (page.organicResults || [])) {
    const url = String(r.url || '').split('?')[0]; const k = keyOf(url);
    if (!/linkedin\.com\/in\//i.test(url) || !k || existing.has(k) || people.length >= max) continue;
    existing.add(k);
    people.push({ ...parseLinkedIn(r.title, r.description), url, snippet: r.description || '', industry, location: city });
  }
  const rows = [];
  for (const p of people) {
    const a = await linkedinMessages(s, p);
    rows.push({ 'Lead ID': newId('LI'), 'Date Found': today(), Name: p.name, Title: p.title, Company: p.company, Industry: industry, Location: city, 'LinkedIn URL': p.url, 'Fit Score': a.fit_score || '', 'Best Service': a.best_service || '', 'Connection Note': clean(a.connection_note).slice(0, 280), 'First Message': clean(a.first_message), Status: 'To Connect', Notes: a.plain ? 'Messages written without AI' : '' });
  }
  await store.append('LinkedIn Leads', rows);
  // also reach them by email: find their company's website and email address, and queue it for pitching
  const emailed = rows.length ? await emailLinkedInCompanies(s, rows) : 0;
  const msg = `Added ${rows.length} LinkedIn prospects (${industry}, ${city}), ${emailed} of their companies queued for email`;
  log('linkedin', msg); return msg;
}
// AI-written connection note + first message, or plain ones when the AI is out (never empty)
async function linkedinMessages(s, p) {
  if (ai.canUse('low')) {
    try {
      const nt = await templates('LinkedIn connection note'), mt = await templates('LinkedIn first message');
      const a = await gemini(P.linkedin(s, p, nt.length ? pick(nt) : null, mt.length ? pick(mt) : null), s.GEMINI_MODEL, { priority: 'low' });
      if (a && a.connection_note && a.first_message) return a;
    } catch (e) { if (!aiUnavailable(e)) log('linkedin', 'AI error: ' + e.message, 'warn'); }
  }
  return { ...linkedinPlain(s, p), plain: true };
}
const NOT_COMPANY_SITE = /(^|\.)(linkedin|facebook|instagram|twitter|x|youtube|wikipedia|crunchbase|glassdoor|indeed|zoominfo|bloomberg|yelp|tripadvisor|justdial|indiamart|google|apollo|rocketreach|signalhire|pitchbook|dnb|owler|ambitionbox|naukri|tracxn|medium|github|reddit|quora|amazon)\.[a-z.]+$/;
// For LinkedIn prospects: Google their company, take its own website, find an email, add it to Raw Leads so it is pitched like any other lead
async function emailLinkedInCompanies(s, rows) {
  const todo = rows.filter(r => r.Company && r.Company.length > 1).slice(0, 10);
  if (!todo.length) return 0;
  const raw = await store.read('Raw Leads', true);
  const known = new Map(); for (const r of raw) { const d = web.domainOf(r.Website); if (d) known.set(d, r); }
  const q = r => `"${r.Company}" ${r.Location || ''}`.trim();
  let pages = [];
  try { pages = await web.googleSearch(todo.map(q).join('\n')); } catch (e) { log('linkedin', 'Company search failed: ' + e.message, 'warn'); return 0; }
  const byQuery = {}; for (const pg of pages) { const t = (pg.searchQuery && pg.searchQuery.term) || ''; byQuery[t] = (byQuery[t] || []).concat(pg.organicResults || []); }
  const add = [], notes = [];
  for (const r of todo) {
    const site = (byQuery[q(r)] || []).map(x => x.url).find(u => { const d = web.domainOf(u); return d && !NOT_COMPANY_SITE.test(d); });
    if (!site) { notes.push({ key: r['Lead ID'], set: { Notes: [r.Notes, 'Email search: company website not found'].filter(Boolean).join(' | ') } }); continue; }
    const d = web.domainOf(site), website = 'https://' + new URL(site).hostname;
    if (known.has(d)) { notes.push({ key: r['Lead ID'], set: { Notes: [r.Notes, `Email search: company already in Raw Leads (${known.get(d)['Lead ID']})`].filter(Boolean).join(' | ') } }); continue; }
    const found = await discoverEmail(s, website, d);
    const id = newId('L');
    add.push({ 'Lead ID': id, 'Date Found': today(), Source: 'LinkedIn', 'Business Name': r.Company, Industry: r.Industry, City: r.Location, Website: website, Email: found.email,
      'Contact Name': r.Name, LinkedIn: r['LinkedIn URL'], Status: found.email ? 'New' : 'No Email',
      Notes: [`From LinkedIn: ${r.Name}, ${r.Title}`, found.how && found.how !== 'website' ? `Email ${found.how}` : ''].filter(Boolean).join(' | ') });
    known.set(d, add[add.length - 1]);
    notes.push({ key: r['Lead ID'], set: { Notes: [r.Notes, `Email search: ${found.email || 'no email found'} (Raw Leads ${id})`].filter(Boolean).join(' | ') } });
  }
  if (add.length) await store.append('Raw Leads', add);
  if (notes.length) await store.update('LinkedIn Leads', 'Lead ID', notes);
  return add.filter(r => r.Status === 'New').length;
}

// ---------------------------------------------------------------- 04b recheck (every 6 hours)
// Leads that had no email get another search (new methods find more), LinkedIn prospects get emailed and their empty messages filled
async function recheck(s) {
  const out = [];
  // 1) Raw leads without an email: up to 15 per run, each tried at most twice
  const raw = (await store.read('Raw Leads', true)).filter(r => r.Status === 'No Email' && r.Website && (state.rechecked[r['Lead ID']] || 0) < 2).slice(0, 15);
  const fixes = [];
  for (const r of raw) {
    state.rechecked[r['Lead ID']] = (state.rechecked[r['Lead ID']] || 0) + 1;
    const found = await discoverEmail(s, r.Website, web.domainOf(r.Website));
    if (found.email) fixes.push({ key: r['Lead ID'], set: { Email: found.email, Status: 'New', Notes: [r.Notes, `${today()}: email ${found.how === 'website' ? 'found on re-check' : found.how}`].filter(Boolean).join(' | ') } });
  }
  persist();
  if (fixes.length) await store.update('Raw Leads', 'Lead ID', fixes);
  if (raw.length) out.push(`re-checked ${raw.length} leads without email, found ${fixes.length}`);
  // 2) LinkedIn prospects: fill empty messages, then look for their company's email
  const li = await store.read('LinkedIn Leads', true);
  const empty = li.filter(r => !String(r['First Message'] || '').trim()).slice(0, 25);
  const fill = [];
  for (const r of empty) {
    const p = { ...parseLinkedIn(`${r.Name} - ${r.Title}`, ''), name: r.Name, company: r.Company || parseLinkedIn(`${r.Name} - ${r.Title}`, '').company, industry: r.Industry, location: r.Location };
    const a = await linkedinMessages(s, p);
    fill.push({ key: r['Lead ID'], set: { Company: p.company || r.Company || '', 'Connection Note': clean(a.connection_note).slice(0, 280), 'First Message': clean(a.first_message), 'Fit Score': r['Fit Score'] || a.fit_score || '', 'Best Service': r['Best Service'] || a.best_service || '' } });
    r.Company = p.company || r.Company;
  }
  if (fill.length) { await store.update('LinkedIn Leads', 'Lead ID', fill); out.push(`wrote messages for ${fill.length} LinkedIn prospects`); }
  const unsearched = li.filter(r => !/Email search:/.test(String(r.Notes || '')) && r.Company);
  if (unsearched.length) out.push(`${await emailLinkedInCompanies(s, unsearched)} LinkedIn companies queued for email`);
  const msg = out.join(', ') || 'Nothing to re-check';
  log('recheck', msg); return msg;
}

// ---------------------------------------------------------------- 05 LinkedIn follow-up + alert
async function linkedinFollow(s) {
  const rows = await store.read('LinkedIn Leads', true);
  const work = rows.filter(r => {
    const reply = String(r['Their Reply'] || '').trim();
    return (reply && !String(r['Suggested Reply'] || '').trim()) || (String(r.Status).toLowerCase() === 'interested' && !String(r['Forwarded To Team'] || '').trim());
  }).slice(0, 15);
  if (!work.length) return 'Nothing new';
  for (const r of work) {
    let a;
    try { a = (await gemini(P.linkedinReply(s, r), s.GEMINI_MODEL, { priority: 'send' })) || { category: 'other' }; } catch (e) {
      if (aiUnavailable(e)) { log('linkedin', `LinkedIn replies are waiting for the AI: ${e.message}`, 'warn'); break; } // handled on the next run
      a = { category: 'other' };
    }
    const forward = String(r.Status).toLowerCase() === 'interested' || a.category === 'interested';
    const set = { 'AI Category': a.category || '' };
    const sug = clean(a.suggested_reply);
    if (sug && !String(r['Suggested Reply'] || '').trim()) set['Suggested Reply'] = sug;
    if (forward) { set.Status = 'Interested'; set['Forwarded To Team'] = s.TEAM_LEADER_EMAIL ? today() : 'no team email set'; }
    else if (a.category === 'not_interested') set.Status = 'Not Interested';
    await store.update('LinkedIn Leads', 'Lead ID', [{ key: r['Lead ID'], set }]);
    if (forward) {
      await upsertQualified({ 'Lead ID': r['Lead ID'], 'Date Qualified': today(), Source: 'LinkedIn', 'Business Name': r.Company, 'Contact Name': r.Name, LinkedIn: r['LinkedIn URL'], Country: r.Location, 'Service Needed': a.service_needed || r['Best Service'], 'Lead Score': a.lead_score || 'Warm', 'Their Message': String(r['Their Reply'] || '').slice(0, 1500), Summary: a.summary || '', 'Next Step': a.next_step || '', Owner: s.TEAM_LEADER_NAME || '', 'Team Alerted': s.TEAM_LEADER_EMAIL ? today() : '' });
      if (s.TEAM_LEADER_EMAIL) await alertTeam(s, `Hot lead (LinkedIn): ${r.Name} - ${r.Company}`,
        `A LinkedIn lead is interested. Please continue the conversation from your LinkedIn${s.TEAM_LEADER_LINKEDIN ? ' (' + s.TEAM_LEADER_LINKEDIN + ')' : ''}.\n\nName: ${r.Name}\nRole: ${r.Title} at ${r.Company}\nLocation: ${r.Location}\nLinkedIn profile: ${r['LinkedIn URL']}\nService needed: ${a.service_needed || r['Best Service']}\nLead score: ${a.lead_score || 'Warm'}\n\nOur message:\n${r['First Message']}\n\nTheir reply:\n${r['Their Reply'] || '(marked interested by the team)'}\n\nSummary: ${a.summary || '-'}\nSuggested next step: ${a.next_step || '-'}\n\nSuggested reply you can send:\n${sug || r['Suggested Reply'] || '-'}`);
    }
    log('linkedin', `${r.Name}: ${a.category}${forward ? ', forwarded to team leader' : ''}`);
  }
  return `Handled ${work.length} LinkedIn updates`;
}

// ---------------------------------------------------------------- 06 daily report
async function dailyReport(s) {
  const to = String(s.REPORT_EMAILS || s.TEAM_LEADER_EMAIL || '').trim();
  if (!to) return 'No report email set';
  const t = today();
  const raw = await store.read('Raw Leads', true), qual = await store.read('Qualified Leads', true), li = await store.read('LinkedIn Leads', true);
  const n = f => raw.filter(f).length;
  const tq = qual.filter(q => String(q['Date Qualified']) === t);
  const body = `Daily report - ${t}\n\nTODAY\nNew leads found: ${n(r => String(r['Date Found']) === t)}\nFirst emails sent: ${n(r => String(r['Pitched On']) === t)}\nFollow-ups sent: ${n(r => String(r['Follow-up 1 On']) === t || String(r['Follow-up 2 On']) === t)}\nReplies received: ${n(r => String(r['Last Reply On']) === t)}\nNew qualified leads: ${tq.length}\nNew LinkedIn prospects: ${li.filter(r => String(r['Date Found']) === t).length}\n\n` +
    (tq.length ? 'QUALIFIED TODAY\n' + tq.map(q => `- ${q['Business Name'] || q['Contact Name']} (${q.Source}) - ${q['Service Needed']} - ${q['Lead Score']}`).join('\n') + '\n\n' : '') +
    `ALL TIME\nRaw leads: ${raw.length} (waiting: ${n(r => r.Status === 'New')}, no email: ${n(r => r.Status === 'No Email')})\nEmailed: ${n(r => r['Pitched On'])} | Replied: ${n(r => r['Last Reply On'])} | Interested: ${n(r => r.Status === 'Interested')} | Bounced: ${n(r => r.Status === 'Bounced')}\nQualified: ${qual.length}\nLinkedIn: ${li.length} total, ${li.filter(r => r.Status === 'To Connect').length} waiting to connect\n\n- ${s.COMPANY} Lead Agent`;
  await mail.send({ to, subject: `${s.COMPANY} leads report - ${t}`, text: body, fromName: `${s.COMPANY} Lead Agent` });
  return 'Report sent to ' + to;
}

// ---------------------------------------------------------------- scheduler
const JOBS = {
  find: { name: 'Find leads (Google Maps)', fn: findLeads, every: s => Number(s.FIND_EVERY_HOURS || 8) * 3600e3 },
  send: { name: 'Send pitches & follow-ups', fn: sendEmails, every: () => 60 * 60e3 },
  replies: { name: 'Read & answer replies', fn: checkReplies, every: () => 5 * 60e3 },
  linkedin: { name: 'Find LinkedIn prospects', fn: linkedinProspects, every: s => Number(s.LINKEDIN_EVERY_HOURS || 12) * 3600e3 },
  linkedinFollow: { name: 'LinkedIn replies & team alerts', fn: linkedinFollow, every: () => 30 * 60e3 },
  recheck: { name: 'Re-check leads without email + email LinkedIn companies', fn: recheck, every: () => 6 * 3600e3 },
  report: { name: 'Daily report (8:30 PM)', fn: dailyReport, every: null },
};

async function run(id, opts = {}) {
  if (running[id]) return 'Already running';
  running[id] = true;
  try {
    const s = await store.settings();
    ai.configure(s);
    const msg = await JOBS[id].fn(s, opts);
    state.lastResult[id] = { ok: true, msg, at: new Date().toISOString() };
    return msg;
  } catch (e) {
    state.lastResult[id] = { ok: false, msg: e.message, at: new Date().toISOString() };
    log(id, e.message, 'error'); throw e;
  } finally {
    state.lastRun[id] = Date.now(); running[id] = false; persist();
  }
}

let timer = null, lastSettings = null;
async function tick() {
  if (!config.isConfigured()) return;
  let s;
  try { s = await store.settings(); lastSettings = s; } catch (e) { log('agent', 'Cannot read settings: ' + e.message, 'error'); return; }
  if (!yes(s.AGENT_ON)) return;
  for (const [id, j] of Object.entries(JOBS)) {
    if (running[id]) continue;
    if (id === 'report') { if (istMinutes() >= 20 * 60 + 30 && state.reportDay !== today()) { state.reportDay = today(); persist(); run(id).catch(() => {}); } continue; }
    const last = state.lastRun[id] || 0;
    if (Date.now() - last >= j.every(s)) run(id).catch(() => {});
  }
}
function start() { if (!timer) { timer = setInterval(tick, 60000); setTimeout(tick, 5000); log('agent', 'Agent engine started'); } }
function status() {
  const s = lastSettings || {};
  return Object.entries(JOBS).map(([id, j]) => {
    const last = state.lastRun[id] || 0;
    const every = j.every ? j.every(s) : null;
    return { id, name: j.name, running: !!running[id], lastRun: last ? new Date(last).toISOString() : null, nextRun: every ? new Date((last || Date.now()) + every).toISOString() : 'daily 20:30', result: state.lastResult[id] || null };
  });
}

module.exports = { start, run, status, logs, JOBS, dailyLimit, sentOn, today, writeEmail, log, _internals: { findLeads, sendEmails, checkReplies, linkedinProspects, linkedinFollow, dailyReport, recheck, parseLinkedIn, discoverEmail } };
