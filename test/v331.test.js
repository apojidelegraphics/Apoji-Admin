// Apoji Admin 3.3.1: mark all done, platforms on releases and items, one answer to "are they online"
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const pkg = JSON.parse(R('package.json')), v26 = R('v26.js'), admin = R('admin.js'), sql = R('supabase/apoji-admin-3.3.1.sql');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
ok('version 3.3.1 everywhere', () => { assert.ok(pkg.version.split('.').map(Number).reduce((a, x) => a * 1000 + x) >= 3003001); assert.ok(admin.includes("VERSION: '" + pkg.version + "'") && R('sw.js').includes('apoji-admin-v' + pkg.version) && R('README.md').includes('## 3.3.1')); });
ok('mark all done toggles every item', () => { assert.ok(v26.includes("id=\"pvAll\"") && v26.includes("items.forEach(x => { x.done = !every; })") && v26.includes("'Mark all not done'")); });
ok('platforms: item pick wins, else the release; one test per platform; Test Run is "web" in Testing', () => {
  const NX = { A: {}, pages: {}, can: () => true, testPlatform: () => 'all' };
  const start = v26.indexOf('  const PLATS = ['), end = v26.indexOf('NX.planItemPlats = itemPlats');
  vm.runInNewContext(v26.slice(start, end) + 'NX.planItemPlats = itemPlats;', { NX });
  const p = { platforms: ['mac', 'windows'] };
  assert.strictEqual(JSON.stringify(NX.planTestRows({ text: 'a' }, p, 'A').map(r => r.platform)), '["mac","windows"]');
  assert.strictEqual(JSON.stringify(NX.planTestRows({ text: 'b', platforms: ['test_run'] }, p, 'B').map(r => r.platform)), '["web"]');
  assert.strictEqual(JSON.stringify(NX.planTestRows({ text: 'c', platforms: ['nope'] }, {}, 'C').map(r => r.platform)), '["all"]');
  assert.ok(R('v33.js').includes('NX.planTestRows(itemOf(h), p, title)'));
});
ok('saving still works before the SQL runs; SQL only allows the four platforms', () => {
  assert.ok(v26.includes('NX.plansNoPlatforms = true') && v26.includes("...(NX.plansNoPlatforms ? {} :"));
  assert.ok(sql.includes("array['mac', 'windows', 'phone', 'test_run']") && sql.includes('add column if not exists platforms'));
});
ok('presence: one rule (Admin heartbeat or an app in the last 5 min) for dots and the profile card', () => {
  assert.ok(admin.includes('APP_LIVE = 5 * 60e3') && admin.includes("presence(adminById(a?.id || a?.user_id) || a)") && admin.includes('const repaintPresence'));
  assert.ok(R('v23.js').includes('NX.markSeen?.(uid, r.seen_at)') && R('v32.js').includes("data.card.online = adm ? NX.presence(adm) !== 'offline'") && R('v33.js').includes("from('user_presence').select('user_id,seen_at')"));
  // the rule itself
  const src = admin.slice(admin.indexOf('  const SEEN = new Map()'), admin.indexOf('  // 2.8: Idle you picked yourself'));
  const NX = { A: { user: { id: 'me' }, admins: [{ id: 'd', status: 'auto', last_seen: new Date(Date.now() - 3600e3).toISOString() }], prefs: {} } };
  const ctx = { NX, Date, Map, myStatus: () => 'auto' }; vm.runInNewContext(src + ';this.presence = presence; this.markSeen = markSeen;', ctx);
  assert.strictEqual(ctx.presence({ id: 'd' }), 'offline');
  ctx.markSeen('d', new Date().toISOString()); assert.strictEqual(ctx.presence({ id: 'd' }), 'online');   // using the Windows app = online
  NX.A.admins[0].status = 'invisible'; assert.strictEqual(ctx.presence({ id: 'd' }), 'offline');        // invisible stays hidden
});
console.log(`v3.3.1: ${n} passed`);
