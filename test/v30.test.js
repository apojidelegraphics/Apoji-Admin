// Apoji Admin 3.0: crown back in the corner, idle/dnd marks scale, spacing pass, lightbox buttons, preview bar placement
const assert = require('assert'), fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const css = read('admin.css'), v26 = read('v26.js'), v28 = read('v28.js'), pkg = JSON.parse(read('package.json'));
assert.ok(css.includes('top: 14.6% !important; left: 14.6% !important; bottom: auto; transform: translate(-62%, -78%) rotate(-28deg)'));
assert.ok(css.includes('.pr.idle::after { inset: auto !important; top: -6% !important; right: -6% !important; width: 62% !important;') && css.includes('.pr.dnd::after { left: 22% !important;'));
assert.ok(v28.includes("wrap.querySelector('.dg-main').appendChild(md)") && css.includes('.me-cols { display: block !important; columns: 2 420px;') && css.includes('.lightbox .lb-acts a, .lightbox .lb-acts .btn { position: static !important;'));
assert.ok(v26.includes("hd.insertAdjacentHTML('afterend', html)") && v26.includes('class="pv-txt"'));
assert.ok(read('cosmetics.js').includes('.nxp-crown { position: absolute; z-index: 4; left: 14.6%; top: 14.6%;'));
assert.ok(/^3\.\d+\.\d+$/.test(pkg.version) && read('README.md').includes('## ' + pkg.version));
console.log('Apoji Admin 3.0: 6 checks passed');
