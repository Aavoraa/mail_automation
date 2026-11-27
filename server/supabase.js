// Supabase (Postgres) storage. Same tabs and columns as the Google Sheet, one table per tab:
//   "Raw Leads" -> table aav_raw_leads, column "Lead ID" -> lead_id (all text), plus row_no (order of the rows).
// The app creates and updates the tables itself through one small helper function (aav_exec) that you add once
// in the Supabase SQL Editor (SETUP_SQL below). Tables have Row Level Security on, so only the secret key can read them.
const { TABS } = require('./schema');
const config = require('./config');

const snake = h => String(h).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const table = tab => 'aav_' + snake(tab);
const COLS = {}; for (const [tab, cols] of Object.entries(TABS)) COLS[tab] = cols.map(h => [h, snake(h)]);
const ident = s => '"' + String(s).replace(/"/g, '""') + '"';

const SETUP_SQL = `-- AAVORAA Lead Agent: run this once in Supabase -> SQL Editor -> New query -> Run
create or replace function public.aav_exec(q text) returns void
language plpgsql security definer set search_path = public as $$
begin execute q; end; $$;
revoke all on function public.aav_exec(text) from public, anon, authenticated;
grant execute on function public.aav_exec(text) to service_role;`;

function ddl() {
  const out = [];
  for (const [tab, cols] of Object.entries(COLS)) {
    const t = 'public.' + ident(table(tab));
    out.push(`create table if not exists ${t} (row_no bigint generated always as identity primary key)`);
    for (const [, c] of cols) out.push(`alter table ${t} add column if not exists ${ident(c)} text not null default ''`);
    out.push(`alter table ${t} enable row level security`);
    // only the app (secret key) may use these tables, whatever the project's "grant API access" setting is
    out.push(`grant select, insert, update, delete on table ${t} to service_role`);
    out.push(`revoke all on table ${t} from anon, authenticated`);
  }
  out.push(`notify pgrst, 'reload schema'`);
  return out.join(';\n') + ';';
}

// role inside a legacy JWT key (anon / service_role); new keys start with sb_secret_ / sb_publishable_
function keyRole(k) {
  if (/^sb_secret_/.test(k)) return 'service_role';
  if (/^sb_publishable_/.test(k)) return 'anon';
  try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString('utf8')).role || ''; } catch (e) { return ''; }
}

