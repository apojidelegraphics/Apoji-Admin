// Apoji Admin 2.2: the Beta dashboard, the web search maintenance switch, Mac & PC wording.
const assert = require('assert'), fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let n = 0; const ok = m => { n++; console.log('  ✓ ' + m); };
const pages = read('pages.js'), pkg = require('../package.json');
assert.ok(pages.includes("P.beta = async") && pages.includes("sb.rpc('admin_beta_stats')") && pages.includes('data-reports') && pages.includes("if (f.feature) q = q.eq('feature', f.feature)"));
assert.ok(read('admin.js').includes("['beta', 'β', 'Beta']") && read('extras.js').includes("['beta', 'β', 'Beta']") && read('admin.css').includes('.beta-stats'));
ok('Beta dashboard: stage, uses, people, thumbs, notes and bug reports per feature');
assert.ok(pages.includes("['websearch', '🔎 Web search'") && read('features.js').includes("['websearch', '🔎 Web search']"));
ok('Maintenance: one web search switch');
const f = read('features.js');
assert.ok(f.includes('🖥 Desktop hub') && f.includes('Desktop versions (Mac &amp; PC)') && !f.includes("'Your Mac didn’t answer"));
assert.ok(!/Your Mac|your Mac/.test(read('v18.js')));
ok('Mac & PC: Desktop hub, releases, broadcasts and Nexus chat');
assert.ok(read('README.md').includes('## 2.2'));
ok('version 2.2.0');
console.log(`Apoji Admin 2.2: ${n} checks passed`);
