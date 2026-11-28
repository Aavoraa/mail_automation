// Social media for any business profile:
//  1. Content studio: the AI writes ready-to-post posts (Instagram, Facebook, LinkedIn, X) for a product or service.
//  2. Auto-post to YOUR OWN pages through the official APIs: Facebook Page, Instagram Business (needs an image URL), X.
//     LinkedIn: one click opens LinkedIn with the text ready (posting by API needs LinkedIn's approval).
//  3. One-click DMs: leads' Instagram / Facebook / X handles found on their website; the app opens the chat and copies
//     the message, a person presses Send (no automated DMs: those get accounts banned).
const crypto = require('crypto');
const ai = require('./ai');
const store = require('./store');
const config = require('./config');
const web = require('./web');
const meter = require('./usage');

const PLATFORMS = ['Instagram', 'Facebook', 'LinkedIn', 'X'];
const MOCK = process.env.AAVORAA_MOCK === '1';
const newId = p => p + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
const now = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

function prompt(s, platforms, count, angle) {
  return `${ai.who(s)}
You are also our social media writer. Write ${count} different social media post(s) for EACH of these platforms: ${platforms.join(', ')}.
They are free organic posts that work like an ad for our ${String(s.OFFER_TYPE || '').toLowerCase() === 'product' ? 'product' : 'offer'}: hook in the first line, one clear benefit, a call to action${s.CTA ? ' (' + s.CTA + ')' : ''}${s.WEBSITE ? ` and our website ${s.WEBSITE}` : ''}.
${angle ? `Angle / campaign for these posts: ${angle}\n` : ''}Rules: only true facts from what you know about our offer, no invented prices, numbers, awards or customer names. Plain text, a few fitting emojis at most.
Per platform: Instagram 60-150 words + 8-15 hashtags; Facebook 40-120 words + 2-5 hashtags; LinkedIn 80-200 words, professional, 3-5 hashtags; X under 240 characters INCLUDING 1-2 hashtags.
For each post also give "image_idea": one sentence describing a simple image or short video to go with it.
Return ONLY JSON: {"posts": [{"platform": "Instagram|Facebook|LinkedIn|X", "text": "post text without the hashtags", "hashtags": "#tag #tag", "image_idea": "..."}]}`;
}
function mockPosts(platforms, count) { const out = []; for (const p of platforms) for (let i = 0; i < count; i++) out.push({ platform: p, text: `Post ${i + 1} for ${p}: one clear benefit of our offer. Ask us today!`, hashtags: '#business #growth', image_idea: 'A clean photo of the product in use' }); return { posts: out }; }

async function generate(s, { profile, platforms, count = 1, angle = '' }, by) {
  platforms = (platforms || []).filter(p => PLATFORMS.includes(p)); if (!platforms.length) throw new Error('Choose at least one platform.');
  count = Math.max(1, Math.min(5, Number(count) || 1));
  const prof = profile ? ai.profiles().find(p => p['Profile ID'] === profile) : null;
  const sx = prof ? ai.overlay(s, prof) : s;
  const a = MOCK ? mockPosts(platforms, count) : await ai.gemini(prompt(sx, platforms, count, String(angle || '').slice(0, 300)), s.GEMINI_MODEL, { priority: 'low' });
  const posts = (a && Array.isArray(a.posts) ? a.posts : []).filter(p => p && p.text && PLATFORMS.includes(p.platform));
  if (!posts.length) throw new Error('The AI did not return any posts. Try again in a minute.');
  const rows = posts.map(p => ({ 'Post ID': newId('SP'), 'Created On': now(), Profile: prof ? prof['Profile ID'] : '', Platform: p.platform, Text: ai.clean ? ai.clean(p.text) : String(p.text).trim(), Hashtags: String(p.hashtags || '').trim(), 'Image Idea': String(p.image_idea || '').trim(), 'Image URL': '', Link: sx.WEBSITE ? (/^https?:/.test(sx.WEBSITE) ? sx.WEBSITE : 'https://' + sx.WEBSITE) : '', Status: 'Draft', 'Scheduled For': '', 'Posted On': '', 'Post Link': '', Notes: `written by AI for ${by}` }));
  await store.append('Social Posts', rows);
  meter.add('social', 'posts written', rows.length);
  return rows;
}

