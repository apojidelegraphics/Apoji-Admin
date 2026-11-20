// Apoji Admin for Mac: the admin portal as its own app. The portal's files ship inside the app and load from
// apoji://admin (a private, secure origin), so it opens instantly and doesn't depend on GitHub Pages.
// Supabase, the chat encryption and notifications work the same as in the browser.
// 1.2: it can also be your team's Mac hub over Tailscale (hub.js): phone notifications, schedules, keep awake.
const { app, BrowserWindow, Menu, protocol, net, shell, ipcMain, session, nativeTheme } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const MAC = process.platform === 'darwin', WIN = process.platform === 'win32';   // 2.0.4: runs on Windows too
if (WIN) app.setAppUserModelId(app.isPackaged ? 'com.apojidelegraphics.apojiadmin' : process.execPath);   // notifications and the taskbar group under the app's name
const HOME = 'apoji://admin/index.html';
const RELEASES = 'https://github.com/apojidelegraphics/Apoji-Admin/releases/latest';
const SB_URL = process.env.APOJI_TEST_SUPABASE || 'https://yzbnxpkuhlxsuwzbjifx.supabase.co', SB_KEY = 'sb_publishable_LY-EZORCvEQqW6AeQC5a8w_Z7wmeyjn';
protocol.registerSchemesAsPrivileged([{ scheme: 'apoji', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
let win = null;
const { setupHub } = require('./hub');
const hubApp = !gotLock ? { keepRunning: () => false, openedAtLogin: () => false } : setupHub({ getWin: () => win, showWin: tab => showWin(tab), sbUrl: SB_URL, sbKey: SB_KEY });
function showWin(tab) {
  if (!win) createWindow(); else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  if (tab) win.webContents.executeJavaScript(`window.NX && NX.A.user && NX.go(${JSON.stringify(tab)})`).catch(() => {});
}

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
    backgroundColor: '#0a0817',
    ...(MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 21 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#0a0817', symbolColor: '#e8e6f5', height: 60 }, icon: path.join(ROOT, 'build', 'icon.png'), autoHideMenuBar: true }),
    // keeps running at full speed in the background (the hub runs schedules and sends phone notifications)
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true, backgroundThrottling: false }
  });
  win.loadURL(HOME);
  // Opened at login as the hub: start in the background (click the Dock or menu bar icon to open it)
  win.once('ready-to-show', () => { if (!(hubApp.keepRunning() && hubApp.openedAtLogin())) win.show(); });
  // With the hub on, closing the window hides it so the hub keeps working. ⌘Q still quits.
  win.on('close', e => { if (hubApp.keepRunning() && !app.isQuitting) { e.preventDefault(); win.hide(); } });
  // Links to GitHub, Supabase, etc. open in your browser. The GitHub App setup also happens in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('apoji://admin/')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.on('closed', () => { win = null; });
  if (!MAC) win.on('focus', () => win?.flashFrame(false));
}

ipcMain.on('badge', (_e, n) => { n = Math.max(0, n | 0); try { app.setBadgeCount(n); } catch {}
  if (!MAC && win) win.setTitle(n > 0 ? `(${n}) Apoji Admin` : 'Apoji Admin'); });   // Windows has no Dock badge: the count goes in the title
ipcMain.on('attention', () => { if (win && !win.isFocused()) { if (MAC) app.dock?.bounce('informational'); else win.flashFrame(true); } });
ipcMain.handle('version', () => app.getVersion());

