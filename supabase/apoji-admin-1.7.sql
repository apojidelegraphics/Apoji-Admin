-- Apoji Admin 1.7: high-admin tiers (Viewer · Editor · Owner), Axiom controls, automatic changelog emails.
-- Run once in Supabase → SQL Editor, after the Nexus repo's nexus-v2.7.sql and nexus-v2.9.sql. Safe to run again.

-- =====================================================================================================
-- 1) Tiers for high-admins. Viewer: sees everything, changes nothing high-admin-only. Editor: today's high-admin.
--    Owner: Apoji_Delegraphics. Only the Owner can change the Owner account or anyone's tier; the Owner tag itself
--    can only be given here in the SQL editor.
-- =====================================================================================================
alter table public.admin_roles add column if not exists high_tier text not null default 'editor';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'admin_roles_high_tier_check') then
    alter table public.admin_roles add constraint admin_roles_high_tier_check check (high_tier in ('viewer', 'editor', 'owner'));
  end if;
end $$;

create or replace function public.my_high_tier()
returns text language sql stable security definer set search_path = public as $$
  select case when level = 'high-admin' then high_tier end from public.admin_roles where user_id = auth.uid()
$$;
create or replace function public.is_owner(p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_roles where user_id = p_uid and level = 'high-admin' and high_tier = 'owner')
$$;
-- High-admin who may change things (Editor or Owner)
create or replace function public.hi_can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_high_tier() in ('editor', 'owner'), false)
$$;

-- The Owner: Apoji_Delegraphics
update public.admin_roles r set high_tier = 'owner'
  from public.profiles p where p.id = r.user_id and lower(p.username) = 'apoji_delegraphics' and r.level = 'high-admin';

-- Guard the roles table itself, whatever function or tool writes to it (the SQL editor is always allowed)
create or replace function public.admin_roles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if public.my_high_tier() = 'viewer' then raise exception 'Viewers can look but not change admin roles.'; end if;
  if tg_op in ('UPDATE', 'DELETE') and old.high_tier = 'owner' and not public.is_owner() then raise exception 'Only the Owner can change the Owner account.'; end if;
  if tg_op = 'INSERT' and new.high_tier = 'owner' then raise exception 'The Owner tag can only be given in the Supabase SQL editor.'; end if;
  if tg_op = 'UPDATE' and new.high_tier is distinct from old.high_tier then
    if new.high_tier = 'owner' or old.high_tier = 'owner' then raise exception 'The Owner tag can only be changed in the Supabase SQL editor.'; end if;
    if not public.is_owner() then raise exception 'Only the Owner can change tiers.'; end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists admin_roles_guard on public.admin_roles;
create trigger admin_roles_guard before insert or update or delete on public.admin_roles for each row execute function public.admin_roles_guard();

-- Nobody but the Owner can suspend or ban the Owner
create or replace function public.owner_moderation_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.is_owner(new.user_id) and not public.is_owner() then raise exception 'The Owner account can''t be moderated.'; end if;
  return new;
end $$;
drop trigger if exists owner_moderation_guard on public.user_moderation;
create trigger owner_moderation_guard before insert or update on public.user_moderation for each row execute function public.owner_moderation_guard();

-- Tiers for the admin list (any admin can read them), and changing one (Owner only)
create or replace function public.admin_tiers()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then coalesce(jsonb_object_agg(user_id, high_tier) filter (where level = 'high-admin'), '{}'::jsonb) else '{}'::jsonb end from public.admin_roles
$$;
create or replace function public.admin_set_tier(p_user uuid, p_tier text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then return jsonb_build_object('success', false, 'error', 'owner_only'); end if;
  if p_tier not in ('viewer', 'editor') then return jsonb_build_object('success', false, 'error', 'bad_tier'); end if;
  update public.admin_roles set high_tier = p_tier where user_id = p_user and level = 'high-admin' and high_tier <> 'owner';
  if not found then return jsonb_build_object('success', false, 'error', 'not_high_admin'); end if;
  insert into public.moderation_log (action, performed_by, details) values ('tier_changed', auth.uid(), jsonb_build_object('user', p_user, 'tier', p_tier));
  return jsonb_build_object('success', true);
end $$;

-- =====================================================================================================
-- 2) Axiom controls: take it offline (now, for a while or until you say so) with a message, per-person blocks,
--    minute overrides and resets, tool kits switched off for everyone, read-only mode, prompt history + restore.
-- =====================================================================================================
alter table public.apex_config add column if not exists offline_until timestamptz;
alter table public.apex_config add column if not exists offline_message text not null default '';
alter table public.apex_config add column if not exists kits_off text[] not null default '{}';
alter table public.apex_config add column if not exists read_only boolean not null default false;

