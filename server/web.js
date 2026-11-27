// Apify (Google Maps + Google search) and website checks.
const config = require('./config');
const MOCK = process.env.AAVORAA_MOCK === '1';

async function apify(actor, input) {
  if (MOCK) return mockApify(actor, input);
  const token = config.get().apifyToken;
  if (!token) throw new Error('Apify token is missing (Connections page).');
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 300000);
  try {
    const res = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: ctrl.signal,
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error('Apify: ' + ((j && j.error && j.error.message) || res.status));
    return Array.isArray(j) ? j : [];
  } finally { clearTimeout(t); }
}
// contacts = true adds Apify's contact enrichment: it reads each business website (also JavaScript sites) and returns its emails
const useApify = () => config.get().leadSource === 'apify' && !!config.get().apifyToken;
const mapsSearch = (industry, city, max, contacts = true) => !MOCK && !useApify() ? require('./free').places(industry, city, max) : apify('compass~crawler-google-places', { searchStringsArray: [industry], locationQuery: city, maxCrawledPlacesPerSearch: max, language: 'en', skipClosedPlaces: true, ...(contacts ? { scrapeContacts: true } : {}) });
const googleSearch = (query) => !MOCK && !useApify() ? require('./free').search(query) : apify('apify~google-search-scraper', { queries: query, maxPagesPerQuery: 1, resultsPerPage: 20, mobileResults: false, saveHtml: false, saveHtmlToKeyValueStore: false });

async function getHtml(url) {
  if (MOCK) return '<html><title>Demo Co</title><meta name="viewport"> © 2021 info@democo.com <a href="/contact">Contact</a></html>' + 'x'.repeat(600);
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Accept: 'text/html' }, redirect: 'follow', signal: ctrl.signal });
    const text = await res.text();
    return text.slice(0, 600000);
  } catch (e) { return ''; } finally { clearTimeout(t); }
}