// ---- which platforms can post automatically (keys pasted on the Connections page)
function ready() {
  const c = config.get();
  return { Facebook: !!(c.fbPageId && c.fbPageToken), Instagram: !!(c.igUserId && c.fbPageToken), X: !!(c.xApiKey && c.xApiSecret && c.xAccessToken && c.xAccessSecret), LinkedIn: false };
}
async function graph(path, body) {
  const c = config.get();
  const r = await fetch('https://graph.facebook.com/v21.0/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, access_token: c.fbPageToken }), signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('Meta: ' + ((j.error && (j.error.error_user_msg || j.error.message)) || r.status));
  return j;
}
// X (Twitter) API v2 with the account's own keys (OAuth 1.0a user context)
function oauth1(method, url, c) {
  const enc = x => encodeURIComponent(x).replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
  const p = { oauth_consumer_key: c.xApiKey, oauth_nonce: crypto.randomBytes(16).toString('hex'), oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: c.xAccessToken, oauth_version: '1.0' };
  const base = [method, enc(url), enc(Object.keys(p).sort().map(k => enc(k) + '=' + enc(p[k])).join('&'))].join('&');
  p.oauth_signature = crypto.createHmac('sha1', enc(c.xApiSecret) + '&' + enc(c.xAccessSecret)).update(base).digest('base64');
  return 'OAuth ' + Object.keys(p).sort().map(k => enc(k) + '="' + enc(p[k]) + '"').join(', ');
}
const fullText = p => [p.Text, p.Hashtags].filter(Boolean).join('\n\n');
async function publish(p) {
  const c = config.get(), text = fullText(p);
  if (!ready()[p.Platform]) throw new Error(p.Platform === 'LinkedIn' ? 'LinkedIn does not allow automatic posting without its approval: use "Open LinkedIn" and press Post.' : `${p.Platform} is not connected (Connections → Social media).`);
  if (MOCK) return { link: `https://example.test/${p.Platform.toLowerCase()}/${p['Post ID']}` };
  if (p.Platform === 'Facebook') {
    const j = await graph(encodeURIComponent(c.fbPageId) + (p['Image URL'] ? '/photos' : '/feed'), p['Image URL'] ? { url: p['Image URL'], caption: text } : { message: text, ...(p.Link ? { link: p.Link } : {}) });
    const id = j.post_id || j.id || ''; return { link: id ? 'https://www.facebook.com/' + id : '' };
  }
  if (p.Platform === 'Instagram') {
    if (!/^https:\/\//.test(p['Image URL'] || '')) throw new Error('Instagram needs an image: paste a public image link (https://…jpg) in "Image URL" first.');
    const m = await graph(encodeURIComponent(c.igUserId) + '/media', { image_url: p['Image URL'], caption: text.slice(0, 2200) });
    const pub = await graph(encodeURIComponent(c.igUserId) + '/media_publish', { creation_id: m.id });
    return { link: pub.id ? 'https://www.instagram.com/' : '' };
  }
  if (p.Platform === 'X') {
    const url = 'https://api.x.com/2/tweets';
    const r = await fetch(url, { method: 'POST', headers: { Authorization: oauth1('POST', url, c), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text.slice(0, 280) }), signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('X: ' + ((j.detail || j.title || (j.errors && j.errors[0] && j.errors[0].message)) || r.status));
    return { link: j.data && j.data.id ? 'https://x.com/i/web/status/' + j.data.id : '' };
  }
  throw new Error('Unknown platform');
}
async function postNow(id, by) {
  const p = (await store.read('Social Posts', true)).find(x => x['Post ID'] === id); if (!p) throw new Error('Post not found');
  try {
    const r = await publish(p);
    await store.update('Social Posts', 'Post ID', [{ key: id, set: { Status: 'Posted', 'Posted On': now(), 'Post Link': r.link || '', Notes: [p.Notes, `posted by ${by}`].filter(Boolean).join(' | ').slice(-500) } }]);
    meter.add('social', 'posted'); return r;
  } catch (e) {
    await store.update('Social Posts', 'Post ID', [{ key: id, set: { Status: p.Status === 'Scheduled' ? 'Failed' : p.Status, Notes: [p.Notes, 'not posted: ' + e.message].filter(Boolean).join(' | ').slice(-500) } }]).catch(() => {});
    throw e;
  }
}
// every 5 minutes: post what is scheduled and due
async function runScheduled(s, log = () => {}) {
  const due = (await store.read('Social Posts', true)).filter(p => p.Status === 'Scheduled' && p['Scheduled For'] && p['Scheduled For'] <= now());
  let n = 0;
  for (const p of due) { try { await postNow(p['Post ID'], 'schedule'); n++; log(`Posted on ${p.Platform}`); } catch (e) { log(`Scheduled ${p.Platform} post failed: ${e.message}`, 'warn'); } }
  return due.length ? `Posted ${n} of ${due.length} scheduled post(s)` : 'Nothing scheduled';
}
async function test(platform) {
  const c = config.get();
  if (MOCK) return `${platform} connected (test).`;
  if (platform === 'Facebook' || platform === 'Instagram') {
    if (!c.fbPageToken) throw new Error('Paste the Page access token first.');
    const id = platform === 'Facebook' ? c.fbPageId : c.igUserId; if (!id) throw new Error(`Paste the ${platform === 'Facebook' ? 'Facebook Page ID' : 'Instagram business account ID'} first.`);
    const r = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(id)}?fields=${platform === 'Facebook' ? 'name' : 'username'}&access_token=${encodeURIComponent(c.fbPageToken)}`, { signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({})); if (!r.ok || j.error) throw new Error('Meta: ' + ((j.error && j.error.message) || r.status));
    return `${platform} connected: ${j.name || '@' + j.username}.`;
  }
  if (platform === 'X') {
    const url = 'https://api.x.com/2/users/me';
    const r = await fetch(url, { headers: { Authorization: oauth1('GET', url, c) }, signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error('X: ' + (j.detail || j.title || r.status));
    return `X connected: @${j.data && j.data.username}.`;
  }
  throw new Error('Unknown platform');
}

// ---- one-click DMs: leads with an Instagram / Facebook / X / TikTok profile on their website
const handle = (u, re) => { const m = String(u || '').match(re); return m ? m[1] : ''; };
function dmLinks(r) {
  const ig = handle(r.Instagram, /instagram\.com\/([A-Za-z0-9_.]+)/i), fb = handle(r.Facebook, /(?:facebook|fb)\.com\/([A-Za-z0-9_.\-]+)/i), x = handle(r['X / Twitter'], /(?:twitter|x)\.com\/([A-Za-z0-9_]+)/i), tt = handle(r.TikTok, /tiktok\.com\/@([A-Za-z0-9_.]+)/i);
  const out = [];
  if (ig) out.push({ channel: 'Instagram', url: `https://ig.me/m/${ig}`, profile: `https://www.instagram.com/${ig}/` });
  if (fb && !/^(profile\.php|pages|people)$/i.test(fb)) out.push({ channel: 'Facebook', url: `https://m.me/${fb}`, profile: `https://www.facebook.com/${fb}` });
  if (x) out.push({ channel: 'X', url: `https://x.com/${x}`, profile: `https://x.com/${x}` });
  if (tt) out.push({ channel: 'TikTok', url: `https://www.tiktok.com/@${tt}`, profile: `https://www.tiktok.com/@${tt}` });
  return out;
}
function dmMessage(s, r) {
  s = ai.withProfile(s, r);
  const biz = String(r['Business Name'] || '').split(/\s+[|:–-]\s+/)[0], first = r['Contact Name'] ? ' ' + String(r['Contact Name']).split(/\s+/)[0] : '';
  const offer = String(s.SERVICES || '').split(/[,;\n]/)[0].trim();
  return `Hi${first || ' ' + biz + ' team'}! I'm ${s.SENDER_NAME} from ${s.COMPANY}${s.WEBSITE ? ' (' + s.WEBSITE + ')' : ''}. ${r['Pitch Angle'] || `We help businesses like ${biz} with ${offer || 'growth'}.`} ${s.CTA ? `Would you like ${s.CTA}?` : 'Would a quick chat be useful?'}`.replace(/\s+/g, ' ').trim();
}
async function dmList(s) {
  const rows = await store.read('Raw Leads');
  return rows.filter(r => (r.Instagram || r.Facebook || r['X / Twitter'] || r.TikTok) && !['Do Not Contact', 'Not Interested'].includes(r.Status))
    .map(r => ({ id: r['Lead ID'], business: r['Business Name'], city: r.City, profile: r.Profile, status: r.Status, sentOn: r['Social Sent On'], sentVia: r['Social Channel'], links: dmLinks(r), message: dmMessage(s, r), fit: Number(r['Fit Score'] || 0) }))
    .filter(x => x.links.length).sort((a, b) => (!!a.sentOn - !!b.sentOn) || b.fit - a.fit).slice(0, 300);
}
async function markSent(id, channel, by) {
  const r = (await store.read('Raw Leads', true)).find(x => x['Lead ID'] === id); if (!r) throw new Error('Lead not found');
  const day = now().slice(0, 10);
  await store.update('Raw Leads', 'Lead ID', [{ key: id, set: { 'Social Sent On': day, 'Social Channel': channel, Notes: [r.Notes, `${day}: DM sent on ${channel} (${by})`].filter(Boolean).join(' | ').slice(-1500) } }]);
}
// find social profiles on the websites of leads that have none yet (in the background)
let scan = { running: false, done: 0, found: 0, total: 0 };
function scanSites(max = 40) {
  if (scan.running) return `Already checking websites: ${scan.done} of ${scan.total} done.`;
  return (async () => {
    const rows = (await store.read('Raw Leads', true)).filter(r => r.Website && !r.Instagram && !r.Facebook && !r['X / Twitter'] && !r.TikTok && !/social checked/.test(String(r.Notes || '')) && !['Do Not Contact'].includes(r.Status)).slice(0, max);
    scan = { running: true, done: 0, found: 0, total: rows.length };
    (async () => {
      for (const r of rows) {
        try {
          const site = MOCK ? { html: '<a href="https://www.instagram.com/mockshop/">ig</a>', contactHtml: '' } : await web.findEmails(r.Website);
          const sl = web.socialLinks(site.html + ' ' + (site.contactHtml || ''));
          const any = sl.instagram || sl.facebook || sl.x || sl.tiktok; if (any) scan.found++;
          await store.update('Raw Leads', 'Lead ID', [{ key: r['Lead ID'], set: { Instagram: sl.instagram, Facebook: sl.facebook, 'X / Twitter': sl.x, TikTok: sl.tiktok, Notes: [r.Notes, 'social checked'].filter(Boolean).join(' | ').slice(-1500) } }]);
        } catch (e) {}
        scan.done++;
      }
      scan.running = false;
    })();
    return rows.length ? `Checking ${rows.length} websites for Instagram / Facebook / X / TikTok profiles. The list fills in as they are found.` : 'Every lead with a website has been checked already.';
  })();
}
module.exports = { PLATFORMS, generate, ready, publish, postNow, runScheduled, test, dmList, dmLinks, dmMessage, markSent, scanSites, scanStatus: () => scan, fullText };
