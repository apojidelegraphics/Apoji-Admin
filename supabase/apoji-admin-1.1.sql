-- Apoji Admin 1.1: team tasks, pinned chat messages, saved replies. Also removes the GitHub App tables (the GitHub
-- section is gone). Run once in Supabase → SQL Editor, after apoji-admin.sql. Safe to run again.

-- 1) GitHub App removed: drop its tables (this also deletes the app's stored private key, if you'd created it)
drop function if exists public.admin_github_status();
drop table if exists public.github_links;
drop table if exists public.github_events;
drop table if exists public.github_installations;
drop table if exists public.github_app;

-- 2) Team tasks: a shared to-do board for admins (To do · Doing · Done), with an owner, due date and priority,
--    optionally linked to a feedback report, a user or a content report.
create table if not exists public.admin_tasks (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 4000),
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assignee uuid references auth.users(id) on delete set null,
  due date,
  link_kind text not null default '' check (link_kind in ('', 'feedback', 'user', 'report')),
  link_id text not null default '' check (char_length(link_id) <= 80),
  link_label text not null default '' check (char_length(link_label) <= 200),
  position double precision not null default extract(epoch from now()),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists admin_tasks_status on public.admin_tasks (status, position);
alter table public.admin_tasks enable row level security;
drop policy if exists at_select on public.admin_tasks;
create policy at_select on public.admin_tasks for select using (public.is_admin());
drop policy if exists at_insert on public.admin_tasks;
create policy at_insert on public.admin_tasks for insert with check (public.is_admin() and created_by = auth.uid());
drop policy if exists at_update on public.admin_tasks;
create policy at_update on public.admin_tasks for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists at_delete on public.admin_tasks;
create policy at_delete on public.admin_tasks for delete using (created_by = auth.uid() or public.get_my_admin_level() = 'high-admin');

create or replace function public.admin_tasks_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then new.done_at := now(); end if;
  if new.status <> 'done' then new.done_at := null; end if;
  return new;
end $$;
drop trigger if exists admin_tasks_touch on public.admin_tasks;
create trigger admin_tasks_touch before insert or update on public.admin_tasks for each row execute function public.admin_tasks_touch();

-- 3) Pinned chat messages (only the pin is stored; the message itself stays encrypted)
alter table public.admin_messages add column if not exists pinned_at timestamptz;
alter table public.admin_messages add column if not exists pinned_by uuid references auth.users(id) on delete set null;
create or replace function public.admin_pin_message(p_message bigint, p_pin boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.admin_messages set pinned_at = case when p_pin then now() end, pinned_by = case when p_pin then auth.uid() end
  where id = p_message and not deleted and public.admin_can_room(room);
  return jsonb_build_object('success', found);
end $$;
revoke all on function public.admin_pin_message(bigint, boolean) from public, anon;
grant execute on function public.admin_pin_message(bigint, boolean) to authenticated;

-- 4) Saved replies (your own snippets for feedback replies and chat)
alter table public.admin_prefs add column if not exists saved_replies jsonb not null default '[]'::jsonb;
alter table public.admin_prefs drop constraint if exists admin_prefs_saved_replies_check;
alter table public.admin_prefs add constraint admin_prefs_saved_replies_check check (jsonb_typeof(saved_replies) = 'array' and jsonb_array_length(saved_replies) <= 50 and pg_column_size(saved_replies) < 60000);

-- Live updates for the task board
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'admin_tasks') then
    alter publication supabase_realtime add table public.admin_tasks;
  end if;
end $$;
