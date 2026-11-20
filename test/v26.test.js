// Apoji Admin 2.6: Mexel (aARgon3 staff system), release planning, Preview as, removable flags, lessons on the map,
// and our own icons. (Doesn't read the Nexus or aArgon3 repos.)
const assert = require('assert'), fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let n = 0; const ok = m => { n++; console.log('  ✓ ' + m); };
const pkg = JSON.parse(read('package.json')), html = read('index.html'), v26 = read('v26.js'), icons = read('icons.js');
const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
for (const f of ['v26.js', 'icons.js']) assert.ok(srcs.includes(f) && read('sw.js').includes('./' + f), f);
assert.ok(srcs.some(s => /qrcode-generator@1\.4\.4/.test(s)) && pkg.build.files.includes('icons.js'));
ok('2.6 files are loaded, cached and packed');

for (const a of ["'me'", "'orders'", "'order'", "'cancel'", "'comp'", "'sale'", "'sale_status'", "'shifts'", "'edit_shift'", "'clock_in'", "'clock_out'", "'break'", "'log'"]) assert.ok(v26.includes(`mexel(${a}`), 'staff action ' + a);
assert.ok(v26.includes('/functions/v1/staff') && v26.includes('Authorization: `Bearer ${token}`') && v26.includes("['mexel', '🧾', 'Mexel']") === false && read('admin.js').includes("['MONEY', [['mexel', '🧾', 'Mexel']]]"));
assert.ok(v26.includes('r.ready') && v26.includes("r.state === 'expired'") && v26.includes('NX.qrSvg'));
ok('🧾 Mexel: Today, Orders (cancel / refund / free), Sell (link + QR, waits for payment), Timesheets (fix, CSV), Log');

const sql = read('supabase/apoji-admin-2.6.sql');
assert.ok(sql.includes('create table if not exists public.admin_release_plans') && sql.includes("status in ('idea', 'planned', 'building', 'testing', 'released', 'dropped')") && sql.includes('release_plans_can_write') && sql.includes('admin_release_plans_log'));
assert.ok(v26.includes('NX.releasePlans = async') && v26.includes("id=\"pvTests\"") && v26.includes("id=\"pvNotes\"") && v26.includes('NX.releaseGate?.(slot.dataset.gate)'));
ok('🗓 Release planning: versions with dates, status, apps and a checklist; to Testing; release notes; the gate');

assert.ok(v26.includes('NX.previewAs = role') && /'high-viewer'/.test(v26) && /mod: \['Moderator'/.test(v26) && v26.includes('preview-bar') && v26.includes('A.realOwner'));
ok('👁 Preview as (Owner only): High-admin, Viewer, Admin, Moderator, with a bar to stop');

assert.ok(read('pages.js').includes('data-delflag') && read('pages.js').includes(".from('feature_flags').delete()"));
ok('🗑 feature flags can be removed');

const v23 = read('v23.js');
assert.ok(v23.includes("id: 'u-lessons'") && v23.includes("id: 'p-pushes'") && v23.indexOf('const lessonLeaves') > v23.indexOf('const pl = (k, w)'), 'lessons on the map, after leaf() exists');
ok('📚 lessons (and pushes) on the Training map');

const I = (() => { const sandbox = { NX: {}, document: { readyState: 'loading', addEventListener() {} }, requestAnimationFrame() {}, MutationObserver: class { observe() {} } }; new Function(...Object.keys(sandbox), icons)(...Object.values(sandbox)); return sandbox.NX; })();
assert.ok(Object.keys(I.ICONS).length >= 90);
for (const [e, name] of Object.entries(I.EMOJI_ICONS)) assert.ok(I.ICONS[name], `${e} → ${name} is drawn`);
for (const e of ['🧪', '🚀', '🧠', '🔒', '👑', '📮', '🛡', '🧾', '🗓']) assert.ok(I.EMOJI_ICONS[e], e);
assert.ok(I.iconFor('🚀 Push lessons').rest === 'Push lessons' && I.iconFor('Plain words') === null);
assert.ok(icons.includes('.msgs,.thread,.emojis') && read('mindtree.js').includes('iconFor') && v23.includes('iconFor: NX.iconFor'));
ok('our own icons for every emoji in the interface (not in what people type), in the mind map too');

assert.strictEqual(pkg.version, '2.6.0');
assert.ok(read('admin.js').includes("VERSION: '2.6.0'") && read('sw.js').includes('apoji-admin-v2.6.0') && read('README.md').includes('## 2.6'));
ok('version 2.6.0');
console.log(`Apoji Admin 2.6: ${n} checks passed`);
