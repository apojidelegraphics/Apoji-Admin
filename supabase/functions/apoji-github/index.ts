// Apoji Admin GitHub App — Supabase Edge Function "apoji-github".
//   POST …/apoji-github/webhook   GitHub webhooks (signed with the app's webhook secret)
//   POST …/apoji-github           Actions from the admin portal (needs a signed-in admin):
//        { action: 'setup', code }                    finish creating the app (high-admins; from the manifest flow)
//        { action: 'status' }                         installations + repos (refreshes github_installations)
//        { action: 'issues', repo }                   open issues in a repo
//        { action: 'create_issue', feedback_id, repo } turn a feedback report into a GitHub issue (no email/info leaks)
// Deploy with JWT verification OFF (GitHub can't send a Supabase token): supabase functions deploy apoji-github --no-verify-jwt
// The app's private key + webhook secret are stored in public.github_app (no API access; only this function reads it).

const SITE_ORIGINS = ['https://apojidelegraphics.github.io'];
const GH = 'https://api.github.com';
const enc = new TextEncoder();

export type Deps = { fetch: typeof fetch; env: (k: string) => string | undefined; now: () => number };
const defaultDeps: Deps = { fetch: (...a) => fetch(...a), env: k => Deno.env.get(k), now: () => Date.now() };

// ---------- small helpers
const b64url = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const json = (body: unknown, status = 200, origin = '') => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });
function cors(origin: string): Record<string, string> {
  return SITE_ORIGINS.includes(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' } : {};
}
function derLen(n: number) { if (n < 128) return [n]; const b = []; while (n) { b.unshift(n & 255); n >>= 8; } return [0x80 | b.length, ...b]; }
// GitHub hands out PKCS#1 ("BEGIN RSA PRIVATE KEY"); Web Crypto wants PKCS#8. Wrap it.
export function pemToPkcs8(pem: string): Uint8Array {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), c => c.charCodeAt(0));
  if (/BEGIN PRIVATE KEY/.test(pem)) return der;
  const algId = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLen(der.length), ...der];
  const inner = [0x02, 0x01, 0x00, ...algId, ...octet];
  return new Uint8Array([0x30, ...derLen(inner.length), ...inner]);
}
export async function appJwt(appId: number | string, pem: string, now = Date.now()) {
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const t = Math.floor(now / 1000);
  const head = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify({ iat: t - 60, exp: t + 540, iss: String(appId) })));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}
export async function validSignature(secret: string, raw: string, header: string | null) {
  if (!header?.startsWith('sha256=') || !secret) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(raw)));
  const hex = [...mac].map(b => b.toString(16).padStart(2, '0')).join('');
  const got = header.slice(7);
  if (got.length !== hex.length) return false;
  let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

