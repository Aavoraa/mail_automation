// AAVORAA Lead Agent - Windows desktop shell.
const { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog, Notification, ipcMain } = require('electron');
const path = require('path');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
global.__AAV_USERDATA__ = app.getPath('userData');

let win = null, tray = null, quitting = false, url = '';

global.desktop = {
  getAutoStart: () => app.getLoginItemSettings().openAtLogin,
  setAutoStart: on => app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] }),
};

function createWindow(show = true) {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 980, minHeight: 640, show: false, backgroundColor: '#0c0b09',
    title: 'AAVORAA Lead Agent', icon: path.join(__dirname, 'assets', 'icon.png'), autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  win.on('focus', () => win.flashFrame(false));
  win.loadURL(url);
  win.once('ready-to-show', () => { if (show) win.show(); });
  win.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https?:/.test(u)) shell.openExternal(u); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, u) => { if (!u.startsWith(url)) { e.preventDefault(); shell.openExternal(u); } });
  win.on('close', e => {
    if (quitting) return;
    e.preventDefault(); win.hide();
    if (!global.__trayTold) {
      global.__trayTold = true;
      try { new Notification({ title: 'AAVORAA Lead Agent is still working', body: 'The agent keeps running in the background. Right-click the gold "A" icon near the clock to open or quit.' }).show(); } catch (err) {}
    }
  });
}

function createTray() {
  trayPlain = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(trayPlain);
  tray.setToolTip('AAVORAA Lead Agent - running');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open AAVORAA Lead Agent', click: () => { win.show(); win.focus(); } },
    { label: 'Open in browser', click: () => shell.openExternal(url) },
    { type: 'separator' },
    { label: 'Quit (stops the agent)', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => { win.show(); win.focus(); });
}

// ---- notifications: red circle on the taskbar and tray icons, Windows pop-up for each new client reply / qualified lead
// Paint a round red dot (white rim) into the top-right corner of an image (or a plain dot when no image is given).
function redDot(base, size = 16) {
  let w = size, h = size, buf;
  if (base && !base.isEmpty()) { ({ width: w, height: h } = base.getSize()); buf = Buffer.from(base.toBitmap()); } else buf = Buffer.alloc(w * h * 4);
  const r = base ? Math.max(3, Math.round(w * 0.3)) : w / 2 - 0.5, cx = base ? w - r - 0.5 : w / 2 - 0.5, cy = base ? r - 0.5 : h / 2 - 0.5;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - cx, y - cy); if (d > r + 0.5) continue;
    const i = (y * w + x) * 4, rim = d > r - 1.2; // BGRA
    buf[i] = rim ? 255 : 59; buf[i + 1] = rim ? 255 : 56; buf[i + 2] = rim ? 255 : 229; buf[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(buf, { width: w, height: h });
}
let trayPlain = null, trayDot = null, overlayDot = null, lastBadge = 0;
ipcMain.on('aav-badge', (e, n) => {
  n = Math.max(0, Number(n) || 0);
  try {
    overlayDot = overlayDot || redDot(null, 16);
    if (win) win.setOverlayIcon(n ? overlayDot : null, n ? `${n} new` : '');
    if (tray) { trayDot = trayDot || redDot(trayPlain); tray.setImage(n ? trayDot : trayPlain); tray.setToolTip(n ? `AAVORAA Lead Agent - ${n} new` : 'AAVORAA Lead Agent - running'); }
    if (win && n > lastBadge && !win.isFocused()) win.flashFrame(true);
  } catch (err) {}
  lastBadge = n;
});
const PAGES = ['replies', 'qualified', 'linkedin'];
ipcMain.on('aav-notify', (e, o) => {
  try {
    const n = new Notification({ title: o.title || 'AAVORAA Lead Agent', body: o.body || '', silent: true, icon: path.join(__dirname, 'assets', 'icon.png') });
    n.on('click', () => { if (!win) return; win.show(); win.focus(); if (PAGES.includes(o.page)) win.webContents.send('aav-open', { page: o.page, src: ['gmail', 'linkedin', 'qualified', 'accepted'].includes(o.src) ? o.src : '' }); });
    n.show();
  } catch (err) {}
});

app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', e => e.preventDefault());

app.whenReady().then(async () => {
  try {
    const server = require('./server/index.js');
    const { port } = await server.listen();
    url = `http://127.0.0.1:${port}/`;
  } catch (e) {
    dialog.showErrorBox('AAVORAA Lead Agent', e.code === 'EADDRINUSE'
      ? 'Port 4780 is already in use. Is the app already open? Check the gold "A" icon near the clock.'
      : 'Could not start: ' + e.message);
    app.exit(1); return;
  }
  app.setAppUserModelId('com.aavoraa.leadagent');
  createTray();
  createWindow(!process.argv.includes('--hidden'));
  require('./search-window').start();
  require('./linkedin-bot').start({ parent: () => win });
});
