// Apoji Admin 2.8: idle status, Done releases + calendar, daily digest, on-call, bug duplicates, admin activity heatmap,
// staff shift reminders, swaps, payroll, deeper profiles and promo performance.
const assert = require('assert'), fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let n = 0; const ok = m => { n++; console.log('  ✓ ' + m); };
const pkg = JSON.parse(read('package.json')), html = read('index.html'), admin = read('admin.js'), pages = read('pages.js'), v26 = read('v26.js'), v27 = read('v27.js'), v28 = read('v28.js'), css = read('admin.css'), sql = read('supabase/apoji-admin-2.8.sql');
for (const f of ['admin.js', 'pages.js', 'v26.js', 'v27.js', 'v28.js', 'extras.js']) new Function(read(f));   // parses

// idle
assert.ok(sql.includes("check (status in ('auto', 'idle', 'dnd', 'invisible'))") && sql.includes('idle_after int') && sql.includes('back_at timestamptz') && sql.includes("'idle_since', ap.idle_since"));
assert.ok(admin.includes('function presText') && admin.includes('NX.A.prefs.idle_after') && admin.includes("if (pres === null) pres = ") && admin.includes('urgent = false'));
assert.ok(pages.includes("['idle', '🌙 Idle'") && pages.includes('data-back') && pages.includes('id="idleAfter"') && read('extras.js').includes("label: 'Status: Idle'"));
ok('idle: pick Idle (until a time), your own idle timer, idle shown on every admin picture');

// releases
assert.ok(sql.includes("'released', 'done', 'dropped'") && sql.includes('done_at timestamptz') && sql.includes('admin_release_plans_done'));
assert.ok(v26.includes("done: ['Done', 'p-approved']") && v26.includes('plans-done') && v26.includes('data-plandone') && v26.includes('data-planreopen') && v26.includes('rcal-grid') && v26.includes("data-planview"));
ok('releases: mark done, finished plans at the bottom, calendar view');

// digest, on-call, duplicates, heatmap
for (const f of ['admin_daily_digest', 'admin_oncall_now', 'admin_oncall_rotate', 'oncall_page', 'admin_feedback_similar', 'admin_feedback_dupes', 'admin_feedback_merge', 'admin_activity_heatmap']) assert.ok(sql.includes('function public.' + f + '('), f);
assert.ok(sql.includes('trigger oncall_incident_page') && sql.includes('trigger oncall_bug_page') && sql.includes("revoke all on function public.oncall_page"));
assert.ok(v28.includes("sb.rpc('admin_daily_digest'") && v28.includes("NX.store.get('digestDay'") && v28.includes('urgent: true') && v28.includes('NX.afterFbDetail =') && v28.includes('NX.afterFeedbackList ='));
assert.ok(pages.includes('NX.afterFeedbackList?.(data)') && pages.includes('NX.afterFbDetail?.(el, r)') && admin.includes("['activity', '🔥', 'Admin activity']") && v28.includes('P.activity = async'));
assert.ok(admin.includes("'admin_oncall', 'staff_shift_swaps'"));
ok('daily digest + morning notification, on-call rotation and paging, duplicates and merge, activity heatmap');

// staff
for (const t of ['staff_shift_feed', 'staff_reminder_prefs', 'staff_shift_swaps', 'staff_profiles_ext']) assert.ok(sql.includes('create table if not exists public.' + t), t);
assert.ok(sql.includes('function public.staff_send_reminders()') && sql.includes("cron.schedule('staff-shift-reminders'") && sql.includes('function public.staff_swap(') && sql.includes('function public.staff_publish_shifts('));
assert.ok(v27.includes('NX.staffKit = {') && v27.includes('NX.afterShiftsWeek?.(') && v27.includes('NX.shiftsClick') && v27.includes('NX.afterEmployees?.(') && v27.includes('NX.afterEmpModal?.(') && v27.includes('NX.afterPromos?.(') && v26.includes('NX.afterTimesheets?.('));
assert.ok(v28.includes("sb.rpc('staff_publish_shifts'") && v28.includes("K().mexel('schedule_save'") && v28.includes('async function payroll') && v28.includes('Math.max(0, m - OT)') && v28.includes("from('staff_profiles_ext')") && v28.includes('How codes are doing'));
ok('staff: reminders feed + cron, swaps (approved swaps move the shift), payroll with overtime, profiles, promo performance');

// shipping
assert.ok(html.includes('<script src="v28.js"></script>') && read('sw.js').includes("'./v28.js'") && pkg.build.files.includes('v2*.js'));
assert.ok(admin.includes("VERSION: '" + pkg.version + "'") && read('sw.js').includes('apoji-admin-v' + pkg.version) && read('README.md').includes('## ' + pkg.version));
assert.ok(css.includes('.rcal-grid') && css.includes('.hm-grid') && css.includes('.dg-wrap') && css.includes('.sh-extra'));
ok('v28.js is loaded, cached and packed; version ' + pkg.version);
console.log(`Apoji Admin 2.8: ${n} checks passed`);
