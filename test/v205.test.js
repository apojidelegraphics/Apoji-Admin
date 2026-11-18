// 2.0.5 checks: the Owner's crown on the top-left of the picture, and maintenance in the ◆ Nexus chat / @mentions.
const assert = require('assert'), fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
assert.ok(/\.av \.av-crown \{[^}]*left: -6px[^}]*rotate\(-22deg\)/.test(read('admin.css')));
console.log("  ✓ the Owner's crown sits on the top-left of the picture");
const v18 = read('v18.js');
assert.ok(v18.includes('async function maintFor(agentId)') && v18.includes('m.admin_bypass === false') && /async function ask\([^)]*\) \{\s*const down = await maintFor\(agentId\)/.test(v18));
console.log('  ✓ ◆ Nexus and @mentions respect maintenance switches that admins don’t bypass');
assert.strictEqual(JSON.parse(read('package.json')).version, '2.0.5'); assert.ok(read('sw.js').includes('v2.0.5'));
console.log('2.0.5: 3 checks passed');
