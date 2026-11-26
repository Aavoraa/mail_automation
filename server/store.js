// Google Sheets storage (service account) with a short read cache.
// A mock in-memory store is used for testing when AAVORAA_MOCK=1.
const { JWT } = require('google-auth-library');
const { TABS, SETTINGS, DEFAULT_TEMPLATES } = require('./schema');
const config = require('./config');

const colLetter = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const q = t => `'${String(t).replace(/'/g, "''")}'`;

class SheetStore {
  constructor() { this.cache = {}; this.client = null; this.key = null; this.queue = Promise.resolve(); }

  get sheetId() {
    const url = String(config.get().sheetUrl || '');
    const m = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : url.trim();
  }
  async token() {
    const sa = config.get().serviceAccount;
    if (!sa) throw new Error('Google Sheet is not connected yet.');
    const key = sa.client_email + sa.private_key.length;
    if (!this.client || this.key !== key) {
      this.client = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
      this.key = key;
    }
    const t = await this.client.getAccessToken();
    return t.token;
  }
  async api(method, path, body, attempt = 0) {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}${path}`, {
      method, headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000), // never wait forever
    });
    if (res.status === 429 && attempt < 4) { await new Promise(r => setTimeout(r, 15000 * (attempt + 1))); return this.api(method, path, body, attempt + 1); }
    const text = await res.text();
    if (!res.ok) {
      let msg = text; try { msg = JSON.parse(text).error.message; } catch (e) {}
      if (res.status === 403) msg += ' (Share the Google Sheet with the service account email as Editor.)';
      if (res.status === 404) msg = 'Google Sheet not found. Check the sheet link.';
      throw new Error('Google Sheets: ' + msg);
    }
    return text ? JSON.parse(text) : {};
  }
  // serialize writes so row numbers stay correct
  serial(fn) { const p = this.queue.then(fn, fn); this.queue = p.catch(() => {}); return p; }

  async meta() { return this.api('GET', '?fields=properties.title,sheets.properties'); }

  async ensureTabs() {
    const m = await this.meta();
    const have = new Set(m.sheets.map(s => s.properties.title));
    const missing = Object.keys(TABS).filter(t => !have.has(t));
    if (missing.length) await this.api('POST', ':batchUpdate', { requests: missing.map(title => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) });
    for (const [tab, cols] of Object.entries(TABS)) {
      const r = await this.api('GET', `/values/${encodeURIComponent(q(tab) + '!1:1')}`);
      const head = (r.values && r.values[0]) || [];
      const add = cols.filter(c => !head.includes(c));
      if (add.length) {
        const all = head.concat(add);
        await this.api('PUT', `/values/${encodeURIComponent(q(tab) + '!A1')}?valueInputOption=RAW`, { values: [all] });
      }
    }
    await this.seedDefaults();
    return { title: m.properties.title };
  }
  // default settings and templates (both storages)
  async seedDefaults() {
    const settings = await this.read('Settings', true);
    const keys = new Set(settings.map(r => r.Key));
    const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    const newRows = SETTINGS.filter(s => !keys.has(s[0])).map(s => ({ Key: s[0], Value: s[0] === 'START_DATE' ? today : s[1], 'What it means': s[2] }));
    if (newRows.length) await this.append('Settings', newRows);
    const tpl = await this.read('Templates', true);
    if (!tpl.length) await this.append('Templates', DEFAULT_TEMPLATES.map((t, i) => ({ 'Template ID': 'T' + (i + 1), ...t, 'Created By': 'system', 'Updated On': today })));
    this.cache = {};
  }

  async headers(tab) {
    const r = await this.api('GET', `/values/${encodeURIComponent(q(tab) + '!1:1')}`);
    return (r.values && r.values[0]) || [];
  }

  async read(tab, fresh = false) {
    const c = this.cache[tab];
    if (!fresh && c && Date.now() - c.at < 20000) return c.rows;
    const r = await this.api('GET', `/values/${encodeURIComponent(q(tab))}?valueRenderOption=FORMATTED_VALUE`);
    const values = r.values || [];
    const head = values[0] || [];
    const rows = [];
    for (let i = 1; i < values.length; i++) {
      const o = { _row: i + 1 };
      head.forEach((h, j) => { if (h) o[h] = values[i][j] ?? ''; });
      if (Object.keys(o).some(k => k !== '_row' && String(o[k]).trim() !== '')) rows.push(o);
    }
    this.cache[tab] = { at: Date.now(), rows, head };
    return rows;
  }

  append(tab, objects) {
    if (!objects.length) return Promise.resolve(0);
    return this.serial(async () => {
      const head = await this.headers(tab);
      const values = objects.map(o => head.map(h => (o[h] === undefined || o[h] === null) ? '' : String(o[h])));
      await this.api('POST', `/values/${encodeURIComponent(q(tab) + '!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { values });
      delete this.cache[tab];
      return objects.length;
    });
  }

  // patches: [{ match: {key: value}, set: {col: value} }]
  update(tab, keyCol, patches) {
    if (!patches.length) return Promise.resolve(0);
    return this.serial(async () => {
      const head = await this.headers(tab);
      const rows = await this.read(tab, true);
      const data = [];
      for (const p of patches) {
        const row = rows.find(r => String(r[keyCol]) === String(p.key));
        if (!row) continue;
        for (const [col, val] of Object.entries(p.set)) {
          const j = head.indexOf(col);
          if (j < 0) continue;
          data.push({ range: `${q(tab)}!${colLetter(j)}${row._row}`, values: [[val === undefined || val === null ? '' : String(val)]] });
        }
      }
      if (data.length) await this.api('POST', '/values:batchUpdate', { valueInputOption: 'RAW', data });
      delete this.cache[tab];
      return data.length;
    });
  }

  async settings() {
    const rows = await this.read('Settings');
    const s = {};
    for (const r of rows) if (r.Key) s[String(r.Key).trim()] = String(r.Value ?? '').trim();
    for (const d of SETTINGS) if (!(d[0] in s)) s[d[0]] = d[1];
    return s;
  }
  async saveSettings(obj) {
    const rows = await this.read('Settings', true);
    const have = new Set(rows.map(r => r.Key));
    const patches = Object.entries(obj).filter(([k]) => have.has(k)).map(([k, v]) => ({ key: k, set: { Value: v } }));
    await this.update('Settings', 'Key', patches);
    const add = Object.entries(obj).filter(([k]) => !have.has(k)).map(([k, v]) => ({ Key: k, Value: v, 'What it means': (SETTINGS.find(s => s[0] === k) || [])[2] || '' }));
    if (add.length) await this.append('Settings', add);
  }
}

