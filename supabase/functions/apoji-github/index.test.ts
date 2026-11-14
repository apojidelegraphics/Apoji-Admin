// deno test --allow-env supabase/functions/apoji-github/index.test.ts
import { appJwt, handler, pemToPkcs8, validSignature, type Deps } from './index.ts';

const assert = (c: unknown, m = 'assertion failed') => { if (!c) throw new Error(m); };
const enc = new TextEncoder();
const hmac = async (secret: string, raw: string) => { const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return 'sha256=' + [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(raw)))].map(b => b.toString(16).padStart(2, '0')).join(''); };
// PKCS#1 PEM made by Node (the format GitHub hands out), passed in by the test runner
const PEM = Deno.env.get('TEST_PEM_PKCS1')!, PUB = Deno.env.get('TEST_PUB_SPKI')!;

Deno.test('PKCS#1 key → JWT that verifies with the public key', async () => {
  assert(/BEGIN RSA PRIVATE KEY/.test(PEM), 'need a PKCS#1 key');
  const jwt = await appJwt(1234, PEM, 1_700_000_000_000);
  const [h, b, s] = jwt.split('.');
  const pub = await crypto.subtle.importKey('spki', Uint8Array.from(atob(PUB.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const sig = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - s.length % 4) % 4)), c => c.charCodeAt(0));
  assert(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pub, sig, enc.encode(`${h}.${b}`)), 'signature verifies');
  const payload = JSON.parse(atob(b.replace(/-/g, '+').replace(/_/g, '/')));
  assert(payload.iss === '1234' && payload.exp - payload.iat === 600, 'claims');
  assert(pemToPkcs8(PEM)[0] === 0x30, 'der sequence');
});

Deno.test('webhook signatures', async () => {
  const raw = '{"a":1}';
  assert(await validSignature('s3cret', raw, await hmac('s3cret', raw)));
  assert(!(await validSignature('s3cret', raw, await hmac('other', raw))));
  assert(!(await validSignature('s3cret', raw, null)));
});

