// Lets the app page show Windows pop-ups and the red dot on the taskbar / tray icon. Nothing else is exposed.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('aavDesktop', {
  badge: n => ipcRenderer.send('aav-badge', Number(n) || 0),
  notify: o => ipcRenderer.send('aav-notify', { title: String(o.title || '').slice(0, 120), body: String(o.body || '').slice(0, 300), page: String(o.page || ''), src: String(o.src || '') }),
  onOpen: fn => ipcRenderer.on('aav-open', (e, o) => fn(o)),
});
