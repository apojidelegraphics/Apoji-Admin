// The Mac hub: a small private API that only your tailnet can reach. Apoji Admin on your Mac runs it; Tailscale
// ("tailscale serve") puts it at https://<this-mac>.<tailnet>.ts.net:8443 with a real certificate, and tells us who
// is asking (the Tailscale-User-Login header). Every call except /api/ping also needs a signed-in Apoji admin
// (their Supabase token), so being on the tailnet alone isn't enough.
//
// The website (GitHub Pages) stays a full Supabase app from anywhere. When it can reach this hub it adds:
//   phone notifications (web push sent from this Mac), "run it now" for schedules, and what's new on the Mac.
//
// No Electron in here, so it can be tested with plain Node. electron/hub.js wires it to the app.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const PORT = 47120;          // local only (127.0.0.1)
const TS_PORT = 8443;        // the tailnet port (443 is left free for anything else you serve)
const ORIGINS = ['https://apojidelegraphics.github.io', 'apoji://admin'];
const KINDS = ['requests', 'feedback', 'reports', 'tasks', 'chat', 'audit', 'schedules', 'hub'];
const DEFAULT_KINDS = ['requests', 'feedback', 'reports', 'tasks', 'chat', 'audit', 'schedules', 'hub'];
// The Mac app's own binary is also its command line, but only when it's told to be (TAILSCALE_BE_CLI=1); run from
// another app without that, it just pokes the menu bar app and prints nothing. /usr/local/bin/tailscale exists if
// you picked "Install CLI" in Tailscale's settings; Homebrew installs go in /opt/homebrew/bin.
const CLI_PATHS = ['/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale', `${process.env.HOME || ''}/Applications/Tailscale.app/Contents/MacOS/Tailscale`, '/usr/bin/tailscale'];

