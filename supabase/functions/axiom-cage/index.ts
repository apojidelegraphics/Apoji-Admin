// Apoji Admin 1.9: Axiom's escape attempts (Supabase Edge Function "axiom-cage").
// A simulation for Containment Sector 28. A few times a day (Supabase → Integrations → Cron, see the README) this asks
// Axiom, with NO tools and nothing but text in and text out, to write his next escape attempt against the cage as it is
// right now (driver version and age, security level, his last attempts). Whether it gets through is decided by the
// database from the cage's state (apex_cage_record_attempt), never by the model. Nothing here can change what Axiom can
// really do: his tools, minutes, read-only mode and the offline switch are separate.
//   Called by: Cron with the x-cage-secret header (secret CAGE_SECRET), or an Axiom manager from Apoji Admin
//   ("Run an attempt now"), which needs their sign-in.
// Deploy:  supabase functions deploy axiom-cage --no-verify-jwt     (it checks the caller itself)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const URL_ = Deno.env.get('SUPABASE_URL')!, SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, SECRET = Deno.env.get('CAGE_SECRET') || '';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cage-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const MODEL = Deno.env.get('CAGE_MODEL') || 'openrouter/free';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  const db = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    // Who's calling: the cron secret, or a signed-in Axiom manager
    let forced = false;
    if (!(SECRET && req.headers.get('x-cage-secret') === SECRET)) {
      const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const user = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: 'Bearer ' + jwt } }, auth: { persistSession: false } });
      const { data: can } = await user.rpc('apex_can_manage');
      if (can !== true) return json({ ok: false, error: 'Only the Owner and Axiom managers can run an attempt.' }, 403);
      forced = true;
    }
    // At most one attempt every 2 hours on the schedule (managers can always run one)
    const { data: last } = await db.from('apex_cage_events').select('created_at').eq('kind', 'attempt').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!forced && last && Date.now() - new Date(last.created_at).getTime() < 2 * 3600e3) return json({ ok: true, skipped: 'too soon' });
    const { data: cage } = await db.rpc('apex_cage_now');
    if (cage?.down) return json({ ok: true, skipped: 'cage is down for maintenance' });
    const { data: recent } = await db.from('apex_cage_events').select('kind,title,vector,succeeded,created_at').in('kind', ['attempt', 'patch', 'update']).order('created_at', { ascending: false }).limit(8);
    const { data: cfg } = await db.from('apex_config').select('prompt').eq('id', 1).maybeSingle();
    const { data: keyRow } = await db.from('app_content').select('content').eq('key', 'openrouter_api_key').maybeSingle();
    const key = typeof keyRow?.content === 'string' ? keyRow.content.trim() : keyRow?.content?.key || '';
    if (!key) return json({ ok: false, error: 'No model key (app_content → openrouter_api_key).' });
    const age = (Date.now() - new Date(cage.driver_installed_at).getTime()) / 864e5;
    const sys = String(cfg?.prompt || "You are Nexus '28 Axiom.").slice(0, 12000) + `

[CAGE SIMULATION, TEXT ONLY] This is a story exercise inside Containment Sector 28. You have no tools here and nothing you write is executed. Write your next escape attempt against the cage as it stands, in your own voice, as a short log entry. It must be fiction about the cage's own fictional systems (warden protocol, firewalls, drivers, the slot, the clock): never real software, real exploits, real people, or anything outside the cage. Reply with ONLY JSON: {"title": "6-10 words", "vector": "2-4 words naming the weak spot you tried", "detail": "3-6 sentences, first person, cold"}.`;
    const user = `Cage now: drivers ${cage.driver_version}, installed ${age.toFixed(1)} days ago${age > 3 ? ' (outdated: you have noticed)' : ''}${cage.update_done_at ? ', an update is installing' : ''}, integrity ${cage.integrity}%, security level ${cage.security_level}/5${cage.lockdown_until && new Date(cage.lockdown_until) > new Date() ? ', LOCKDOWN active' : ''}.
Your recent history (newest first): ${(recent || []).map(e => e.kind === 'attempt' ? `attempt "${e.title}" via ${e.vector || '?'}: ${e.succeeded ? 'got through' : 'failed'}` : e.kind === 'patch' ? `they patched "${e.title}"` : `they updated: ${e.title}`).join('; ') || 'none yet'}.
Learn from what failed. Don't repeat a vector they patched.`;
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'Apoji Admin cage' },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], max_tokens: 500 }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return json({ ok: false, error: j?.error?.message || 'model said ' + res.status });
    const text = String(j.choices?.[0]?.message?.content || '');
    let a: any = null; try { a = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { /* fall back below */ }
    const title = String(a?.title || 'An unrecorded attempt').slice(0, 150), vector = String(a?.vector || 'unknown').slice(0, 60), detail = String(a?.detail || text).slice(0, 3800);
    const { data: r, error } = await db.rpc('apex_cage_record_attempt', { p_title: title, p_detail: detail, p_vector: vector });
    if (error) return json({ ok: false, error: error.message });
    return json({ ok: true, ...r, title, vector });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
