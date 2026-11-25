// Apoji Admin 3.1: Profile uploads review page (Nexus 4.0.6 "Make your own")
const assert = require('assert'), fs = require('fs'), path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const v = R('v31.js'), html = R('index.html'), sw = R('sw.js'), pkg = JSON.parse(R('package.json')), admin = R('admin.js');
assert.ok(admin.includes("['uploads', '🖼', 'Profile uploads']") && v.includes('P.uploads = async'));
assert.ok(html.includes('<script src="v31.js"></script>') && sw.includes("'./v31.js'") && pkg.build.files.includes('v3*.js'));
assert.ok(v.includes("sb.rpc('admin_cosmetic_uploads'") && v.includes("sb.rpc('admin_cosmetic_review'") && v.includes("sb.rpc('admin_cosmetic_takedown'"));
assert.ok(v.includes('referrerpolicy="no-referrer"') && !/innerHTML = [^;]*\$\{u\.url\}/.test(v.replace(/esc\(u\.url\)/g, '')));   // every url goes through esc()
assert.ok(R('cosmetics.js').includes('SAFE_MINE') && R('cosmetics.js') === fs.readFileSync(path.join(__dirname, '..', '..', 'nexus-desktop', 'renderer', 'cosmetics.js'), 'utf8') || !fs.existsSync(path.join(__dirname, '..', '..', 'nexus-desktop')));
assert.ok(admin.includes("VERSION: '" + pkg.version + "'") && sw.includes('apoji-admin-v' + pkg.version));
console.log('Apoji Admin 3.1: 6 checks passed');
