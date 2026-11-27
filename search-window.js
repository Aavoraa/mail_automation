// Free web search for lead finding: loads search pages in a hidden normal browser window (one at a time).
// If the search site shows a check (captcha), the page is simply returned and the app waits; it never tries to get around it.
const { BrowserWindow, session, app } = require('electron');
const PART = 'persist:search';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let queue = Promise.resolve();
function start() {
  session.fromPartition(PART).setUserAgent(app.userAgentFallback.replace(/\s(Electron|aavoraa[^\s]*|AAVORAA[^\s]*)\/\S+/gi, ''));
  global.pageHtml = (url, waitMs = 1500) => {
    const job = queue.then(async () => {
      const w = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: PART, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true } });
      try {
        await w.loadURL(url).catch(e => { if (!/ERR_ABORTED/.test(e.message)) throw e; });
        await sleep(waitMs);
        return await w.webContents.executeJavaScript('document.documentElement.outerHTML');
      } finally { w.destroy(); }
    });
    queue = job.catch(() => {});
    return job;
  };
}
module.exports = { start };
