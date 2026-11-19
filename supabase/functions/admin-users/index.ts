// Apoji Admin 1.7: change a user's account without knowing their password (Supabase Edge Function "admin-users").
// 2.3: admins and mods with an approved access request ('users_edit' / 'users_create', see nexus-v3.8.sql) can use it
// too, for regular accounts only. New action 'temp_password': a one-time password shown once to the admin; the apps
// make the person pick their own at the next sign-in (user_metadata.must_change_password). Nobody can SEE a
// password: Supabase only keeps a one-way hash.
// Runs with the service role, so only this function can do it, and it checks every call:
//   • the caller must be a high-admin Editor or the Owner (Viewers can't change anything)
//   • only the Owner can touch the Owner account, or another high-admin's email, password or account
//   • every change is written to the audit log (moderation_log)
// Deploy: supabase functions deploy admin-users --no-verify-jwt (it checks the sign-in itself)   (or Supabase dashboard → Edge Functions → Deploy new function)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const URL_ = Deno.env.get('SUPABASE_URL')!, SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/, USERNAME = /^[A-Za-z0-9_.-]{3,24}$/;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  try {
    const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: who } = await admin.auth.getUser(jwt);
    const me = who?.user; if (!me) return json({ ok: false, error: 'Sign in again.' }, 401);
    const { data: role0 } = await admin.from('admin_roles').select('level, high_tier').eq('user_id', me.id).maybeSingle();
    if (!role0) return json({ ok: false, error: 'Admins only.' }, 403);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || ''), target = String(body.user_id || '');
    // 2.3: lower admins with an approved request act like an Editor, but never on admin accounts
    const granted = async (perm: string) => !!(await admin.rpc('admin_has_perm', { p_perm: perm, p_uid: me.id })).data;
    const high = role0.level === 'high-admin';
    if (!high && !(await granted(action === 'create' ? 'users_create' : 'users_edit'))) return json({ ok: false, error: 'High-admins only. You can ask for access: Users → Request access.' }, 403);
    const myRole = high ? role0 : { level: role0.level, high_tier: 'editor' };
    const owner = myRole.high_tier === 'owner';
    // 2.1: make a new account (Editors and the Owner). Roles are given afterwards with admin_grant_role, as usual.
    if (action === 'create') {
      if (myRole.high_tier === 'viewer') return json({ ok: false, error: 'Viewers can look but not change accounts.' }, 403);
      const email = String(body.email || '').trim().toLowerCase(), password = String(body.password || '');
      if (!EMAIL.test(email)) return json({ ok: false, error: "That doesn't look like an email address." }, 400);
      if (password && password.length < 8) return json({ ok: false, error: 'Use at least 8 characters.' }, 400);
      const uname = String(body.username || '').trim(); if (uname && !USERNAME.test(uname)) return json({ ok: false, error: 'Usernames are 3–24 characters: letters, numbers, _ . -' }, 400);
      const nick = String(body.nickname || '').trim().slice(0, 40);
      const made = password
        ? await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: nick ? { nickname: nick } : {} })
        : await admin.auth.admin.inviteUserByEmail(email, { data: nick ? { nickname: nick } : {}, redirectTo: 'https://apojidelegraphics.github.io/Nexus-28/companion/' });
      if (made.error) return json({ ok: false, error: /already|registered|exists/i.test(made.error.message) ? 'Another account already uses that email.' : made.error.message }, 400);
      const uid = made.data.user!.id;
      // every account needs a profile with a username: theirs, or one made from the email (name, name2, name37…)
      const base = (uname || email.split('@')[0].replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 20) || 'user').padEnd(3, '0');
      let taken = false;
      for (let i = 0; i < 6; i++) {
        const tryName = i === 0 ? base : (base.slice(0, 20) + (i === 1 ? '2' : Math.floor(Math.random() * 900 + 100)));
        const { error } = await admin.from('profiles').upsert({ id: uid, username: tryName, ...(nick ? { nickname: nick } : {}) });
        if (!error) { taken = i > 0 && !!uname; break; }
        if (!/duplicate|unique/i.test(error.message)) break;
      }
      if (taken) return json({ ok: true, user_id: uid, message: `Profile created for ${email}, but @${uname} was taken, so it got a similar username. Change it in their Account card.` });
      await admin.from('moderation_log').insert({ action: 'user_created', performed_by: me.id, target_user_id: uid, target_email: email, details: { invited: !password, username: uname || null } }).then(() => {}, () => {});
      return json({ ok: true, user_id: uid, message: password ? `Profile created for ${email}. Tell them their password privately.` : `Invite sent to ${email}.` });
    }
    const { data: t } = await admin.auth.admin.getUserById(target);
    if (!t?.user) return json({ ok: false, error: 'That account no longer exists.' }, 404);
    const { data: tRole } = await admin.from('admin_roles').select('level, high_tier').eq('user_id', target).maybeSingle();
    const { data: prof } = await admin.from('profiles').select('username, nickname, avatar_url').eq('id', target).maybeSingle();

    if (action === 'info') return json({ ok: true, user: { id: t.user.id, email: t.user.email, confirmed: !!t.user.email_confirmed_at, created_at: t.user.created_at, last_sign_in_at: t.user.last_sign_in_at,
      provider: t.user.app_metadata?.provider || 'email', username: prof?.username || '', nickname: prof?.nickname || '', level: tRole?.level || '', tier: tRole?.level === 'high-admin' ? tRole.high_tier : '' },
      can: { edit: myRole.high_tier !== 'viewer' && (tRole?.high_tier !== 'owner' || owner), credentials: myRole.high_tier !== 'viewer' && (owner || tRole?.level !== 'high-admin' || target === me.id) } });

    if (myRole.high_tier === 'viewer') return json({ ok: false, error: 'Viewers can look but not change accounts.' }, 403);
    if (!high && tRole) return json({ ok: false, error: 'Only high-admins can change admin accounts.' }, 403);
    if (tRole?.level === 'high-admin' && tRole.high_tier === 'owner' && !owner) return json({ ok: false, error: 'Only the Owner can change the Owner account.' }, 403);
    if (tRole?.level === 'high-admin' && target !== me.id && !owner && ['email', 'password', 'temp_password', 'delete'].includes(action)) return json({ ok: false, error: "Only the Owner can change another high-admin's email, password or account." }, 403);

    const log = (what: string, details: Record<string, unknown> = {}) => admin.from('moderation_log').insert({ action: what, performed_by: me.id, target_user_id: target, target_email: t.user.email, details }).then(() => {}, () => {});

    if (action === 'email') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!EMAIL.test(email)) return json({ ok: false, error: "That doesn't look like an email address." }, 400);
      const { error } = await admin.auth.admin.updateUserById(target, { email, email_confirm: true });
      if (error) return json({ ok: false, error: /already|registered|exists/i.test(error.message) ? 'Another account already uses that email.' : error.message }, 400);
      await log('user_email_changed', { from: t.user.email, to: email });
      return json({ ok: true, message: `Email changed to ${email}. They sign in with it from now on.` });
    }
    if (action === 'password') {
      const password = String(body.password || '');
      if (password.length < 8) return json({ ok: false, error: 'Use at least 8 characters.' }, 400);
      const { error } = await admin.auth.admin.updateUserById(target, { password });
      if (error) return json({ ok: false, error: error.message }, 400);
      await log('user_password_set');
      return json({ ok: true, message: 'Password changed. Tell them the new one privately, or send a reset email instead.' });
    }
    // 2.3: a one-time password (shown once, never stored by us); they must pick their own when they next sign in
    if (action === 'temp_password') {
      const W = ['moon', 'tiger', 'river', 'cloud', 'maple', 'comet', 'ember', 'pixel', 'orbit', 'cedar', 'lunar', 'storm', 'coral', 'nova', 'frost', 'delta'];
      const r = crypto.getRandomValues(new Uint32Array(3));
      const temp = `${W[r[0] % W.length]}-${W[r[1] % W.length]}-${1000 + (r[2] % 9000)}`.replace(/^./, c => c.toUpperCase());
      const { error } = await admin.auth.admin.updateUserById(target, { password: temp, user_metadata: { ...(t.user.user_metadata || {}), must_change_password: true } });
      if (error) return json({ ok: false, error: error.message }, 400);
      await log('user_temp_password');
      return json({ ok: true, password: temp, message: 'Temporary password set. Tell them privately; Nexus asks them to pick a new one when they sign in.' });
    }
    if (action === 'reset') {
      const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
      const redirectTo = /^https:\/\//.test(String(body.redirect || '')) ? String(body.redirect) : undefined;
      const { error } = await anon.auth.resetPasswordForEmail(t.user.email!, redirectTo ? { redirectTo } : undefined);
      if (error) return json({ ok: false, error: error.message }, 400);
      await log('user_password_reset_sent');
      return json({ ok: true, message: `Reset email sent to ${t.user.email}.` });
    }
    if (action === 'profile') {
      const patch: Record<string, unknown> = {};
      if (body.nickname !== undefined) patch.nickname = String(body.nickname).trim().slice(0, 40) || null;
      if (body.username !== undefined) { const u = String(body.username).trim(); if (!USERNAME.test(u)) return json({ ok: false, error: 'Usernames are 3–24 characters: letters, numbers, _ . -' }, 400); patch.username = u; }
      if (body.remove_avatar) patch.avatar_url = null;
      if (!Object.keys(patch).length) return json({ ok: false, error: 'Nothing to change.' }, 400);
      const { error } = await admin.from('profiles').update(patch).eq('id', target);
      if (error) return json({ ok: false, error: /duplicate|unique/i.test(error.message) ? 'That username is taken.' : error.message }, 400);
      await log('user_profile_changed', { before: { username: prof?.username, nickname: prof?.nickname }, after: patch });
      return json({ ok: true, message: 'Saved.' });
    }
    // 2.0.4: an admin changes someone else's picture (cropped to 256px in the app, sent as base64)
    if (action === 'avatar') {
      const m = String(body.image || '').match(/^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
      if (!m) return json({ ok: false, error: 'That picture can’t be used.' }, 400);
      const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
      if (bytes.length > 400000) return json({ ok: false, error: 'That picture is too big.' }, 400);
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1], path = `${target}/avatar.${ext}`;
      const up = await admin.storage.from('avatars').upload(path, bytes, { upsert: true, contentType: 'image/' + m[1] });
      if (up.error) return json({ ok: false, error: up.error.message }, 400);
      const url = admin.storage.from('avatars').getPublicUrl(path).data.publicUrl + '?v=' + Date.now();
      const { error } = await admin.from('profiles').update({ avatar_url: url }).eq('id', target);
      if (error) return json({ ok: false, error: error.message }, 400);
      await log('user_avatar_changed', {});
      return json({ ok: true, message: 'Picture updated.', avatar_url: url });
    }
    if (action === 'delete') {
      if (target === me.id) return json({ ok: false, error: "You can't delete your own account here." }, 400);
      if (body.confirm !== 'DELETE') return json({ ok: false, error: 'Type DELETE to confirm.' }, 400);
      if (tRole && !owner) return json({ ok: false, error: 'Remove their admin role first (or ask the Owner).' }, 403);
      await log('user_deleted', { username: prof?.username || '' });
      const { error } = await admin.auth.admin.deleteUser(target);
      if (error) return json({ ok: false, error: error.message }, 400);
      return json({ ok: true, message: 'Account deleted.' });
    }
    return json({ ok: false, error: 'Unknown action.' }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
