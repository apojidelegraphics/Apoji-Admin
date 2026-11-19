// Apoji Admin 2.5: lesson rollout with undo, auto-sort, Free API usage, test assignment + release gate, redeem an
// order for a customer, Axiom's cage wear, Tree / Graph on Training, and the Terms. (Doesn't read the Nexus repo.)
const assert = require('assert'), fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let n = 0; const ok = m => { n++; console.log('  ✓ ' + m); };
const pkg = JSON.parse(read('package.json')), v25 = read('v25.js'), v23 = read('v23.js'), html = read('index.html');

const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
for (const f of ['mindtree.js', 'terms-data.js', 'v25.js']) assert.ok(srcs.includes(f) && read('sw.js').includes('./' + f), f + ' is loaded and cached');
assert.ok(srcs.indexOf('terms-data.js') < srcs.indexOf('v25.js') && srcs.indexOf('v23.js') < srcs.indexOf('v25.js'));
assert.ok(pkg.build.files.includes('terms-data.js') && pkg.build.files.includes('mindtree.js') && pkg.build.files.includes('v2*.js'), 'packed into the desktop apps');
ok('2.5 files are loaded, cached offline and packed into the Mac and Windows apps');

assert.ok(v25.includes("sb.rpc('admin_training_push'") && v25.includes("sb.rpc('admin_training_promote'") && v25.includes("sb.rpc('admin_training_undo'") && v25.includes('data.can_push'));
assert.ok(v25.includes('before → <b>') && v23.includes('NX.trainingShip(b)') && v23.includes("id=\"trPush\""));
assert.ok(v25.includes("training_push: ['🚀 Push lessons'") && v25.includes("redeem: ['🧾 Redeem orders for people'"));
ok('Training → Ship: push lessons admins → beta → everyone with the 👍 rate before and after, and Undo (Owner + chosen high-admins)');

assert.ok(v25.includes('NX.trainingAutoSort') && v25.includes("model: 'openrouter/free'") && /'good', 'wrong', 'private', 'unsure'/.test(v25) && v23.includes("id=\"trAuto\"") && v23.includes("auto_label,auto_note"));
ok('✨ Auto-sort pre-labels the review queue with the free model (and flags personal info)');

assert.ok(v25.includes('P.freeapi = async') && v25.includes("sb.rpc('admin_free_usage')") && read('admin.js').includes("['freeapi', '📊', 'Free API usage']") && read('features.js').includes('NX.freeKeyCredit'));
ok('📊 Free API usage: Nexus speech against Groq’s free limits, Test Run, and the free key’s credit');

assert.ok(v25.includes("sb.rpc('admin_assign_tests'") && v25.includes("sb.rpc('admin_testers')") && v25.includes('id="asAuto"') && v25.includes("sb.rpc('admin_release_gate'"));
assert.ok(read('features.js').includes('NX.releaseGate(ver)') && v25.includes('P.releases = async'));
ok('🧪 Testing: assign tests to testers (matched by the apps they use) and the release gate (Testing, Releases, changelog email)');

assert.ok(v25.includes('NX.redeemFor = async') && v25.includes("sb.rpc('admin_redeem_for'") && read('pages.js').includes('id="ordGo"') && v25.includes('order_id,plan_type,status,config'));
ok('🧾 Redeem an order for a customer from their drawer (looked up in the store; never customer details)');

const v19 = read('v19.js');
assert.ok(v19.includes('function wearRows(c)') && v19.includes('function advice(') && v19.includes('2 days old') && v19.includes('attempt_chance'));
ok('Axiom’s cage: driver age, wear (starts at 2 days), the odds of the next attempt, and what to do');

const mt = read('mindtree.js');
assert.ok(mt.includes('function drawGraph()') && mt.includes('setMode,') && v23.includes('data-tmode="graph"') && v23.includes("NX.store.set('trMode'"));
ok('Training map: 🌳 Tree or ◉ Graph (Obsidian-style), remembered');

const T = require('../terms-data.js');
assert.ok(T.TERMS.sections.some(s => s.id === 'admins' && (s.who || []).includes('admin')) && v25.includes('P.terms = async') && v25.includes('NX.termsCheck = async') && read('admin.js').includes("['terms', '⚖', 'Terms']") && read('admin.js').includes('NX.termsCheck?.()'));
ok('📜 Terms page (admin part highlighted) and admins agree once per version');

assert.strictEqual(pkg.version, '2.5.0');
assert.ok(read('admin.js').includes("VERSION: '2.5.0'") && read('sw.js').includes('apoji-admin-v2.5.0') && read('README.md').includes('## 2.5'));
ok('version 2.5.0');
console.log(`Apoji Admin 2.5: ${n} checks passed`);
