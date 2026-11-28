// "Aavo", the in-app assistant: chat (typed or spoken) that answers questions about the leads and runs app actions.
// Looking things up happens straight away. Sending / starting / changing things runs straight away when "Do it straight away" is on,
// otherwise Aavo asks first (a Confirm click, or saying "yes").
// Uses the same AI as the agent (free Gemini / ChatGPT); without AI it still understands simple requests.
const store = require('./store');
const engine = require('./engine');
const ai = require('./ai');
const config = require('./config');

const PAGES = { dashboard: 'Dashboard', linkedin: 'LinkedIn tasks', calls: 'Call / WhatsApp', replies: 'Replies from client', interested: 'Interested leads', qualified: 'Qualified leads', leads: 'All email leads', import: 'Import leads', templates: 'Templates & tone', settings: 'Settings', activity: 'Agent activity', team: 'Team & logins', usage: 'Tokens & usage', bills: 'Bills & payments', connections: 'Connections' };
const JOBS = { find: 'find new leads', send: 'send pitches & follow-ups', replies: 'read & answer email replies', linkedin: 'find LinkedIn prospects', linkedinFollow: 'process LinkedIn replies', recheck: 'find missing emails' };
// name: [description, args, needs confirm, roles]
const ACTIONS = {
  stats: ['Numbers for today and all time (leads, emails, replies, interested, qualified, alarms, AI left)', '{}', false, ['owner', 'leader', 'linkedin']],
  search: ['Find leads by name, company, email, city or service', '{"query": "text"}', false, ['owner', 'leader', 'linkedin']],
  waiting: ['Client replies waiting for an answer (email + LinkedIn)', '{}', false, ['owner', 'leader', 'linkedin']],
  alarms: ['Problems: bounces, paused inboxes, failed replies', '{}', false, ['owner', 'leader', 'linkedin']],
  open_page: ['Open a page of the app', `{"page": one of ${JSON.stringify(Object.keys(PAGES))}}`, false, ['owner', 'leader', 'linkedin']],
  draft_reply: ['Write an AI answer to a client email reply (shown for checking, not sent)', '{"query": "name or email of the client"}', false, ['owner', 'leader']],
  run_job: ['Start an agent job now', `{"job": one of ${JSON.stringify(Object.keys(JOBS))}}`, true, ['owner']],
  agent_on: ['Switch the whole agent on or off', '{"on": true or false}', true, ['owner']],
  send_reply: ['Send an answer to a client email reply', '{"query": "name or email of the client", "text": "the answer"}', true, ['owner', 'leader']],
  linkedin_send_all: ['Send every prepared LinkedIn message (first messages + AI replies) from the signed-in LinkedIn', '{}', true, ['owner', 'leader', 'linkedin']],
  pitch_everything: ['Pitch everyone waiting on EVERY channel at once: email (imported first), LinkedIn (connections + messages) and WhatsApp', '{}', true, ['owner']],
  send_imported: ['Pitch (email) all the leads you imported / gave, straight away, first in line', '{}', true, ['owner', 'leader']],
  send_emails_now: ['Email all waiting leads now (first emails + due follow-ups), up to today\'s limit, from all inboxes', '{}', true, ['owner']],
  email_linkedin_leads: ['Send an email to every LinkedIn lead that has an email address and was not emailed yet ("send mail to all in LinkedIn")', '{}', true, ['owner']],
  linkedin_connect_now: ['Send LinkedIn connection requests now ("connect all" = everyone waiting, within the limits)', '{"count": number, or "all"}', true, ['owner', 'leader', 'linkedin']],
  find_leads: ['Search for new business leads now (optionally a given industry and city)', '{"industry": "optional", "city": "optional", "count": optional number}', true, ['owner', 'leader']],
  find_linkedin: ['Search for new LinkedIn prospects now (optionally a given industry and city)', '{"industry": "optional", "city": "optional"}', true, ['owner', 'leader']],
  answer_all_replies: ['Answer every client reply that is waiting (AI writes and sends the email answers, and sends the prepared LinkedIn replies)', '{}', true, ['owner']],
  set_setting: ['Change a setting', `{"key": one of ${JSON.stringify(['DAILY_MAX_LIMIT', 'DAILY_START_LIMIT', 'EMAIL_WARMUP', 'LEADS_PER_DAY', 'LINKEDIN_CONNECT_PER_DAY', 'LINKEDIN_CONNECT_PER_WEEK', 'LINKEDIN_MESSAGES_PER_DAY', 'WHATSAPP_PER_DAY', 'LINKEDIN_AUTO_CONNECT', 'TONE', 'SEND_HOURS', 'SEND_PACING', 'REPLY_MODE', 'INDUSTRIES', 'CITIES', 'FOLLOWUP_1_DAYS', 'FOLLOWUP_2_DAYS'])}, "value": "new value"}`, true, ['owner']],
};
const SETTABLE = { DAILY_MAX_LIMIT: [1, 500], DAILY_START_LIMIT: [1, 50], WEEKLY_INCREASE: [0, 25], LEADS_PER_DAY: [0, 2000], LINKEDIN_CONNECT_PER_DAY: [1, 100], LINKEDIN_CONNECT_PER_WEEK: [1, 200], LINKEDIN_MESSAGES_PER_DAY: [1, 150], WHATSAPP_PER_DAY: [0, 1000], FOLLOWUP_1_DAYS: [1, 60], FOLLOWUP_2_DAYS: [1, 90] };
const newId = p => p + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
const validEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim());
const allowed = (role) => Object.entries(ACTIONS).filter(([, a]) => a[3].includes(role));

