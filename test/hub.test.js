// Mac hub tests: tailnet-only, allow list, Supabase admin check, CORS for the website, phone subscriptions + push,
// chat text stays off phones unless you allow it, nudges, sealed secrets. Plain Node (no Electron, no Tailscale needed).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const webpush = require('web-push');
const { createHub } = require('../electron/hub-core');
let n = 0; const ok = m => { n++; console.log('  ✓ ' + m); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-'));
  // a stand-in Tailscale CLI
  const cli = path.join(dir, 'tailscale');
  fs.writeFileSync(cli, `#!/bin/sh
echo "$@ BE_CLI=$TAILSCALE_BE_CLI" >> "${dir}/ts.log"
if [ "$1" = "status" ]; then echo '{"BackendState":"Running","Self":{"DNSName":"studio-mac.tail1234.ts.net.","UserID":7},"User":{"7":{"LoginName":"luke@example.com"}},"CertDomains":["studio-mac.tail1234.ts.net"],"CurrentTailnet":{"Name":"example.com","MagicDNSEnabled":true}}'; fi
exit 0
`, { mode: 0o755 });
  // a stand-in Supabase: token "admin" is an admin, "user" is a regular account
  const fakeFetch = async (url, o = {}) => {
    const tok = (o.headers?.Authorization || '').replace('Bearer ', '');
    const json = (status, b) => ({ ok: status < 400, status, json: async () => b });
    if (url.endsWith('/auth/v1/user')) return tok === 'admin' || tok === 'user' || tok === 'admin2' ? json(200, { id: tok === 'admin2' ? 'u2' : tok === 'admin' ? 'u1' : 'u9', email: tok + '@x.co' }) : json(401, {});
    if (url.endsWith('/rpc/get_my_admin_level')) return json(200, tok.startsWith('admin') ? 'high-admin' : null);
    return json(404, {});
  };
  const sent = [];
  const wp = { generateVAPIDKeys: webpush.generateVAPIDKeys, setVapidDetails: webpush.setVapidDetails,
    sendNotification: async (sub, payload) => { if (sub.endpoint.includes('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 }); sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) }); } };
  const nudges = [];
  const seal = s => Buffer.from('SEALED:' + Buffer.from(s).toString('base64')), unseal = b => Buffer.from(String(b).replace('SEALED:', ''), 'base64').toString();
  const hub = createHub({ dir, version: '1.2.0', name: 'Studio Mac', sbUrl: 'https://sb', sbKey: 'pk', webpush: wp, fetch: fakeFetch, cli, port: 0, seal, unseal, onNudge: w => nudges.push(w) });
  hub.set({ enabled: true });
  // listen on a random port for the test
  await hub.start();
  assert.ok(hub.state.listening && hub.state.serving, 'listening and served on the tailnet');
  assert.strictEqual(hub.url(), 'https://studio-mac.tail1234.ts.net:8443');
  const log = fs.readFileSync(path.join(dir, 'ts.log'), 'utf8');
  assert.ok(log.includes('serve --bg --https=8443 http://127.0.0.1:47120'), log);
  assert.ok(log.includes('status --json BE_CLI=1'), 'the Mac app binary is told to act as the CLI');
  ok('Tailscale: reads status, serves the hub on :8443 with HTTPS (leaves 443 alone)');

  const srv = http.createServer((q, s) => hub.handle(q, s)); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const P = srv.address().port;
  const call = (p, { method = 'GET', login = 'luke@example.com', token = 'admin', origin, body } = {}) => new Promise((res, rej) => {
    const h = { ...(login ? { 'Tailscale-User-Login': login } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(origin ? { Origin: origin } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) };
    const r = http.request({ host: '127.0.0.1', port: P, path: p, method, headers: h }, s => { let d = ''; s.on('data', c => d += c); s.on('end', () => res({ status: s.statusCode, headers: s.headers, body: d ? JSON.parse(d) : null })); });
    r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end();
  });

  assert.strictEqual((await call('/api/ping', { login: '' })).status, 403, 'only through Tailscale');
  assert.strictEqual((await call('/api/ping')).body.app, 'apoji-hub');
  assert.strictEqual((await call('/api/hub', { token: '' })).status, 401);
  assert.strictEqual((await call('/api/hub', { token: 'user' })).status, 401, 'a regular Nexus account is not enough');
  const st = await call('/api/hub');
  assert.strictEqual(st.status, 200); assert.strictEqual(st.body.url, 'https://studio-mac.tail1234.ts.net:8443'); assert.strictEqual(st.body.you.login, 'luke@example.com');
  assert.ok(!JSON.stringify(st.body).includes('privateKey'), 'no secrets in the status');
  ok('tailnet only + Supabase admin token required; status never includes keys');

  hub.set({ restrict: true, allow: ['sam@example.com'] });
  assert.strictEqual((await call('/api/hub', { login: 'eve@example.com' })).status, 403, 'not on the allow list');
  assert.strictEqual((await call('/api/hub', { login: 'sam@example.com' })).status, 200);
  assert.strictEqual((await call('/api/hub', { login: 'luke@example.com' })).status, 200, 'the Mac owner is always allowed');
  hub.set({ restrict: false });
  ok('allow list (the Mac owner always gets in)');

  const pre = await call('/api/hub', { method: 'OPTIONS', origin: 'https://apojidelegraphics.github.io' });
  assert.strictEqual(pre.status, 204); assert.strictEqual(pre.headers['access-control-allow-origin'], 'https://apojidelegraphics.github.io');
  assert.ok(/authorization/.test(pre.headers['access-control-allow-headers']));
  assert.strictEqual((await call('/api/hub', { origin: 'https://evil.example' })).status, 403, 'other websites are refused');
  ok('CORS: the Apoji Admin website and app only');

  const key = (await call('/api/push/key')).body.key; assert.ok(key && key.length > 60);
  const sub = e => ({ subscription: { endpoint: 'https://push.example/' + e, keys: { p256dh: 'BP' + e, auth: 'au' + e } } });
  assert.strictEqual((await call('/api/push/subscribe', { method: 'POST', body: { subscription: { endpoint: 'http://insecure' } } })).status, 400);
  assert.ok((await call('/api/push/subscribe', { method: 'POST', body: { ...sub('phone1'), label: 'iPhone' } })).body.ok);
  assert.ok((await call('/api/push/subscribe', { method: 'POST', token: 'admin2', login: 'sam@example.com', body: { ...sub('phone2'), kinds: ['requests'] } })).body.ok);
  assert.ok((await call('/api/push/subscribe', { method: 'POST', token: 'admin2', login: 'sam@example.com', body: sub('gone3') })).body.ok);
  const mine = (await call('/api/hub')).body.devices; assert.strictEqual(mine.length, 1); assert.strictEqual(mine[0].label, 'iPhone');
  ok('phones subscribe with the hub’s own push key; each admin sees only their own devices');

  let r = await hub.push({ kind: 'requests', title: '🧪 New beta request', body: 'sam: wants in' });
  assert.strictEqual(r.sent, 2); assert.strictEqual(r.removed, 1, 'dead subscriptions are dropped');
  sent.length = 0;
  r = await hub.push({ kind: 'chat', title: '💬 Luke', body: 'the secret plan', room: '#general', to: 'u1' });
  assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].payload.body, 'New message in #general', 'no message text by default');
  assert.ok(!JSON.stringify(hub.status().recent).includes('secret plan'));
  hub.set({ chatText: true }); sent.length = 0;
  await hub.push({ kind: 'chat', title: '💬 Luke', body: 'hello', to: 'u1' }); assert.strictEqual(sent[0].payload.body, 'hello');
  sent.length = 0; await hub.push({ kind: 'tasks', title: 'task', to: 'u2' }); assert.strictEqual(sent.length, 0, 'sam only wanted beta requests');
  sent.length = 0; assert.strictEqual((await call('/api/push/test', { method: 'POST', body: {} })).body.sent, 1);
  ok('push: per-person, per-kind, dead phones removed, chat text only if you allow it, test button');

  assert.ok((await call('/api/nudge', { method: 'POST', body: { what: 'jobs' } })).body.ok); assert.deepStrictEqual(nudges, ['jobs']);
  assert.ok(hub.status().recent.some(e => /asked for schedules/.test(e.title)));
  ok('nudge: the website can tell the Mac to run schedules right now');

  const raw = fs.readFileSync(path.join(dir, 'hub-secret.bin'), 'utf8');
  assert.ok(raw.startsWith('SEALED:') && !raw.includes('push.example'), 'keys + phones are sealed on disk');
  const again = createHub({ dir, version: '1.2.0', name: 'Studio Mac', sbUrl: 'https://sb', sbKey: 'pk', webpush: wp, fetch: fakeFetch, cli, seal, unseal });
  assert.strictEqual(again.vapidKey(), key, 'same push key after a restart'); assert.strictEqual(again.status().subs.length, 2);
  assert.strictEqual(again.cfg.id, hub.cfg.id);
  ok('VAPID keys and phone list are sealed (macOS keychain in the app) and survive restarts');

  await hub.stop(); assert.ok(fs.readFileSync(path.join(dir, 'ts.log'), 'utf8').includes('serve --https=8443 off'));
  srv.close(); fs.rmSync(dir, { recursive: true, force: true });
  ok('turning the hub off removes it from the tailnet');
  console.log(`hub: ${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