// ---------------------------------------------------------------- mock (tests)
class MockStore extends SheetStore {
  constructor() { super(); this.tabs = {}; for (const [t, cols] of Object.entries(TABS)) this.tabs[t] = { head: cols.slice(), rows: [] }; }
  async ensureTabs() {
    const s = this.tabs.Settings;
    if (!s.rows.length) {
      const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
      s.rows = SETTINGS.map(x => ({ Key: x[0], Value: x[0] === 'START_DATE' ? today : x[1], 'What it means': x[2] }));
      this.tabs.Templates.rows = DEFAULT_TEMPLATES.map((t, i) => ({ 'Template ID': 'T' + (i + 1), ...t, 'Created By': 'system', 'Updated On': today }));
    }
    return { title: 'Mock sheet' };
  }
  async headers(tab) { return this.tabs[tab].head; }
  async read(tab) { return this.tabs[tab].rows.map((r, i) => ({ ...r, _row: i + 2 })); }
  async append(tab, objects) { for (const o of objects) { const r = {}; for (const h of this.tabs[tab].head) r[h] = o[h] === undefined ? '' : String(o[h]); this.tabs[tab].rows.push(r); } return objects.length; }
  async update(tab, keyCol, patches) {
    let n = 0;
    for (const p of patches) { const r = this.tabs[tab].rows.find(x => String(x[keyCol]) === String(p.key)); if (r) { for (const [k, v] of Object.entries(p.set)) if (this.tabs[tab].head.includes(k)) { r[k] = String(v ?? ''); n++; } } }
    return n;
  }
}

// Where the data lives: the Google Sheet, or Supabase once it is chosen on the Connections page (checked on every call)
function router() {
  const sheet = new SheetStore();
  let supa = null;
  const pick = () => config.get().storage === 'supabase' ? (supa = supa || new (require('./supabase')(SheetStore))()) : sheet;
  const r = { sheet, supabase: () => (supa = supa || new (require('./supabase')(SheetStore))()), kind: () => (config.get().storage === 'supabase' ? 'supabase' : 'sheet') };
  for (const m of ['ensureTabs', 'headers', 'read', 'append', 'update', 'settings', 'saveSettings', 'seedDefaults']) r[m] = (...a) => pick()[m](...a);
  return r;
}
module.exports = process.env.AAVORAA_MOCK === '1' && process.env.AAVORAA_MOCK_SUPABASE !== '1' ? new MockStore() : router();
