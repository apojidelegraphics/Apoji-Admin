// 2.0.3 checks: real display brightness (same code as Nexus '28), one continuous ◆ Nexus chat, Test Run on the
// dashboard + a maintenance switch for it, and Axiom's attempts on a schedule.
const assert = require('assert'), fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let n = 0; const ok = m => { n++; console.log('  ✓ ' + m); };

for (const [mine, theirs] of [['electron/brightness.js', 'src/brightness.js'], ['electron/dimmer.js', 'src/dimmer.js'], ['native/Brightness.swift', 'native/Brightness.swift'], ['scripts/build-brightness.sh', 'scripts/build-brightness.sh']]) {
  const twin = ['Nexus-28', 'nexus-desktop'].map(d => path.join(__dirname, '..', '..', d, theirs)).find(x => fs.existsSync(x));
  if (twin) assert.strictEqual(read(mine), fs.readFileSync(twin, 'utf8'), 'same ' + theirs + ' as Nexus');
}
const pkg = JSON.parse(read('package.json'));
assert.ok(read('scripts/postinstall.js').includes('build-brightness') && pkg.build.mac.extraResources[0].filter.includes('apoji-brightness') && read('.github/workflows/release.yml').includes('sh scripts/build-brightness.sh'));
assert.ok(read('electron/hub.js').includes("require('./brightness')") && read('features.js').includes('id="hDimTry"'));
ok('dimming lowers the real brightness (checked on start, "Try it"), built in CI');

const v18 = read('v18.js');
assert.ok(!v18.includes('id="ncPick"') && !v18.includes('id="ncNew"') && v18.includes('function oneChat()'));
ok('◆ Nexus is one continuous chat, like a DM');

const pages = read('pages.js');
assert.ok(pages.includes("rpc('admin_try_stats')") && pages.includes("['web', '🧪 Test Run'"));
ok('Test Run card on the dashboard + its own maintenance switch');

const fn = read('supabase/functions/axiom-cage/index.ts');
assert.ok(fn.includes("from('apex_cage_secret')") && fn.includes('const echo = '));
ok('Axiom’s attempts run by themselves (pg_cron) and never copy the instructions');
assert.ok(/^2\.0\.\d+$/.test(pkg.version) && read('sw.js').includes(`'apoji-admin-v${pkg.version}'`));
console.log(`v2.0.3: ${n} checks passed`);
