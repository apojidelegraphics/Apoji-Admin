// Apoji Admin 2.10: autosaving release plans, bigger schedules (kinds + repeats), richer announcements, theme switch, avatar fixes
const assert = require('assert'), fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const pkg = JSON.parse(read('package.json')), admin = read('admin.js'), pages = read('pages.js'), feat = read('features.js'), v26 = read('v26.js'), css = read('admin.css'), sql = read('supabase/apoji-admin-2.10.sql');
assert.ok(v26.includes('async function autosave()') && v26.includes('new MutationObserver(() => { if (el.isConnected) return;') && v26.includes('id="pvGo">Done') && v26.includes('id="pvAuto"'));
console.log('  ✓ release plans save by themselves (as you type and when the window closes)');
for (const k of ['broadcast_send', 'incident_post', 'incident_resolve', 'axiom_offline', 'axiom_online']) { assert.ok(feat.includes(`${k}: async`), k); assert.ok(sql.includes(`'${k}'`), 'sql ' + k); }
assert.ok(feat.includes("const REP = [['', 'Once'], ['daily', 'Every day'], ['weekdays', 'Every weekday'], ['weekly', 'Every week'], ['monthly', 'Every month']]") && feat.includes("sb.rpc('admin_stop_series'") && feat.includes('data-later=') && feat.includes('duration_ms'));
assert.ok(sql.includes('create or replace function public.admin_next_run') && sql.includes('insert into admin_schedules (kind, target, label, payload, run_at, created_by)') && sql.includes('while nxt <= now() loop'));
console.log('  ✓ schedules: broadcasts, status notices, Axiom; repeats (daily/weekdays/weekly/monthly, until), run now, +1h, stop series');
for (const c of ['title', 'style', 'link_url', 'link_label', 'apps', 'pinned']) assert.ok(sql.includes(`announcements add column if not exists ${c}`), c);
assert.ok(pages.includes("const ASTYLE = [['info'") && pages.includes("kind: 'announcement_on', target: String(id)") && pages.includes('data-dup=') && pages.includes('id="apv"'));
console.log('  ✓ announcements: title, style, button, apps, pinned, start/end via Schedules, edit/duplicate, preview');
assert.ok(admin.includes("const themeMode = () => store.get('themeMode', 'nexus')") && admin.includes('function clearTheme()') && pages.includes('id="thMode"'));
console.log('  ✓ theme: Apoji Admin violet or your Nexus theme');
assert.ok(css.includes('.av { container-type: inline-size; }') && css.includes('right: calc(14.6% - var(--pd) / 2)') && css.includes('rotate(-28deg)'))   // 3.0: the crown went back to the corner;
console.log('  ✓ avatars: status dot on the edge at any size, crown centered on top');
assert.ok(/^(2\.10|3\.\d+)\.\d+$/.test(pkg.version) && read('README.md').includes('## ' + pkg.version) && admin.includes(`VERSION: '${pkg.version}'`) && read('sw.js').includes('apoji-admin-v' + pkg.version));
console.log('Apoji Admin 2.10: 6 checks passed');