create table if not exists public.apex_overrides (
  user_id uuid primary key references auth.users(id) on delete cascade,
  blocked boolean not null default false,
  weekly_minutes int check (weekly_minutes between 0 and 10080),
  reset_at timestamptz,
  note text not null default '' check (char_length(note) <= 200),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.apex_overrides enable row level security;
drop policy if exists apex_overrides_read on public.apex_overrides;
create policy apex_overrides_read on public.apex_overrides for select using (public.get_my_admin_level() = 'high-admin');
revoke insert, update, delete on public.apex_overrides from anon, authenticated;

create table if not exists public.apex_prompt_history (id bigserial primary key, prompt text not null, saved_at timestamptz not null default now());
alter table public.apex_prompt_history add column if not exists saved_by uuid references auth.users(id) on delete set null;
alter table public.apex_prompt_history enable row level security;
revoke all on public.apex_prompt_history from anon, authenticated;

create or replace function public.apex_status(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.apex_config; o public.apex_overrides; lvl text; unl boolean; beta boolean; ok boolean; used numeric; lim int; off boolean;
  wk timestamptz := date_trunc('week', now() at time zone 'utc') at time zone 'utc'; since timestamptz;
begin
  select * into c from public.apex_config where id = 1;
  if p_uid is null or c is null then return jsonb_build_object('allowed', false, 'reason', 'sign_in'); end if;
  select level into lvl from public.admin_roles where user_id = p_uid;
  select * into o from public.apex_overrides where user_id = p_uid;
  unl := exists (select 1 from public.apex_unlimited where user_id = p_uid);
  select coalesce(is_beta_tester, false) into beta from public.profiles where id = p_uid;
  off := c.offline_until is not null and c.offline_until > now();
  ok := case c.stage
    when 'off' then false
    when 'owner' then unl
    when 'high-admin' then unl or lvl = 'high-admin'
    when 'admin' then unl or lvl is not null
    when 'beta' then unl or lvl is not null or coalesce(beta, false)
    else true end;
  ok := coalesce(ok, false) and not off and not (coalesce(o.blocked, false) and not unl);
  lim := coalesce(o.weekly_minutes, c.weekly_minutes);
  since := greatest(wk, coalesce(o.reset_at, wk));
  select coalesce(sum(seconds), 0) / 60.0 into used from public.apex_usage where user_id = p_uid and created_at >= since;
  return jsonb_build_object(
    'allowed', ok,
    'reason', case when ok then '' when off then 'offline' when c.stage = 'off' then 'off' when coalesce(o.blocked, false) then 'blocked' else 'not_yet' end,
    'notice', case when off or c.stage = 'off' then nullif(c.offline_message, '') end,
    'back_at', case when off and c.offline_until < 'infinity' then c.offline_until end,
    'stage', c.stage, 'unlimited', unl, 'admin', lvl is not null, 'level', coalesce(lvl, ''),
    'limit', case when unl then null else lim end,
    'used', round(used, 1),
    'left', case when unl then null else greatest(0, round(lim - used, 1)) end,
    'resets_at', wk + interval '7 days',
    'kits_off', to_jsonb(coalesce(c.kits_off, '{}')), 'read_only', coalesce(c.read_only, false),
    'providers', case when lvl is not null or unl then null else to_jsonb(c.public_providers) end);
end $$;
revoke all on function public.apex_status(uuid) from public, anon, authenticated;

-- Changing settings: Editors and the Owner only (Viewers can look). Prompt changes keep the old prompt in history.
create or replace function public.admin_apex_set(p_stage text default null, p_weekly_minutes int default null, p_providers text[] default null, p_prompt text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.hi_can_write() then return jsonb_build_object('success', false, 'error', 'viewer'); end if;
  if p_providers is not null and not (p_providers <@ array['anthropic', 'openrouter', 'openai', 'gemini', 'ollama', 'lmstudio', 'groq', 'mistral', 'xai', 'deepseek', 'together', 'fireworks', 'cerebras', 'perplexity', 'cohere']) then
    return jsonb_build_object('success', false, 'error', 'bad_provider'); end if;
  if p_prompt is not null then insert into public.apex_prompt_history (prompt, saved_by) select prompt, auth.uid() from public.apex_config where id = 1 and prompt <> ''; end if;
  update public.apex_config set
    stage = coalesce(p_stage, stage), weekly_minutes = coalesce(p_weekly_minutes, weekly_minutes),
    public_providers = coalesce(p_providers, public_providers), prompt = coalesce(p_prompt, prompt),
    updated_by = auth.uid(), updated_at = now() where id = 1;
  insert into public.moderation_log (action, performed_by, details)
    values ('apex_settings_changed', auth.uid(), jsonb_strip_nulls(jsonb_build_object('stage', p_stage, 'weekly_minutes', p_weekly_minutes, 'providers', p_providers, 'prompt_changed', p_prompt is not null)));
  return jsonb_build_object('success', true);
end $$;

-- Offline / online, tool kits, read-only. p: {offline: minutes | 0 (until turned back on) | null (leave), online: true, message, kits_off: [...], read_only}
create or replace function public.admin_apex_control(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare kits text[];
begin
  if not public.hi_can_write() then return jsonb_build_object('success', false, 'error', 'viewer'); end if;
  if p ? 'online' and (p->>'online')::boolean then
    update public.apex_config set offline_until = null, updated_by = auth.uid(), updated_at = now() where id = 1;
  elsif p ? 'offline' then
    update public.apex_config set offline_until = case when coalesce((p->>'offline')::int, 0) <= 0 then 'infinity'::timestamptz else now() + make_interval(mins => least((p->>'offline')::int, 60 * 24 * 60)) end,
      offline_message = left(coalesce(p->>'message', offline_message), 300), updated_by = auth.uid(), updated_at = now() where id = 1;
  end if;
  if p ? 'message' and not (p ? 'offline') then update public.apex_config set offline_message = left(p->>'message', 300) where id = 1; end if;
  if p ? 'kits_off' then
    select coalesce(array_agg(k), '{}') into kits from jsonb_array_elements_text(p->'kits_off') k where k in ('mac', 'dev', 'web', 'nexus');
    update public.apex_config set kits_off = kits, updated_by = auth.uid(), updated_at = now() where id = 1;
  end if;
  if p ? 'read_only' then update public.apex_config set read_only = (p->>'read_only')::boolean, updated_by = auth.uid(), updated_at = now() where id = 1; end if;
  insert into public.moderation_log (action, performed_by, details) values ('apex_control', auth.uid(), p);
  return jsonb_build_object('success', true);
end $$;

-- One person: block/unblock, their own weekly minutes (null = the default), reset this week's minutes
create or replace function public.admin_apex_user(p_user uuid, p_blocked boolean default null, p_minutes int default null, p_clear_minutes boolean default false, p_reset boolean default false, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.hi_can_write() then return jsonb_build_object('success', false, 'error', 'viewer'); end if;
  if public.is_owner(p_user) and not public.is_owner() then return jsonb_build_object('success', false, 'error', 'owner'); end if;
  insert into public.apex_overrides (user_id) values (p_user) on conflict (user_id) do nothing;
  update public.apex_overrides set blocked = coalesce(p_blocked, blocked),
    weekly_minutes = case when p_clear_minutes then null when p_minutes is not null then greatest(0, least(p_minutes, 10080)) else weekly_minutes end,
    reset_at = case when p_reset then now() else reset_at end, note = coalesce(left(p_note, 200), note), updated_by = auth.uid(), updated_at = now()
    where user_id = p_user;
  insert into public.moderation_log (action, performed_by, details) values ('apex_user', auth.uid(), jsonb_strip_nulls(jsonb_build_object('user', p_user, 'blocked', p_blocked, 'minutes', p_minutes, 'reset', p_reset)));
  return jsonb_build_object('success', true);
end $$;

-- Find someone by email or username (for the overrides box)
create or replace function public.admin_apex_find(p_q text)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  if public.get_my_admin_level() is distinct from 'high-admin' then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id', u.id, 'email', u.email, 'username', p.username)), '[]'::jsonb) from (
    select u.id, u.email from auth.users u left join public.profiles p on p.id = u.id
    where u.email ilike '%' || p_q || '%' or p.username ilike '%' || p_q || '%' limit 8) u left join public.profiles p on p.id = u.id);
end $$;

create or replace function public.admin_apex_prompts()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  if public.get_my_admin_level() is distinct from 'high-admin' then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'saved_at', h.saved_at, 'length', char_length(h.prompt), 'preview', left(h.prompt, 160), 'by', u.email) order by h.id desc), '[]'::jsonb)
    from (select * from public.apex_prompt_history order by id desc limit 20) h left join auth.users u on u.id = h.saved_by);
