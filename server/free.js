// Free lead finding, no API key and no payment:
//  - places(): businesses from OpenStreetMap (free, open map data) plus a free web search for "industry in city"
//  - search(): free web search (DuckDuckGo, then Bing if DuckDuckGo is busy), in the same shape Apify's Google search gave
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const BOT_UA = 'AAVORAA-Lead-Agent/1.0'; // OpenStreetMap asks apps to name themselves
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => Math.round(a + Math.random() * (b - a));
const ent = s => String(s || '').replace(/[‎‏‪-‮]/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(n)).replace(/\s+/g, ' ').trim();
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

async function get(url, opts = {}) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(opts.timeout || 30000), ...opts, headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...(opts.headers || {}) } });
  return { status: res.status, text: await res.text() };
}

// ---------------------------------------------------------------- web search
function ddgParse(html) {
  const out = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="[^"]*result__a|$)/g;
  let m;
  while ((m = re.exec(html))) {
    let url = m[1].replace(/&amp;/g, '&');
    const u = url.match(/[?&]uddg=([^&]+)/); if (u) url = decodeURIComponent(u[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    if (!/^https?:/.test(url) || /duckduckgo\.com\/y\.js|ad_domain|ad_provider/.test(url)) continue;
    const sn = (m[3].match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/) || [])[1];
    out.push({ title: ent(m[2]), url, description: ent(sn) });
  }
  return out;
}
let ddgBusyUntil = 0;
// DuckDuckGo does not understand ("a" OR "b") groups: keep the first choice of each group
const simple = q => q.replace(/\(([^()]*)\)/g, (m, g) => g.split(/\s+OR\s+/i)[0].trim()).replace(/"([^"\s]+)"/g, '$1');
const blocked = html => /anomaly-modal|anomaly\.js|unfortunately, bots|challenge-form|g-recaptcha|hcaptcha/i.test(html);
// In the Windows app the search runs in a hidden normal browser window (like a person searching); outside it, a plain request.
async function ddgHtml(q) {
  const url = 'https://html.duckduckgo.com/html/?' + new URLSearchParams({ q, kl: 'wt-wt' });
  if (global.pageHtml) return global.pageHtml(url, 1500);
  return (await get(url, { headers: { Referer: 'https://html.duckduckgo.com/' } })).text;
}
async function ddg(q) {
  const html = await ddgHtml(q);
  if (!html || blocked(html)) { ddgBusyUntil = Date.now() + 45 * 60e3; return null; } // asked to slow down: wait, never try to get around it
  return ddgParse(html);
}
let lastSearch = 0;
async function searchOne(q) {
  if (Date.now() < ddgBusyUntil) throw new Error('The free web search asked us to slow down. It is tried again in about ' + Math.ceil((ddgBusyUntil - Date.now()) / 60e3) + ' minutes.');
  const gap = 9000 - (Date.now() - lastSearch); if (gap > 0) await sleep(gap + rand(0, 4000)); // slow and polite
  lastSearch = Date.now(); meter.add('search', 'ddg');
  let res = await ddg(simple(q));
  if (res && !res.length && /\bOR\b/.test(q)) { await sleep(rand(8000, 12000)); lastSearch = Date.now(); res = await ddg(q.replace(/[()]/g, '')); }
  if (!res) throw new Error('The free web search asked us to slow down. It is tried again in about 45 minutes.');
  return res;
}
// queries: one per line (like Apify's Google search). Returns [{ searchQuery: { term }, organicResults: [{ title, url, description }] }]
async function search(queries) {
  const list = String(queries || '').split(/\n/).map(s => s.trim()).filter(Boolean);
  const out = [];
  let err = null;
  for (const term of list) {
    let res = [];
    try { res = await searchOne(term); } catch (e) { err = e; if (Date.now() < ddgBusyUntil) break; }
    out.push({ searchQuery: { term }, organicResults: res });
  }
  if (err && !out.some(o => o.organicResults.length)) throw err;
  return out;
}
async function testSearch() { const r = await searchOne('coffee shop London'); if (!r.length) throw new Error('The free web search returned nothing. Check the internet connection and try again in a few minutes.'); return r.length; }