// ---------------------------------------------------------------- the data the assistant can see
async function snapshot() {
  const [raw, qual, li, rep] = await Promise.all([store.read('Raw Leads'), store.read('Qualified Leads'), store.read('LinkedIn Leads'), store.read('Replies').catch(() => [])]);
  const d = engine.today(), st = ai.aiStatus();
  return {
    today: { leadsFound: raw.filter(r => r['Date Found'] === d).length + li.filter(r => r['Date Found'] === d).length, emailsSent: engine.sentOn(raw, d), replies: raw.filter(r => r['Last Reply On'] === d).length },
    total: { emailLeads: raw.length, emailed: raw.filter(r => r['Pitched On']).length, replied: raw.filter(r => r['Last Reply On']).length, bounced: raw.filter(r => r.Status === 'Bounced').length,
      interested: qual.filter(r => r.Stage !== 'Qualified').length, qualified: qual.filter(r => r.Stage === 'Qualified').length,
      linkedin: li.length, linkedinToConnect: li.filter(r => r.Status === 'To Connect').length, linkedinAccepted: li.filter(r => r.Status === 'Connected').length },
    waiting: rep.filter(r => /please answer|Not sent/i.test(r['Reply Status'] || '')).length + li.filter(r => r.Status === 'Replied').length,
    alarms: engine.alarms().length, aiRequestsLeft: Math.max(0, st.limit - st.used), agentOn: /^(yes|on|true|1)$/i.test(String((await store.settings()).AGENT_ON)),
  };
}
const fmt = n => Number(n || 0).toLocaleString('en-IN');
const norm = s => String(s || '').toLowerCase();

