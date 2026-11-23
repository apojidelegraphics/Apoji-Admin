// Apoji Admin 2.3: admin access requests, "active on", testing checklists, training (with the mind map), pictures on
// feedback, bug vs feature, temporary passwords, typing switches, save image, phone chat header, keep awake rebuilt.
const assert = require('assert'), fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let n = 0; const ok = m => { n++; console.log('  ✓ ' + m); };
const v = read('v23.js'), pages = read('pages.js'), admin = read('admin.js'), chat = read('chat.js'), pkg = require('../package.json');
assert.ok(v.includes('P.perms = async') && v.includes("sb.rpc('admin_request_perm'") && v.includes("sb.rpc('admin_decide_perm'") && v.includes("sb.rpc('admin_set_approver'") && admin.includes("['perms', '🔐', 'Admin access', 'perms']") && admin.includes('NX.loadPerms?.()'));
ok('Admin access: request, approve for a while or for good, approvers picked by the Owner');
assert.ok(v.includes('NX.surfaceChips') && v.includes("presence_ping', { p_surface: 'admin'") && pages.includes('<th>Active on</th>') && pages.includes('NX.softwareCard?.(uid)') && v.includes("p.new?.kind !== 'got_app'"));
ok('active on: chips in Users, a What they use card, 🎉 when a Test Run person gets the app');
assert.ok(v.includes('P.testing = async') && v.includes('Fill from the release notes') && v.includes('data-tbug') && admin.includes("['testing', '🧪', 'Testing']"));
ok('Testing checklists, filled from the release notes, fails become bug reports');
assert.ok(v.includes('P.training = async') && v.includes('function mindMap()') && v.includes('Export for fine-tuning (JSONL)') && admin.includes("['training', '🧠', 'Training']"));
ok('Training page with the mind map and exports');
assert.ok(pages.includes("FB_GROUP = { bugs: ['bug', 'beta'], features: ['feature']") && pages.includes('data-sortk') && pages.includes("from('feedback-files').upload") && v.includes('NX.saveImage') && chat.includes("sv.className = 'save-img'"));
ok('bugs and feature ideas apart, pictures on reports, ⬇ Save image in reports and chat');
assert.ok(pages.includes("data-ac=\"temp\"") && pages.includes('Nobody can see someone') && read('supabase/functions/admin-users/index.ts').includes("action === 'temp_password'") && read('supabase/functions/admin-users/index.ts').includes("admin_has_perm"));
ok('temporary passwords (nobody can see a password) and granted access in admin-users');
assert.ok(chat.includes('typing_send === false') && chat.includes('typing_show === false') && pages.includes("tog('tySend'"));
ok('typing indicator switches');
assert.ok(read('admin.css').includes('.thread .top .e2t { display: none; }') && chat.includes('<span class="e2t"> E2EE</span>'));
ok('Team chat header fits on phones');
const aw = read('electron/awake.js');
assert.ok(aw.includes('async function verify(') && aw.includes('async function reset()') && read('features.js').includes('data-hmode') && read('features.js').includes('hAwReset') && read('electron/hub.js').includes("'hub:awakeReset'") && read('electron/hub-core.js').includes("'forMinutes' in patch"));
ok('keep awake rebuilt: confirmed by the system, for a while, battery floor, Reset');
assert.ok(pkg.version.localeCompare('2.3.0', undefined, { numeric: true }) >= 0); assert.ok( read('sw.js').includes('./v23.js') && read('index.html').includes('v23.js') && read('README.md').includes('## 2.3'));
ok('2.3 is wired into the page and the offline cache');
console.log(`Apoji Admin 2.3: ${n} checks passed`);
// 2.3.1: every script the page loads must be packed into the Mac and Windows apps (v23.js was missing, so Admin
// access, Testing, Training and "active on" only worked on the website)
{
  const files = require('../package.json').build.files, mm = require('path');
  const glob = g => new RegExp('^' + g.replace(/\./g, '\\.').replace(/\*\*/g, '.+').replace(/\*/g, '[^/]*') + '$');
  const scripts = [...read('index.html').matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s));
  for (const s of scripts) assert.ok(files.some(f => glob(f).test(s)), s + ' is not packed into the desktop app');
  console.log(`  ✓ every page script (${scripts.length}) is packed into the desktop app`);
}