// ---------------------------------------------------------------- OpenStreetMap businesses
// common words -> OpenStreetMap tags; anything else is matched against business names and tag values
const OSM = {
  'real estate': ['office=estate_agent'], 'interior': ['shop=interior_decoration', 'craft=interior_work', 'office=interior_design'], architect: ['office=architect'],
  construction: ['office=construction_company', 'craft=builder'], dental: ['amenity=dentist', 'healthcare=dentist'], dentist: ['amenity=dentist'],
  aesthetic: ['shop=beauty', 'amenity=clinic'], skin: ['amenity=clinic', 'shop=beauty'], physiotherapy: ['healthcare=physiotherapist'], physio: ['healthcare=physiotherapist'],
  hospital: ['amenity=hospital'], clinic: ['amenity=clinic', 'amenity=doctors'], veterinary: ['amenity=veterinary'], vet: ['amenity=veterinary'],
  school: ['amenity=school'], coaching: ['amenity=prep_school', 'amenity=training'], training: ['amenity=training', 'office=educational_institution'],
  restaurant: ['amenity=restaurant'], cafe: ['amenity=cafe'], bakery: ['shop=bakery'], hotel: ['tourism=hotel'], resort: ['tourism=hotel', 'leisure=resort'],
  travel: ['shop=travel_agency', 'office=travel_agent'], law: ['office=lawyer'], lawyer: ['office=lawyer'], accounting: ['office=accountant'], accountant: ['office=accountant'],
  consultant: ['office=consulting'], recruitment: ['office=employment_agency'], logistics: ['office=logistics', 'office=courier'], manufacturer: ['man_made=works', 'craft=*'],
  textile: ['shop=fabric', 'craft=tailor'], furniture: ['shop=furniture'], jewellery: ['shop=jewelry'], jewelry: ['shop=jewelry'], fashion: ['shop=clothes', 'shop=boutique'], boutique: ['shop=boutique', 'shop=clothes'],
  gym: ['leisure=fitness_centre'], fitness: ['leisure=fitness_centre'], yoga: ['leisure=fitness_centre', 'sport=yoga'], salon: ['shop=hairdresser', 'shop=beauty'], spa: ['leisure=spa', 'shop=massage', 'amenity=spa'],
  'car dealer': ['shop=car'], auto: ['shop=car_repair'], 'car repair': ['shop=car_repair'], solar: ['craft=photovoltaic', 'office=energy_supplier'], hvac: ['craft=hvac'],
  cleaning: ['office=cleaning', 'shop=dry_cleaning'], 'pest control': ['office=pest_control'], event: ['office=event_management'], wedding: ['shop=wedding', 'office=event_management'],
  photography: ['craft=photographer', 'shop=photo'], printing: ['shop=copyshop', 'craft=printer'], marketing: ['office=advertising_agency'], software: ['office=it', 'office=software'], it: ['office=it'],
  insurance: ['office=insurance'], pharmacy: ['amenity=pharmacy'], optician: ['shop=optician'], florist: ['shop=florist'], pet: ['shop=pet'], 'real-estate': ['office=estate_agent'],
};
function tagsFor(industry) {
  const i = String(industry).toLowerCase(), tags = new Set();
  const generic = ['clinic', 'training', 'consultant', 'it'];
  const hits = Object.keys(OSM).filter(k => new RegExp('\\b' + k.replace(/[-]/g, '.') + '\\b').test(i));
  const specific = hits.filter(k => !generic.includes(k));
  (specific.length ? specific : hits).forEach(k => OSM[k].forEach(t => tags.add(t))); // "dental clinic" = dentists, not every clinic
  return [...tags];
}
const cityCache = {};
async function cityArea(city) {
  if (cityCache[city]) return cityCache[city];
  const r = await get('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ q: city, format: 'json', limit: '5', addressdetails: '1' }), { headers: { 'User-Agent': BOT_UA } });
  const list = JSON.parse(r.text || '[]');
  const best = list.find(x => x.osm_type === 'relation') || list[0];
  if (!best) throw new Error(`Could not find "${city}" on the map.`);
  const bb = best.boundingbox.map(Number); // [south, north, west, east]
  return (cityCache[city] = { center: [Number(best.lat), Number(best.lon)], area: best.osm_type === 'relation' ? 3600000000 + Number(best.osm_id) : 0, bbox: `${bb[0]},${bb[2]},${bb[1]},${bb[3]}`, country: String((best.address && best.address.country_code) || '').toUpperCase() });
}
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
async function overpass(q) {
  let last;
  for (const url of OVERPASS.slice(0, 3)) {
    try {
      const r = await get(url, { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'User-Agent': BOT_UA, Accept: '*/*', 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 55000 });
      if (r.status === 200) return JSON.parse(r.text).elements || [];
      last = new Error('map search busy (' + r.status + ')'); if (process.env.FREE_DEBUG) console.log(url, r.status, r.text.slice(0, 200));
    } catch (e) { last = e; if (process.env.FREE_DEBUG) console.log(url, e.message); }
  }
  throw last || new Error('map search failed');
}
async function osmPlaces(industry, city) {
  const c = await cityArea(city);
  const scope = `(${c.bbox})`;
  const tags = tagsFor(industry);
  const words = String(industry).toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3 && !/company|services|store|clinic|agency|firm|studio|institute|contractor/.test(w));
  const web = '[~"^(website|contact:website|url)$"~"."]';
  const parts = tags.map(t => { const [k, v] = t.split('='); return `nwr${scope}["${k}"${v === '*' ? '' : `="${v}"`}]${web};`; });
  if (words.length && !tags.length) parts.push(`nwr${scope}["name"~"${words.join('|')}",i]${web};`); // name search is slow: only when no map category fits
  if (!parts.length) return [];
  const q = `[out:json][timeout:45];(${parts.join('')});out tags center 300;`;
  const els = await overpass(q);
  return els.map(e => {
    const t = e.tags || {};
    const site = t.website || t['contact:website'] || t.url || '';
    const cat = Object.entries(t).find(([k]) => ['shop', 'amenity', 'office', 'craft', 'healthcare', 'tourism', 'leisure'].includes(k));
    return { source: 'OpenStreetMap', title: t.name || t['name:en'] || '', website: site.split(/[;\s]/)[0], phone: t.phone || t['contact:phone'] || '', emails: [t.email, t['contact:email']].filter(Boolean),
      city: t['addr:city'] || city, countryCode: c.country, categoryName: cat ? String(cat[1]).replace(/_/g, ' ') : industry };
  }).filter(p => p.title && p.website);
}
// directories and big platforms are not the business itself
const NOT_BUSINESS = /(^|\.)(google|facebook|instagram|linkedin|twitter|x|youtube|tiktok|pinterest|wikipedia|yelp|tripadvisor|justdial|indiamart|sulekha|yellowpages|yell|bark|houzz|thumbtack|angi|nextdoor|trustpilot|clutch|glassdoor|indeed|booking|expedia|agoda|zomato|swiggy|ubereats|deliveroo|talabat|opentable|practo|lybrate|zocdoc|healthgrades|bayut|propertyfinder|dubizzle|99acres|magicbricks|housing|zillow|realtor|rightmove|zoopla|amazon|ebay|alibaba|reddit|quora|medium|bing|duckduckgo|apple|maps|timeout|foursquare|cylex|hotfrog|bizcommunity|yelu|top10|bestof|threebestrated|expertise|tradeindia|crunchbase|zoominfo|dnb|wedmegood|weddingwire|theknot|mapquest|waze|yahoo|msn|blogspot|wordpress|wix|weebly|linktr|jooble|bayt|gulftalent|naukrigulf|monster|naukri|justlife|servicemarket|getthat|whatclinic|okadoc|bookimed|dentaldepartures)\.[a-z.]+$/;
async function webPlaces(industry, city) {
  const pages = await search(`${industry} in ${city}\n${industry} ${city} contact us`);
  const out = [], seen = new Set();
  for (const pg of pages) for (const r of pg.organicResults || []) {
    let host = ''; try { host = new URL(r.url).hostname.replace(/^www\./, ''); } catch (e) { continue; }
    const words = String(industry + ' ' + city).toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3);
    const txt = (r.title + ' ' + r.description + ' ' + host).toLowerCase();
    if (!words.some(w => txt.includes(w)) || /(porn|sex|xxx|casino|betting|escort|adult)/.test(txt)) continue;
    if (!host || seen.has(host) || NOT_BUSINESS.test(host) || /^\d+\s|\b(best|top|ranked|cheapest|reviews?|list of|directory|near me|compare)\b/i.test(r.title)) continue; // lists and directories, not a business
    seen.add(host);
    let name = String(r.title).split(/\s[|\-–—:]\s/)[0].trim();
    if (!name || /^(contact|home|about|welcome|book|our |get in touch)/i.test(name)) name = host.split('.')[0].replace(/[-_]/g, ' ').replace(/\w/g, x => x.toUpperCase());
    out.push({ source: 'Web search', title: name, website: 'https://' + host + '/', phone: '', emails: [], city, countryCode: '', categoryName: industry });
  }
  return out;
}
// ---------------------------------------------------------------- lead sources with a free API key (each optional)
// Google Places, TomTom, Geoapify and HERE all have free monthly/daily allowances; a source is used only once its key is saved.
const config = require('./config');
const meter = require('./usage');
const keyOf = k => String(config.get()[k] || '').trim();
const norm = (source, o) => ({ source, title: o.title || '', website: String(o.website || '').split(/[;\s]/)[0], phone: o.phone || '', emails: (o.emails || []).filter(Boolean), city: o.city || '', countryCode: String(o.countryCode || '').toUpperCase(), categoryName: o.category || '', totalScore: o.rating ?? '', reviewsCount: o.reviews ?? '' });
async function googlePlaces(industry, city) {
  const key = keyOf('googlePlacesKey'); if (!key) return [];
  const out = []; let pageToken = '';
  for (let i = 0; i < 3; i++) {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.displayName,places.websiteUri,places.internationalPhoneNumber,places.rating,places.userRatingCount,places.primaryTypeDisplayName,places.addressComponents,nextPageToken' },
      body: JSON.stringify({ textQuery: `${industry} in ${city}`, pageSize: 20, ...(pageToken ? { pageToken } : {}) }) });
    const j = await r.json().catch(() => ({})); meter.add('search', 'googlePlaces');
    if (!r.ok) throw new Error('Google Places: ' + ((j.error && j.error.message) || r.status));
    for (const p of j.places || []) {
      const comp = t => ((p.addressComponents || []).find(c => (c.types || []).includes(t)) || {});
      out.push(norm('Google Places', { title: p.displayName && p.displayName.text, website: p.websiteUri, phone: p.internationalPhoneNumber, rating: p.rating, reviews: p.userRatingCount, category: p.primaryTypeDisplayName && p.primaryTypeDisplayName.text, city: comp('locality').longText || city, countryCode: comp('country').shortText }));
    }
    if (!j.nextPageToken) break; pageToken = j.nextPageToken; await sleep(2000);
  }
  return out;
}
async function tomtom(industry, city) {
  const key = keyOf('tomtomKey'); if (!key) return [];
  const r = await fetch(`https://api.tomtom.com/search/2/search/${encodeURIComponent(industry + ' ' + city)}.json?` + new URLSearchParams({ key, limit: '100', idxSet: 'POI' }), { signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({})); meter.add('search', 'tomtom');
  if (!r.ok) throw new Error('TomTom: ' + ((j.errorText || (j.error && j.error.description)) || r.status));
  return (j.results || []).map(x => norm('TomTom', { title: x.poi && x.poi.name, website: x.poi && x.poi.url && (/^https?:/.test(x.poi.url) ? x.poi.url : 'https://' + x.poi.url), phone: x.poi && x.poi.phone, category: x.poi && (x.poi.categories || [])[0], city: x.address && x.address.municipality, countryCode: x.address && x.address.countryCode }));
}
const GEO_CAT = { 'amenity=dentist': 'healthcare.dentist', 'healthcare=dentist': 'healthcare.dentist', 'amenity=clinic': 'healthcare.clinic_or_praxis', 'amenity=doctors': 'healthcare.clinic_or_praxis', 'amenity=hospital': 'healthcare.hospital', 'amenity=veterinary': 'pet.veterinary', 'amenity=restaurant': 'catering.restaurant', 'amenity=cafe': 'catering.cafe', 'shop=bakery': 'commercial.food_and_drink.bakery', 'tourism=hotel': 'accommodation.hotel', 'shop=travel_agency': 'service.travel_agency', 'shop=furniture': 'commercial.furniture_and_interior', 'shop=interior_decoration': 'commercial.furniture_and_interior', 'shop=jewelry': 'commercial.jewelry', 'shop=clothes': 'commercial.clothing', 'shop=boutique': 'commercial.clothing', 'leisure=fitness_centre': 'sport.fitness', 'shop=hairdresser': 'service.beauty.hairdresser', 'shop=beauty': 'service.beauty', 'leisure=spa': 'service.beauty.spa', 'shop=car': 'commercial.vehicle', 'shop=car_repair': 'service.vehicle.repair', 'amenity=school': 'education.school', 'amenity=pharmacy': 'healthcare.pharmacy', 'shop=optician': 'commercial.health_and_beauty.optician', 'shop=florist': 'commercial.florist', 'office=estate_agent': 'office.estate_agent', 'office=lawyer': 'office.lawyer', 'office=accountant': 'office.accountant', 'office=it': 'office.it', 'office=insurance': 'office.insurance' };
async function geoapify(industry, city) {
  const key = keyOf('geoapifyKey'); if (!key) return [];
  const cats = [...new Set(tagsFor(industry).map(t => GEO_CAT[t]).filter(Boolean))];
  if (!cats.length) return [];
  const g = await (await fetch('https://api.geoapify.com/v1/geocode/search?' + new URLSearchParams({ text: city, type: 'city', limit: '1', apiKey: key }), { signal: AbortSignal.timeout(30000) })).json().catch(() => ({}));
  const pid = g.features && g.features[0] && g.features[0].properties.place_id; meter.add('search', 'geoapify');
  if (!pid) throw new Error('Geoapify: city not found (check the key)');
  const r = await fetch('https://api.geoapify.com/v2/places?' + new URLSearchParams({ categories: cats.join(','), filter: 'place:' + pid, limit: '200', apiKey: key }), { signal: AbortSignal.timeout(40000) });
  const j = await r.json().catch(() => ({})); meter.add('search', 'geoapify');
  if (!r.ok) throw new Error('Geoapify: ' + (j.message || r.status));
  return (j.features || []).map(f => { const p = f.properties || {}, raw = (p.datasource && p.datasource.raw) || {}; return norm('Geoapify', { title: p.name, website: p.website || raw.website || raw['contact:website'], phone: (p.contact && p.contact.phone) || raw.phone, emails: [(p.contact && p.contact.email) || raw.email], category: (p.categories || [])[0], city: p.city || city, countryCode: p.country_code }); });
}
async function here(industry, city) {
  const key = keyOf('hereKey'); if (!key) return [];
  const c = await cityArea(city).catch(() => null);
  const at = c && c.center ? `${c.center[0]},${c.center[1]}` : '';
  const r = await fetch('https://discover.search.hereapi.com/v1/discover?' + new URLSearchParams({ q: `${industry} ${city}`, limit: '100', apiKey: key, ...(at ? { at } : { qq: 'city=' + city }) }), { signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({})); meter.add('search', 'here');
  if (!r.ok) throw new Error('HERE: ' + (j.title || j.error_description || r.status));
  return (j.items || []).map(x => { const ct = (x.contacts || [])[0] || {}; const v = k => ((ct[k] || [])[0] || {}).value; return norm('HERE', { title: x.title, website: v('www'), phone: v('phone') || v('mobile'), emails: [v('email')], category: ((x.categories || [])[0] || {}).name, city: x.address && x.address.city, countryCode: x.address && x.address.countryCode }); });
}
const KEY_SOURCES = { googlePlaces: ['googlePlacesKey', googlePlaces], tomtom: ['tomtomKey', tomtom], geoapify: ['geoapifyKey', geoapify], here: ['hereKey', here] };
async function testSource(name) {
  const [k, fn] = KEY_SOURCES[name] || []; if (!fn) throw new Error('Unknown source');
  if (!keyOf(k)) throw new Error('Paste the key first.');
  const r = await fn('restaurant', 'London');
  return `${r.length} businesses found for a test search (${r.filter(x => x.website).length} with a website).`;
}

async function places(industry, city, max = 10) {
  const named = [['OpenStreetMap', osmPlaces], ['Web search', webPlaces], ...Object.entries(KEY_SOURCES).filter(([, [k]]) => keyOf(k)).map(([n, [, fn]]) => [n, fn])];
  const res = await Promise.allSettled(named.map(([n, fn]) => fn(industry, city).then(v => { meter.add('sourceLeads', n, v.length); return v; })));
  const lists = res.map(r => (r.status === 'fulfilled' ? r.value : []).filter(p => p.title && p.website));
  if (res[0].status === 'fulfilled') meter.add('search', 'osm');
  for (const [i, r] of res.entries()) if (r.status === 'rejected') console.warn(`[find] ${named[i][0]}: ${r.reason.message}`);
  if (!lists.some(l => l.length)) throw new Error('Lead finding found nothing: ' + (res.filter(r => r.status === 'rejected').map(r => r.reason.message).join('; ') || 'no businesses with a website'));
  // mix the sources (one from each in turn) so no single source fills the day; key sources + map first, web search last
  const order = [...lists.slice(2), shuffle(lists[0]), lists[1]].filter(l => l.length), out = [];
  for (let i = 0; out.length < Math.max(max * 4, 40) && order.some(l => i < l.length); i++) for (const l of order) if (l[i]) out.push(l[i]);
  return out;
}
module.exports = { places, search, testSearch, testSource, KEY_SOURCES, _t: { ddgParse, tagsFor, osmPlaces, webPlaces, searchOne } };
