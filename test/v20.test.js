// 2.0 checks: the cage is part of the Axiom page (escape, Track, capture), better attempts, Nexus room looks like team
// chat, reports from the portal, "Portal" in the header, keep awake on battery + dimming.
const assert = require('assert'), fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let n = 0; const ok = m => { n++; console.log('  ✓ ' + m); };

const v19 = read('v19.js'), feat = read('features.js'), admin = read('admin.js');
assert.ok(!/SIMULATION</.test(v19) && !/\(Story only/.test(v19) && !/It’s story/.test(v19));
assert.ok(!admin.includes("['cage', '⛓'") && admin.includes("if (tab === 'cage') tab = 'axiom'") && feat.includes("NX.cage?.mount($('axCage'), cageRes)"), 'one Axiom page; old #cage links still land there');
ok('cage merged into the Axiom page, no "simulation" wording');

assert.ok(v19.includes("sb.rpc('apex_cage_track')") && v19.includes("sb.rpc('apex_cage_capture')") && v19.includes('LIVE TRACE') && v19.includes("id=\"cgCapture\""), 'Track + capture');
assert.ok(feat.includes("escaped ? '🚨 Axiom is offline: he escaped'") && feat.includes('Owner override'), 'escape shows on the power card');
ok('escape: Axiom offline, Track streams his trail, Attempt to capture (cool-down), Owner override');

const fn = read('supabase/functions/axiom-cage/index.ts');
assert.ok(fn.includes('max_tokens: 1600') && fn.includes('m.reasoning') && /tryNo < 3/.test(fn) && fn.includes('Math.random() >= 1 / 12') && fn.includes("skipped: 'escaped'"), 'reads reasoning, retries, ~1 in 12 left blank on purpose');
ok('attempts: most come back written (reasoning fallback + retries), about 1 in 12 left unrecorded');

const v18 = read('v18.js');
assert.ok(v18.includes('<div class="msgs" id="ncLog">') && v18.includes('<div class="compose"><div class="box">') && v18.includes('class="m ${cont') && v18.includes('<span class="ai-tag">AI</span>'), 'same rows + compose box as team chat');
ok('◆ Nexus room uses team chat rows, avatars, times and the compose box');

const pages = read('pages.js');
assert.ok(pages.includes('id="fNew"') && pages.includes("channel: 'portal'") && pages.includes("source: 'web'"), 'new report');
assert.ok(read('index.html').includes('APOJI ADMIN <span class="ttl-portal">PORTAL</span>'));
ok('＋ New report on Feedback & bugs; "APOJI ADMIN PORTAL" header');

const aw = read('electron/awake.js'), dim = read('electron/dimmer.js'), hub = read('electron/hub.js'), core = read('electron/hub-core.js');
for (const [f, own] of [['src/awake.js', aw], ['src/dimmer.js', dim]]) {
  const twin = ['Nexus-28', 'nexus-desktop'].map(d => path.join(__dirname, '..', '..', d, f)).find(x => fs.existsSync(x));
  if (twin) assert.strictEqual(own, fs.readFileSync(twin, 'utf8'), 'same ' + f + ' as Nexus');
}
assert.ok(hub.includes("require('./dimmer').createDimmer") && hub.includes("label: 'Dim the screen when away'") && core.includes('if (!cfg.v20) { cfg.pluggedOnly = false; cfg.v20 = true; }'), 'dimmer + on battery by default');
ok('keep awake works on battery (down to 20%); "keep the screen on" dims after a while away');

const pkg = JSON.parse(read('package.json'));
assert.ok(/^[23]\.\d+\.\d+$/.test(pkg.version) && read('sw.js').includes(`'apoji-admin-v${pkg.version}'`));
ok('version 2.0.x');
console.log(`v2.0: ${n} checks passed`);
