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

  // ---------- keep this Mac awake (the screen can still turn off). "Only while plugged in" lets it sleep on battery.
  // 1.7: powerSaveBlocker('prevent-app-suspension') only stopped App Nap; the Mac still went to sleep. Now it runs macOS's
  // own `caffeinate` (no idle sleep, no system sleep while on power), tied to this app so it ends if the app quits,
  // and keeps the Electron blocker as a backup. Closing the lid still sleeps a MacBook unless an external display is connected.
  // 1.8: it never worked unless the hub was on (the switch only showed up then, and applyAwake needed it). Now Keep awake
  // stands on its own, can keep the screen on too, and the status comes from macOS itself (pmset -g assertions), so
  // the app shows whether the Mac really is being kept awake.
  let blocker = null, caf = null, cafArgs = '';
  const onBattery = () => { try { return typeof powerMonitor.isOnBatteryPower === 'function' ? powerMonitor.isOnBatteryPower() : !!powerMonitor.onBatteryPower; } catch { return false; } };
  function startCaffeinate() {
    const args = ['-i', '-m', '-s', ...(hub.cfg.keepDisplay ? ['-d', '-u'] : []), '-w', String(process.pid)];
    if (caf && cafArgs === args.join(' ')) return;
    stopCaffeinate();
    if (process.platform !== 'darwin') return;
    try {
      cafArgs = args.join(' ');
      caf = require('child_process').spawn('/usr/bin/caffeinate', args, { stdio: 'ignore' });
      caf.on('exit', () => { caf = null; setTimeout(() => { applyAwake(); hub.changed(); }, 1000); });
      caf.on('error', () => { caf = null; });
    } catch { caf = null; }
  }
  function stopCaffeinate() { const c = caf; caf = null; cafArgs = ''; try { c?.removeAllListeners('exit'); c?.kill(); } catch {} }
  // What macOS says is keeping it awake right now
  function verify() {
    if (process.platform !== 'darwin') return Promise.resolve(null);
    return new Promise(res => require('child_process').execFile('/usr/bin/pmset', ['-g', 'assertions'], { timeout: 4000 }, (err, out) => {
      if (err) return res(null);
      const mine = String(out).split('\n').filter(l => caf && l.includes(`pid ${caf.pid}(`));
      res({ system: mine.some(l => /PreventUserIdleSystemSleep|PreventSystemSleep/.test(l)), display: mine.some(l => /PreventUserIdleDisplaySleep/.test(l)) });
    }));
  }
  function applyAwake() {
    const bat = onBattery(), want = hub.cfg.keepAwake && !(hub.cfg.pluggedOnly && bat);
    const blockType = hub.cfg.keepDisplay ? 'prevent-display-sleep' : 'prevent-app-suspension';
    if (want) { if (blocker != null && blocker.type !== blockType) { powerSaveBlocker.stop(blocker.id); blocker = null; } if (blocker == null) blocker = { id: powerSaveBlocker.start(blockType), type: blockType }; startCaffeinate(); }
    else { if (blocker != null) { powerSaveBlocker.stop(blocker.id); blocker = null; } stopCaffeinate(); }
    const on = want && (caf != null || (blocker != null && powerSaveBlocker.isStarted(blocker.id)));
    const prev = hub.state.awake || {};
    hub.state.awake = { on, onBattery: bat, display: !!hub.cfg.keepDisplay && on, verified: on ? prev.verified ?? null : null,
      reason: !hub.cfg.keepAwake ? 'Keep awake is off' : hub.cfg.pluggedOnly && bat ? 'On battery, so this Mac can sleep (turn off “Only while plugged in” to keep it awake on battery)' : on ? (hub.cfg.keepDisplay ? 'Staying awake with the screen on' : 'Staying awake (the screen can turn off)') + '. Closing a MacBook lid still sleeps unless a display is connected.' : "Couldn't keep this Mac awake" };
    if (on) verify().then(v => { if (!v || !hub.state.awake.on) return; hub.state.awake.verified = v.system; if (!v.system) hub.state.awake.reason = "macOS isn't honoring keep awake (pmset shows no assertion). Try turning it off and on, or check System Settings → Battery → Options."; hub.changed(); });
  }
  app.on('before-quit', stopCaffeinate);
  powerMonitor.on('on-ac', () => { applyAwake(); hub.changed(); });
  powerMonitor.on('on-battery', () => { applyAwake(); hub.changed(); });
  powerMonitor.on('resume', () => hub.refresh());

  function applyLogin() {
    try { app.setLoginItemSettings({ openAtLogin: hub.cfg.openAtLogin, openAsHidden: true }); } catch {}
  }

  // ---------- menu bar icon
  let tray = null;
  function paintTray(st = hub.status()) {
    if (!hub.cfg.enabled && !hub.cfg.keepAwake) { tray?.destroy(); tray = null; return; }
    if (!tray) {
      const img = nativeImage.createFromPath(path.join(__dirname, 'trayTemplate.png')); img.setTemplateImage(true);
      tray = new Tray(img); tray.setToolTip('Apoji Admin hub');
    }
    const line = !hub.cfg.enabled ? '○ Hub is off' : st.serving ? `● Online at ${st.tailscale.dnsName?.split('.')[0] || 'tailnet'}` : st.tailscale?.error ? '○ ' + st.tailscale.error : '○ Not on your tailnet yet';
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: line, enabled: false },
      { label: st.awake?.on ? '☕ Keeping this Mac awake' : '💤 ' + (st.awake?.reason || 'Can sleep'), enabled: false },
      { label: `📱 ${st.devices} phone${st.devices === 1 ? '' : 's'} get notifications`, enabled: false },
      { type: 'separator' },
      { label: 'Open Apoji Admin', click: () => showWin('hub') },
      { label: 'Keep this Mac awake', type: 'checkbox', checked: hub.cfg.keepAwake, click: m => setAndApply({ keepAwake: m.checked }) },
      { label: 'Only while plugged in', type: 'checkbox', checked: hub.cfg.pluggedOnly, enabled: hub.cfg.keepAwake, click: m => setAndApply({ pluggedOnly: m.checked }) },
      { label: 'Keep the screen on too', type: 'checkbox', checked: !!hub.cfg.keepDisplay, enabled: hub.cfg.keepAwake, click: m => setAndApply({ keepDisplay: m.checked }) },
      { label: 'Run schedules now', click: () => getWin()?.webContents.send('hub:nudge', 'jobs') },
      { type: 'separator' },
      hub.cfg.enabled ? { label: 'Turn the hub off', click: () => setAndApply({ enabled: false }) } : { label: 'Turn the hub on', click: () => setAndApply({ enabled: true }) },
      { label: 'Quit Apoji Admin', click: () => { app.isQuitting = true; app.quit(); } }
    ]));
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

  return { hub, keepRunning: () => hub.cfg.enabled || (hub.cfg.keepAwake && hub.state.awake?.on), openedAtLogin: () => { try { return !!app.getLoginItemSettings().wasOpenedAtLogin; } catch { return false; } } };
}

module.exports = { setupHub };
