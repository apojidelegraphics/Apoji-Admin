// Apoji Admin 2.4: desktop apps pack every script (Admin access, Testing, Training and "active on" work on Mac and
// Windows), and Training is a working map: each step shows live numbers and opens what you can do there.
const assert = require('assert'), fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let n = 0; const ok = m => { n++; console.log('  ✓ ' + m); };
const pkg = JSON.parse(read('package.json'));

// every <script src> in index.html is in build.files
const files = pkg.build.files, globRe = g => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '§').replace(/\*/g, '[^/]*').replace(/§/g, '.*') + '$');
const srcs = [...read('index.html').matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1].replace(/^\.\//, '')).filter(s => !/^https?:/.test(s));
assert.ok(srcs.includes('v23.js'));
for (const s of srcs) assert.ok(files.some(f => !f.startsWith('!') && globRe(f).test(s)), s + ' is not packed into the desktop apps');
ok('every script the page loads is packed into the Mac and Windows apps');

const v = read('v23.js');
for (const k of ['collect', 'clean', 'store', 'use', 'check', 'ship']) assert.ok(v.includes(`id: '${k}'`), 'step ' + k);
assert.ok(v.includes('MindTree.create($(\'trTree\')') && v.includes("s.side = i < 3 ? 'right' : 'left'") && v.includes('A.trFold'));
assert.ok(srcs.indexOf('mindtree.js') >= 0 && srcs.indexOf('mindtree.js') < srcs.indexOf('v23.js') && read('sw.js').includes('./mindtree.js'));
const mtree = read('mindtree.js'); assert.ok(mtree.includes('root.MindTree') && mtree.includes('collapseAll()') && mtree.includes("side !== 'left'"));
assert.ok(v.includes("sb.rpc('admin_training_stats')") && v.includes('A.trStep') && v.includes('async function trPanel('));
assert.ok(v.includes('data-approve') && v.includes('data-skip') && v.includes('data-unapprove') && v.includes('data-rule'));
assert.ok(v.includes("approved: true") && v.includes('approved_by') && v.includes('lesson'));
assert.ok(v.includes('Try a question') && v.includes("'training_lessons'"));
assert.ok(v.includes('NX.trainingMap') || v.includes('function mindMap()'), 'the old static map is kept');
ok('Training is a Notion-style mind map (mindtree.js, same as Nexus): live numbers per step, a review queue that turns examples into lessons, and a lesson tester');

const readme = read('README.md');
assert.ok(readme.includes('## 2.4') && readme.includes('docs/training-mind-map.png') && fs.existsSync(path.join(__dirname, '..', 'docs', 'training-mind-map.png')));
ok('README explains the training flow, with the map picture');

assert.ok(pkg.version.localeCompare('2.4.1', undefined, { numeric: true }) >= 0 && read('sw.js').includes('./v23.js'));
ok('2.4.1 is in the page and the offline cache');
console.log(`Apoji Admin 2.4: ${n} checks passed`);
