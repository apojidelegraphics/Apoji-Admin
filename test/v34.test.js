// Apoji Admin 3.4: session replays page + player, A/B splits on feature flags
const assert = require('assert'), fs = require('fs'), path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const pkg = JSON.parse(R('package.json')), v = R('v34.js'), admin = R('admin.js');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
ok('version 3.4.0 everywhere, loaded and cached', () => {
  assert.strictEqual(pkg.version, '3.4.0'); assert.ok(admin.includes("VERSION: '3.4.0'") && R('sw.js').includes('apoji-admin-v3.4.0') && R('README.md').includes('## 3.4.0'));
  assert.ok(R('index.html').includes('<script src="v34.js"></script>') && R('sw.js').includes("'./v34.js'") && pkg.build.files.includes('v3*.js'));
});
ok('Session replays page in INSIGHTS: filters, summary, player', () => {
  assert.ok(admin.includes("['replays', '👁', 'Session replays']") && v.includes('P.replays = async') && v.includes("from('session_replays')"));
  for (const k of ['Screens people visit', 'Where sessions end', 'Most-clicked', 'function player(', 'rpErrJump', 'data-spd']) assert.ok(v.includes(k), k);
  assert.ok(!/content|message|body/.test((v.match(/select\('id,app[^']*'\)/) || [''])[0]), 'replays query reads only step fields');
});
ok('flags: Split column (100/50/25/10) writes rollout and logs it; Results compares A and B', () => {
  assert.ok(v.includes("[50, 'Half (A/B test)']") && v.includes("update({ rollout: v") && v.includes("action: 'flag_split'") && v.includes('async function abResults'));
});
ok('terms match Nexus', () => { const nx = path.join(__dirname, '../../nexus-desktop/renderer/terms-data.js'); if (fs.existsSync(nx)) assert.strictEqual(R('terms-data.js'), fs.readFileSync(nx, 'utf8')); });
console.log(`v3.4: ${n} passed`);