end $$;
create or replace function public.admin_apex_restore_prompt(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare old text;
begin
  if not public.hi_can_write() then return jsonb_build_object('success', false, 'error', 'viewer'); end if;
  select prompt into old from public.apex_prompt_history where id = p_id;
  if old is null then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  return public.admin_apex_set(null, null, null, old);
end $$;

-- The Axiom page: everything above plus who's blocked/overridden and the latest turns
create or replace function public.admin_apex_overview()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare wk timestamptz := date_trunc('week', now() at time zone 'utc') at time zone 'utc';
begin
  if public.get_my_admin_level() is distinct from 'high-admin' then return jsonb_build_object('success', false, 'error', 'not_high_admin'); end if;
  return jsonb_build_object('success', true, 'tier', public.my_high_tier(),
    'config', (select to_jsonb(c) - 'prompt' || jsonb_build_object('prompt', c.prompt, 'offline', c.offline_until is not null and c.offline_until > now()) from public.apex_config c where id = 1),
    'unlimited', (select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'email', u.email, 'note', x.note)), '[]'::jsonb) from public.apex_unlimited x join auth.users u on u.id = x.user_id),
    'overrides', (select coalesce(jsonb_agg(jsonb_build_object('user_id', o.user_id, 'email', u.email, 'blocked', o.blocked, 'weekly_minutes', o.weekly_minutes, 'reset_at', o.reset_at, 'note', o.note) order by u.email), '[]'::jsonb)
      from public.apex_overrides o join auth.users u on u.id = o.user_id where o.blocked or o.weekly_minutes is not null or o.reset_at > wk),
    'week', (select coalesce(jsonb_agg(jsonb_build_object('user_id', w.user_id, 'email', u.email, 'level', coalesce(r.level, ''), 'minutes', w.minutes, 'turns', w.turns, 'last', w.last,
        'unlimited', exists (select 1 from public.apex_unlimited x where x.user_id = w.user_id)) order by w.minutes desc), '[]'::jsonb)
      from (select user_id, round(sum(seconds) / 60.0, 1) minutes, count(*) turns, max(created_at) last from public.apex_usage where created_at >= wk group by user_id) w
      join auth.users u on u.id = w.user_id left join public.admin_roles r on r.user_id = w.user_id),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object('email', u.email, 'kind', a.kind, 'provider', a.provider, 'model', a.model, 'seconds', a.seconds, 'at', a.created_at) order by a.created_at desc), '[]'::jsonb)
      from (select * from public.apex_usage order by created_at desc limit 25) a join auth.users u on u.id = a.user_id),
    'weeks', (select coalesce(jsonb_agg(jsonb_build_object('week', x.wk, 'minutes', x.minutes, 'people', x.people) order by x.wk), '[]'::jsonb)
      from (select date_trunc('week', created_at at time zone 'utc')::date wk, round(sum(seconds) / 60.0, 1) minutes, count(distinct user_id) people
            from public.apex_usage where created_at > now() - interval '8 weeks' group by 1) x),
    'resets_at', wk + interval '7 days');
end $$;

-- =====================================================================================================
-- 3) Changelog emails: automatic (sent by the changelog-send function when a release is published) or manual
-- =====================================================================================================
-- Stored in admin_settings 'emailjs' as { ..., mode: 'auto' | 'manual' }. Nothing to create here; the function
-- reads it with the service role.

-- Viewers can't change the EmailJS settings
drop policy if exists ads_hi on public.admin_settings;
drop policy if exists ads_hi_read on public.admin_settings;
create policy ads_hi_read on public.admin_settings for select using (public.get_my_admin_level() = 'high-admin');
drop policy if exists ads_hi_write on public.admin_settings;
create policy ads_hi_write on public.admin_settings for all using (public.hi_can_write()) with check (public.hi_can_write());

do $$ declare f text; begin
  foreach f in array array['my_high_tier()', 'is_owner(uuid)', 'hi_can_write()', 'admin_tiers()', 'admin_set_tier(uuid, text)', 'admin_apex_set(text, int, text[], text)', 'admin_apex_control(jsonb)',
    'admin_apex_user(uuid, boolean, int, boolean, boolean, text)', 'admin_apex_find(text)', 'admin_apex_prompts()', 'admin_apex_restore_prompt(bigint)', 'admin_apex_overview()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