// ---------------------------------------------------------------- actions
async function findReply(q) {
  const rows = (await store.read('Replies', true)).filter(r => r.Category !== 'automatic');
  const k = norm(q);
  return rows.reverse().find(r => [r['Business Name'], r['Contact Name'], r.From].some(v => norm(v).includes(k)) && k.length > 1);
}
async function act(name, args = {}, user, confirmed = false) {
  const a = ACTIONS[name];
  if (!a) return { text: "I can't do that yet." };
  if (!a[3].includes(user.role)) return { text: 'Your login is not allowed to do that. Ask the owner.' };
  if (a[2] && !confirmed) return { confirm: { name, args, label: describe(name, args) } };
  switch (name) {
    case 'stats': {
      const s = await snapshot();
      return { text: `Today: ${fmt(s.today.leadsFound)} new leads, ${fmt(s.today.emailsSent)} emails sent, ${fmt(s.today.replies)} replies.\nAll time: ${fmt(s.total.emailLeads)} email leads, ${fmt(s.total.emailed)} emailed, ${fmt(s.total.replied)} replied, ${fmt(s.total.bounced)} bounced.\nInterested: ${fmt(s.total.interested)} · Qualified: ${fmt(s.total.qualified)}.\nLinkedIn: ${fmt(s.total.linkedin)} prospects, ${fmt(s.total.linkedinToConnect)} to connect, ${fmt(s.total.linkedinAccepted)} accepted.\n${s.waiting} replies waiting for you · ${s.alarms} alarms · agent is ${s.agentOn ? 'ON' : 'OFF'} · ${fmt(s.aiRequestsLeft)} AI requests left today.` };
    }
    case 'search': {
      const k = norm(args.query).trim(); if (k.length < 2) return { text: 'Tell me a name, company, email or city to look for.' };
      const [raw, li, qual] = await Promise.all([store.read('Raw Leads'), store.read('LinkedIn Leads'), store.read('Qualified Leads')]);
      const hit = (r, keys) => keys.some(x => norm(r[x]).includes(k));
      const out = [
        ...qual.filter(r => hit(r, ['Business Name', 'Contact Name', 'Email', 'Service Needed'])).map(r => `★ ${r['Business Name'] || r['Contact Name']} - ${r.Stage === 'Qualified' ? 'QUALIFIED' : 'interested (' + (r['Lead Score'] || '') + ')'} · ${r['Service Needed'] || ''} · ${r.Email || r.Phone || ''}`),
        ...raw.filter(r => hit(r, ['Business Name', 'Contact Name', 'Email', 'City', 'Country', 'Industry', 'Best Service'])).map(r => `✉ ${r['Business Name']} (${r.City || r.Country || ''}) - ${r.Status} · ${r.Email || 'no email'}`),
        ...li.filter(r => hit(r, ['Name', 'Company', 'Title', 'Location', 'Email'])).map(r => `in ${r.Name}${r.Company ? ', ' + r.Company : ''} - ${r.Status}`),
      ];
      return { text: out.length ? `Found ${out.length}:\n` + out.slice(0, 8).join('\n') + (out.length > 8 ? `\n…and ${out.length - 8} more (use the search box on the leads pages).` : '') : `No lead matches "${args.query}".` };
    }
    case 'waiting': {
      const [rep, li] = await Promise.all([store.read('Replies'), store.read('LinkedIn Leads')]);
      const m = rep.filter(r => /please answer|Not sent/i.test(r['Reply Status'] || '')).map(r => `✉ ${r['Business Name'] || r.From}: "${String(r['Their Message'] || '').slice(0, 90)}"`);
      const l = li.filter(r => r.Status === 'Replied').map(r => `in ${r.Name}: "${String(r['Their Reply'] || '').slice(0, 90)}"`);
      const all = [...m, ...l];
      return { text: all.length ? `${all.length} waiting for an answer:\n${all.slice(0, 8).join('\n')}` : 'Nobody is waiting for an answer right now. 🎉', page: all.length ? 'replies' : undefined };
    }
    case 'alarms': {
      const al = engine.alarms();
      return { text: al.length ? `${al.length} alarm(s):\n` + al.slice(0, 6).map(a => '⚠ ' + a.title).join('\n') : 'No alarms. Everything is running.', page: al.length ? 'dashboard' : undefined };
    }
    case 'open_page': {
      const p = PAGES[args.page] ? args.page : null;
      return p ? { text: `Opening ${PAGES[p]}.`, page: p } : { text: 'Which page? ' + Object.values(PAGES).join(', ') };
    }
    case 'draft_reply': {
      const r = await findReply(args.query); if (!r) return { text: `I could not find a reply from "${args.query}".` };
      const d = await engine.replyDraft(r['Reply ID']);
      return { text: `Here is an answer for ${r['Business Name'] || r.From}:\n\n${d.text}\n\nSay "send it" to send this, or change it first.`, draft: { query: args.query, text: d.text } };
    }
    case 'send_reply': {
      const r = await findReply(args.query); if (!r) return { text: `I could not find a reply from "${args.query}".` };
      await engine.answerReply(r['Reply ID'], args.text, user.name + ' (via Aavo)');
      return { text: `Sent to ${r.From}. ✓` };
    }
    case 'run_job': {
      if (!JOBS[args.job]) return { text: 'Which job? ' + Object.values(JOBS).join(', ') };
      engine.run(args.job, { force: true }).catch(() => {});
      return { text: `Started: ${JOBS[args.job]}. Results appear in Agent activity.` };
    }
    case 'agent_on': {
      await store.saveSettings({ AGENT_ON: args.on ? 'yes' : 'no' });
      return { text: `The agent is now ${args.on ? 'ON' : 'OFF (paused)'}.` };
    }
    case 'pitch_everything': {
      const r = await require('./pitch').pitchEverything(user.name);
      return { text: r.text, page: 'activity' };
    }
    case 'send_imported': {
      const raw = await store.read('Raw Leads', true), imp = raw.filter(r => /^Import/i.test(String(r.Source || '')));
      const waitingN = imp.filter(r => ['New', 'Low Fit'].includes(r.Status) && validEmail(r.Email)).length, noMail = imp.filter(r => r.Status === 'No Email').length, done = imp.filter(r => r['Pitched On']).length;
      if (!imp.length) return { text: 'You have not imported any leads yet. Open "Import leads" and upload your Excel / CSV file, then tell me "pitch them".', page: 'import' };
      if (!/^(yes|on|true|1)$/i.test(String((await store.settings()).AGENT_ON))) await store.saveSettings({ AGENT_ON: 'yes' });
      engine.run('importSend').then(m => engine.log('aavo', 'Imported leads: ' + m)).catch(() => {});
      return { text: waitingN ? `✓ Pitching your imported leads now: ${waitingN} waiting to be emailed (first in line, one by one, up to today's limit).\n• ${done} were already pitched\n• ${noMail} have no email address (I am searching their websites for one)` : `All ${done} imported leads with an email are already pitched.${noMail ? ` ${noMail} have no email address yet (I am searching their websites).` : ''}`, page: waitingN ? 'activity' : undefined };
    }
    case 'send_emails_now': {
      if (!/^(yes|on|true|1)$/i.test(String((await store.settings()).AGENT_ON))) return { text: 'The agent is switched OFF, so no emails can go out. Say "switch the agent on" first.' };
      const raw = await store.read('Raw Leads'), waitingN = raw.filter(r => ['New', 'Low Fit'].includes(r.Status) && validEmail(r.Email)).length;
      engine.run('send', { force: true }).then(m => engine.log('aavo', 'Send all: ' + m)).catch(() => {});
      return { text: `✓ Sending now. ${waitingN} new lead(s) are waiting, plus any follow-ups that are due.\nThey go out one by one (about 30 seconds apart) from all your inboxes, up to today's limit. Watch the progress in Agent activity.`, page: 'activity' };
    }
    case 'email_linkedin_leads': {
      const [li, raw] = await Promise.all([store.read('LinkedIn Leads', true), store.read('Raw Leads', true)]);
      const have = new Set(raw.map(r => String(r.Email || '').toLowerCase().trim()).filter(Boolean));
      const withEmail = li.filter(r => validEmail(r.Email));
      const fresh = withEmail.filter(r => !have.has(String(r.Email).toLowerCase().trim()) && !['Not Interested'].includes(r.Status));
      if (fresh.length) await store.append('Raw Leads', fresh.map(r => ({ 'Lead ID': newId('L'), 'Date Found': engine.today(), Source: 'LinkedIn (via Aavo)', 'Business Name': r.Company || r.Name, Industry: r.Industry || '', City: r.Location || '', Email: String(r.Email).toLowerCase().trim(), 'Contact Name': r.Name, LinkedIn: r['LinkedIn URL'], 'Best Service': r['Best Service'] || '', 'Fit Score': r['Fit Score'] || '', Status: 'New', Notes: 'LinkedIn lead, emailed on request' })));
      const already = withEmail.length - fresh.length, noEmail = li.length - withEmail.length;
      if (fresh.length) engine.run('send', { force: true }).then(m => engine.log('aavo', 'LinkedIn leads emailed: ' + m)).catch(() => {});
      return { text: fresh.length ? `✓ Emailing ${fresh.length} LinkedIn lead(s) now (a personal email written for each, sent one by one from your inboxes, up to today's limit).\n• ${already} were already emailed before\n• ${noEmail} have no email address yet (the agent keeps searching for them)` : `Nothing new to send: ${already} LinkedIn lead(s) were already emailed and ${noEmail} have no email address yet.`, page: fresh.length ? 'activity' : undefined };
    }
    case 'linkedin_connect_now': {
      if (!global.liBot) return { text: 'LinkedIn works only in the Windows app on the main PC.' };
      return { text: await global.liBot.connectBatch(/all|every/i.test(String(args.count)) || !args.count ? 'all' : Math.max(1, Math.min(200, Number(args.count) || 10))), page: 'linkedin' };
    }
    case 'find_leads': {
      const o = { force: true, ...(args.industry ? { industry: String(args.industry) } : {}), ...(args.city ? { city: String(args.city) } : {}), ...(args.count ? { max: Math.min(50, Number(args.count) || 25) } : {}) };
      engine.run('find', o).then(m => engine.log('aavo', 'Find leads: ' + m)).catch(() => {});
      return { text: `✓ Searching for new leads now${o.industry ? ' (' + o.industry + (o.city ? ' in ' + o.city : '') + ')' : o.city ? ' in ' + o.city : ''}. New leads appear in All email leads in a few minutes.`, page: 'activity' };
    }
    case 'find_linkedin': {
      const o = { ...(args.industry ? { industry: String(args.industry) } : {}), ...(args.city ? { city: String(args.city) } : {}) };
      engine.run('linkedin', o).then(m => engine.log('aavo', 'LinkedIn search: ' + m)).catch(() => {});
      return { text: `✓ Searching LinkedIn for new prospects now${o.industry ? ' (' + o.industry + (o.city ? ' in ' + o.city : '') + ')' : ''}. They appear in LinkedIn tasks in a few minutes.`, page: 'linkedin' };
    }
    case 'answer_all_replies': {
      const s = await store.settings(); let n = 0;
      for (let i = 0; i < 5; i++) { const k = await engine._internals.answerHeld(s, { force: true }).catch(() => 0); n += k; if (!k) break; }
      if (!n && !ai.canUse('reply')) return { text: 'The AI cannot answer right now (its free requests for today are used up or it is busy). Try again later, or answer from the cards below.' };
      const li = global.liBot ? await global.liBot.sendAll(user.name + ' (via Aavo)').catch(e => e.message) : 'LinkedIn replies: only in the Windows app.';
      return { text: `✓ Email replies answered by AI: ${n}.\n✓ LinkedIn: ${li}` };
    }
    case 'set_setting': {
      const key = String(args.key || '').toUpperCase(), allowedKeys = JSON.parse(ACTIONS.set_setting[1].match(/one of (\[.*?\])/)[1]);
      if (!allowedKeys.includes(key)) return { text: 'I can change: daily email limit, leads per day, LinkedIn requests per day, LinkedIn auto-connect on/off, tone, sending hours, pacing, reply mode, industries, cities, follow-up days.' };
      let v = String(args.value ?? '').trim();
      if (SETTABLE[key]) { const n = Number(v.replace(/[^\d.]/g, '')); if (!(n >= SETTABLE[key][0] && n <= SETTABLE[key][1])) return { text: `${key} must be between ${SETTABLE[key][0]} and ${SETTABLE[key][1]}.` }; v = String(Math.round(n)); }
      if (key === 'EMAIL_WARMUP') v = /^(no|off|false|0|stop|disable)/i.test(v) ? 'no' : 'yes';
      if (key === 'LINKEDIN_AUTO_CONNECT') v = /^(yes|on|true|1|start|enable)/i.test(v) ? 'yes' : 'no';
      if (key === 'TONE') { const t = ['Warm & friendly', 'Formal & professional', 'Short & direct', 'Consultative expert'].find(x => x.toLowerCase().includes(v.toLowerCase().split(/\s+/)[0])); if (!t) return { text: 'Tone can be: Warm & friendly, Formal & professional, Short & direct, Consultative expert.' }; v = t; }
      if (key === 'SEND_PACING') v = /fast/i.test(v) ? 'fast' : 'even';
      if (key === 'REPLY_MODE') v = /draft/i.test(v) ? 'draft' : 'send';
      if (key === 'SEND_HOURS' && !/^\d{1,2}-\d{1,2}$/.test(v)) return { text: 'Sending hours look like 8-20 (8 AM to 8 PM).' };
      await store.saveSettings({ [key]: v });
      return { text: `✓ ${key.replace(/_/g, ' ').toLowerCase()} is now "${v}".` };
    }
    case 'linkedin_send_all': {
      if (!global.liBot) return { text: 'LinkedIn sending works only in the Windows app on the main PC.' };
      return { text: await global.liBot.sendAll(user.name + ' (via Aavo)') };
    }
  }
  return { text: 'Done.' };
}
function describe(name, args) {
  if (name === 'pitch_everything') return 'Pitch everyone on email, LinkedIn and WhatsApp now';
  if (name === 'send_imported') return 'Pitch all the leads you imported now';
  if (name === 'send_emails_now') return 'Email all waiting leads now';
  if (name === 'email_linkedin_leads') return 'Email every LinkedIn lead that has an email address';
  if (name === 'linkedin_connect_now') return /all/i.test(String(args.count)) || !args.count ? 'Connect everyone waiting on LinkedIn' : `Send ${args.count} LinkedIn connection requests now`;
  if (name === 'find_leads') return 'Search for new leads now' + (args.industry ? ` (${args.industry}${args.city ? ' in ' + args.city : ''})` : '');
  if (name === 'find_linkedin') return 'Search LinkedIn for new prospects now';
  if (name === 'answer_all_replies') return 'Answer every waiting client reply';
  if (name === 'set_setting') return `Change ${args.key} to "${args.value}"`;
  if (name === 'run_job') return `Start "${JOBS[args.job] || args.job}" now`;
  if (name === 'agent_on') return args.on ? 'Switch the agent ON' : 'Pause the agent (switch OFF)';
  if (name === 'send_reply') return `Send this answer to ${args.query}:\n"${String(args.text || '').slice(0, 300)}"`;
  if (name === 'linkedin_send_all') return 'Send all prepared LinkedIn messages now';
  return name;
}

