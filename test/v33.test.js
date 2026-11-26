// Apoji Admin 3.3: Health rebuilt, flags by platform, release plan → release notes in one click, upload card overflow
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const v = R('v33.js'), sql = R('supabase/apoji-admin-3.3.sql'), pkg = JSON.parse(R('package.json')), css = R('admin.css');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
ok('loaded everywhere, version 3.3.0 everywhere', () => {
  assert.ok(R('index.html').includes('<script src="v33.js"></script>') && R('sw.js').includes("'./v33.js'"));
  assert.strictEqual(pkg.version, '3.3.0'); assert.ok(R('admin.js').includes(`VERSION: '${pkg.version}'`) && R('sw.js').includes('apoji-admin-v' + pkg.version) && R('README.md').includes('## ' + pkg.version));
});
ok('plan → release notes: features first, fixes marked, chores left out', () => {
  const NX = { sb: {}, $: () => null, esc: s => s, ago: () => '', when: () => '', toast() {}, A: { tab: '' }, pages: {}, can: () => true };
  vm.runInNewContext(v, { NX, window: {}, document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null }, sessionStorage: { getItem: () => null, setItem() {} }, navigator: {}, performance: { now: () => 0 }, fetch: () => Promise.reject(), Set, Date, Math, Object, JSON, Promise, setTimeout, clearTimeout, String, Number, Array, URL });
  const lines = NX.planNotes({ items: [{ kind: 'fix', text: 'the custom profile upload doesnt show around the pfp' }, { kind: 'feature', text: 'profile visitors' }, { kind: 'chore', text: 'bump deps' }, { kind: 'feature', text: '  ' }] });
  assert.strictEqual(JSON.stringify(lines), JSON.stringify(['Profile visitors.', "Fixed: The custom profile upload doesnt show around the pfp."]));
  assert.strictEqual(typeof NX.publishNotes, 'function'); assert.strictEqual(typeof NX.publishPlanNotes, 'function');
  assert.ok(R('v26.js').includes('NX.publishPlanNotes'));
  assert.ok(v.includes('if (!RX.wired)'), 'Publish button listener added once, not every render');
});
ok('SQL: platforms limited to the four, release notes readable by everyone when published, health counts', () => {
  assert.ok(sql.includes("array['mac', 'windows', 'phone', 'test_run']") && sql.includes('primary key (app, version)') && sql.includes('using (published or public.is_admin())'));
  assert.ok(sql.includes('grant select on public.release_notes to anon') && sql.includes('admin_has_perm(\'changelog\')'));
  for (const k of ['surfaces', 'urgent_bugs', 'uploads_waiting', 'known_open', 'incidents_open']) assert.ok(sql.includes(`'${k}'`), k);
  assert.ok(sql.includes("status in ('new', 'triaged', 'working')") && sql.includes("not in ('fixed', 'wont_fix')"));
});
ok('Health page and flags Where column', () => {
  assert.ok(v.includes('P.health = async') && v.includes('hx-spark') && /30\s*\*?\s*1e3|30000|30e3/.test(v));
  assert.ok(R('features.js').includes('NX.health = {') && R('v27.js').includes('NX.serverFns = FNS'));
  assert.ok(v.includes("['test_run'") || v.includes("'test_run'"));
});
ok('upload review cards stay inside', () => { assert.ok(/\.up-it\s*\{[^}]*min-width:\s*0/.test(css) && css.includes('minmax(0, 1fr)') || css.includes('minmax(0,1fr)')); });
ok('cosmetics match Nexus', () => { const nx = path.join(__dirname, '../../nexus-desktop/renderer/cosmetics.js'); if (fs.existsSync(nx)) assert.strictEqual(R('cosmetics.js'), fs.readFileSync(nx, 'utf8')); });
console.log(`v3.3: ${n} passed`);