// ---------- database (PostgREST with the service role; RLS is bypassed, so every write here is deliberate)
function db(d: Deps) {
  const url = d.env('SUPABASE_URL')!, key = d.env('SUPABASE_SERVICE_ROLE_KEY')!;
  const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  return async (method: string, path: string, body?: unknown, prefer = 'return=representation') => {
    const r = await d.fetch(`${url}/rest/v1/${path}`, { method, headers: { ...h, Prefer: prefer }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) throw new Error(`db ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.status === 204 ? null : r.json().catch(() => null);
  };
}
// The person calling: a signed-in admin? → their user id + admin level
async function caller(req: Request, d: Deps) {
  const auth = req.headers.get('authorization') || '';
  if (!/^Bearer .+/.test(auth)) return null;
  const url = d.env('SUPABASE_URL')!, anon = d.env('SUPABASE_ANON_KEY')!;
  const u = await d.fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: auth } });
  if (!u.ok) return null;
  const user = await u.json();
  const l = await d.fetch(`${url}/rest/v1/rpc/get_my_admin_level`, { method: 'POST', headers: { apikey: anon, Authorization: auth, 'Content-Type': 'application/json' }, body: '{}' });
  const level = l.ok ? await l.json() : null;
  return level ? { id: user.id as string, email: user.email as string, level: String(level) } : null;
}

// ---------- GitHub API as the app
async function gh(d: Deps, path: string, token: string, init: RequestInit = {}) {
  const r = await d.fetch(`${GH}${path}`, { ...init, headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Apoji-Admin', Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${body?.message || 'request failed'}`);
  return body;
}
async function appConfig(d: Deps) {
  const rows = await db(d)('GET', 'github_app?select=app_id,slug,private_key,webhook_secret,owner,html_url&id=eq.1');
  return rows?.[0] || null;
}
async function installationToken(d: Deps, cfg: { app_id: number; private_key: string }, installationId: number) {
  const jwt = await appJwt(cfg.app_id, cfg.private_key, d.now());
  const t = await gh(d, `/app/installations/${installationId}/access_tokens`, jwt, { method: 'POST' });
  return t.token as string;
}
async function tokenForRepo(d: Deps, cfg: { app_id: number; private_key: string }, repo: string) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Pick a repository.');
  const jwt = await appJwt(cfg.app_id, cfg.private_key, d.now());
  const inst = await gh(d, `/repos/${repo}/installation`, jwt).catch(() => null);
  if (!inst?.id) throw new Error(`Apoji Admin isn't installed on ${repo}.`);
  return installationToken(d, cfg, inst.id);
}
async function refreshInstallations(d: Deps, cfg: { app_id: number; private_key: string }) {
  const jwt = await appJwt(cfg.app_id, cfg.private_key, d.now());
  const list = await gh(d, '/app/installations?per_page=100', jwt);
  const out = [];
  for (const i of list) {
    let repos: string[] = [];
    try { const tok = await installationToken(d, cfg, i.id); const r = await gh(d, '/installation/repositories?per_page=100', tok); repos = r.repositories.map((x: { full_name: string }) => x.full_name); } catch { /* suspended */ }
    out.push({ id: i.id, account: i.account?.login || '', repos, suspended: !!i.suspended_at, updated_at: new Date(d.now()).toISOString() });
  }
  const put = db(d);
  if (out.length) await put('POST', 'github_installations?on_conflict=id', out, 'resolution=merge-duplicates,return=minimal');
  const ids = out.map(o => o.id).join(',');
  await put('DELETE', `github_installations${ids ? `?id=not.in.(${ids})` : '?id=gt.0'}`, undefined, 'return=minimal');
  return out;
}

// ---------- portal actions
async function action(req: Request, d: Deps, origin: string) {
  const who = await caller(req, d);
  if (!who) return json({ ok: false, error: 'Sign in with an admin account.' }, 401, origin);
  const a = await req.json().catch(() => ({}));
  const put = db(d);
  if (a.action === 'setup') {
    if (who.level !== 'high-admin') return json({ ok: false, error: 'Only high-admins can set up the GitHub App.' }, 403, origin);
    if (!/^[\w-]{8,80}$/.test(String(a.code || ''))) return json({ ok: false, error: 'Missing the code from GitHub.' }, 400, origin);
    const r = await d.fetch(`${GH}/app-manifests/${a.code}/conversions`, { method: 'POST', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Apoji-Admin' } });
    const app = await r.json().catch(() => null);
    if (!r.ok || !app?.id) return json({ ok: false, error: `GitHub said: ${app?.message || r.status}. The setup link only works once and for an hour; start again.` }, 400, origin);
    await put('POST', 'github_app?on_conflict=id', { id: 1, app_id: app.id, slug: app.slug, client_id: app.client_id, client_secret: app.client_secret, private_key: app.pem, webhook_secret: app.webhook_secret, owner: app.owner?.login || '', html_url: app.html_url, created_by: who.id },
      'resolution=merge-duplicates,return=minimal');
    await put('POST', 'moderation_log', { action: 'github_app_created', performed_by: who.id, details: { slug: app.slug, app_id: app.id } }, 'return=minimal').catch(() => {});
    return json({ ok: true, slug: app.slug, html_url: app.html_url, install_url: `https://github.com/apps/${app.slug}/installations/new` }, 200, origin);
  }
  const cfg = await appConfig(d);
  if (!cfg) return json({ ok: false, error: 'The GitHub App isn\'t set up yet.' }, 400, origin);
  if (a.action === 'status') return json({ ok: true, slug: cfg.slug, html_url: cfg.html_url, installations: await refreshInstallations(d, cfg) }, 200, origin);
  if (a.action === 'issues') {
    const tok = await tokenForRepo(d, cfg, String(a.repo || ''));
    const list = await gh(d, `/repos/${a.repo}/issues?state=open&per_page=30&sort=updated`, tok);
    return json({ ok: true, issues: list.filter((i: { pull_request?: unknown }) => !i.pull_request).map((i: Record<string, any>) => ({ number: i.number, title: i.title, url: i.html_url, user: i.user?.login, labels: (i.labels || []).map((l: any) => l.name), comments: i.comments, updated_at: i.updated_at })) }, 200, origin);
  }
  if (a.action === 'create_issue') {
    const id = Number(a.feedback_id); const repo = String(a.repo || '');
    const f = (await put('GET', `feedback_reports?select=id,kind,title,body,feature,app_version,source,status&id=eq.${id}`))?.[0];
    if (!f) return json({ ok: false, error: 'That report is gone.' }, 404, origin);
    const existing = (await put('GET', `github_links?select=issue_url&feedback_id=eq.${id}`)) || [];
    if (existing.length && !a.again) return json({ ok: false, error: 'Already on GitHub.', url: existing[0].issue_url }, 409, origin);
    const tok = await tokenForRepo(d, cfg, repo);
    // Public issue: the report text only. No email, username or device details.
    const label = { bug: 'bug', feature: 'enhancement', beta: 'beta', feedback: 'feedback' }[f.kind as string] || 'feedback';
    const body = `${String(f.body || '').slice(0, 6000)}\n\n---\n_From the Nexus ${f.source} app${f.app_version ? ` (v${String(f.app_version).replace(/^N28C /, '')})` : ''}${f.feature ? ` · feature: ${f.feature}` : ''}, via Apoji Admin (report #${f.id})._`;
    const issue = await gh(d, `/repos/${repo}/issues`, tok, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: String(f.title).slice(0, 200), body, labels: [label] }) });
    await put('POST', 'github_links', { feedback_id: id, repo, issue_number: issue.number, issue_url: issue.html_url, created_by: who.id }, 'return=minimal');
    await put('POST', 'feedback_replies', { report_id: id, author: who.id, author_name: 'Apoji Admin', is_staff: true, internal: true, body: `Opened GitHub issue ${repo}#${issue.number}: ${issue.html_url}` }, 'return=minimal');
    if (f.status === 'new') await put('PATCH', `feedback_reports?id=eq.${id}`, { status: 'triaged', updated_at: new Date(d.now()).toISOString() }, 'return=minimal');
    return json({ ok: true, number: issue.number, url: issue.html_url }, 200, origin);
  }
  return json({ ok: false, error: 'Unknown action.' }, 400, origin);
}

