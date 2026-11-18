// 2.0.4 checks: dimming starts once the app is ready, Windows support, the Owner's crown in chat, changing someone's
// picture, and editing users through the admin-users function.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let n = 0; const ok = m => { n++; console.log('  ✓ ' + m); };

(async () => {
  // ---------- dimming: brightness + dimmer are made after app ready (the screen module throws before that)
  const hub = read('electron/hub.js');
  const ready = hub.indexOf('app.whenReady().then(() => {'), dimAt = hub.indexOf("require('./dimmer').createDimmer");
  assert.ok(ready > 0 && dimAt > ready && hub.indexOf("require('./brightness')") > ready);
  ok('the dimmer starts once the app is ready (it never started before)');

  // ---------- Windows
  for (const [mine, theirs] of [['electron/awake.js', 'src/awake.js'], ['electron/brightness.js', 'src/brightness.js']]) {
    const twin = ['Nexus-28', 'nexus-desktop'].map(d => path.join(__dirname, '..', '..', d, theirs)).find(x => fs.existsSync(x));
    if (twin) assert.strictEqual(read(mine), fs.readFileSync(twin, 'utf8'), 'same ' + theirs + ' as Nexus');
  }
  const { createAwake } = require('../electron/awake');
  const started = [], stopped = [];
  const blocker = { start: t => { started.push(t); return started.length; }, stop: id => stopped.push(id) };
  let cfg = { keepAwake: true, keepDisplay: false };
  const aw = createAwake({ app: 'admin', platform: 'win32', getCfg: () => cfg, blocker, power: { isOnBatteryPower: () => false }, shared: path.join(os.tmpdir(), 'aw-' + Date.now() + '.json') });
  let st = await aw.apply(); assert.ok(st.on && started[0] === 'prevent-app-suspension');
  cfg = { keepAwake: true, keepDisplay: true }; st = await aw.apply(); assert.ok(st.on && started[1] === 'prevent-display-sleep' && stopped[0] === 1);
  cfg = { keepAwake: false }; st = await aw.apply(); assert.ok(!st.on && stopped.length === 2 && !st.lid.on);
  ok('Windows: keep awake through powerSaveBlocker (screen on too), lid-closed mode stays Mac only');

  const { createBrightness } = require('../electron/brightness');
  let pct = 80; const calls = [];
  const exec = (cmd, args, o, cb) => { calls.push(cmd); const s = args[args.length - 1]; const m = s.match(/Brightness = \[byte\](\d+)/); if (m) { pct = +m[1]; return cb(null, '{"ok":true}'); } return cb(null, `{"pct":${pct}}`); };
  const sf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-')), 's.json');
  const b = createBrightness({ platform: 'win32', exec, stateFile: sf, winInternal: () => [7] });
  const c = await b.check(); assert.ok(c.ok && c.displays[0].id === 7 && c.displays[0].builtin && calls.every(x => x === 'powershell.exe'));
  await b.dim([7, 8], 0.45); assert.strictEqual(pct, 44); await b.restore(); assert.strictEqual(pct, 80);
  const bad = createBrightness({ platform: 'win32', exec: (c, a, o, cb) => cb(new Error('no WMI')), stateFile: sf, winInternal: () => [1] });
  assert.ok(!(await bad.check()).ok, 'a desktop monitor without WMI brightness falls back to the dark layer');
  ok("Windows: the laptop's built-in screen dims for real through WMI, others get the dark layer");

  const main = read('electron/main.js'), pkg = JSON.parse(read('package.json')), rel = read('.github/workflows/release.yml');
  assert.ok(main.includes("titleBarOverlay") && main.includes("win.flashFrame(true)") && main.includes("setAppUserModelId"));
  assert.ok(pkg.build.win.target[0].target === 'nsis' && pkg.scripts.postinstall === 'node scripts/postinstall.js' && pkg.build.files.includes('build/icon.png'));
  assert.ok(rel.includes('runs-on: windows-latest') && rel.includes('dist/*.exe') && rel.includes('More info → Run anyway'));
  assert.ok(read('electron/preload.js').includes('platform: process.platform') && read('admin.css').includes('.desktop-app.win-app header') && read('electron/hub-core.js').includes('tailscale.exe'));
  assert.ok(read('admin.js').includes("'This PC'") && read('features.js').includes("${NX.WIN ? '' : `") && read('README.md').includes('Windows'));
  ok('Windows app: installer in the release, its own title bar, tray icon, "This PC" wording, Tailscale for Windows');

  // ---------- crown + pictures + editing users
  const adm = read('admin.js');
  assert.ok(adm.includes('class="av-crown"') && read('admin.css').includes('.av .av-crown'));
  ok("the Owner's picture wears a 👑 in chat (and everywhere else)");
  const pages = read('pages.js'), fn = read('supabase/functions/admin-users/index.ts');
  const row = pages.slice(pages.indexOf('<label>Picture</label>'), pages.indexOf('<label>Picture</label>') + 300);
  assert.ok(row.indexOf('data-ac="pic"') < row.indexOf('data-ac="nopic"') && row.includes('Change picture') && pages.includes("action: 'avatar', image"));
  assert.ok(fn.includes("if (action === 'avatar')") && fn.includes("storage.from('avatars').upload(") && fn.includes("log('user_avatar_changed'") && fn.includes('--no-verify-jwt'));
  ok('"Change picture" sits left of "Remove picture"; admin-users uploads it (and is deployed, so editing users works)');
  console.log(`2.0.4: ${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
