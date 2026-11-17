// 1.9 checks: lid mode + shorter menu, offline outbox, prompt editor, Nexus in Team chat, Axiom's cage (story only).
const assert = require('assert'), fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const pkg = JSON.parse(read('package.json'));
for (const f of ['v19.js', 'orb.js']) assert.ok(pkg.build.files.includes(f) && read('index.html').includes(`src="${f}"`) && read('sw.js').includes(`'./${f}'`), f + ' ships');
const hub = read('electron/hub.js');
assert.ok(hub.includes("label: 'Stay awake with the lid closed'") && hub.includes('const cut = (t, n = 38)') && !hub.includes("'💤 ' + (st.awake?.reason"), 'menu bar lines are short now');
// Same awake.js as Nexus '28 (checked when the Nexus repo sits next to this one)
const twin = ['Nexus-28', 'nexus-desktop'].map(d => path.join(__dirname, '..', '..', d, 'src', 'awake.js')).find(f => fs.existsSync(f));
if (twin) assert.strictEqual(read('electron/awake.js'), fs.readFileSync(twin, 'utf8'), 'same awake.js as Nexus');
const admin = read('admin.js');
assert.ok(admin.includes("if (k === 'from') return table => isOffline() ? recorder(table) : rawSb.from(table)") && admin.includes('offline-chip') && admin.includes('async function flushOutbox()'));
assert.ok(admin.includes("['prompts', '✍', 'Agent prompts']") && admin.includes("['axiom', '🔺', 'Axiom (Apex)', 'cage']") && !admin.includes("['nexus', '◆', 'Nexus chat']"));
const chat = read('chat.js'), v18 = read('v18.js'), v19 = read('v19.js');
assert.ok(chat.includes("const allRooms = () => ['nexus', 'all',") && chat.includes('ai_sent: true') && chat.includes('NX.nexusChat.groupReply'));
assert.ok(v18.includes('NX.nexusChat = { mount') && v18.includes("const lastAgent = () =>") && !v18.includes('id="ncAgent"'), 'no model picker: always the last agent');
assert.ok(v19.includes("sb.rpc('admin_prompt_save'") && v19.includes("sb.rpc('apex_cage_action'") && v19.includes("sb.functions.invoke('axiom-cage'"));
const fn = read('supabase/functions/axiom-cage/index.ts');
assert.ok(fn.includes('NO tools') && fn.includes("rpc('apex_cage_record_attempt'") && !/tools\s*:/.test(fn), 'attempts are written with no tools');
console.log('v1.9: 8 checks passed');