// ---------------------------------------------------------------- understanding the message
function prompt(user, history, snap, page) {
  const acts = allowed(user.role).map(([n, a]) => `- ${n}: ${a[0]}. args ${a[1]}`).join('\n');
  const convo = history.slice(-10).map(m => `${m.role === 'user' ? 'User' : 'Aavo'}: ${String(m.text).slice(0, 600)}`).join('\n');
  return `You are Aavo, the friendly robot assistant inside the AAVORAA Lead Agent app (finds leads, emails them, LinkedIn outreach, replies, qualified leads). You talk to ${user.name} (${user.role}). They may write in English, Tamil or Tanglish: answer in the same language, short and clear (max 80 words), warm and helpful.
Current page: ${page || 'dashboard'}.
Live numbers: ${JSON.stringify(snap)}
Actions you can use (pick at most ONE):
${acts}
Rules: when the user gives a command ("send mail to all in LinkedIn", "connect 10 people", "find dentists in Dubai", "answer all replies", "set daily limit to 40"), DO it with the matching action, do not just explain. If they ask for numbers, leads, replies or alarms, use the matching action. Never invent numbers; use the live numbers above. If the request is unclear, ask ONE short question instead of guessing. "say" is one short sentence about what you are doing.
Conversation so far:
${convo}

Return ONLY JSON: {"say": "your short answer", "action": null or {"name": "...", "args": {...}}}`;
}
// Without AI: simple keyword understanding (English + a little Tanglish)
function fallback(text, history) {
  const t = norm(text);
  if (/^(hi|hello|hey|vanakkam|good (morning|evening|afternoon))/.test(t)) return { name: 'stats', args: {} };
  // "send it" / "do it" / "go ahead": the draft Aavo just wrote, otherwise the last thing the user asked for
  if (/^(please\s+)?(send it|send them|send|do it|do that|go ahead|proceed|start|anuppu|send pannu|pannu|podu)\b[\s.!]*(now|please)?[\s.!]*$/.test(t)) {
    const d = [...history].reverse().find(m => m.draft); if (d) return { name: 'send_reply', args: d.draft };
    for (const m of [...history].slice(0, -1).reverse()) {
      if (m.role !== 'user') continue;
      const a = fallback(m.text, []);
      if (a && !['stats', 'search', 'waiting', 'alarms', 'open_page'].includes(a.name)) return a;
    }
    return { name: 'clarify', args: {} };
  }
  // commands first (most specific), then questions
  if (/(pitch|send|contact).*(every(thing|one|where)|all channels|all (the )?platforms|email.*linkedin.*whatsapp|everything)/.test(t)) return { name: 'pitch_everything', args: {} };
  if (/(pitch|mail|email|send|anuppu).*(import|gave|given|uploaded|my list|my leads|my file|excel|sheet i)|(import|gave|uploaded).*(pitch|mail|email|send)/.test(t)) return { name: 'send_imported', args: {} };
  if (/\bpitch(ing)?\b/.test(t) && !/linkedin/.test(t)) return { name: 'send_emails_now', args: {} };
  if (/(mail|email).*(linkedin)|linkedin.*(mail|email)/.test(t)) return { name: 'email_linkedin_leads', args: {} };
  if (/connect/.test(t) && /linkedin|people|request|all|every|\d/.test(t)) return { name: 'linkedin_connect_now', args: { count: /\d+/.test(t) ? Number(t.match(/\d+/)[0]) : 'all' } };
  if (/(answer|reply)\s+(to\s+)?(all|every)/.test(t)) return { name: 'answer_all_replies', args: {} };
  if (/(send|mail).*\b(e?mails?)\b|\b(e?mail)\b.*\b(all|every)\b.*\bleads?\b|send all (e)?mails/.test(t) && !/linkedin/.test(t)) return { name: 'send_emails_now', args: {} };
  if (/send all|linkedin.*send|send.*linkedin|linkedin.*message/.test(t)) return { name: 'linkedin_send_all', args: {} };
  if (/find.*linkedin|linkedin.*(prospect|find|search)/.test(t)) return { name: 'find_linkedin', args: {} };
  if (/alarm|problem|error|bounce/.test(t)) return { name: 'alarms', args: {} };
  if (/waiting|pending|reply|replies|answer/.test(t)) return { name: 'waiting', args: {} };
  if (/(start|run|find).*(lead)/.test(t)) return { name: 'find_leads', args: {} };
  if (/(start|run).*(send|email|pitch)/.test(t)) return { name: 'run_job', args: { job: 'send' } };
  if (/(pause|stop|off).*(agent)|agent.*(off|stop|pause)/.test(t)) return { name: 'agent_on', args: { on: false } };
  if (/(start|on|resume).*(agent)|agent.*\bon\b/.test(t)) return { name: 'agent_on', args: { on: true } };
  const page = Object.entries(PAGES).find(([k, v]) => t.includes(norm(v)) || t.includes(k)); if (page && /open|show|go|kaattu|po\b/.test(t)) return { name: 'open_page', args: { page: page[0] } };
  const m = t.match(/(?:find|search|look for|show|thedu)\s+(.+)/); if (m && !/stat|number|today/.test(t)) return { name: 'search', args: { query: m[1].replace(/^(lead|leads|for)\s+/, '') } };
  if (/stat|how many|number|today|count|evlo|report/.test(t)) return { name: 'stats', args: {} };
  return null;
}
async function chat(user, history, page, auto = false) {
  const last = history[history.length - 1] || {}, text = String(last.text || '').trim();
  if (!text) return { text: 'Hi! Ask me anything about your leads, or tell me what to do.' };
  // "yes" / "ok" / "do it" / "seri" answers the question Aavo just asked
  const prev = [...history].slice(0, -1).reverse().find(m => m.role !== 'user');
  if (prev && prev.confirm && !prev.done && /^(yes|yeah|yep|ok|okay|sure|confirm|do it|go|go ahead|send|seri|sari|aama|aamaa|haan|ha|podu|pannu|anuppu)\b/i.test(text)) return act(prev.confirm.name, prev.confirm.args || {}, user, true).catch(e => ({ text: 'That did not work: ' + e.message }));
  if (prev && prev.confirm && !prev.done && /^(no|cancel|stop|venam|vendam|illa)\b/i.test(text)) return { text: 'Okay, cancelled.' };
  const snap = await snapshot();
  let say = '', action = null, viaAI = false, aiErr = '';
  try {
    // at most 25 seconds: if the AI is slow or overloaded, Aavo goes ahead with its own understanding of the words
    const a = await Promise.race([ai.gemini(prompt(user, history, snap, page), (await store.settings()).GEMINI_MODEL, { priority: 'reply', fast: true }), new Promise((_, no) => setTimeout(() => no(Object.assign(new Error('the AI took too long to answer'), { aiUnavailable: true })), process.env.AAVORAA_MOCK === '1' ? 3000 : 25000))]);
    if (a && (a.say || a.action)) { say = String(a.say || '').trim(); action = a.action && a.action.name ? a.action : null; viaAI = true; }
  } catch (e) { aiErr = e.message; if (!ai.aiUnavailable(e)) console.warn('[aavo] ' + e.message); }
  if (!viaAI || (!action && !say)) {
    action = fallback(text, history);
    if (!action) return { text: viaAI ? `Sorry, I did not get that. Please say it another way, for example "pitch my imported leads", "send mail to all in LinkedIn", "connect 10 on LinkedIn" or "answer all replies".` : `I could not use the AI just now${aiErr ? ' (' + aiErr.replace(/\.$/, '') + ')' : ''}, so I only understand simple commands. Try: "pitch my imported leads", "send all emails now", "send mail to all in LinkedIn", "connect 10 on LinkedIn", "answer all replies" or "today's numbers".` };
  }
  if (!action) return { text: say || 'Okay.' };
  if (action.name === 'clarify') return { text: 'What should I send? Tell me one of these:\n• "send all emails now" (pitch the waiting leads)\n• "pitch my imported leads"\n• "send mail to all in LinkedIn"\n• "send LinkedIn messages"\n• "answer all replies"' };
  let r = await act(action.name, action.args || {}, user).catch(e => ({ text: 'That did not work: ' + e.message }));
  if (r.confirm && auto) r = await act(action.name, action.args || {}, user, true).catch(e => ({ text: 'That did not work: ' + e.message })); // "Do it straight away" is on
  if (r.confirm) return { text: (say ? say + '\n\n' : '') + 'Shall I go ahead? ' + r.confirm.label + ' (say "yes" or click Confirm)', confirm: r.confirm };
  return { ...r, text: [say && !/^(okay|sure|done)\.?$/i.test(say) && action.name !== 'open_page' ? say : '', r.text].filter(Boolean).join('\n\n') };
}

module.exports = { chat, act, ACTIONS, _t: { fallback, snapshot } };
