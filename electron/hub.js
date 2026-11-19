// Electron side of the Mac hub: keeps this Mac awake (only while plugged in, if you like), opens at login, lives in
// the menu bar, and connects the hub API (hub-core.js) to the app window.
const { app, ipcMain, powerSaveBlocker, powerMonitor, safeStorage, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const webpush = require('web-push');
const QRCode = require('qrcode');
const { createHub } = require('./hub-core');

function macName() {
  try { return require('child_process').execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], { timeout: 2000 }).toString().trim() || os.hostname(); }
  catch { return os.hostname().replace(/\.local$/, ''); }
}

function setupHub({ getWin, showWin, sbUrl, sbKey }) {
  const canSeal = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };
  const hub = createHub({
    dir: path.join(app.getPath('userData'), 'hub'), version: app.getVersion(), name: macName(), sbUrl, sbKey, webpush,
    seal: s => canSeal() ? safeStorage.encryptString(s) : Buffer.from(s), unseal: b => { try { return canSeal() ? safeStorage.decryptString(b) : b.toString(); } catch { return b.toString(); } },
    onNudge: what => getWin()?.webContents.send('hub:nudge', what),
    onChange: st => { getWin()?.webContents.send('hub:changed', st); paintTray(st); },
    log: (...a) => console.log('[hub]', ...a)
  });

  // ---------- keep this Mac awake + lid-closed mode (1.9: awake.js, shared with Nexus '28; works without the hub)
  const awake = require('./awake').createAwake({ app: 'admin', getCfg: () => hub.cfg, power: powerMonitor, blocker: powerSaveBlocker,
    onChange: st => { hub.state.awake = { on: st.on, onBattery: st.onBattery, display: !!hub.cfg.keepDisplay && st.on, verified: st.on, reason: st.reason, short: st.short, lid: st.lid, lidText: st.lidText, truth: st.truth, until: st.until, floor: st.floor, battery: st.battery, wanted: st.wanted }; hub.changed(); },
    onExpire: () => { if (hub.cfg.keepAwake) { hub.set({ keepAwake: false, until: null }); paintTray(); } } });
  const applyAwake = () => awake.apply();
  // 2.0: "keep the screen on" still dims after a while away (dimmer.js, shared with Nexus '28)
  let dimmer = null;
  // 2.0.3: real display brightness where the screen allows it (checked once on start), the dark layer elsewhere
  // 2.0.4 fix: this used to run before the app was ready, when Electron's screen module isn't available yet, so the
  // dimmer never started. Now it starts once the app is ready.
  let brightness = null;
  app.whenReady().then(() => {
  try { const B = require('./brightness'); brightness = B.createBrightness({ bin: B.helperPath({ app, dir: path.join(__dirname, '..') }), stateFile: path.join(app.getPath('userData'), 'brightness-saved.json'), winInternal: () => require('electron').screen.getAllDisplays().filter(d => d.internal).map(d => d.id), log: (...a) => console.log('[brightness]', ...a) }); brightness.check().then(st => { hub.state.brightness = st; hub.changed(); }).catch(() => {}); } catch (e) { console.log('[brightness]', e.message); }
  try { const { BrowserWindow, screen } = require('electron'); dimmer = require('./dimmer').createDimmer({ BrowserWindow, screen, powerMonitor, getCfg: () => hub.cfg, isAwake: () => !!awake.state().on, brightness }); } catch (e) { console.log('[dimmer]', e.message); }
  });
  ipcMain.handle('hub:testDim', () => dimmer ? { ok: true, ...dimmer.test(4000) } : { ok: false });
  ipcMain.handle('hub:checkBrightness', async () => { if (brightness) hub.state.brightness = await brightness.check(); hub.changed(); return { ok: true }; });
  app.on('before-quit', () => { awake.quit(); dimmer?.stop(); });
  powerMonitor.on('resume', () => hub.refresh());

  function applyLogin() {
    try { app.setLoginItemSettings({ openAtLogin: hub.cfg.openAtLogin, openAsHidden: true }); } catch {}
  }

  // ---------- menu bar icon
  let tray = null;
  function paintTray(st = hub.status()) {
    if (!hub.cfg.enabled && !hub.cfg.keepAwake) { tray?.destroy(); tray = null; return; }
    if (!tray) {
      // 2.0.4: Windows' taskbar needs a colour icon (the Mac's black template one would vanish on a dark taskbar)
      const img = process.platform === 'darwin' ? nativeImage.createFromPath(path.join(__dirname, 'trayTemplate.png')) : nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 16, height: 16 });
      if (process.platform === 'darwin') img.setTemplateImage(true);
      tray = new Tray(img); tray.setToolTip('Apoji Admin hub');
      if (process.platform !== 'darwin') tray.on('click', () => showWin());   // on Windows a click opens the app
    }
    const cut = (t, n = 38) => String(t || '').length > n ? String(t).slice(0, n - 1) + '…' : String(t || '');
    const line = cut(!hub.cfg.enabled ? '○ Hub is off' : st.serving ? `● Online at ${st.tailscale.dnsName?.split('.')[0] || 'tailnet'}` : st.tailscale?.error ? '○ ' + st.tailscale.error : '○ Not on your tailnet yet');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: line, enabled: false },
      { label: st.awake?.on ? '☕ ' + (st.awake.short || 'Awake') : '💤 ' + (st.awake?.short || 'Can sleep'), enabled: false },
      ...(hub.cfg.lidMode ? [{ label: st.awake?.lid?.on ? (st.awake.lid.closed ? '💻 Lid closed: still awake' : '💻 Lid-closed mode on') : '💻 Lid-closed mode paused', enabled: false }] : []),
      { label: `📱 ${st.devices} phone${st.devices === 1 ? '' : 's'} get notifications`, enabled: false },
      { type: 'separator' },
      { label: 'Open Apoji Admin', click: () => showWin('hub') },
      { label: process.platform === 'win32' ? 'Keep this PC awake' : 'Keep this Mac awake', type: 'checkbox', checked: hub.cfg.keepAwake, click: m => setAndApply({ keepAwake: m.checked }) },
      { label: 'Keep awake for…', enabled: hub.cfg.keepAwake, submenu: [[0, 'Until I turn it off'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [480, '8 hours']].map(([v, l]) => ({ label: l, type: 'radio', checked: v ? false : !hub.cfg.until, click: () => setAndApply({ forMinutes: v }) })) },
      { label: 'Only while plugged in', type: 'checkbox', checked: hub.cfg.pluggedOnly, enabled: hub.cfg.keepAwake, click: m => setAndApply({ pluggedOnly: m.checked }) },
      { label: 'Keep the screen on too', type: 'checkbox', checked: !!hub.cfg.keepDisplay, enabled: hub.cfg.keepAwake, click: m => setAndApply({ keepDisplay: m.checked }) },
      { label: 'Dim the screen when away', type: 'checkbox', checked: hub.cfg.dim !== false, enabled: hub.cfg.keepAwake && !!hub.cfg.keepDisplay, click: m => setAndApply({ dim: m.checked }) },
      { label: 'Stay awake with the lid closed', type: 'checkbox', checked: !!hub.cfg.lidMode, click: m => lidMode(m.checked).catch(() => paintTray()) },
      { label: 'Run schedules now', click: () => getWin()?.webContents.send('hub:nudge', 'jobs') },
      { type: 'separator' },
      hub.cfg.enabled ? { label: 'Turn the hub off', click: () => setAndApply({ enabled: false }) } : { label: 'Turn the hub on', click: () => setAndApply({ enabled: true }) },
      { label: 'Quit Apoji Admin', click: () => { app.isQuitting = true; app.quit(); } }
    ]));
  }

  async function lidMode(on) {
    if (on && !awake.ruleReady()) await awake.grant();       // one macOS password prompt
    return setAndApply({ lidMode: !!on });
  }
  async function setAndApply(patch) {
    const was = hub.cfg.enabled;
    hub.set(patch);
    if (hub.cfg.enabled && !was) await hub.start();
    else if (!hub.cfg.enabled && was) await hub.stop();
    applyAwake(); applyLogin(); paintTray();
    hub.changed();
    await new Promise(res => setTimeout(res, 600));     // let macOS confirm keep awake before answering
    return withQr(hub.status());
  }
  async function withQr(st) { if (st.url) try { st.qr = await QRCode.toDataURL(st.url, { margin: 1, width: 240, color: { dark: '#0a0817', light: '#ffffff' } }); } catch {} return st; }

  ipcMain.handle('hub:status', async (_e, fresh) => withQr(fresh ? await hub.refresh() : hub.status()));
  ipcMain.handle('hub:set', (_e, patch) => setAndApply(patch || {}));
  // 2.3: check what's really keeping this computer awake (without changing anything), and clear leftovers
  ipcMain.handle('hub:awakeCheck', async () => { await awake.status(); hub.state.awake = { ...(hub.state.awake || {}), ...awake.state(), display: !!hub.cfg.keepDisplay && awake.state().on }; return withQr(hub.status()); });
  ipcMain.handle('hub:awakeReset', async () => { try { await awake.reset(); return { ok: true, status: await withQr(hub.status()) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('hub:lid', async (_e, on) => { try { return { ok: true, status: await lidMode(on) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('hub:lidRevoke', async () => { try { hub.set({ lidMode: false }); await awake.revoke(); await applyAwake(); return { ok: true, status: await withQr(hub.status()) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('hub:push', (_e, ev) => hub.cfg.enabled ? hub.push(ev || {}) : { sent: 0, off: true });
  ipcMain.handle('hub:removeDevice', (_e, id) => hub.removeSub(String(id)));
  ipcMain.handle('hub:note', (_e, ev) => { hub.remember(ev || {}); hub.changed(); return true; });

  // Start (the hub only runs once you turn it on in This Mac)
  app.whenReady().then(async () => {
    if (hub.cfg.enabled) await hub.start();
    applyAwake(); applyLogin(); paintTray();
    setInterval(() => { if (hub.cfg.enabled) hub.refresh(); }, 5 * 60e3);   // Tailscale reconnects, IP changes, etc.
  });
  app.on('before-quit', () => { app.isQuitting = true; if (hub.state.serving) hub.serve(false); });

  return { hub, keepRunning: () => hub.cfg.enabled || (hub.cfg.keepAwake && hub.state.awake?.on) || !!hub.cfg.lidMode, openedAtLogin: () => { try { return !!app.getLoginItemSettings().wasOpenedAtLogin; } catch { return false; } } };
}

module.exports = { setupHub };
