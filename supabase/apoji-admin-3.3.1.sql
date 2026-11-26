-- Apoji Admin 3.3.1 (run in the Nexus project's SQL editor, after apoji-admin-3.3.sql). Safe to run more than once.
-- A release plan can say which platforms it's for (Mac, Windows, N28C, Test Run). Empty = everywhere.
-- Each item in a plan can pick its own platforms too; those live inside the items list, so they need nothing here.
alter table public.admin_release_plans add column if not exists platforms text[] not null default '{}';
alter table public.admin_release_plans drop constraint if exists admin_release_plans_platforms_check;
alter table public.admin_release_plans add constraint admin_release_plans_platforms_check check (platforms <@ array['mac', 'windows', 'phone', 'test_run']::text[]);
