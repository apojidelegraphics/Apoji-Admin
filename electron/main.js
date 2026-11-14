// Apoji Admin for Mac: the admin portal as its own app. The portal's files ship inside the app and load from
// apoji://admin (a private, secure origin), so it opens instantly and doesn't depend on GitHub Pages.
// Supabase, the chat encryption and notifications work the same as in the browser.
const { app, BrowserWindow, Menu, protocol, net, shell, ipcMain, session, nativeTheme } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const HOME = 'apoji://admin/index.html';
const RELEASES = 'https://github.com/apojidelegraphics/Apoji-Admin/releases/latest';
protocol.registerSchemesAsPrivileged([{ scheme: 'apoji', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();
let win = null;

function serve() {
  protocol.handle('apoji', req => {
    const u = new URL(req.url);
    if (u.host !== 'admin') return new Response('Not found', { status: 404 });
    let p = decodeURIComponent(u.pathname); if (p === '/' || !p) p = '/index.html';
    if (process.env.APOJI_TEST_MOCK && p === '/__supabase.js') return net.fetch(pathToFileURL(process.env.APOJI_TEST_MOCK).toString());
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT + path.sep) || /[\\/](electron|node_modules|supabase|build|\.github)[\\/]/.test(file.slice(ROOT.length))) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // tests only: use a stand-in for Supabase
  if (process.env.APOJI_TEST_MOCK) session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://cdn.jsdelivr.net/*'] }, (d, cb) => cb({ redirectURL: 'apoji://admin/__supabase.js' }));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 880, minWidth: 380, minHeight: 520, show: false, title: 'Apoji Admin',
    backgroundColor: '#0a0817', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 21 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true }
  });
  win.loadURL(HOME);
  win.once('ready-to-show', () => win.show());
  // Links to GitHub, Supabase, etc. open in your browser. The GitHub App setup also happens in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('apoji://admin/')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.on('closed', () => { win = null; });
}

ipcMain.on('badge', (_e, n) => { try { app.setBadgeCount(Math.max(0, n | 0)); } catch {} });
ipcMain.on('attention', () => { if (win && !win.isFocused()) app.dock?.bounce('informational'); });
ipcMain.handle('version', () => app.getVersion());

// A quiet update check against GitHub Releases (Help menu shows it too)
async function checkUpdate(manual) {
  try {
    const r = await net.fetch('https://api.github.com/repos/apojidelegraphics/Apoji-Admin/releases/latest', { headers: { 'User-Agent': 'Apoji-Admin' } });
    const j = await r.json(); const latest = String(j.tag_name || '').replace(/^v/, '');
    const newer = latest && latest.localeCompare(app.getVersion(), undefined, { numeric: true }) > 0;
    if (newer) win?.webContents.send('update', { latest, url: j.html_url || RELEASES });
    else if (manual) win?.webContents.send('update', { latest: '', current: app.getVersion() });
  } catch { if (manual) shell.openExternal(RELEASES); }
}

app.whenReady().then(() => {
  serve();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Check for Updates…', click: () => checkUpdate(true) }, { label: 'Apoji Admin on GitHub', click: () => shell.openExternal('https://github.com/apojidelegraphics/Apoji-Admin') }] }
  ]));
  nativeTheme.themeSource = 'dark';
  createWindow();
  setTimeout(() => checkUpdate(false), 8000);
  setInterval(() => checkUpdate(false), 6 * 3600e3);
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('activate', () => { if (!win) createWindow(); else win.show(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
