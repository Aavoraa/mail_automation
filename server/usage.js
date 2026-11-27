// Usage meter for the Token Dashboard: AI requests and tokens, emails sent, searches on each lead source,
// leads found / analysed / emailed - counted per day (India time) and kept for 90 days on this PC.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const FILE = path.join(config.dir, 'usage-log.json');
let data = (() => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return { days: {} }; } })();
data.days = data.days || {};
const day = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
let timer = null;
const save = () => { if (timer) return; timer = setTimeout(() => { timer = null; try { fs.writeFileSync(FILE, JSON.stringify(data)); } catch (e) {} }, 2000); };

// add('ai', 'tokens', 512) / add('search', 'osm') / add('mail', 'sent') ...
function add(group, key, n = 1) {
  if (process.env.AAVORAA_MOCK === '1' && !process.env.AAVORAA_USAGE_TEST) return;
  const d = day();
  const g = ((data.days[d] = data.days[d] || {})[group] = data.days[d][group] || {});
  g[key] = (g[key] || 0) + (Number(n) || 0);
  const keep = Object.keys(data.days).sort().slice(0, -90); for (const k of keep) delete data.days[k];
  save();
}
// totals over the last n days (1 = today)
function sum(n) {
  const from = new Date(Date.now() + 5.5 * 3600e3 - (n - 1) * 86400e3).toISOString().slice(0, 10);
  const out = {};
  for (const [d, groups] of Object.entries(data.days)) if (d >= from) for (const [g, keys] of Object.entries(groups)) for (const [k, v] of Object.entries(keys)) { out[g] = out[g] || {}; out[g][k] = (out[g][k] || 0) + v; }
  return out;
}
function series(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.now() + 5.5 * 3600e3 - i * 86400e3).toISOString().slice(0, 10); out.push({ day: d, ...(data.days[d] || {}) }); }
  return out;
}
module.exports = { add, sum, series, _data: () => data };
