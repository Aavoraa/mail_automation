// Gemini AI + all prompts.
const config = require('./config');
const { TONES } = require('./schema');

let last = 0;
async function gemini(prompt, model, attempt = 0) {
  if (process.env.AAVORAA_MOCK === '1') return mockAI(prompt);
  const key = config.get().geminiKey;
  if (!key) throw new Error('Gemini API key is missing (Connections page).');
  const gap = 6500 - (Date.now() - last); // free tier: about 10 requests a minute
  if (gap > 0) await new Promise(r => setTimeout(r, gap));
  last = Date.now();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.5-flash'}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, responseMimeType: 'application/json' } }),
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) { await new Promise(r => setTimeout(r, 20000 * (attempt + 1))); return gemini(prompt, model, attempt + 1); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Gemini: ' + ((j.error && j.error.message) || res.status));
  const text = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).filter(p => !p.thought).map(p => p.text || '').join('');
  return parseJSON(text);
}
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

module.exports = { gemini, P, clean, fill, leadVars, firstName };
