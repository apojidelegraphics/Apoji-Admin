// Apoji Admin 3.2: Testing rebuilt + release-notes fill, Profiles & frames, Apoji account, incident links, Apoji-wide search
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const v = R('v32.js'), sql = R('supabase/apoji-admin-3.2.sql'), admin = R('admin.js'), pkg = JSON.parse(R('package.json'));
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
ok('loaded everywhere and packed', () => { assert.ok(R('index.html').includes('<script src="v32.js"></script>') && R('sw.js').includes("'./v32.js'") && pkg.build.files.includes('v3*.js')); });
ok('short titles and platforms from release notes', () => {
  const NX = { sb: {}, $: () => null, esc: s => s, ago: () => '', when: () => '', toast() {}, A: { tab: '' }, pages: {}, can: () => true };
  vm.runInNewContext(v, { NX, window: {}, document: { querySelector: () => null, getElementById: () => null }, fetch: () => Promise.reject(), Set, Date, Math, Object, JSON, Promise, setTimeout, clearTimeout, String, Number, Array, URL });
  assert.strictEqual(NX.testTitle('Sets in the Cirkts shop: nine matching looks (picture frame, …).'), 'Sets in the Cirkts shop');
  assert.strictEqual(NX.testTitle('Desktop widgets remember where you put them, even when the system doesn\'t report the move. And more.'), 'Desktop widgets remember where you put them, even when the system doesn\'t report the move');
  assert.ok(NX.testTitle('x'.repeat(300)).length <= 110);
  assert.strictEqual(NX.testPlatform('Windows: the highlight orb works'), 'windows');
  assert.strictEqual(NX.testPlatform('N28C: dark boxes'), 'phone');
  assert.strictEqual(NX.testPlatform('Revamp the Testing page', ['admin']), 'admin');
  assert.strictEqual(NX.testPlatform('Friends see more on your profile'), 'all');
});
ok('Testing: open items, your own result, filters, release chips, fill from notes or plans, skips what\'s there', () => {
  for (const s of ['data-thead=', 'data-tmine=', "upsert({ item_id: id, user_id: A.user.id", "onConflict: 'item_id,user_id'", 'data-tf=', 'data-trel=', 'id="tPlat"', 'id="tQ"', 'whats-new/changes.json', "from('admin_release_plans')", 'f-row ${dup', 'NX.testAssign?.(T.rel)', 'NX.testGateCard'])
    assert.ok(v.includes(s), s);
  assert.ok(R('v25.js').includes('NX.testGateCard = r => gateCard(r); NX.testAssign = r => assignModal(r);'));
});
ok('Profiles & frames: tabs, real cards, resets that tell them; uploads is a tab of it', () => {
  assert.ok(admin.includes("['profiles', '🖼', 'Profiles & frames']") && admin.includes("'uploads'];"));
  for (const s of ["sb.rpc('admin_profiles'", "sb.rpc('admin_profile_reset'", 'NX.profileReset =', "['uploads', 'Pictures waiting']", "['reported', 'Reported']"]) assert.ok(v.includes(s), s);
  assert.ok(/admin_profile_reset[\s\S]*?if not public\.is_admin\(\)/.test(sql) && sql.includes("'Only the Owner can change the Owner''s profile.'") && sql.includes("insert into broadcasts (title, body, audience, to_user, created_by)") && sql.includes("action', 'profile_reset'") === false && sql.includes("('profile_reset', p_user"));
});
ok('One Apoji account: My settings card, user drawer card, fuller public profile', () => {
  assert.ok(R('pages.js').includes('NX.afterUserDrawer?.(el, uid, base)') && v.includes('NX.afterUserDrawer = async') && v.includes("sb.rpc('admin_profile_detail'"));
  assert.ok(v.includes("sb.rpc('apoji_account')") && v.includes("sb.rpc('apoji_link_code')") && v.includes("sb.rpc('profile_style_set'"));
  assert.ok(sql.includes("'pframe', s.pframe") && sql.includes("'frame_img', s.frame_img") && !/'email'/.test(sql.slice(sql.indexOf('function public.apoji_public_profile'), sql.indexOf('3) ---'))));
});
ok('status links and Apoji-wide search', () => {
  assert.ok(v.includes("sb.rpc('admin_link_incident'") && v.includes('id="ilRel"'));
  assert.ok(R('extras.js').includes('NX.paletteExtra ? await NX.paletteExtra(ql)') && v.includes("sb.rpc('admin_search'") && /admin_search[\s\S]*?if not public\.is_admin\(\)/.test(sql));
});
ok('version', () => { assert.ok(admin.includes("VERSION: '" + pkg.version + "'") && R('sw.js').includes('apoji-admin-v' + pkg.version) && R('README.md').includes('## ' + pkg.version)); });
console.log(`Apoji Admin 3.2: ${n} checks passed`);