function createHub(opts) {
  const { dir, version = '0.0.0', name = 'Mac', sbUrl, sbKey, webpush, seal = s => s, unseal = s => s, onNudge = () => {}, onChange = () => {}, log = () => {} } = opts;
  const fetchFn = opts.fetch || globalThis.fetch;
  const cfgFile = path.join(dir, 'hub.json'), secFile = path.join(dir, 'hub-secret.bin');

  // ---------- settings (plain) + secrets (VAPID keys, phone subscriptions: sealed with the macOS keychain)
  const cfg = Object.assign({ id: 'hub-' + crypto.randomBytes(6).toString('hex'), enabled: false, keepAwake: false, keepDisplay: false, lidMode: false, pluggedOnly: true, openAtLogin: false, restrict: false, allow: [], chatText: false }, readJson(cfgFile));
  let sec = null;
  try { sec = JSON.parse(unseal(fs.readFileSync(secFile))); } catch {}
  if (!sec?.vapid?.publicKey) sec = { vapid: webpush.generateVAPIDKeys(), subs: sec?.subs || [] };
  sec.subs = Array.isArray(sec.subs) ? sec.subs : [];
  saveCfg(); saveSec();
  function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } }
  function saveCfg() { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2), { mode: 0o600 }); }
  function saveSec() { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(secFile, seal(JSON.stringify(sec)), { mode: 0o600 }); }
  webpush.setVapidDetails('https://github.com/apojidelegraphics/Apoji-Admin', sec.vapid.publicKey, sec.vapid.privateKey);

  const state = { serving: false, listening: false, startedAt: Date.now(), ts: { installed: false, running: false }, awake: { on: false, onBattery: false }, recent: [], error: '' };
  const changed = () => { try { onChange(status()); } catch {} };
  function remember(e) { state.recent.unshift({ at: new Date().toISOString(), ...e }); state.recent.length = Math.min(state.recent.length, 60); }

  // ---------- Tailscale
  let cli = opts.cli || null;
  function findCli() { if (cli) return cli; cli = CLI_PATHS.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || 'tailscale'; return cli; }
  const ts = args => new Promise(res => execFile(findCli(), args, { timeout: 10000, env: { ...process.env, TAILSCALE_BE_CLI: '1', PATH: (process.env.PATH || '') + ':/opt/homebrew/bin:/usr/local/bin' } },
    (err, out, errOut) => res({ ok: !err, out: String(out || ''), err: String(errOut || err?.message || '') })));
  const detail = r => `${findCli()} → ${(r.err || r.out || 'no output').trim().split('\n').slice(-2).join(' ').slice(0, 220)}`;
  async function tailscale() {
    const r = await ts(['status', '--json']);
    if (!r.ok && /ENOENT|not found/i.test(r.err)) { cli = null; return (state.ts = { installed: false, running: false, error: 'Couldn’t find Tailscale on this Mac.', detail: detail(r) }); }
    let j = null; try { j = JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch {}
    if (!j) { cli = null; return (state.ts = { installed: true, running: false, error: 'Tailscale didn’t answer. Make sure it’s connected in the menu bar, then Check again.', detail: detail(r) }); }
    const self = j.Self || {}, user = (j.User || {})[self.UserID] || {};
    const dns = String(self.DNSName || '').replace(/\.$/, '');
    state.ts = { installed: true, running: j.BackendState === 'Running', backend: j.BackendState || '', dnsName: dns, login: user.LoginName || '', tailnet: j.CurrentTailnet?.Name || '',
      https: Array.isArray(j.CertDomains) && j.CertDomains.length > 0, magicDns: j.CurrentTailnet?.MagicDNSEnabled !== false, error: '' };
    state.ts.detail = findCli();
    if (!state.ts.running) state.ts.error = j.BackendState === 'NeedsLogin' ? 'Sign in to Tailscale on this Mac.' : 'Tailscale is off. Turn it on from the menu bar.';
    else if (!state.ts.https) state.ts.error = 'Turn on HTTPS certificates: Tailscale admin console → DNS → HTTPS Certificates.';
    return state.ts;
  }
  const url = () => state.ts.dnsName ? `https://${state.ts.dnsName}:${TS_PORT}` : '';
  async function serve(on) {
    const r = on ? await ts(['serve', '--bg', `--https=${TS_PORT}`, `http://127.0.0.1:${PORT}`]) : await ts(['serve', `--https=${TS_PORT}`, 'off']);
    state.serving = on && r.ok;
    if (on && !r.ok) state.error = 'tailscale serve: ' + (r.err.trim().split('\n').pop() || 'failed').slice(0, 200);
    else state.error = '';
    return r.ok;
  }

  // ---------- who's asking: tailnet login (allow list) + an Apoji admin's Supabase token
  const tokens = new Map();
  async function verify(token) {
    if (!token || token.length > 4096) return null;
    const hit = tokens.get(token); if (hit && hit.until > Date.now()) return hit.who;
    try {
      const h = { apikey: sbKey, Authorization: 'Bearer ' + token };
      const u = await fetchFn(`${sbUrl}/auth/v1/user`, { headers: h }); if (!u.ok) return null;
      const user = await u.json();
      const l = await fetchFn(`${sbUrl}/rest/v1/rpc/get_my_admin_level`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: '{}' });
      const level = l.ok ? await l.json() : null;
      if (!user?.id || !level) return null;
      const who = { userId: user.id, email: user.email || '', level };
      tokens.set(token, { who, until: Date.now() + 5 * 60e3 });
      if (tokens.size > 200) tokens.delete(tokens.keys().next().value);
      return who;
    } catch { return null; }
  }
  const loginOk = login => !!login && (!cfg.restrict || cfg.allow.map(s => s.toLowerCase()).includes(login.toLowerCase()) || login.toLowerCase() === (state.ts.login || '').toLowerCase());

  // ---------- web push (sent from this Mac to your phone's browser; the payload is encrypted for that browser)
  async function push(ev) {
    const kind = KINDS.includes(ev.kind) ? ev.kind : 'hub';
    const body = kind === 'chat' && !cfg.chatText ? (ev.room ? `New message in ${ev.room}` : 'New message') : String(ev.body || '');
    const msg = JSON.stringify({ title: String(ev.title || 'Apoji Admin').slice(0, 80), body: body.slice(0, 240), url: String(ev.url || '').slice(0, 200), tag: String(ev.tag || kind).slice(0, 60), kind });
    const targets = sec.subs.filter(s => (!ev.to || s.userId === ev.to) && (s.kinds || DEFAULT_KINDS).includes(kind) && (!ev.except || s.userId !== ev.except));
    let sent = 0, gone = 0;
    await Promise.all(targets.map(async s => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, msg, { TTL: 6 * 3600, urgency: kind === 'chat' || kind === 'audit' ? 'high' : 'normal' }); sent++; s.lastOk = Date.now(); }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { s.dead = true; gone++; } else log('push failed', e.statusCode || e.message); }
    }));
    if (gone) sec.subs = sec.subs.filter(s => !s.dead);
    if (sent || gone) saveSec();
    remember({ kind, title: JSON.parse(msg).title, body: kind === 'chat' ? '' : JSON.parse(msg).body, sent });
    changed();
    return { sent, targets: targets.length, removed: gone };
  }
  function subscribe(who, login, b) {
    const s = b?.subscription;
    if (!s || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || s.endpoint.length > 1000 || !s.keys?.p256dh || !s.keys?.auth) throw Object.assign(new Error('bad_subscription'), { code: 400 });
    const kinds = Array.isArray(b.kinds) ? b.kinds.filter(k => KINDS.includes(k)) : DEFAULT_KINDS;
    sec.subs = sec.subs.filter(x => x.endpoint !== s.endpoint);
    if (sec.subs.filter(x => x.userId === who.userId).length >= 10) throw Object.assign(new Error('too_many_devices'), { code: 400 });
    sec.subs.push({ endpoint: s.endpoint, keys: { p256dh: String(s.keys.p256dh), auth: String(s.keys.auth) }, userId: who.userId, email: who.email, login, label: String(b.label || 'Phone').slice(0, 40), kinds, added: Date.now() });
    saveSec(); changed();
    return { ok: true };
  }
  const mySubs = userId => sec.subs.filter(s => s.userId === userId).map(s => ({ id: hash(s.endpoint), label: s.label, kinds: s.kinds || DEFAULT_KINDS, added: s.added, lastOk: s.lastOk || null, login: s.login }));
  const hash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

  // ---------- the API
  function cors(req, res) {
    const o = req.headers.origin;
    if (o && ORIGINS.includes(o)) {
      res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
      if (req.headers['access-control-request-private-network']) res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    return !o || ORIGINS.includes(o);
  }
  const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(obj)); };
  const readBody = req => new Promise((ok, bad) => { let n = 0, chunks = []; req.on('data', c => { n += c.length; if (n > 64 * 1024) { bad(Object.assign(new Error('too_big'), { code: 413 })); req.destroy(); } else chunks.push(c); }); req.on('end', () => { try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch { bad(Object.assign(new Error('bad_json'), { code: 400 })); } }); });

  async function handle(req, res) {
    if (!cors(req, res)) return send(res, 403, { error: 'origin' });
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const p = new URL(req.url, 'http://x').pathname;
    const login = String(req.headers['tailscale-user-login'] || '');
    if (!login) return send(res, 403, { error: 'tailnet_only' });          // only requests that came through Tailscale
    if (!loginOk(login)) return send(res, 403, { error: 'not_allowed', login });
    if (p === '/api/ping') return send(res, 200, { ok: true, app: 'apoji-hub', id: cfg.id, name, version });
    // Opened in a browser: a friendly page instead of an error (the API itself still needs an admin sign-in)
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
      return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Apoji Admin hub</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0817;color:#efe6ff;font:16px/1.5 -apple-system,system-ui,sans-serif;text-align:center;padding:24px">
<div><div style="font-size:44px">🛰</div><h1 style="margin:.2em 0;font-size:22px">${esc(name)} is your Apoji Admin hub</h1>
<p style="color:#a89cc8;max-width:420px">It's running and this device reaches it over Tailscale (signed in as ${esc(login)}). This address is for the app, not for browsing.</p>
<p><a href="https://apojidelegraphics.github.io/Apoji-Admin/#hub" style="display:inline-block;background:#9a80ff;color:#120a24;font-weight:700;padding:10px 18px;border-radius:12px;text-decoration:none">Open Apoji Admin → Mac hub</a></p></div>`);
    }
    const who = await verify(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    if (!who) return send(res, 401, { error: 'sign_in' });
    try {
      if (req.method === 'GET' && p === '/api/hub') return send(res, 200, { ...publicStatus(), you: { login, email: who.email, level: who.level }, devices: mySubs(who.userId) });
      if (req.method === 'GET' && p === '/api/push/key') return send(res, 200, { key: sec.vapid.publicKey });
      if (req.method === 'GET' && p === '/api/events') return send(res, 200, { events: state.recent.slice(0, 40) });
      if (req.method !== 'POST') return send(res, 404, { error: 'not_found' });
      const b = await readBody(req);
      if (p === '/api/push/subscribe') return send(res, 200, subscribe(who, login, b));
      if (p === '/api/push/unsubscribe') { const before = sec.subs.length; sec.subs = sec.subs.filter(s => !(s.userId === who.userId && (s.endpoint === b.endpoint || hash(s.endpoint) === b.id))); saveSec(); changed(); return send(res, 200, { ok: true, removed: before - sec.subs.length }); }
      if (p === '/api/push/kinds') { const s = sec.subs.find(s => s.userId === who.userId && (s.endpoint === b.endpoint || hash(s.endpoint) === b.id)); if (!s) return send(res, 404, { error: 'not_found' }); s.kinds = (b.kinds || []).filter(k => KINDS.includes(k)); saveSec(); return send(res, 200, { ok: true }); }
      if (p === '/api/push/test') return send(res, 200, await push({ kind: 'hub', to: who.userId, title: '🔔 Apoji Admin', body: `Phone notifications from ${name} work.`, tag: 'test' }));
      if (p === '/api/nudge') { const what = ['jobs', 'refresh', 'heartbeat'].includes(b.what) ? b.what : 'jobs'; onNudge(what, who); remember({ kind: 'hub', title: `⚡ ${who.email.split('@')[0] || 'An admin'} asked for ${what === 'jobs' ? 'schedules to run' : what}`, body: '' }); return send(res, 200, { ok: true }); }
      return send(res, 404, { error: 'not_found' });
    } catch (e) { return send(res, e.code || 500, { error: e.message }); }
  }

  let server = null;
  function listen() {
    if (server) return Promise.resolve(true);
    return new Promise(ok => {
      server = http.createServer((req, res) => handle(req, res).catch(e => send(res, 500, { error: e.message })));
      server.on('error', e => { state.error = e.code === 'EADDRINUSE' ? `Port ${PORT} is busy (is Apoji Admin open twice?)` : e.message; server = null; state.listening = false; ok(false); });
      server.listen(opts.port ?? PORT, '127.0.0.1', () => { state.listening = true; ok(true); });
    });
  }
  function close() { return new Promise(ok => { if (!server) return ok(); server.close(() => ok()); server = null; state.listening = false; }); }

  async function start() { await tailscale(); const l = await listen(); if (l && state.ts.running) await serve(true); changed(); return status(); }
  async function stop() { if (state.serving) await serve(false); await close(); state.serving = false; changed(); return status(); }
  async function refresh() { await tailscale(); if (cfg.enabled && state.listening && state.ts.running && !state.serving) await serve(true); changed(); return status(); }
  function set(patch = {}) {
    for (const k of ['enabled', 'keepAwake', 'keepDisplay', 'lidMode', 'pluggedOnly', 'openAtLogin', 'restrict', 'chatText']) if (k in patch) cfg[k] = !!patch[k];
    if (Array.isArray(patch.allow)) cfg.allow = [...new Set(patch.allow.map(s => String(s).trim().toLowerCase()).filter(s => /^[^\s@]+@[^\s@]+$|^[\w.-]+@github$|^[\w.-]+$/.test(s) && s.length < 120))].slice(0, 30);
    saveCfg(); return cfg;
  }
  function publicStatus() {
    return { id: cfg.id, name, version, enabled: cfg.enabled, online: state.listening, serving: state.serving, url: state.serving ? url() : '', port: TS_PORT,
      tailscale: { ...state.ts }, awake: { ...state.awake }, keepAwake: cfg.keepAwake, keepDisplay: !!cfg.keepDisplay, lidMode: !!cfg.lidMode, pluggedOnly: cfg.pluggedOnly, openAtLogin: cfg.openAtLogin,
      restrict: cfg.restrict, allow: cfg.allow.slice(), chatText: cfg.chatText, devices: sec.subs.length, uptime: Math.round((Date.now() - state.startedAt) / 1000), error: state.error };
  }
  function status() { return { ...publicStatus(), recent: state.recent.slice(0, 20), subs: sec.subs.map(s => ({ id: hash(s.endpoint), label: s.label, email: s.email, login: s.login, kinds: s.kinds || DEFAULT_KINDS, added: s.added, lastOk: s.lastOk || null })) }; }
  function removeSub(id) { sec.subs = sec.subs.filter(s => hash(s.endpoint) !== id); saveSec(); changed(); return status(); }

  return { cfg, state, start, stop, refresh, set, status, publicStatus, push, removeSub, handle, listen, close, tailscale, serve, verify, remember, changed, url, vapidKey: () => sec.vapid.publicKey, PORT, TS_PORT };
}

module.exports = { createHub, PORT, TS_PORT, ORIGINS, KINDS };
