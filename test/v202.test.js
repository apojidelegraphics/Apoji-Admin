// 2.0.2 checks: dim slider, edit reports written in the portal + Feature & Fix, typing indicators, Nexus follows the
// current model, the Nexus orb moves.
const assert = require('assert'), fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let n = 0; const ok = m => { n++; console.log('  ✓ ' + m); };

const feat = read('features.js'), core = read('electron/hub-core.js');
assert.ok(feat.includes('id="hDimLv"') && feat.includes('<span>0% (dark)</span><span style="left:55%">55%</span><span>None</span>') && feat.includes("{ dim: true, dimLevel: (100 - br) / 100 }") && core.includes("if ('dimLevel' in patch)"));
ok('dim slider: 0% (dark), 55%, None');

const pages = read('pages.js');
assert.ok(pages.includes("featfix: '🛠 Feature & Fix'") && pages.includes("const isPortal = r => r.channel === 'portal'") && pages.includes("if (e.target.id === 'fbEdit') return newReport(r);") && pages.includes("sb.from('feedback_reports').update(patch).eq('id', r.id)"));
ok('reports written in the portal can be edited; new Feature & Fix kind');

const chat = read('chat.js');
assert.ok(chat.includes("sb.channel('admin-typing'") && chat.includes("payload: { x: await E.enc(JSON.stringify({ room: C.room, user: me(), on })) }") && chat.includes('id="typingLine"'), 'typing over an encrypted broadcast');
ok('typing indicators in every room and DM (sealed with the team key)');

const v18 = read('v18.js');
assert.ok(v18.includes('NC.status?.current?.agent') && v18.includes('const macModel = ()') && v18.includes("the agent and model you're using in Nexus"));
assert.ok(v18.includes('requestAnimationFrame(blit)') && v18.includes('<canvas class="nx-orb" data-nxorb') && !v18.includes('toDataURL'), 'live orb');
ok('◆ Nexus follows the agent + model picked in Nexus right now; the orb moves');

for (const f of ['src/awake.js', 'src/dimmer.js']) {
  const twin = ['Nexus-28', 'nexus-desktop'].map(d => path.join(__dirname, '..', '..', d, f)).find(x => fs.existsSync(x));
  if (twin) assert.strictEqual(read('electron/' + path.basename(f)), fs.readFileSync(twin, 'utf8'), 'same ' + f);
}
ok('same awake.js / dimmer.js as Nexus');
console.log(`v2.0.2: ${n} checks passed`);
