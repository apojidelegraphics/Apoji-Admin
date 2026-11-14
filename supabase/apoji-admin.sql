-- Apoji Admin: end-to-end encrypted admin chat + the Apoji Admin GitHub App.
-- Run once in Supabase → SQL Editor, AFTER nexus-v2.2.sql. Safe to run again.

-- =====================================================================================================
-- 1) Encrypted admin chat
--    The portal encrypts every message and file in the browser with a key made from the team passphrase.
--    This table only holds the salt and a check value (an encrypted "ok"), never the key or passphrase.
-- =====================================================================================================
create table if not exists public.admin_crypto (
  id smallint primary key default 1 check (id = 1),
  salt text not null check (char_length(salt) between 16 and 64),
  verifier text not null check (verifier like 'enc:v1:%' and char_length(verifier) < 400),
  iterations integer not null check (iterations >= 100000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.admin_crypto enable row level security;
drop policy if exists acr_select on public.admin_crypto;
create policy acr_select on public.admin_crypto for select using (public.is_admin());

-- First time only, by a high-admin. (To start over with a new passphrase, delete the row in the SQL editor; older
-- encrypted messages then can't be read anymore.)
create or replace function public.admin_crypto_setup(p_salt text, p_verifier text, p_iterations int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if public.get_my_admin_level() is distinct from 'high-admin' then return jsonb_build_object('success', false, 'error', 'not_high_admin'); end if;
  if exists (select 1 from public.admin_crypto) then return jsonb_build_object('success', false, 'error', 'already_set'); end if;
  insert into public.admin_crypto (salt, verifier, iterations, created_by) values (p_salt, p_verifier, p_iterations, auth.uid());
  insert into public.moderation_log (action, performed_by, details) values ('admin_chat_encryption_on', auth.uid(), '{}'::jsonb);
  return jsonb_build_object('success', true);
end $$;
revoke all on function public.admin_crypto_setup(text, text, int) from public, anon;
grant execute on function public.admin_crypto_setup(text, text, int) to authenticated;

-- The database refuses readable chat messages: new and edited messages must be encrypted (files too).
create or replace function public.admin_messages_sealed() returns trigger language plpgsql as $$
begin
  if new.deleted then return new; end if;
  if new.body <> '' and new.body not like 'enc:v1:%' then
    raise exception 'Admin chat messages must be end-to-end encrypted (update the admin portal).' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(new.attachments, '[]'::jsonb)) a where not (a ? 'e')) then
    raise exception 'Admin chat files must be end-to-end encrypted.' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists admin_messages_sealed on public.admin_messages;
create trigger admin_messages_sealed before insert or update of body, attachments on public.admin_messages for each row execute function public.admin_messages_sealed();

-- Edits keep the encryption
create or replace function public.admin_edit_message(p_message bigint, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_body not like 'enc:v1:%' or char_length(p_body) > 12000 then return jsonb_build_object('success', false, 'error', 'bad_body'); end if;
  update public.admin_messages set body = p_body, edited_at = now() where id = p_message and sender = auth.uid() and not deleted and public.admin_can_room(room);
  return jsonb_build_object('success', found);
end $$;
-- Encrypted text is longer than the plain text it holds
alter table public.admin_messages drop constraint if exists admin_messages_body_check;
alter table public.admin_messages add constraint admin_messages_body_check check (char_length(body) <= 12000 and (deleted or char_length(body) > 0 or jsonb_array_length(attachments) > 0));

-- High-admins: replace a message from before encryption with its encrypted version (the portal does this for you)
create or replace function public.admin_encrypt_message(p_message bigint, p_body text, p_attachments jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if public.get_my_admin_level() is distinct from 'high-admin' then return jsonb_build_object('success', false, 'error', 'not_high_admin'); end if;
  if (p_body <> '' and p_body not like 'enc:v1:%') or jsonb_typeof(p_attachments) <> 'array' then return jsonb_build_object('success', false, 'error', 'bad_body'); end if;
  update public.admin_messages set body = p_body, attachments = p_attachments where id = p_message and not deleted;
  return jsonb_build_object('success', found);
end $$;
revoke all on function public.admin_encrypt_message(bigint, text, jsonb) from public, anon;
grant execute on function public.admin_encrypt_message(bigint, text, jsonb) to authenticated;

-- Encrypted files are uploaded as plain bytes; lift the old per-file limit slightly for the encryption overhead
update storage.buckets set file_size_limit = 10551296 where id = 'admin-files';

-- =====================================================================================================
-- 2) The Apoji Admin GitHub App
--    The app's private key and webhook secret live in github_app, which nobody can read through the API
--    (no policies; only the apoji-github edge function, with the service role, uses it).
-- =====================================================================================================
create table if not exists public.github_app (
  id smallint primary key default 1 check (id = 1),
  app_id bigint not null,
  slug text not null,
  client_id text,
  client_secret text,
  private_key text not null,
  webhook_secret text not null,
  owner text,
  html_url text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.github_app enable row level security;
revoke all on public.github_app from anon, authenticated;

create table if not exists public.github_installations (
  id bigint primary key,
  account text not null default '',
  repos jsonb not null default '[]'::jsonb,
  suspended boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.github_installations enable row level security;
drop policy if exists gi_select on public.github_installations;
create policy gi_select on public.github_installations for select using (public.is_admin());

create table if not exists public.github_events (
  id bigint generated always as identity primary key,
  delivery text unique,
  event text not null,
  action text not null default '',
  repo text not null default '',
  title text not null default '',
  url text not null default '',
  actor text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists github_events_created on public.github_events (created_at desc);
alter table public.github_events enable row level security;
drop policy if exists ge_select on public.github_events;
create policy ge_select on public.github_events for select using (public.is_admin());

create table if not exists public.github_links (
  feedback_id bigint not null references public.feedback_reports(id) on delete cascade,
  repo text not null,
  issue_number integer not null,
  issue_url text not null,
  state text not null default 'open',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (repo, issue_number)
);
create index if not exists github_links_feedback on public.github_links (feedback_id);
alter table public.github_links enable row level security;
drop policy if exists gl_select on public.github_links;
create policy gl_select on public.github_links for select using (public.is_admin());

-- What the portal may know about the app (never the secrets)
create or replace function public.admin_github_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g public.github_app;
begin
  if not public.is_admin() then return jsonb_build_object('success', false, 'error', 'not_admin'); end if;
  select * into g from public.github_app where id = 1;
  return jsonb_build_object('success', true, 'configured', g.app_id is not null, 'app_id', g.app_id, 'slug', g.slug, 'owner', g.owner, 'html_url', g.html_url, 'created_at', g.created_at,
    'installations', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'account', account, 'repos', repos, 'suspended', suspended) order by account), '[]'::jsonb) from public.github_installations));
end $$;
revoke all on function public.admin_github_status() from public, anon;
grant execute on function public.admin_github_status() to authenticated;

do $$ declare t text; begin
  foreach t in array array['github_events', 'github_links', 'github_installations'] loop
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
