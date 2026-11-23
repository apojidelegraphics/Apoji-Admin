// Apoji Admin 2.9: pictures and frames from the shared Apoji profile (apoji_profiles in nexus-v4.0.1.sql)
const assert = require('assert'), fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const admin = read('admin.js'), html = read('index.html'), pkg = JSON.parse(read('package.json'));
assert.ok(admin.includes("rawSb.rpc('apoji_profiles'") && admin.includes('data-uid=') && admin.includes("'nxp-f-' + fk"));
assert.ok(html.indexOf('cosmetics.js') > -1 && html.indexOf('cosmetics.js') < html.indexOf('src="admin.js"'));
assert.ok(pkg.build.files.includes('cosmetics.js') && read('sw.js').includes("'./cosmetics.js'"));
assert.ok(read('cosmetics.js').includes('window.NexusCosmetics') && read('admin.css').includes('.av.framed::after'));
console.log('Apoji Admin 2.9: 4 checks passed');
