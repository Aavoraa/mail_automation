// AAVORAA Lead Agent - Windows desktop shell.
const { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog, Notification } = require('electron');
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
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
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
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
  tray.setToolTip('AAVORAA Lead Agent - running');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open AAVORAA Lead Agent', click: () => { win.show(); win.focus(); } },
    { label: 'Open in browser', click: () => shell.openExternal(url) },
    { type: 'separator' },
    { label: 'Quit (stops the agent)', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => { win.show(); win.focus(); });
}

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
});
