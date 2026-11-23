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
const mapsSearch = (industry, city, max) => apify('compass~crawler-google-places', { searchStringsArray: [industry], locationQuery: city, maxCrawledPlacesPerSearch: max, language: 'en', skipClosedPlaces: true });
const googleSearch = (query) => apify('apify~google-search-scraper', { queries: query, maxPagesPerQuery: 1, resultsPerPage: 20, mobileResults: false, saveHtml: false, saveHtmlToKeyValueStore: false });

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
function emailsFrom(html) {
  const found = new Set();
  for (const m of String(html || '').matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const e = m[0].toLowerCase().replace(/^u003e/, '');
    if (!badEmail.test(e) && e.length < 60) found.add(e);
  }
  return [...found];
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

function mockApify(actor) {
  if (actor.includes('places')) return [
    { title: 'Demo Dental ' + Math.floor(Math.random() * 1000), website: 'https://demodental' + Math.floor(Math.random() * 1e6) + '.com', phone: '+971 4 000', city: 'Dubai', countryCode: 'AE', categoryName: 'Dentist', totalScore: 4.6, reviewsCount: 40 },
    { title: 'No Site Cafe', website: '' },
  ];
  return [{ organicResults: [{ url: 'https://www.linkedin.com/in/jane-demo-' + Math.floor(Math.random() * 1e6), title: 'Jane Demo - Founder - Demo Interiors | LinkedIn', description: 'Founder at Demo Interiors, Dubai' }] }];
}

module.exports = { mapsSearch, googleSearch, getHtml, emailsFrom, strip, domainOf, checkSite, contactUrl, linkedinIn, bestEmail };