// A fake Supabase + GitHub behind fetch
function fake() {
  const calls: { method: string; url: string; body: any }[] = [];
  const tables: Record<string, any[]> = {
    github_app: [{ app_id: 99, slug: 'apoji-admin', private_key: PEM, webhook_secret: 'whsec', owner: 'apojidelegraphics', html_url: 'https://github.com/apps/apoji-admin', created_by: 'u-admin' }],
    feedback_reports: [{ id: 12, kind: 'bug', title: 'Crash on start', body: 'It crashes. email: secret@example.com should not leak from fields', feature: '', app_version: '2.2.0', source: 'desktop', status: 'new' }],
    github_links: [], feedback_replies: [], github_events: [], announcements: [], github_installations: [], moderation_log: []
  };
  const res = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const f: typeof fetch = async (input, init = {}) => {
    const url = String(input), method = init.method || 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const auth = new Headers(init.headers).get('authorization') || '';
    if (url.endsWith('/auth/v1/user')) return auth === 'Bearer user-admin' || auth === 'Bearer user-mod' ? res(200, { id: auth === 'Bearer user-admin' ? 'u-admin' : 'u-mod', email: 'a@x' }) : res(401, {});
    if (url.endsWith('/rpc/get_my_admin_level')) return res(200, auth === 'Bearer user-admin' ? 'high-admin' : auth === 'Bearer user-mod' ? 'mod' : null);
    if (url.includes('/rest/v1/')) {
      const [t] = url.split('/rest/v1/')[1].split('?');
      if (method === 'GET') {
        let rows = tables[t] || [];
        const m = url.match(/[?&](\w+)=eq\.([^&]+)/g) || [];
        for (const cond of m) { const [, k, v] = cond.match(/(\w+)=eq\.(.+)/)!; if (k !== 'select') rows = rows.filter(r => String(r[k] ?? (k === 'id' && t === 'github_app' ? 1 : undefined)) === decodeURIComponent(v)); }
        return res(200, rows);
      }
      if (method === 'POST') { (tables[t] ||= []).push(...[].concat(body)); return res(201, []); }
      if (method === 'PATCH') { return res(204, null); }
      if (method === 'DELETE') return res(204, null);
    }
    if (url.includes('api.github.com')) {
      const p = url.split('api.github.com')[1];
      if (p.startsWith('/repos/apojidelegraphics/Nexus-28/installation')) return res(200, { id: 777 });
      if (p === '/app/installations/777/access_tokens') return res(201, { token: 'ghs_install' });
      if (p === '/repos/apojidelegraphics/Nexus-28/issues' && method === 'POST') return res(201, { number: 41, html_url: 'https://github.com/apojidelegraphics/Nexus-28/issues/41' });
      if (p.startsWith('/app-manifests/')) return res(201, { id: 5, slug: 'apoji-admin', client_id: 'Iv1', client_secret: 'cs', pem: PEM, webhook_secret: 'whsec', html_url: 'https://github.com/apps/apoji-admin', owner: { login: 'apojidelegraphics' } });
      return res(404, { message: 'Not Found' });
    }
    return res(404, {});
  };
  const deps: Deps = { fetch: f, env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon' } as Record<string, string>)[k], now: () => Date.now() };
  return { deps, calls, tables };
}
const post = (body: unknown, token?: string, path = '/functions/v1/apoji-github', headers: Record<string, string> = {}) =>
  new Request('https://db.test' + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://apojidelegraphics.github.io', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

Deno.test('actions need a signed-in admin; setup needs a high-admin', async () => {
  const { deps } = fake();
  assert((await handler(post({ action: 'status' }), deps)).status === 401);
  const r = await handler(post({ action: 'setup', code: 'abcdefgh123' }, 'user-mod'), deps);
  assert(r.status === 403, 'mods cannot set up');
  const ok = await (await handler(post({ action: 'setup', code: 'abcdefgh123' }, 'user-admin'), deps)).json();
  assert(ok.ok && ok.install_url === 'https://github.com/apps/apoji-admin/installations/new', JSON.stringify(ok));
  assert((await handler(post({ action: 'status' }, 'user-admin'), deps)).headers.get('access-control-allow-origin') === 'https://apojidelegraphics.github.io', 'CORS for the portal');
});

Deno.test('feedback → GitHub issue without personal details, linked, noted, triaged', async () => {
  const { deps, calls, tables } = fake();
  const r = await (await handler(post({ action: 'create_issue', feedback_id: 12, repo: 'apojidelegraphics/Nexus-28' }, 'user-admin'), deps)).json();
  assert(r.ok && r.number === 41, JSON.stringify(r));
  const create = calls.find(c => c.url.endsWith('/repos/apojidelegraphics/Nexus-28/issues') && c.method === 'POST')!;
  assert(create.body.title === 'Crash on start' && create.body.labels[0] === 'bug');
  assert(!/a@x|u-admin/.test(create.body.body) && create.body.body.includes('report #12'));
  assert(tables.github_links[0].issue_number === 41 && tables.feedback_replies[0].internal === true);
  assert(calls.some(c => c.method === 'PATCH' && c.url.includes('feedback_reports?id=eq.12') && c.body.status === 'triaged'));
  const again = await handler(post({ action: 'create_issue', feedback_id: 12, repo: 'apojidelegraphics/Nexus-28' }, 'user-admin'), deps);
  assert(again.status === 409, 'no duplicates');
});

Deno.test('webhooks: signature checked, events saved, closed issue → feedback fixed, release → draft announcement', async () => {
  const { deps, calls, tables } = fake();
  tables.github_links.push({ feedback_id: 12, repo: 'apojidelegraphics/Nexus-28', issue_number: 41 });
  const hook = async (event: string, payload: unknown, secret = 'whsec') => { const raw = JSON.stringify(payload); return handler(post(raw, undefined, '/functions/v1/apoji-github/webhook', { 'x-github-event': event, 'x-github-delivery': crypto.randomUUID(), 'x-hub-signature-256': await hmac(secret, raw) }), deps); };
  assert((await hook('issues', {}, 'wrong')).status === 401, 'bad signature rejected');
  const repo = { full_name: 'apojidelegraphics/Nexus-28', name: 'Nexus-28', default_branch: 'main' };
  assert((await hook('issues', { action: 'closed', issue: { number: 41, title: 'Crash', state: 'closed', state_reason: 'completed', html_url: 'u' }, repository: repo, sender: { login: 'luke' } })).status === 200);
  assert(calls.some(c => c.method === 'PATCH' && c.url.includes('feedback_reports?id=eq.12') && c.body.status === 'fixed'), 'feedback marked fixed');
  assert(tables.github_events.some(e => e.event === 'issues' && e.title.includes('#41')));
  await hook('release', { action: 'published', release: { tag_name: 'v2.3.0', html_url: 'r' }, repository: repo, sender: { login: 'luke' } });
  assert(tables.announcements[0].active === false && tables.announcements[0].message.startsWith("Nexus '28 v2.3.0 is out"), 'draft announcement');
  await hook('push', { ref: 'refs/heads/feature-x', commits: [{}], repository: repo, sender: { login: 'luke' } });
  assert(!tables.github_events.some(e => e.event === 'push'), 'non-default branch pushes are skipped');
});
