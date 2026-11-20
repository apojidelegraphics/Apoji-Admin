-- Apoji Admin 2.6 — run once in the Supabase SQL editor (Nexus project, after nexus-v3.10.sql). Safe to run again.
--   Release planning (Releases → 🗓 Plan): planned versions with a target date, a status and a checklist of what's in them.
--   Everyone in Apoji Admin can see the plans; the Owner, high-admin editors and people with "Email the changelog"
--   (changelog) can change them. Every change is logged.

create table if not exists public.admin_release_plans (
  id bigint generated always as identity primary key,
  version text not null check (char_length(version) between 1 and 40),
  title text not null default '' check (char_length(title) <= 120),
  target_date date,
  status text not null default 'planned' check (status in ('idea', 'planned', 'building', 'testing', 'released', 'dropped')),
  apps text[] not null default '{}',                      -- nexus, admin, n28c, test_run, aargon3
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 200),   -- [{ text, kind: feature|fix|chore, done, by? }]
  notes text not null default '' check (char_length(notes) <= 4000),
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create unique index if not exists admin_release_plans_version on public.admin_release_plans (lower(version));
alter table public.admin_release_plans enable row level security;

create or replace function public.release_plans_can_write() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.admin_has_perm('changelog');
$$;
drop policy if exists release_plans_read on public.admin_release_plans;
create policy release_plans_read on public.admin_release_plans for select using (public.is_admin());
drop policy if exists release_plans_write on public.admin_release_plans;
create policy release_plans_write on public.admin_release_plans for insert with check (public.release_plans_can_write());
drop policy if exists release_plans_update on public.admin_release_plans;
create policy release_plans_update on public.admin_release_plans for update using (public.release_plans_can_write()) with check (public.release_plans_can_write());
drop policy if exists release_plans_delete on public.admin_release_plans;
create policy release_plans_delete on public.admin_release_plans for delete using (public.release_plans_can_write());

-- who changed what (moderation_log, shown in Audit)
create or replace function public.admin_release_plans_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then new.updated_at := now(); new.updated_by := auth.uid(); end if;
  insert into moderation_log (action, performed_by, details)
  values ('release_plan_' || lower(tg_op), auth.uid(), jsonb_build_object('version', coalesce(new.version, old.version), 'status', coalesce(new.status, old.status)));
  return coalesce(new, old);
end $$;
drop trigger if exists admin_release_plans_log on public.admin_release_plans;
create trigger admin_release_plans_log before insert or update or delete on public.admin_release_plans for each row execute function public.admin_release_plans_log();

do $$ begin
  begin alter publication supabase_realtime add table public.admin_release_plans; exception when duplicate_object then null; end;
end $$;
revoke all on function public.release_plans_can_write() from public, anon;
grant execute on function public.release_plans_can_write() to authenticated;