// 2.1: automatic updates on Windows (electron-updater + the release's latest.yml): downloads in the background, then
// asks to restart; if you don't, it installs the next time Apoji Admin quits. Macs keep the download link (an unsigned
// Mac app can't replace itself).
// 2.7: updates didn't install for people who keep Apoji Admin running in the tray, and failures were silent. Now every
// step is written to updates.log, the window is told what's happening, and if electron-updater fails for any reason
// the app downloads the installer from the release itself and runs it silently (then reopens).
const fs = require('fs'), os = require('os');
let winUpdater = null, winReady = null, fallbackExe = null, lastErr = '';
const ulog = (...a) => { try { fs.appendFileSync(path.join(app.getPath('userData'), 'updates.log'), `[${new Date().toISOString()}] ${a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')}\n`); } catch {} console.log('[update]', ...a); };
const tell = u => win?.webContents.send('update', { ...u, current: app.getVersion() });
function setupWinUpdates() {
  if (!WIN || !app.isPackaged) return;
  try {
    winUpdater = require('electron-updater').autoUpdater;
    winUpdater.autoDownload = true; winUpdater.autoInstallOnAppQuit = true; winUpdater.logger = { info: m => ulog('info', m), warn: m => ulog('warn', m), error: m => ulog('error', m), debug: () => {} };
    winUpdater.on('update-available', info => { ulog('available', info.version); tell({ latest: info.version, downloading: true }); });
    winUpdater.on('update-not-available', info => ulog('up to date', info?.version || ''));
    winUpdater.on('update-downloaded', info => { winReady = info.version; ulog('downloaded', info.version); tell({ latest: info.version, ready: true }); });
    winUpdater.on('error', e => { lastErr = String(e?.message || e).slice(0, 300); ulog('error', lastErr); fallback().catch(er => ulog('fallback failed', er.message)); });
  } catch (e) { ulog('no electron-updater', e.message); winUpdater = null; }
}
// the fallback: fetch the latest release's installer and run it silently
async function latestRelease() {
  const r = await net.fetch('https://api.github.com/repos/apojidelegraphics/Apoji-Admin/releases/latest', { headers: { 'User-Agent': 'Apoji-Admin' } });
  if (!r.ok) throw new Error('GitHub said ' + r.status);
  return r.json();
}
async function fallback() {
  if (!WIN || !app.isPackaged || fallbackExe || winReady) return;
  const j = await latestRelease(), latest = String(j.tag_name || '').replace(/^v/, '');
  if (!latest || latest.localeCompare(app.getVersion(), undefined, { numeric: true }) <= 0) return;
  const asset = (j.assets || []).find(a => /\.exe$/i.test(a.name) && /setup/i.test(a.name)) || (j.assets || []).find(a => /\.exe$/i.test(a.name));
  if (!asset) throw new Error('no installer in the release');
  ulog('fallback download', asset.name); tell({ latest, downloading: true });
  const res = await net.fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Apoji-Admin', Accept: 'application/octet-stream' } });
  if (!res.ok) throw new Error('download failed ' + res.status);
  const file = path.join(os.tmpdir(), asset.name); fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  fallbackExe = file; winReady = latest; ulog('fallback ready', file); tell({ latest, ready: true });
}
function runFallback() {
  if (!fallbackExe) return false;
  ulog('running installer', fallbackExe); app._nxInstalling = true;
  require('child_process').spawn(fallbackExe, ['/S', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  app.isQuitting = true; setTimeout(() => app.quit(), 400); return true;
}
ipcMain.handle('update:install', () => {
  if (fallbackExe) return runFallback();
  if (winUpdater && winReady) { app.isQuitting = true; ulog('quitAndInstall', winReady); setImmediate(() => winUpdater.quitAndInstall(true, true)); return true; }
  return false;
});
ipcMain.on('update:check', () => checkUpdate(true));
ipcMain.handle('update:state', () => ({ current: app.getVersion(), ready: winReady, error: lastErr, auto: !!winUpdater, log: (() => { try { return fs.readFileSync(path.join(app.getPath('userData'), 'updates.log'), 'utf8').split('\n').slice(-30).join('\n'); } catch { return ''; } })() }));
// quitting from the tray installs a downloaded update too (the hub keeps the app alive, so "on quit" rarely happened)
app.on('before-quit', () => { if (fallbackExe && !app._nxInstalling) { app._nxInstalling = true; require('child_process').spawn(fallbackExe, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } });
// A quiet update check against GitHub Releases (Help menu shows it too)
async function checkUpdate(manual) {
  if (WIN && app.isPackaged) {
    if (winReady) { tell({ latest: winReady, ready: true }); return; }
    if (winUpdater) {
      try { ulog('check'); const r = await winUpdater.checkForUpdates(); const v = r?.updateInfo?.version; if (manual) tell(v && v.localeCompare(app.getVersion(), undefined, { numeric: true }) > 0 ? { latest: v, downloading: true } : { latest: '' }); return; }
      catch (e) { lastErr = String(e?.message || e).slice(0, 300); ulog('check failed', lastErr); }
    }
    try { await fallback(); if (manual && !winReady) tell({ latest: '' }); } catch (e) { ulog('fallback failed', e.message); if (manual) shell.openExternal(RELEASES); }
    return;
  }
  try {
    const j = await latestRelease(); const latest = String(j.tag_name || '').replace(/^v/, '');
    const newer = latest && latest.localeCompare(app.getVersion(), undefined, { numeric: true }) > 0;
    if (newer) win?.webContents.send('update', { latest, url: j.html_url || RELEASES });
    else if (manual) win?.webContents.send('update', { latest: '', current: app.getVersion() });
  } catch { if (manual) shell.openExternal(RELEASES); }
}

app.whenReady().then(() => {
  serve();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(MAC ? [{ role: 'appMenu' }] : [{ label: 'File', submenu: [{ role: 'quit', label: 'Exit' }] }]), { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Check for Updates…', click: () => checkUpdate(true) }, { label: 'Apoji Admin on GitHub', click: () => shell.openExternal('https://github.com/apojidelegraphics/Apoji-Admin') }] }
  ]));
  nativeTheme.themeSource = 'dark';
  createWindow();
  setupWinUpdates();
  setTimeout(() => checkUpdate(false), 8000);
  setInterval(() => checkUpdate(false), 6 * 3600e3);
});
app.on('second-instance', () => showWin());
app.on('activate', () => showWin());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
