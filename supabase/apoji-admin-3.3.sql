-- Apoji Admin 3.3 (run in the Nexus project's SQL editor, after apoji-admin-3.2.sql). Safe to run more than once.
--  1) Feature flags can be limited to some platforms (Mac, Windows, N28C, Test Run). Empty = everywhere.
--  2) Release notes published from a release plan in one click. The Nexus What's new page and the apps read them.
--  3) More for the Health page: where people are using Apoji right now, and what's waiting on the team.

-- 1) ------------------------------------------------------------------------------------------------------
alter table public.feature_flags add column if not exists platforms text[] not null default '{}';
alter table public.feature_flags drop constraint if exists feature_flags_platforms_check;
alter table public.feature_flags add constraint feature_flags_platforms_check check (platforms <@ array['mac', 'windows', 'phone', 'test_run']::text[]);

-- 2) ------------------------------------------------------------------------------------------------------
create table if not exists public.release_notes (
  app text not null default 'nexus' check (app in ('nexus', 'admin')),
  version text not null check (char_length(version) between 1 and 40),
  title text not null default '' check (char_length(title) <= 120),
  date date not null default current_date,
  highlights text[] not null default '{}' check (cardinality(highlights) <= 40),
  published boolean not null default true,
  plan_id bigint references public.admin_release_plans(id) on delete set null,
  created_by uuid references auth.users(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (app, version)
);
alter table public.release_notes enable row level security;
drop policy if exists release_notes_read on public.release_notes;
create policy release_notes_read on public.release_notes for select using (published or public.is_admin());
drop policy if exists release_notes_write on public.release_notes;
create policy release_notes_write on public.release_notes for all using (public.is_admin() and (public.is_owner() or public.admin_has_perm('changelog')))
  with check (public.is_admin() and (public.is_owner() or public.admin_has_perm('changelog')));
grant select on public.release_notes to anon, authenticated;

-- 3) ------------------------------------------------------------------------------------------------------
create or replace function public.admin_health_more()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then '{}'::jsonb else jsonb_build_object(
    'surfaces', coalesce((select jsonb_object_agg(surface, n) from (select surface, count(distinct user_id) n from user_presence where seen_at > now() - interval '15 minutes' group by surface) x), '{}'::jsonb),
    'surfaces_day', coalesce((select jsonb_object_agg(surface, n) from (select surface, count(distinct user_id) n from user_presence where seen_at > now() - interval '24 hours' group by surface) x), '{}'::jsonb),
    'incidents_open', (select count(*) from status_incidents where resolved_at is null),
    'urgent_bugs', (select count(*) from feedback_reports where status in ('new', 'triaged', 'working') and duplicate_of is null and coalesce(priority, '') = 'urgent'),
    'bugs_open', (select count(*) from feedback_reports where status in ('new', 'triaged', 'working') and duplicate_of is null),
    'uploads_waiting', (select count(*) from cosmetic_uploads where status = 'pending'),
    'reports_open', (select count(*) from content_reports where status = 'open'),
    'access_waiting', (select count(*) from access_requests where status = 'pending'),
    'beta_waiting', (select count(*) from beta_requests where status = 'pending'),
    'known_open', (select count(*) from known_issues where status not in ('fixed', 'wont_fix'))
  ) end;
$$;
revoke all on function public.admin_health_more() from public, anon;
grant execute on function public.admin_health_more() to authenticated;
