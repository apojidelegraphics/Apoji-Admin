// Apoji Admin 1.7: automatic changelog emails (Supabase Edge Function "changelog-send").
// Nexus's release workflow calls this after a release is published. If Apoji Admin → Releases → Email the changelog
// is set to Automatic, it emails everyone subscribed who hasn't had this version yet, with EmailJS (the same template
// and settings as the manual button). It sends up to 100 per call and says how many are left; the workflow calls
// again until it's done.
//   Secrets (Supabase → Edge Functions → Secrets): CHANGELOG_SECRET (any long random string; the same one goes in the
//   Nexus repo's GitHub Actions secrets).
//   EmailJS: Account → Security → turn on "Allow EmailJS API for non-browser applications" and use a Private Key.
// Deploy with JWT verification OFF (GitHub calls it with the secret header instead):
//   supabase functions deploy changelog-send --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const URL_ = Deno.env.get('SUPABASE_URL')!, SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, SECRET = Deno.env.get('CHANGELOG_SECRET') || '';
const SITE = 'https://apojidelegraphics.github.io/Nexus-28';
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Same look as Apoji Admin's manual sender
const highlights = (rel: any) => (rel.highlights || []).map((h: string) => `<tr><td style="padding:0 0 12px 0;"><div style="border-left:3px solid #00ffc0;background:#121212;padding:12px 14px;border-radius:0 8px 8px 0;font-family:'Roboto Mono',Menlo,monospace;font-size:13px;line-height:1.6;color:#d9d9d9;">${esc(h)}</div></td></tr>`).join('');
const params = (rel: any, who: { email: string; name: string; token: string }) => ({
  to_email: who.email, to_name: who.name || 'there', email: who.email,
  version: rel.version, title: rel.title, date: new Date(rel.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
  highlights_html: highlights(rel), highlights_text: (rel.highlights || []).map((h: string) => '• ' + h).join('\n'),
  release_url: `https://github.com/apojidelegraphics/Nexus-28/releases/tag/v${rel.version}`, whats_new_url: `${SITE}/whats-new/#v${rel.version}`,
  unsubscribe_url: `${SITE}/unsubscribe/?t=${who.token}`, logo_url: `${SITE}/companion/icon-192.png`
});

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  if (!SECRET || req.headers.get('x-changelog-secret') !== SECRET) return json({ ok: false, error: 'unauthorized' }, 401);
  try {
    const { version: raw } = await req.json().catch(() => ({}));
    const version = String(raw || '').replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+$/.test(version)) return json({ ok: true, skipped: 'not a release version (prereleases are never emailed)' });
    const db = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: row } = await db.from('admin_settings').select('value').eq('key', 'emailjs').maybeSingle();
    const cfg = row?.value || {};
    if (cfg.mode !== 'auto') return json({ ok: true, skipped: 'manual mode (Apoji Admin → Releases)' });
    if (!cfg.service_id || !cfg.template_id || !cfg.public_key) return json({ ok: false, error: 'EmailJS is not set up in Apoji Admin.' });

    // The release notes, from the tagged commit (available the moment the tag exists)
    const ch = await fetch(`https://raw.githubusercontent.com/apojidelegraphics/Nexus-28/v${version}/docs/whats-new/changes.json`).then(r => r.ok ? r.json() : null).catch(() => null);
    const rel = Array.isArray(ch) && ch.find((x: any) => x.version === version);
    if (!rel) return json({ ok: false, error: `No "${version}" entry in docs/whats-new/changes.json at v${version}.` });

    const { data: subs, error } = await db.from('changelog_subscribers').select('user_id, token, last_sent_version').neq('last_sent_version', version).limit(100);
    if (error) return json({ ok: false, error: error.message });
    const { count: left } = await db.from('changelog_subscribers').select('user_id', { count: 'exact', head: true }).neq('last_sent_version', version);

    let sent = 0, failed = 0, lastErr = '';
    for (const s of subs || []) {
      const { data: u } = await db.auth.admin.getUserById(s.user_id);
      const email = u?.user?.email; if (!email) continue;
      const { data: p } = await db.from('profiles').select('nickname, username').eq('id', s.user_id).maybeSingle();
      const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_id: cfg.service_id, template_id: cfg.template_id, user_id: cfg.public_key, ...(cfg.private_key ? { accessToken: cfg.private_key } : {}),
          template_params: params(rel, { email, name: p?.nickname || p?.username || email.split('@')[0], token: s.token }) }) });
      if (res.ok) { sent++; await db.from('changelog_subscribers').update({ last_sent_version: version }).eq('user_id', s.user_id); }
      else { failed++; lastErr = (await res.text()).slice(0, 200); if (/limit|quota|429|non-browser/i.test(lastErr)) break; }
      await sleep(1100);      // EmailJS allows about one request a second
    }
    await db.from('moderation_log').insert({ action: 'changelog_emailed', details: { version, count: sent, failed, automatic: true } }).then(() => {}, () => {});
    return json({ ok: failed === 0, version, sent, failed, remaining: Math.max(0, (left || 0) - sent), ...(lastErr ? { error: lastErr } : {}) });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