// ---------- webhooks
function summarize(event: string, p: Record<string, any>) {
  const repo = p.repository?.full_name || '', actor = p.sender?.login || '';
  switch (event) {
    case 'issues': return { repo, actor, title: `#${p.issue?.number} ${p.issue?.title || ''}`, url: p.issue?.html_url || '' };
    case 'issue_comment': return { repo, actor, title: `on #${p.issue?.number}: ${String(p.comment?.body || '').slice(0, 140)}`, url: p.comment?.html_url || '' };
    case 'pull_request': return { repo, actor, title: `#${p.pull_request?.number} ${p.pull_request?.title || ''}${p.action === 'closed' && p.pull_request?.merged ? ' (merged)' : ''}`, url: p.pull_request?.html_url || '' };
    case 'release': return { repo, actor, title: `${p.release?.name || p.release?.tag_name || ''}`, url: p.release?.html_url || '' };
    case 'push': return { repo, actor, title: `${(p.commits || []).length} commit${(p.commits || []).length === 1 ? '' : 's'} to ${String(p.ref || '').replace('refs/heads/', '')}: ${String(p.head_commit?.message || '').split('\n')[0].slice(0, 120)}`, url: p.compare || '' };
    case 'workflow_run': return { repo, actor, title: `${p.workflow_run?.name || 'Workflow'}: ${p.workflow_run?.conclusion || p.workflow_run?.status || ''}`, url: p.workflow_run?.html_url || '' };
    case 'installation': case 'installation_repositories': return { repo: '', actor, title: `${p.installation?.account?.login || ''} ${p.action || ''}`, url: p.installation?.html_url || '' };
    default: return { repo, actor, title: event, url: '' };
  }
}
async function webhook(req: Request, d: Deps) {
  const raw = await req.text();
  const cfg = await appConfig(d);
  if (!cfg || !(await validSignature(cfg.webhook_secret, raw, req.headers.get('x-hub-signature-256')))) return new Response('bad signature', { status: 401 });
  const event = req.headers.get('x-github-event') || '', delivery = req.headers.get('x-github-delivery') || crypto.randomUUID();
  const p = JSON.parse(raw || '{}');
  const put = db(d);
  if (event === 'ping') return new Response('pong');
  const s = summarize(event, p);
  // workflow runs are noisy: only keep finished ones; pushes only to the default branch
  const keep = !(event === 'workflow_run' && p.action !== 'completed') && !(event === 'push' && p.ref !== `refs/heads/${p.repository?.default_branch}`);
  if (keep) await put('POST', 'github_events?on_conflict=delivery', { delivery, event, action: String(p.action || ''), repo: s.repo, title: String(s.title).slice(0, 300), url: s.url, actor: s.actor }, 'resolution=ignore-duplicates,return=minimal');
  if (event === 'installation' || event === 'installation_repositories') await refreshInstallations(d, cfg).catch(() => {});
  // A linked issue was closed or reopened → the feedback report follows
  if (event === 'issues' && ['closed', 'reopened'].includes(p.action)) {
    const links = await put('GET', `github_links?select=feedback_id&repo=eq.${encodeURIComponent(s.repo)}&issue_number=eq.${p.issue.number}`);
    for (const l of links || []) {
      const status = p.action === 'reopened' ? 'working' : p.issue.state_reason === 'not_planned' ? 'wontfix' : 'fixed';
      await put('PATCH', `github_links?repo=eq.${encodeURIComponent(s.repo)}&issue_number=eq.${p.issue.number}`, { state: p.issue.state }, 'return=minimal');
      await put('PATCH', `feedback_reports?id=eq.${l.feedback_id}`, { status, updated_at: new Date(d.now()).toISOString() }, 'return=minimal');
      await put('POST', 'feedback_replies', { report_id: l.feedback_id, author: (await put('GET', 'github_app?select=created_by&id=eq.1'))?.[0]?.created_by, author_name: 'Apoji Admin', is_staff: true, internal: true,
        body: `GitHub issue #${p.issue.number} was ${p.action}${p.issue.state_reason ? ` (${p.issue.state_reason.replace('_', ' ')})` : ''} by ${s.actor}. Status → ${status}.` }, 'return=minimal').catch(() => {});
    }
  }
  // A release → a draft announcement admins can turn on in one click
  if (event === 'release' && p.action === 'published' && !p.release?.draft && !p.release?.prerelease) {
    const name = p.repository?.name === 'Nexus-28' ? "Nexus '28" : p.repository?.name;
    await put('POST', 'announcements', { message: `${name} ${p.release.tag_name} is out! Update from the app menu.`.slice(0, 300), active: false }, 'return=minimal').catch(() => {});
  }
  return new Response('ok');
}

export async function handler(req: Request, d: Deps = defaultDeps) {
  const origin = req.headers.get('origin') || '';
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (req.method !== 'POST') return new Response('Apoji Admin', { status: 200 });
  try {
    if (new URL(req.url).pathname.endsWith('/webhook')) return await webhook(req, d);
    return await action(req, d, origin);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500, origin);
  }
}

if (import.meta.main) Deno.serve(req => handler(req));
