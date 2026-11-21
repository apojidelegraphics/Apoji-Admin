// Apoji Admin 2.7: emojis gone from chat and feedback (not reactions), gold crown, phone drawers you can close, Mexel
// Sales / You / Promotions, STAFF (Shifts, Employees), release plans (Copy info, editable items), API usage with the
// Paragon & Axiom models, and the early features for everyone.
const assert = require('assert'), fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let n = 0; const ok = m => { n++; console.log('  ✓ ' + m); };
const pkg = JSON.parse(read('package.json')), html = read('index.html'), v27 = read('v27.js'), v26 = read('v26.js'), admin = read('admin.js'), css = read('admin.css'), icons = read('icons.js');

// icons: the chat panel and feedback threads are drawn with icons; only what people wrote and reactions keep emojis
assert.ok(!/KEEP = '[^']*\.thread,/.test(icons) && !icons.includes('.msgs > .m,'), 'the whole chat panel is no longer skipped');
assert.ok(icons.includes('.msgs .m .tx') && icons.includes('[data-rx]') && icons.includes('[data-act="react"]') && icons.includes('.thread-r .rb'));
assert.ok(icons.includes('function stripOptions') && read('pages.js').includes('<span class="rb">'));
const sandbox = { NX: {}, document: { readyState: 'loading', addEventListener() {} }, requestAnimationFrame() {}, MutationObserver: class { observe() {} } };
new Function(...Object.keys(sandbox), icons)(...Object.values(sandbox));
assert.ok(sandbox.NX.icon('crown').includes('<svg') && sandbox.NX.EMOJI_ICONS['📌'] === 'pin');
ok('emojis: chat and feedback chrome use icons; reactions and what people typed are left alone; select menus drop them');

assert.ok(/\.av \.av-crown \.ico \{ fill: #ffd36b/.test(css) && !/\.av\.img \.av-crown \{ color: initial; \}\s*$/.test(css.slice(-4000)));
ok('the Owner crown is gold');

assert.ok(admin.includes("className: 'btn drawer-done', textContent: 'Close'") && admin.includes("history.pushState({ nxOverlay: 1 }") && admin.includes("addEventListener('popstate'") && admin.includes("[data-x],[data-close]"));
assert.ok(css.includes('.drawer > .x { position: fixed; top: calc(10px + env(safe-area-inset-top))') && css.includes('.drawer-done { display: block;'));
ok('phone drawers: a Close bar, swipe right, Back closes; Close/Cancel buttons in dialogs work');

// Mexel
assert.ok(v26.includes("['sales', 'Sales']") && v26.includes("['promos', 'Promotions', 'm']") && v26.includes("['you', 'You']") && !v26.includes("['time', 'Timesheets']") && v26.includes("if (A.arg === 'time') return NX.go('shifts')"));
for (const k of ['sales', 'you', 'promos']) assert.ok(v27.includes(`NX.mexelTabs.${k} = async function`), k);
assert.ok(v27.includes("mexel('sales'") && v27.includes('gross revenue, all time') && v27.includes('average order') && v27.includes('Orders by plan type') && v27.includes('By store') && v27.includes('total orders'));
assert.ok(v27.includes("mexel('promo_save'") && v27.includes("mexel('promos')") && v27.includes("mexel('profile_save'") && v27.includes("mexel('timeoff_request'"));
assert.ok(css.includes('.mx-body { display: flex; flex-direction: column; gap: 16px; }'));
ok('Mexel: Sales (all time, revenue by month, orders, average, by plan / store / tier / source / seller), You, Promotions, spacing');

// STAFF
assert.ok(admin.includes("['STAFF', [['shifts', '🗓', 'Shifts'], ['employees', '👥', 'Employees']]]") && v27.includes('P.shifts = async') && v27.includes('P.employees = async'));
assert.ok(v27.includes("mexel('schedule'") && v27.includes("mexel('schedule_save'") && v27.includes("mexel('schedule_copy'") && v27.includes("mexel('team_save'") && v27.includes("mexel('timeoff_decide'") && v26.includes('NX.mexelTimesheets = time'));
ok('STAFF: Shifts (this week, add / change / copy shifts, timesheets) and Employees (team, add someone, time off)');

// release plans
assert.ok(v26.includes('const planText = p =>') && v26.includes('data-plancopy') && v26.includes('id="pvCopy"') && v26.includes('data-text="${i}"') && v26.includes('data-kind="${i}"') && v26.includes('data-up="${i}"'));
assert.ok(!/claude/i.test(v26.slice(v26.indexOf('const planText'), v26.indexOf('NX.releasePlans = async'))), 'Copy info is plain text');
ok('release plans: Copy info, edit / reorder / re-kind items after saving, more room');

// API usage + models
assert.ok(admin.includes("['freeapi', '📊', 'API usage']") && v27.includes("sb.rpc('admin_premium_usage')") && v27.includes("key: 'premium_models'") && v27.includes('Server functions') && v27.includes("method: 'OPTIONS'"));
ok('API usage: Paragon & Axiom key usage and models (read by premium-chat), every server function checked');

const sql = read('supabase/apoji-admin-2.7.sql');
assert.ok(/update public\.feature_flags set stage = 'all'/.test(sql) && ['citations', 'daily_challenge', 'homework_helper', 'nexus_wrapped', 'orb_skins', 'phone_companion'].every(k => sql.includes(`'${k}'`)));
ok('early features for everyone (apoji-admin-2.7.sql)');

// 2.7.1
assert.ok(v27.includes('NX.mexelAccess = async') && v27.includes("['mexel', 'shifts', 'employees']") && v27.includes('Not on the staff list'));
const em = read('electron/main.js');
assert.ok(em.includes("updates.log") && em.includes("async function fallback()") && em.includes("['/S', '--force-run']") && em.includes("ipcMain.handle('update:state'") && read('electron/preload.js').includes('updateState'));
assert.ok(read('supabase/aargon3-mexel-lockdown.sql').includes('if not coalesce(p_owner, false) then return null; end if;') && css.includes('.mx-store td:not(:first-child)'));
ok('2.7.1: Mexel for the Owner and picked staff, Windows updates with a fallback and a log, By store fits');

// 2.7.2
assert.ok(v27.includes("sb.rpc('admin_known_issues')") && v27.includes('NX.knownIssueFromReport = async') && read('pages.js').includes('#fbKnownIssue') && css.includes('.ki-list'));
ok('2.7.2: known issues & bugs on the Status page, started from a bug report');

assert.ok(pkg.version.localeCompare('2.7.0', undefined, { numeric: true }) >= 0);
assert.ok(admin.includes("VERSION: '" + pkg.version + "'") && read('sw.js').includes('apoji-admin-v' + pkg.version) && read('sw.js').includes("'./v27.js'") && html.includes('<script src="v27.js"></script>') && read('README.md').includes('## 2.7'));
ok('version 2.7.0 or newer');
console.log(`Apoji Admin 2.7: ${n} checks passed`);
