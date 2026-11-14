-- Apoji Admin 1.2: broadcasts (to everyone's Mac and phone), schedules run by your Mac hub, the hub's heartbeat,
-- encrypted team notes, release + health numbers, and audit alerts. Run once in Supabase → SQL Editor, after
-- apoji-admin-1.1.sql. Safe to run again.

-- =====================================================================================================
-- 1) Broadcasts: a message from the team that the Nexus Mac app shows as a notification (and forwards to that
--    person's phone), and N28C shows as a banner. Nexus 2.3+.
-- =====================================================================================================
create table if not exists public.broadcasts (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 1 and 80),
  body text not null default '' check (char_length(body) <= 400),
  url text not null default '' check (url = '' or url ~ '^https://'),
  audience text not null default 'all' check (audience in ('all', 'beta', 'admins', 'outdated')),
  max_version text not null default '' check (char_length(max_version) <= 20),   -- 'outdated': only apps older than this
  desktop boolean not null default true,
  phone boolean not null default true,
  send_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  cancelled boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists broadcasts_send on public.broadcasts (send_at desc);
alter table public.broadcasts enable row level security;
drop policy if exists bc_select on public.broadcasts;
create policy bc_select on public.broadcasts for select using (
  public.is_admin() or (not cancelled and send_at <= now() and expires_at > now() and (
    audience in ('all', 'outdated')
    or (audience = 'beta' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_beta_tester))
  )));
drop policy if exists bc_insert on public.broadcasts;
create policy bc_insert on public.broadcasts for insert with check (public.is_admin() and created_by = auth.uid());
drop policy if exists bc_update on public.broadcasts;
create policy bc_update on public.broadcasts for update using (public.is_admin()) with check (public.is_admin());
grant select on public.broadcasts to anon;

-- =====================================================================================================
-- 2) Schedules: "turn this on at 9:00, off at 17:00". Your Mac hub runs them (it claims each one so it only runs once).
-- =====================================================================================================
create table if not exists public.admin_schedules (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('announcement_on', 'announcement_off', 'maintenance_on', 'maintenance_off', 'flag_stage')),
  target text not null check (char_length(target) between 1 and 80),
  label text not null default '' check (char_length(label) <= 200),
  payload jsonb not null default '{}'::jsonb,
  run_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'cancelled')),
  result text not null default '' check (char_length(result) <= 500),
  ran_by text not null default '',
  ran_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists admin_schedules_due on public.admin_schedules (status, run_at);
alter table public.admin_schedules enable row level security;
drop policy if exists as_select on public.admin_schedules;
create policy as_select on public.admin_schedules for select using (public.is_admin());
drop policy if exists as_insert on public.admin_schedules;
create policy as_insert on public.admin_schedules for insert with check (public.is_admin() and created_by = auth.uid() and status = 'pending');
drop policy if exists as_update on public.admin_schedules;
create policy as_update on public.admin_schedules for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists as_delete on public.admin_schedules;
create policy as_delete on public.admin_schedules for delete using (public.is_admin() and status <> 'running');

-- Atomically take the jobs that are due (so two hubs never run the same one)
create or replace function public.admin_claim_schedules(p_hub text)
returns setof public.admin_schedules language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  -- jobs stuck "running" for 10 minutes (the hub went to sleep mid-run) go back to pending
  update public.admin_schedules set status = 'pending' where status = 'running' and ran_at < now() - interval '10 minutes';
  return query update public.admin_schedules s set status = 'running', ran_by = left(coalesce(p_hub, ''), 60), ran_at = now()
    where s.id in (select id from public.admin_schedules where status = 'pending' and run_at <= now() order by run_at limit 20 for update skip locked)
    returning s.*;
end $$;
create or replace function public.admin_finish_schedule(p_id bigint, p_ok boolean, p_result text default '')
returns void language sql security definer set search_path = public as $$
  update public.admin_schedules set status = case when p_ok then 'done' else 'failed' end, result = left(coalesce(p_result, ''), 500)
  where id = p_id and status = 'running' and public.is_admin();
$$;

