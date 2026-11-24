// Gemini AI + all prompts.
const config = require('./config');
const { TONES } = require('./schema');

let last = 0;
// ---- model picking: uses the newest Gemini "flash" model your key can use, so Google retiring a model never breaks the agent
let modelCache = { key: '', list: null, at: 0, chosen: '' };
const verOf = n => { const m = String(n).match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
async function listModels(key) {
  if (modelCache.key === key && modelCache.list && Date.now() - modelCache.at < 6 * 3600e3) return modelCache.list;
  const out = []; let page = '';
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200${page ? '&pageToken=' + page : ''}`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Gemini: ' + ((j.error && j.error.message) || r.status));
    for (const m of j.models || []) if ((m.supportedGenerationMethods || []).includes('generateContent')) out.push(String(m.name).replace(/^models\//, ''));
    if (!j.nextPageToken) break; page = j.nextPageToken;
  }
  modelCache = { key, list: out, at: Date.now(), chosen: '' };
  return out;
}
function bestModel(list) {
  const skip = /image|tts|audio|live|embed|vision|thinking|robotics|computer|native|search|lite|nano|gemma|learnlm|aqa/i;
  const score = n => {
    let s = verOf(n) * 100;
    if (/^gemini-\d+(\.\d+)?-flash$/.test(n)) s += 50;          // stable flash
    else if (/^gemini-\d+(\.\d+)?-flash-latest$/.test(n)) s += 45;
    else if (/flash/.test(n) && !/preview|exp/.test(n)) s += 30;
    else if (/flash/.test(n)) s += 10;                            // preview flash
    else if (/pro/.test(n) && !/preview|exp/.test(n)) s += 5;
    else s -= 1000;
    return s;
  };
  const c = list.filter(n => /^gemini-/.test(n) && !skip.test(n)).sort((a, b) => score(b) - score(a));
  return c[0] || list.find(n => /flash/.test(n)) || list[0];
}
const retired = new Set();
async function pickModel(key, wanted) {
  const w = String(wanted || '').trim().replace(/^models\//, '');
  if (w && w.toLowerCase() !== 'auto' && !retired.has(w)) {
    // a specific model typed in Settings: use it only if Google still offers it, otherwise choose automatically
    const have = await listModels(key).catch(() => null);
    if (!have || have.includes(w)) return w;
    retired.add(w); console.warn(`[ai] GEMINI_MODEL "${w}" does not exist for this key, choosing a model automatically`);
  }
  if (modelCache.key === key && modelCache.chosen && !retired.has(modelCache.chosen)) return modelCache.chosen;
  const list = (await listModels(key)).filter(n => !retired.has(n));
  if (!list.length) throw new Error('Gemini: your API key has no text models available. Create a new key at aistudio.google.com.');
  modelCache.chosen = bestModel(list);
  return modelCache.chosen;
}
const gone = msg => /no longer available|not found|is not supported|deprecated|retired|update your code/i.test(msg);

// ---- daily AI budget. Free Gemini keys allow only a few requests a day (20 per model in late 2026), and
// Google resets them at midnight US Pacific time. Requests are shared by priority, so answering customers
// always has some left:   reply = everything,  send = all but a reserve kept for replies,  low = finding leads / LinkedIn.
const fs = require('fs');
const path = require('path');
const USAGE = path.join(config.dir, 'ai-usage.json');
const quotaDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
let usage = (() => { try { return JSON.parse(fs.readFileSync(USAGE, 'utf8')); } catch (e) { return {}; } })();
let dailyLimit = 20;
// Which AI writes the emails: ChatGPT (OpenAI) once its key is saved, otherwise Gemini.
const provider = () => (config.get().openaiKey ? 'openai' : 'gemini');
const aiName = () => (provider() === 'openai' ? 'ChatGPT' : 'Gemini');
const activeKey = () => (provider() === 'openai' ? config.get().openaiKey : config.get().geminiKey);
// a different key has its own quota: forget the old key's usage and pause (only a fingerprint is stored, never the key)
const keyTag = () => require('crypto').createHash('sha256').update(provider() + ':' + String(activeKey() || '')).digest('hex').slice(0, 12);
function today() {
  const tag = keyTag();
  if (usage.key !== tag) usage = { day: quotaDay(), used: 0, blockedUntil: 0, key: tag };
  else if (usage.day !== quotaDay()) usage = { day: quotaDay(), used: 0, blockedUntil: usage.blockedUntil || 0, key: tag };
  return usage;
}
const saveUsage = () => { try { fs.writeFileSync(USAGE, JSON.stringify(usage)); } catch (e) {} };
function setDailyLimit(n) { const v = Math.floor(Number(n)); if (v > 0) dailyLimit = v; }
function caps() {
  const reserve = Math.max(1, Math.min(6, Math.ceil(dailyLimit * 0.3)));
  return { reply: dailyLimit, send: Math.max(0, dailyLimit - reserve), low: Math.max(0, Math.floor(dailyLimit * 0.35)) };
}
// AI could not be used right now (quota, budget kept for replies, network). The work should wait, not fail for good.
class AIUnavailable extends Error { constructor(msg, code) { super(msg); this.code = code; this.aiUnavailable = true; } }
const aiUnavailable = e => !!(e && e.aiUnavailable);
function canUse(priority = 'low') {
  const u = today();
  if (u.blockedUntil > Date.now()) return false;
  return u.used < (caps()[priority] ?? caps().low);
}
function aiStatus() {
  const u = today();
  return { day: u.day, used: u.used, limit: dailyLimit, caps: caps(), blockedUntil: u.blockedUntil > Date.now() ? new Date(u.blockedUntil).toISOString() : null };
}
// "Please retry in 3h36m59.6s" or RetryInfo "13019s" -> milliseconds
function retryAfter(j, msg) {
  const det = ((j.error && j.error.details) || []).find(d => d.retryDelay);
  if (det) { const s = parseFloat(det.retryDelay); if (s > 0) return s * 1000; }
  const m = String(msg).match(/retry in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:([\d.]+)s)?/i);
  if (m && (m[1] || m[2] || m[3])) return ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000;
  return 0;
}
const isDailyQuota = (msg, wait) => /per ?day|PerDay|daily/i.test(msg) || wait > 10 * 60e3;

// gemini(prompt, model, { priority: 'reply' | 'send' | 'low' })
async function gemini(prompt, model, opts = {}) {
  if (typeof opts === 'number') opts = { attempt: opts };
  const attempt = opts.attempt || 0, priority = opts.priority || 'low';
  if (process.env.AAVORAA_MOCK === '1') {
    if (process.env.AAVORAA_MOCK_AI_DOWN === '1') throw new AIUnavailable('Gemini: daily free limit reached (mock)', 'quota');
    if (attempt === 0) { if (!canUse(priority)) throw new AIUnavailable(`AI budget for today is kept for ${priority === 'low' ? 'emails and replies' : 'customer replies'}`, 'budget'); today().used++; }
    return mockAI(prompt);
  }
  if (attempt === 0) {
    const u = today();
    if (u.blockedUntil > Date.now()) throw new AIUnavailable(`${aiName()} is out of requests, AI is back at ${new Date(u.blockedUntil).toLocaleString()}`, 'quota');
    if (!canUse(priority)) throw new AIUnavailable(`AI budget for today (${u.used}/${dailyLimit}) is kept for ${priority === 'low' ? 'emails and customer replies' : 'customer replies'}`, 'budget');
  }
  if (provider() === 'openai') return openaiCall(prompt, opts);
  const key = config.get().geminiKey;
  if (!key) throw new Error('AI key is missing: add your ChatGPT (OpenAI) API key on the Connections page.');
  const use = await pickModel(key, model);
  const gap = 6500 - (Date.now() - last); // free tier: about 10 requests a minute
  if (gap > 0) await new Promise(r => setTimeout(r, gap));
  last = Date.now();
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(use)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(90000), // never wait forever
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, responseMimeType: 'application/json' } }),
    });
  } catch (e) {
    // no internet / Google unreachable: wait a bit and retry, then give up for now (the job tries again later)
    if (attempt < 2) { await new Promise(r => setTimeout(r, 15000 * (attempt + 1))); return gemini(prompt, model, { ...opts, attempt: attempt + 1 }); }
    throw new AIUnavailable('Gemini could not be reached (' + e.message + '), will try again later', 'network');
  }
  today().used++; saveUsage();
  const j = await res.json().catch(() => ({}));
  const msg = (j.error && j.error.message) || String(res.status);
  if (!res.ok && (res.status === 404 || res.status === 400) && gone(msg) && attempt < 2) {
    // the chosen model was retired: forget it and pick the newest available one
    retired.add(use); modelCache.chosen = ''; modelCache.list = null;
    return gemini(prompt, 'auto', { ...opts, attempt: attempt + 1 });
  }
  if (res.status === 429) {
    const wait = retryAfter(j, msg);
    if (isDailyQuota(msg, wait)) {
      // the day's free requests are used up: stop asking until Google resets them, instead of failing every job
      usage.blockedUntil = Date.now() + (wait || 3600e3); usage.used = Math.max(usage.used, dailyLimit); saveUsage();
      throw new AIUnavailable(`Gemini daily free limit reached, AI is back at ${new Date(usage.blockedUntil).toLocaleString()}`, 'quota');
    }
    if (attempt < 3) { await new Promise(r => setTimeout(r, Math.max(wait, 20000 * (attempt + 1)))); return gemini(prompt, model, { ...opts, attempt: attempt + 1 }); }
    throw new AIUnavailable('Gemini is busy (too many requests a minute), will try again later', 'rate');
  }
  if (res.status >= 500) {
    if (attempt < 3) { await new Promise(r => setTimeout(r, 20000 * (attempt + 1))); return gemini(prompt, model, { ...opts, attempt: attempt + 1 }); }
    throw new AIUnavailable('Gemini is having problems (' + res.status + '), will try again later', 'server');
  }
  if (!res.ok) throw new Error('Gemini: ' + msg);
  const text = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).filter(p => !p.thought).map(p => p.text || '').join('');
  return parseJSON(text);
}
// ---- ChatGPT (OpenAI API). Needs an API key from platform.openai.com with credit (a ChatGPT Plus plan does not include it).
// Model "auto" = the first of these the key can use: small, fast and cheap models that write well.
const OPENAI_PREFER = ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-5-mini', 'gpt-5.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-5'];
let openaiModel = 'auto', oaCache = { key: '', chosen: '', at: 0 };
const oaRetired = new Set();
async function openaiPick(key) {
  const w = String(openaiModel || 'auto').trim();
  if (w && w.toLowerCase() !== 'auto' && !oaRetired.has(w)) return w; // a specific model typed in Settings
  if (oaCache.key === key && oaCache.chosen && !oaRetired.has(oaCache.chosen) && Date.now() - oaCache.at < 6 * 3600e3) return oaCache.chosen;
  let ids = [];
  try {
    const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error('ChatGPT: this API key was not accepted. Create a new one at platform.openai.com/api-keys.');
    ids = (j.data || []).map(m => m.id);
  } catch (e) { if (/not accepted/.test(e.message)) throw e; }
  const ok = ids.filter(n => !oaRetired.has(n));
  const chosen = OPENAI_PREFER.find(n => ok.includes(n)) || ok.filter(n => /^gpt-[\d.]+(o)?-mini$/.test(n)).sort().pop() || OPENAI_PREFER.find(n => !oaRetired.has(n)) || 'gpt-4o-mini';
  oaCache = { key, chosen, at: Date.now() };
  return chosen;
}
async function openaiCall(prompt, opts = {}) {
  const attempt = opts.attempt || 0;
  const key = config.get().openaiKey;
  const again = () => openaiCall(prompt, { ...opts, attempt: attempt + 1 });
  const use = await openaiPick(key);
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(90000), // never wait forever
      body: JSON.stringify({ model: use, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } }),
    });
  } catch (e) {
    if (attempt < 2) { await new Promise(r => setTimeout(r, 15000 * (attempt + 1))); return again(); }
    throw new AIUnavailable('ChatGPT could not be reached (' + e.message + '), will try again later', 'network');
  }
  today().used++; saveUsage();
  const j = await res.json().catch(() => ({}));
  const err = j.error || {}, msg = err.message || String(res.status);
  if (res.status === 401) throw new Error('ChatGPT: this API key was not accepted. Create a new one at platform.openai.com/api-keys and paste it on the Connections page.');
  if ((res.status === 404 || res.status === 400) && (err.code === 'model_not_found' || /model/i.test(msg) && /not exist|not found|access|deprecated/i.test(msg)) && attempt < 2) {
    oaRetired.add(use); oaCache.chosen = ''; return again(); // model gone or not allowed for this key: pick another
  }
  if (res.status === 429) {
    if (err.code === 'insufficient_quota' || /quota|billing|credit/i.test(msg)) {
      // no credit left on the OpenAI account: pause AI for an hour instead of failing every job
      usage.blockedUntil = Date.now() + 3600e3; saveUsage();
      throw new AIUnavailable('ChatGPT: your OpenAI account has no credit left. Add credit at platform.openai.com/settings/organization/billing', 'quota');
    }
    const wait = Number(res.headers && res.headers.get && res.headers.get('retry-after')) * 1000 || 0;
    if (attempt < 3) { await new Promise(r => setTimeout(r, Math.max(wait, 10000 * (attempt + 1)))); return again(); }
    throw new AIUnavailable('ChatGPT is busy (too many requests a minute), will try again later', 'rate');
  }
  if (res.status >= 500) {
    if (attempt < 3) { await new Promise(r => setTimeout(r, 15000 * (attempt + 1))); return again(); }
    throw new AIUnavailable('ChatGPT is having problems (' + res.status + '), will try again later', 'server');
  }
  if (!res.ok) throw new Error('ChatGPT: ' + msg);
  oaCache.chosen = oaCache.chosen || use;
  return parseJSON(((j.choices && j.choices[0] && j.choices[0].message) || {}).content);
}
// called by the agent before each job with the Settings values
function configure(s = {}) {
  openaiModel = s.OPENAI_MODEL || 'auto';
  setDailyLimit(provider() === 'openai' ? (s.OPENAI_DAILY_LIMIT || 500) : s.AI_DAILY_LIMIT);
}
const currentModel = () => (provider() === 'openai' ? (oaCache.chosen || String(openaiModel)) : modelCache.chosen || '');
function parseJSON(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  try { return JSON.parse(t); } catch (err) { return null; }
}
const clean = t => String(t || '').replace(/\s*—\s*/g, ', ').replace(/–/g, '-').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();

function rules(s) {
  const tone = TONES[s.TONE] || TONES['Warm & friendly'];
  return `Tone: ${tone}. Write like a thoughtful, kind human, not a marketer: specific, respectful, simple words, natural rhythm. ` +
    `Never use: "I hope this email finds you well", "I came across", "revolutionize", "game-changer", "synergy", "leverage", "unlock", "elevate", ` +
    `exclamation marks, emojis, em dashes, bullet lists, prices, guarantees, made-up client names or results, or fake familiarity. Do not add a signature, we add it.` +
    (s.EXTRA_INSTRUCTIONS ? ` Also always follow this: ${s.EXTRA_INSTRUCTIONS}` : '');
}
function who(s) {
  return `You are ${s.SENDER_NAME}, ${s.SENDER_TITLE || 'Business Development Executive'} at ${s.COMPANY} (${s.WEBSITE}), a digital and technology company (tagline: "${s.TAGLINE}").\nOur services: ${s.SERVICES}.`;
}
function langRule(s, lead) {
  const m = String(lead.Notes || '').match(/Site language: ([^|]+)/);
  return String(s.EMAIL_LANGUAGE || 'auto').toLowerCase() === 'auto'
    ? `Write in the main language of their website (${m ? m[1].trim() : 'English'}). If unsure, use English.`
    : `Write in ${s.EMAIL_LANGUAGE}.`;
}
function firstName(name) { const n = String(name || '').trim().split(/\s+/)[0]; return n || 'there'; }
function fill(text, vars) { return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== '' ? vars[k] : m)); }
function leadVars(lead, s) {
  const issues = String(lead['Website Issues'] || '').split(';').map(x => x.trim()).filter(Boolean);
  return {
    business: lead['Business Name'] || lead.Company || '', contact: lead['Contact Name'] || lead.Name || '',
    first_name: firstName(lead['Contact Name'] || lead.Name), service: lead['Best Service'] || '', issue: issues[0] || '',
    opportunity: lead['Pitch Angle'] || '', city: lead.City || lead.Location || '', industry: lead.Industry || '',
    sender: s.SENDER_NAME, company: s.COMPANY, website: s.WEBSITE, tip: '',
  };
}

// ---------- prompts
const P = {
  analyse(s, L) {
    return `You are a senior growth consultant at ${s.COMPANY}, a digital and technology company.
Our services: ${s.SERVICES}.

Study this business honestly and decide how we could genuinely help them.
Business: ${L.name}
Category: ${L.category}
Location: ${L.city} ${L.country}
Website: ${L.website}
Google rating: ${L.rating} (${L.reviews} reviews)
Automatic website checks: ${JSON.stringify(L.checks)}
Website text (first part): [[[${L.siteText}]]]

Return ONLY a JSON object:
{"fit_score": number 1-10 for how likely they need AND can afford our services,
 "best_service": "the ONE most relevant service from our list",
 "website_issues": "2-3 short, specific, polite observations separated by ' ; ' (based only on the data above)",
 "pitch_angle": "one sentence: the specific opportunity we would mention to them",
 "contact_name": "owner or founder full name only if clearly written in the website text, else empty",
 "language": "main language of the website, e.g. English",
 "is_real_business": true or false}`;
  },
  email(s, lead, stage, tpl) {
    const L = lead;
    const base = `${who(s)}\n${rules(s)} ${langRule(s, L)}\n\nLead:\nBusiness: ${L['Business Name']}\nContact name: ${L['Contact Name'] || 'unknown, so greet with "Hi there" or "Hi ' + L['Business Name'] + ' team"'}\nIndustry: ${L.Industry} | Location: ${L.City} ${L.Country}\nWebsite: ${L.Website}\nWhat we noticed: ${L['Website Issues'] || 'not analysed'}\nBest service for them: ${L['Best Service'] || 'choose the most relevant one from our services'}\nOpportunity: ${L['Pitch Angle'] || ''}`;
    let task;
    if (stage === 0) task = `Write the FIRST cold email (70-120 words). Open with one specific, genuine observation about their business. In one or two sentences explain how the best service could help them. End with a soft, low-pressure question, for example offering a free short audit or a 15-minute call. Final line exactly: "If this isn't relevant, just reply 'no' and I won't email again."\nSubject: 2-6 words, mostly lowercase, personal, no clickbait.`;
    else if (stage === 1) task = `Our first email (subject "${L['Email Subject']}") got no reply. Write a short, friendly FOLLOW-UP (40-70 words) that adds one new useful idea or quick tip related to the best service. No guilt-tripping. End with a simple yes/no question. Subject must be "".`;
    else task = `Two emails got no reply. Write a final, polite closing email (30-50 words): respect their time, say this is the last note, leave the door open. No pressure. Subject must be "".`;
    if (tpl) task += `\n\nUse this TEMPLATE as the base. Keep its structure, intent and key sentences; fill every {{placeholder}} with real details; personalise lightly so it sounds natural for this lead; keep it about the same length.\nTemplate subject: ${tpl.Subject || '(none)'}\nTemplate body:\n[[[${tpl.Body}]]]`;
    return `${base}\n\n${task}\nReturn ONLY JSON: {"subject": "...", "body": "..."}`;
  },
  reply(s, d, tpl) {
    const L = d.lead;
    const booking = s.BOOKING_LINK ? `Share this booking link for the call: ${s.BOOKING_LINK}` : 'Ask for two or three times that suit them, and their time zone.';
    return `${who(s)}\nA lead replied to our outreach email. Read their reply and decide what to do.\n\nLead: ${L['Business Name']} | contact: ${L['Contact Name'] || 'unknown'} | website: ${L.Website}\nWe pitched: ${L['Best Service']} - ${L['Pitch Angle']}\nTheir reply (subject "${d.subject}"):\n[[[${d.text}]]]\n\nHow to write the reply:\n- ${rules(s)}\n- 40-110 words. Same language they wrote in. Thank them, by name if known.\n- Interested or asking for details: answer briefly and suggest a 15-20 minute call. ${booking}\n- Asking about price: say pricing depends on scope and we will share a clear, tailored quote after a short call. Never invent prices, timelines, guarantees, past clients or case studies.\n- Pointing us to another person: thank them and ask politely for the right contact.\n- Not interested: thank them sincerely in 1-2 sentences and confirm we will not email again.\n- Asking to stop / unsubscribe / remove, or an auto-reply / out-of-office: reply must be "".` +
      (tpl ? `\n- If they are interested, base your reply on this template (keep its intent, fill placeholders, adapt to what they said):\n[[[${tpl.Body}]]]` : '') +
      `\n\nReturn ONLY JSON:\n{"category": "interested" | "question" | "referral" | "not_interested" | "unsubscribe" | "out_of_office" | "other",\n "lead_score": "Hot" | "Warm" | "Cold", "service_needed": "", "budget": "only if mentioned", "timeline": "only if mentioned",\n "summary": "one sentence: what they said", "next_step": "short next step for our team", "reply": "the email reply text"}`;
  },
  linkedin(s, p, noteTpl, msgTpl) {
    return `${who(s)}\nWe found this person on LinkedIn (from Google):\nName: ${p.name}\nHeadline: ${p.title}\nCompany: ${p.company}\nSearch: ${p.industry} in ${p.location}\nSnippet: ${p.snippet}\n\n${rules(s)}\n` +
      (noteTpl ? `Base the connection note on this template: [[[${noteTpl.Body}]]]\n` : '') +
      (msgTpl ? `Base the first message on this template: [[[${msgTpl.Body}]]]\n` : '') +
      `Return ONLY JSON:\n{"fit_score": 1-10, "best_service": "one service from our list",\n "connection_note": "LinkedIn connection request note, max 250 characters, friendly, mentions something specific about them, NO selling",\n "first_message": "message to send after they accept, 50-90 words, gives one useful idea related to the best service, ends with a soft question"}`;
  },
  linkedinReply(s, r) {
    return `${who(s)}\nLinkedIn conversation with ${r.Name} (${r.Title} at ${r.Company}):\nOur message: [[[${r['First Message']}]]]\nTheir reply: [[[${r['Their Reply'] || '(no text pasted, team marked them as interested)'}]]]\n\n${rules(s)} Keep it short (30-80 words), same language as them. If interested, suggest a short call${s.BOOKING_LINK ? ' and share this link: ' + s.BOOKING_LINK : ''}.\nReturn ONLY JSON:\n{"category": "interested" | "question" | "not_interested" | "other", "lead_score": "Hot" | "Warm" | "Cold",\n "service_needed": "", "summary": "one sentence", "next_step": "short next step", "suggested_reply": "LinkedIn reply text, or empty if not interested"}`;
  },
};

// ---------- mock AI for tests
function mockAI(prompt) {
  if (prompt.includes('"fit_score": number')) return { fit_score: 7, best_service: 'SEO & AI Search Visibility', website_issues: 'No meta description ; footer shows 2021', pitch_angle: 'More enquiries from Google search', contact_name: '', language: 'English', is_real_business: true };
  if (prompt.includes('A lead replied')) return { category: /interest|yes|call/i.test(prompt.split('Their reply')[1] || '') ? 'interested' : 'question', lead_score: 'Hot', service_needed: 'SEO', summary: 'Wants a call next week', next_step: 'Book a call', reply: 'Thank you, happy to set up a short call. Would Tuesday or Wednesday suit you?' };
  if (prompt.includes('connection_note')) return { fit_score: 8, best_service: 'Performance Marketing', connection_note: 'Hi, I liked your work, would be glad to connect.', first_message: 'Thanks for connecting. One idea that helps businesses like yours is...' };
  if (prompt.includes('suggested_reply')) return { category: 'interested', lead_score: 'Warm', service_needed: 'SEO', summary: 'Open to a call', next_step: 'Message on LinkedIn', suggested_reply: 'Great, would a 15-minute call this week work?' };
  return { subject: 'quick idea for you', body: 'Hi there, I noticed your website could load faster on mobile. Would a free short audit help?\n\nIf this isn\'t relevant, just reply \'no\' and I won\'t email again.' };
}

module.exports = { gemini, askAI: gemini, currentModel, bestModel, P, clean, fill, leadVars, firstName, AIUnavailable, aiUnavailable, canUse, aiStatus, setDailyLimit, configure, provider, aiName };