const badEmail = /\.(png|jpe?g|gif|svg|webp|css|js|ico)$|example\.|sentry|wixpress|domain\.com|email\.com|yourname|yourdomain|@2x|godaddy|^u003e|noreply|no-reply/i;
// Cloudflare "email protection" hides addresses as hex: first byte is the key, the rest is XOR-ed with it
function decodeCf(hex) {
  try { const k = parseInt(hex.slice(0, 2), 16); let o = ''; for (let i = 2; i < hex.length; i += 2) o += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ k); return o; } catch (e) { return ''; }
}
function emailsFrom(html) {
  let src = String(html || '');
  // un-hide the common tricks: Cloudflare protection, HTML entities, url-encoding, "name [at] site [dot] com"
  const cf = [...src.matchAll(/data-cfemail=["']([0-9a-f]{6,})["']|email-protection#([0-9a-f]{6,})/gi)].map(m => decodeCf(m[1] || m[2]));
  src = src.replace(/&#0*64;|&#x0*40;/gi, '@').replace(/&#0*46;|&#x0*2e;/gi, '.').replace(/%40/g, '@');
  src = src.replace(/([a-z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\{at\}|\s+at\s+)\s*([a-z0-9-]+(?:\s*(?:\[dot\]|\(dot\)|\{dot\}|\s+dot\s+|\.)\s*[a-z0-9-]+)+)/gi,
    (m, u, d) => /\[|\(|\{/.test(m) ? `${u}@${d.replace(/\s*(?:\[dot\]|\(dot\)|\{dot\}|\s+dot\s+)\s*/gi, '.')}` : m);
  const found = new Set();
  for (const e0 of [...cf, ...(src.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])]) {
    const e = String(e0).toLowerCase().trim().replace(/^u003e/, '').replace(/^mailto:/, '');
    if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !badEmail.test(e) && e.length < 60) found.add(e);
  }
  return [...found];
}

// Look for an email on the home page, then on the contact / about pages, trying http/https and www variants
async function findEmails(website) {
  const out = { emails: [], html: '', contactHtml: '' };
  let base = String(website || '').trim(); if (!base) return out;
  if (!/^https?:/i.test(base)) base = 'https://' + base;
  const variants = [base];
  try { const u = new URL(base); const alt = new URL(base); alt.protocol = u.protocol === 'https:' ? 'http:' : 'https:'; variants.push(alt.href); const w = new URL(base); w.hostname = u.hostname.startsWith('www.') ? u.hostname.slice(4) : 'www.' + u.hostname; variants.push(w.href); } catch (e) {}
  let home = '', root = base;
  for (const v of variants) { home = await getHtml(v); if (home.length > 300) { root = v; break; } }
  out.html = home;
  const add = h => { for (const e of emailsFrom(h)) if (!out.emails.includes(e)) out.emails.push(e); };
  add(home);
  if (out.emails.length) return out;
  const r = root.replace(/\/$/, '');
  const pages = [...new Set([contactUrl(root, home), r + '/contact', r + '/contact-us', r + '/about', r + '/about-us'])].slice(0, 5);
  for (const p of pages) {
    const h = await getHtml(p);
    if (!out.contactHtml && h) out.contactHtml = h;
    add(h);
    if (out.emails.length) { out.contactHtml = h; break; }
  }
  return out;
}

// Last resort: info@their-domain, but only if that domain can receive email at all (it has MX records)
async function guessEmail(domain) {
  const d = String(domain || '').replace(/^www\./, '').toLowerCase();
  if (!d || /(^|\.)(gmail|yahoo|hotmail|outlook|facebook|instagram|wix|wixsite|business\.site|blogspot|wordpress)\./.test(d + '.')) return '';
  if (MOCK) return 'info@' + d;
  return (await hasMx(d)) ? 'info@' + d : '';
}
// Does the domain accept email? The PC's own DNS server can be unreachable for Node (e.g. a router at fe80::1),
// so fall back to public DNS servers, then to Google's DNS-over-HTTPS.
async function hasMx(d) {
  const dns = require('dns').promises;
  try { const mx = await dns.resolveMx(d); return !!(mx && mx.length); } catch (e) { if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') return false; }
  try { const r = new dns.Resolver({ timeout: 5000, tries: 1 }); r.setServers(['1.1.1.1', '8.8.8.8']); const mx = await r.resolveMx(d); return !!(mx && mx.length); } catch (e) { if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') return false; }
  try { const j = await (await fetch(`https://dns.google/resolve?name=${encodeURIComponent(d)}&type=MX`, { signal: AbortSignal.timeout(10000) })).json(); return (j.Answer || []).some(a => a.type === 15); } catch (e) { return false; }
}
const strip = html => String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;|&#\d+;|&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const domainOf = u => { try { const s = String(u || '').trim(); return new URL(s.startsWith('http') ? s : 'https://' + s).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } };

function checkSite(website, html) {
  const low = html.toLowerCase(); const year = new Date().getFullYear();
  const years = [...low.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/g)].map(m => +m[1]);
  const copyrightYear = years.length ? Math.max(...years) : null;
  return {
    websiteLoaded: html.length > 500, usesHttps: website.startsWith('https'),
    hasPageTitle: /<title[^>]*>[^<]{3,}<\/title>/i.test(html),
    hasMetaDescription: /<meta[^>]+name=["']description["'][^>]*content=["'][^"']{20,}/i.test(html) || /<meta[^>]+content=["'][^"']{20,}["'][^>]*name=["']description["']/i.test(html),
    hasMobileViewportTag: /<meta[^>]+name=["']viewport["']/i.test(html),
    h1HeadingCount: (low.match(/<h1[\s>]/g) || []).length,
    hasGoogleAnalytics: /gtag\(|googletagmanager|google-analytics/.test(low),
    hasMetaPixel: /fbq\(|connect\.facebook\.net/.test(low),
    hasStructuredData: /application\/ld\+json/.test(low),
    hasBlog: /href=["'][^"']*\/(blog|news|articles|insights)/.test(low),
    hasWhatsAppButton: /wa\.me|api\.whatsapp\.com/.test(low),
    hasOnlineBooking: /calendly|book (a|an|your|now)|appointment|booking/.test(low),
    builtWith: /wp-content/.test(low) ? 'WordPress' : /wixstatic|wix\.com/.test(low) ? 'Wix' : /cdn\.shopify|shopify/.test(low) ? 'Shopify' : /squarespace/.test(low) ? 'Squarespace' : 'Other/Custom',
    homepageSizeKB: Math.round(html.length / 1024), footerYear: copyrightYear, footerLooksOutdated: copyrightYear ? copyrightYear < year - 1 : false,
  };
}
function contactUrl(website, html) {
  const href = (html.match(/href=["']([^"'#]*(?:contact|kontakt|contacto|contato|contatti|contactez)[^"']*)["']/i) || [])[1];
  try { if (href && !/^mailto:|^tel:/i.test(href)) return new URL(href, website).href; } catch (e) {}
  return website.replace(/\/$/, '') + '/contact';
}
function linkedinIn(html) { return (String(html).match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in)\/[A-Za-z0-9_\-%.]+/i) || [''])[0]; }
function bestEmail(all, domain) {
  const pref = ['info', 'contact', 'hello', 'sales', 'office', 'enquiries', 'enquiry', 'admin', 'team', 'marketing', 'support'];
  const base = domain.split('.').slice(-2).join('.');
  const same = all.filter(e => (e.split('@')[1] || '').endsWith(base));
  const pool = (same.length ? same : all).slice();
  pool.sort((a, b) => { const ia = pref.indexOf(a.split('@')[0]), ib = pref.indexOf(b.split('@')[0]); return (ia < 0 ? 50 : ia) - (ib < 0 ? 50 : ib); });
  return pool[0] || '';
}

function mockApify(actor, input = {}) {
  // several company searches in one run (LinkedIn email search): one result page per query
  if (actor.includes('google-search') && !/site:linkedin/.test(input.queries || '')) return String(input.queries || '').split(/\n/).filter(Boolean).map(t => ({ searchQuery: { term: t }, organicResults: [{ url: 'https://www.linkedin.com/company/x' }, { url: 'https://www.' + t.replace(/"/g, '').split(' ')[0].toLowerCase() + 'co.com/' }] }));
  if (actor.includes('places')) return [
    { title: 'Demo Dental ' + Math.floor(Math.random() * 1000), website: 'https://demodental' + Math.floor(Math.random() * 1e6) + '.com', phone: '+971 4 000', city: 'Dubai', countryCode: 'AE', categoryName: 'Dentist', totalScore: 4.6, reviewsCount: 40 },
    { title: 'No Site Cafe', website: '' },
  ];
  return [{ organicResults: [{ url: 'https://www.linkedin.com/in/jane-demo-' + Math.floor(Math.random() * 1e6), title: 'Jane Demo - Founder - Demo Interiors | LinkedIn', description: 'Founder at Demo Interiors, Dubai' }] }];
}

module.exports = { useApify, mapsSearch, googleSearch, getHtml, emailsFrom, findEmails, guessEmail, hasMx, decodeCf, strip, domainOf, checkSite, contactUrl, linkedinIn, bestEmail };