module.exports = SheetStore => class SupabaseStore extends SheetStore {
  get base() { return String(config.get().supabaseUrl || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, ''); }
  async api(method, path, body, extra = {}, attempt = 0) {
    const key = String(config.get().supabaseKey || '');
    if (!this.base || !key) throw new Error('Supabase is not connected yet (Connections page).');
    const headers = { apikey: key, 'Content-Type': 'application/json', ...extra };
    if (/^eyJ/.test(key)) headers.Authorization = 'Bearer ' + key;
    let res;
    try { res = await fetch(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) }); }
    catch (e) { if (attempt < 3) { await new Promise(r => setTimeout(r, 4000 * (attempt + 1))); return this.api(method, path, body, extra, attempt + 1); } throw new Error('Supabase: could not connect (' + e.message + ')'); }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await new Promise(r => setTimeout(r, 5000 * (attempt + 1))); return this.api(method, path, body, extra, attempt + 1); }
    const text = await res.text();
    if (!res.ok) {
      let j = {}; try { j = JSON.parse(text); } catch (e) {}
      const msg = j.message || j.msg || j.error || text || res.status;
      const err = new Error('Supabase: ' + msg);
      err.code = j.code; err.status = res.status;
      if (res.status === 401 || /invalid api key|jwt/i.test(String(msg))) err.message = 'Supabase did not accept the key. Use the secret key (sb_secret_… or service_role) from Project Settings → API Keys.';
      else if (j.code === 'PGRST202' && /aav_exec/.test(String(msg))) err.message = 'Supabase needs the one-time setup: copy the setup SQL from the Connections page, paste it in Supabase → SQL Editor and click Run.';
      throw err;
    }
    return { data: text ? JSON.parse(text) : null, range: res.headers.get('content-range') || '' };
  }
  exec(sql) { return this.api('POST', '/rest/v1/rpc/aav_exec', { q: sql }); }

  async check() {
    const k = String(config.get().supabaseKey || '').trim();
    const role = keyRole(k);
    if (role && role !== 'service_role') throw new Error('That is the public (anon / publishable) key. Paste the secret key (sb_secret_… or service_role): Supabase → Project Settings → API Keys.');
    await this.exec('select 1');
  }
  // creates missing tables / columns, then waits until Supabase can see them
  async createTables() {
    await this.check();
    await this.exec(ddl());
    for (let i = 0; i < 15; i++) {
      try { await this.api('GET', `/rest/v1/${table('Settings')}?select=row_no&limit=1`); break; }
      catch (e) { if (e.code !== 'PGRST205' && e.status !== 404 || i === 14) throw e; await new Promise(r => setTimeout(r, 2000)); }
    }
    this.cache = {};
  }
  async ensureTabs() {
    await this.createTables();
    await this.seedDefaults();
    return { title: 'Supabase project ' + (this.base.match(/https?:\/\/([^.]+)/) || [])[1] };
  }
  async headers(tab) { return TABS[tab].slice(); }

  async read(tab, fresh = false) {
    const c = this.cache[tab];
    if (!fresh && c && Date.now() - c.at < 20000) return c.rows;
    const rows = [], step = 1000;
    for (let from = 0; ; from += step) {
      const { data } = await this.api('GET', `/rest/v1/${table(tab)}?select=*&order=row_no.asc`, undefined, { 'Range-Unit': 'items', Range: `${from}-${from + step - 1}` });
      for (const d of data || []) {
        const o = { _row: d.row_no };
        for (const [h, col] of COLS[tab]) o[h] = d[col] ?? '';
        if (Object.keys(o).some(k => k !== '_row' && String(o[k]).trim() !== '')) rows.push(o);
      }
      if (!data || data.length < step) break;
    }
    this.cache[tab] = { at: Date.now(), rows };
    return rows;
  }
  toRow(tab, o) { const r = {}; for (const [h, col] of COLS[tab]) if (o[h] !== undefined) r[col] = o[h] === null ? '' : String(o[h]); return r; }

  append(tab, objects) {
    if (!objects.length) return Promise.resolve(0);
    return this.serial(async () => {
      const all = objects.map(o => { const r = {}; for (const [h, col] of COLS[tab]) r[col] = o[h] === undefined || o[h] === null ? '' : String(o[h]); return r; });
      for (let i = 0; i < all.length; i += 500) await this.api('POST', `/rest/v1/${table(tab)}`, all.slice(i, i + 500), { Prefer: 'return=minimal' });
      delete this.cache[tab];
      return objects.length;
    });
  }
  update(tab, keyCol, patches) {
    if (!patches.length) return Promise.resolve(0);
    return this.serial(async () => {
      const rows = await this.read(tab, true);
      let n = 0;
      for (const p of patches) {
        const row = rows.find(r => String(r[keyCol]) === String(p.key)); // the first row with this key, like the Sheet
        if (!row) continue;
        const set = this.toRow(tab, p.set);
        if (!Object.keys(set).length) continue;
        await this.api('PATCH', `/rest/v1/${table(tab)}?row_no=eq.${row._row}`, set, { Prefer: 'return=minimal' });
        Object.assign(row, p.set); n += Object.keys(set).length;
      }
      delete this.cache[tab];
      return n;
    });
  }
  async count(tab) { const { range } = await this.api('GET', `/rest/v1/${table(tab)}?select=row_no&limit=1`, undefined, { Prefer: 'count=exact' }); return Number(range.split('/')[1]) || 0; }
  clear(tab) { return this.serial(async () => { await this.api('DELETE', `/rest/v1/${table(tab)}?row_no=gte.0`, undefined, { Prefer: 'return=minimal' }); delete this.cache[tab]; }); }

  // Copy everything from the Google Sheet. Tabs that already have data in Supabase are kept, except Settings and Templates
  // (Supabase starts with default ones; your own from the Sheet replace them).
  async copyFrom(sheet, log = () => {}) {
    await this.createTables();
    const out = [];
    for (const tab of Object.keys(TABS)) {
      const rows = (await sheet.read(tab, true)).map(({ _row, ...r }) => r);
      const have = await this.count(tab);
      if (have && !['Settings', 'Templates'].includes(tab)) { out.push(`${tab}: kept the ${have} rows already in Supabase`); continue; }
      if (!rows.length) { out.push(`${tab}: empty`); continue; }
      if (have) await this.clear(tab);
      await this.append(tab, rows);
      out.push(`${tab}: ${rows.length} rows copied`); log(`${tab}: ${rows.length} rows copied`);
    }
    await this.seedDefaults(); // any setting the Sheet did not have yet
    return out;
  }
};
module.exports.SETUP_SQL = SETUP_SQL;
module.exports._t = { snake, table, ddl, keyRole };
