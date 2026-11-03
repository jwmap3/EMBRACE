// Embrace for Windows: opens the Embrace app in its own window.
// The app itself loads from jwmap3.github.io/EMBRACE, so it updates without reinstalling.
const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const path = require('path');

const HOME = 'https://jwmap3.github.io/EMBRACE/';
let win = null;
let closing = false;

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
    show: false,
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

  // Open in full screen. F11 leaves and re-enters full screen.
  win.once('ready-to-show', () => { win.setFullScreen(true); win.show(); });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); event.preventDefault(); }
  });

  // Full screen hides the window's own buttons, so add a round X in the top-right corner.
  win.webContents.on('dom-ready', () => {
    win.webContents.insertCSS(`
      #embrace-close { position: fixed; top: 14px; right: 14px; z-index: 2147483647; width: 46px; height: 46px; border-radius: 50%;
        border: 1px solid rgba(29,38,32,.12); background: rgba(255,255,253,.88); color: #1D2620; cursor: pointer;
        display: grid; place-items: center; box-shadow: 0 6px 18px rgba(38,64,48,.18); backdrop-filter: blur(12px); }
      #embrace-close:hover { background: #fff; color: #B3261E; }
      #embrace-close:focus-visible { outline: 3px solid #2F6E4C; outline-offset: 2px; }
      @media (prefers-color-scheme: dark) { #embrace-close { background: rgba(28,38,36,.9); color: #EEF2EC; border-color: rgba(255,255,255,.12); } }
    `);
    win.webContents.executeJavaScript(`
      if (!document.getElementById('embrace-close')) {
        var b = document.createElement('button');
        b.id = 'embrace-close'; b.type = 'button'; b.title = 'Close Embrace'; b.setAttribute('aria-label', 'Close Embrace');
        b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
        b.addEventListener('click', function () { window.close(); });
        document.body.appendChild(b);
      }
    `).catch(() => {});
  });

  // Always ask before closing, however the window is closed (the X, Alt+F4 or the taskbar).
  win.on('close', (event) => {
    if (closing) return;
    event.preventDefault();
    dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Close Embrace', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Embrace',
      message: 'Are you sure you want to close Embrace?',
      noLink: true
    }).then(({ response }) => {
      if (response === 0) { closing = true; win.close(); }
    });
  });

  win.loadURL(HOME);
  win.on('closed', () => { win = null; });
}

app.on('window-all-closed', () => app.quit());