-- =====================================================================================================
-- 3) The Mac hub's heartbeat (so every admin can see whether it's online, awake and running jobs)
-- =====================================================================================================
create table if not exists public.admin_hub (
  id text primary key check (char_length(id) between 4 and 64),
  name text not null default '',
  owner uuid references auth.users(id) on delete cascade,
  status jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.admin_hub enable row level security;
drop policy if exists ah_select on public.admin_hub;
create policy ah_select on public.admin_hub for select using (public.is_admin());
drop policy if exists ah_write on public.admin_hub;
create policy ah_write on public.admin_hub for insert with check (public.is_admin() and owner = auth.uid());
drop policy if exists ah_update on public.admin_hub;
create policy ah_update on public.admin_hub for update using (public.is_admin() and owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists ah_delete on public.admin_hub;
create policy ah_delete on public.admin_hub for delete using (owner = auth.uid() or public.get_my_admin_level() = 'high-admin');

-- =====================================================================================================
-- 4) Encrypted team notes (playbooks, how-tos, things to remember). Title and text are encrypted with the team
--    passphrase like admin chat; the database refuses anything readable.
-- =====================================================================================================
create table if not exists public.admin_team_notes (
  id uuid primary key default gen_random_uuid(),
  title text not null check (title like 'enc:v1:%' and char_length(title) <= 2000),
  body text not null check (body like 'enc:v1:%' and char_length(body) <= 300000),
  pinned boolean not null default false,
  version integer not null default 1,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.admin_team_notes enable row level security;
drop policy if exists atn_select on public.admin_team_notes;
create policy atn_select on public.admin_team_notes for select using (public.is_admin());
drop policy if exists atn_insert on public.admin_team_notes;
create policy atn_insert on public.admin_team_notes for insert with check (public.is_admin() and created_by = auth.uid());
drop policy if exists atn_update on public.admin_team_notes;
create policy atn_update on public.admin_team_notes for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists atn_delete on public.admin_team_notes;
create policy atn_delete on public.admin_team_notes for delete using (created_by = auth.uid() or public.get_my_admin_level() = 'high-admin');
-- Save only if nobody else saved since you opened it (no silent overwrites)
create or replace function public.admin_save_note(p_id uuid, p_title text, p_body text, p_pinned boolean, p_version int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not public.is_admin() then return jsonb_build_object('success', false, 'error', 'not_admin'); end if;
  update public.admin_team_notes set title = p_title, body = p_body, pinned = p_pinned, version = version + 1, updated_by = auth.uid(), updated_at = now()
    where id = p_id and version = p_version returning version into v;
  if v is null then return jsonb_build_object('success', false, 'error', 'conflict'); end if;
  return jsonb_build_object('success', true, 'version', v);
end $$;

-- =====================================================================================================
-- 5) Release dashboard + health numbers
-- =====================================================================================================
create or replace function public.admin_release_stats(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d int := least(greatest(coalesce(p_days, 30), 7), 120);
begin
  if not public.is_admin() then return jsonb_build_object('success', false, 'error', 'not_admin'); end if;
  return jsonb_build_object('success', true,
    'daily', (select coalesce(jsonb_agg(x order by x.day, x.version), '[]'::jsonb) from (
      select day, source, version, count(distinct user_id) as users from public.app_activity
      where day > current_date - d and source in ('desktop', 'phone') group by day, source, version) x),
    'current', (select coalesce(jsonb_agg(x order by x.users desc), '[]'::jsonb) from (
      select source, version, count(*) as users from (select distinct on (user_id, source) user_id, source, version from public.app_activity
        where day > current_date - 14 and source in ('desktop', 'phone') order by user_id, source, day desc) v group by source, version) x));
end $$;

create or replace function public.admin_health()
returns jsonb language plpgsql stable security definer set search_path = public, storage as $$
begin
  if not public.is_admin() then return jsonb_build_object('success', false, 'error', 'not_admin'); end if;
  return jsonb_build_object('success', true,
    'db_bytes', pg_database_size(current_database()),
    'tables', (select coalesce(jsonb_agg(jsonb_build_object('name', c.relname, 'bytes', pg_total_relation_size(c.oid), 'rows', c.reltuples::bigint) order by pg_total_relation_size(c.oid) desc), '[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' limit 15),
    'storage', (select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket_id, 'files', n, 'bytes', b) order by b desc), '[]'::jsonb)
      from (select bucket_id, count(*) n, coalesce(sum((metadata->>'size')::bigint), 0) b from storage.objects group by bucket_id) s),
    'relay_backlog', (select count(*) from public.relay_messages where handled_at is null and direction = 'to_desktop' and created_at < now() - interval '2 minutes'),
    'schedules_failed', (select count(*) from public.admin_schedules where status = 'failed' and ran_at > now() - interval '7 days'),
    'schedules_pending', (select count(*) from public.admin_schedules where status = 'pending'),
    'maintenance_on', (select count(*) from public.maintenance_config where enabled = 'true'::jsonb or enabled -> 'enabled' = 'true'::jsonb),
    'active_today', (select count(distinct user_id) from public.app_activity where day = current_date and source <> 'portal'),
    'checked_at', now());
end $$;

do $$ declare f text; begin
  foreach f in array array['admin_claim_schedules(text)', 'admin_finish_schedule(bigint, boolean, text)', 'admin_save_note(uuid, text, text, boolean, int)', 'admin_release_stats(int)', 'admin_health()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Audit alerts: admins can read the audit log directly (live updates only deliver rows you're allowed to read).
-- Admin actions write to it through security-definer functions, so turning on row-level security doesn't stop them.
do $$ begin
  if to_regclass('public.moderation_log') is not null then
    execute 'alter table public.moderation_log enable row level security';
    execute 'drop policy if exists ml_admin_select on public.moderation_log';
    execute 'create policy ml_admin_select on public.moderation_log for select using (public.is_admin())';
    execute 'grant select on public.moderation_log to authenticated';
  end if;
end $$;

-- Live updates (audit alerts watch moderation_log)
do $$ declare t text; begin
  foreach t in array array['broadcasts', 'admin_schedules', 'admin_hub', 'admin_team_notes', 'moderation_log'] loop
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
