// Embrace for Windows: opens the Embrace app in its own window.
// The app itself loads from jwmap3.github.io/EMBRACE, so it updates without reinstalling.
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

const HOME = 'https://jwmap3.github.io/EMBRACE/';
let win = null;

// Only one Embrace window at a time; opening it again brings the existing one forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(createWindow);
}

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 420,
    minHeight: 640,
    title: 'Embrace',
    backgroundColor: '#DCE9E4',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });

  // Links to other sites, text messages and phone numbers open outside Embrace.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(HOME)) { event.preventDefault(); shell.openExternal(url); }
  });

  // No internet yet: show a short message and try again every few seconds.
  win.webContents.on('did-fail-load', (event, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<body style="margin:0;height:100vh;display:grid;place-items:center;background:#DCE9E4;font-family:Segoe UI,sans-serif;color:#1D2620">' +
      '<div style="text-align:center"><h1 style="font-weight:600">Embrace</h1><p>Waiting for an internet connection…</p></div></body>'));
    setTimeout(() => { if (win) win.loadURL(HOME); }, 5000);
  });

  win.loadURL(HOME);
  win.on('closed', () => { win = null; });
}

app.on('window-all-closed', () => app.quit());
