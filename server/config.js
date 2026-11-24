// Local, private configuration (secrets never go to the Google Sheet).
const fs = require('fs');
const path = require('path');
const os = require('os');

let safe = null;
try { safe = require('electron').safeStorage; } catch (e) { safe = null; }

const DIR = process.env.AAVORAA_DATA_DIR ||
  (global.__AAV_USERDATA__ || path.join(os.homedir(), '.aavoraa-lead-agent'));
fs.mkdirSync(DIR, { recursive: true });
const FILE = path.join(DIR, 'config.dat');
const STATE = path.join(DIR, 'state.json');

function canEncrypt() { try { return !!(safe && safe.isEncryptionAvailable()); } catch (e) { return false; } }

function load() {
  try {
    const raw = fs.readFileSync(FILE);
    if (raw.slice(0, 4).toString() === 'ENC1') return JSON.parse(safe.decryptString(raw.slice(4)));
    return JSON.parse(raw.toString('utf8'));
  } catch (e) { return {}; }
}
function save(cfg) {
  const json = JSON.stringify(cfg, null, 2);
  if (canEncrypt()) fs.writeFileSync(FILE, Buffer.concat([Buffer.from('ENC1'), safe.encryptString(json)]));
  else fs.writeFileSync(FILE, json, { mode: 0o600 });
}
let cache = load();
module.exports = {
  dir: DIR,
  get: () => cache,
  set(patch) { cache = { ...cache, ...patch }; save(cache); return cache; },
  isConfigured: () => !!(cache.sheetUrl && cache.serviceAccount && cache.gmailUser && cache.gmailAppPassword && (cache.openaiKey || cache.geminiKey)),
  loadState() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { return {}; } },
  saveState(s) { try { fs.writeFileSync(STATE, JSON.stringify(s)); } catch (e) {} },
};
