-- Apoji Admin 2.8 — run in the NEXUS Supabase project (yzbnxpkuhlxsuwzbjifx), after nexus-v3.12.sql.
-- Safe to run more than once.
--   1) Idle status: pick Idle yourself (with a "back at" time), your own idle timer, idle since
--   2) Release plans: Done (with when), shown at the bottom; the release calendar uses target_date / done_at
--   3) Daily digest: yesterday at a glance
--   4) Bug duplicates: similar reports, merge into one
--   5) On-call: who's responsible for outages; major incidents and urgent bugs page them
--   6) Admin activity heatmap
--   7) Staff (aARgon3): shift reminders, shift swaps, more on each person. Kept in THIS project because Apoji Admin's
--      sign-in lives here; people are matched to the aARgon3 staff list by email (their Nexus account email).

-- =====================================================================================================
-- 1) Idle status
-- =====================================================================================================
alter table public.admin_prefs drop constraint if exists admin_prefs_status_check;
alter table public.admin_prefs add constraint admin_prefs_status_check check (status in ('auto', 'idle', 'dnd', 'invisible'));
alter table public.admin_prefs add column if not exists idle_after int not null default 5;      -- minutes without input before you're idle; 0 = never
alter table public.admin_prefs drop constraint if exists admin_prefs_idle_after_check;
alter table public.admin_prefs add constraint admin_prefs_idle_after_check check (idle_after between 0 and 240);
alter table public.admin_prefs add column if not exists idle_since timestamptz;                  -- when you went idle (shown as "idle for 12 min")
alter table public.admin_prefs add column if not exists back_at timestamptz;                     -- picked Idle "until …" (then Automatic again)

create or replace function public.admin_list_admins()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('success', false, 'error', 'not_admin'); end if;
  return jsonb_build_object('success', true, 'me', auth.uid(), 'admins', (select coalesce(jsonb_agg(jsonb_build_object('id', r.user_id, 'level', r.level,
    'email', u.email, 'username', p.username, 'nickname', p.nickname, 'avatar_url', p.avatar_url, 'theme', p.theme,
    'status', case when ap.status = 'idle' and ap.back_at is not null and ap.back_at < now() then 'auto' else coalesce(ap.status, 'auto') end,
    'status_text', coalesce(ap.status_text, ''), 'idle', coalesce(ap.idle, false), 'last_seen', ap.last_seen,
    'idle_since', ap.idle_since, 'back_at', ap.back_at,
    'read_receipts', coalesce(ap.read_receipts, true)) order by u.email), '[]'::jsonb)
    from public.admin_roles r join auth.users u on u.id = r.user_id left join public.profiles p on p.id = r.user_id left join public.admin_prefs ap on ap.user_id = r.user_id));
end $$;

-- =====================================================================================================
-- 2) Release plans: Done
-- =====================================================================================================
alter table public.admin_release_plans drop constraint if exists admin_release_plans_status_check;
alter table public.admin_release_plans add constraint admin_release_plans_status_check check (status in ('idea', 'planned', 'building', 'testing', 'released', 'done', 'dropped'));
alter table public.admin_release_plans add column if not exists done_at timestamptz;
create or replace function public.admin_release_plans_done() returns trigger language plpgsql as $$
begin
  if new.status in ('released', 'done', 'dropped') then new.done_at := coalesce(new.done_at, now());
  else new.done_at := null; end if;
  return new;
end $$;
drop trigger if exists admin_release_plans_done on public.admin_release_plans;
create trigger admin_release_plans_done before insert or update of status on public.admin_release_plans for each row execute function public.admin_release_plans_done();
update public.admin_release_plans set done_at = coalesce(updated_at, now()) where status in ('released', 'dropped') and done_at is null;

-- =====================================================================================================
-- 5) On-call (before the digest, which shows who's on call)
-- =====================================================================================================
create table if not exists public.admin_oncall (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text not null default '' check (char_length(note) <= 200),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '31 days')
);
create index if not exists admin_oncall_when on public.admin_oncall (starts_at, ends_at);
alter table public.admin_oncall enable row level security;
drop policy if exists oc_select on public.admin_oncall;
create policy oc_select on public.admin_oncall for select using (public.is_admin());
drop policy if exists oc_write on public.admin_oncall;
create policy oc_write on public.admin_oncall for all using (public.get_my_admin_level() = 'high-admin' and coalesce(public.hi_can_write(), true))
  with check (public.get_my_admin_level() = 'high-admin' and coalesce(public.hi_can_write(), true));

create or replace function public.oncall_user(p_at timestamptz default now()) returns uuid
language sql stable security definer set search_path = public as $$
  select user_id from public.admin_oncall where starts_at <= p_at and ends_at > p_at order by starts_at desc limit 1
$$;
revoke all on function public.oncall_user(timestamptz) from public, anon;
grant execute on function public.oncall_user(timestamptz) to authenticated, service_role;

create or replace function public.admin_oncall_now() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cur record; nxt record;
begin
  if not public.is_admin() then return jsonb_build_object('success', false, 'error', 'not_admin'); end if;
  select o.*, coalesce(p.nickname, p.username, split_part(u.email, '@', 1)) as name into cur from public.admin_oncall o join auth.users u on u.id = o.user_id left join public.profiles p on p.id = o.user_id
    where o.starts_at <= now() and o.ends_at > now() order by o.starts_at desc limit 1;
  select o.*, coalesce(p.nickname, p.username, split_part(u.email, '@', 1)) as name into nxt from public.admin_oncall o join auth.users u on u.id = o.user_id left join public.profiles p on p.id = o.user_id
    where o.starts_at > now() order by o.starts_at limit 1;
  return jsonb_build_object('success', true,
    'now', case when cur.id is null then null else jsonb_build_object('id', cur.id, 'user_id', cur.user_id, 'name', cur.name, 'starts_at', cur.starts_at, 'ends_at', cur.ends_at, 'note', cur.note) end,
    'next', case when nxt.id is null then null else jsonb_build_object('id', nxt.id, 'user_id', nxt.user_id, 'name', nxt.name, 'starts_at', nxt.starts_at, 'ends_at', nxt.ends_at, 'note', nxt.note) end,
    'upcoming', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'user_id', o.user_id, 'starts_at', o.starts_at, 'ends_at', o.ends_at, 'note', o.note) order by o.starts_at), '[]'::jsonb)
      from public.admin_oncall o where o.ends_at > now() - interval '7 days' and o.starts_at < now() + interval '60 days'));
end $$;

-- a weekly rotation: p_users take turns, one week each, starting p_start at p_hour (UTC). Replaces what's already planned from then on.
create or replace function public.admin_oncall_rotate(p_users uuid[], p_start timestamptz, p_weeks int default 8) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i int; n int := coalesce(array_length(p_users, 1), 0);
begin
  if public.get_my_admin_level() is distinct from 'high-admin' or not coalesce(public.hi_can_write(), true) then return jsonb_build_object('success', false, 'error', 'High-admins plan the on-call rotation.'); end if;
  if n = 0 or p_weeks < 1 or p_weeks > 52 then return jsonb_build_object('success', false, 'error', 'Pick who takes turns and how many weeks.'); end if;
  if exists (select 1 from unnest(p_users) x where not exists (select 1 from public.admin_roles r where r.user_id = x)) then return jsonb_build_object('success', false, 'error', 'Only admins can be on call.'); end if;
  delete from public.admin_oncall where starts_at >= p_start;
  update public.admin_oncall set ends_at = p_start where starts_at < p_start and ends_at > p_start;
  for i in 0 .. p_weeks - 1 loop
    insert into public.admin_oncall (user_id, starts_at, ends_at) values (p_users[(i % n) + 1], p_start + make_interval(days => 7 * i), p_start + make_interval(days => 7 * (i + 1)));
  end loop;
  insert into public.moderation_log (action, performed_by, details) values ('oncall_rotation', auth.uid(), jsonb_build_object('people', n, 'weeks', p_weeks, 'from', p_start));
  return jsonb_build_object('success', true, 'shifts', p_weeks);
end $$;

-- paging: a major/critical incident, or a bug marked urgent, reaches whoever is on call (Nexus app + phone, as a notice)
create or replace function public.oncall_page(p_title text, p_body text, p_url text default '', p_by uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid := public.oncall_user();
begin
  if u is null then return null; end if;
  insert into public.broadcasts (title, body, url, audience, to_user, created_by, expires_at)
    values (left(p_title, 120), left(coalesce(p_body, ''), 1000), coalesce(p_url, ''), 'user', u, coalesce(p_by, auth.uid(), u), now() + interval '2 days');
  return u;
end $$;
revoke all on function public.oncall_page(text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.oncall_page(text, text, text, uuid) to service_role;

create or replace function public.oncall_incident_page() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.severity in ('major', 'critical') then perform public.oncall_page('You''re on call: ' || new.title, 'A ' || new.severity || ' incident was posted on the status page.', '', new.created_by); end if;
  return new;
end $$;
drop trigger if exists oncall_incident_page on public.status_incidents;
create trigger oncall_incident_page after insert on public.status_incidents for each row execute function public.oncall_incident_page();

create or replace function public.oncall_bug_page() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.priority = 'urgent' and new.kind in ('bug', 'featfix') and (tg_op = 'INSERT' or old.priority is distinct from 'urgent') and new.status not in ('fixed', 'wontfix', 'closed') then
    perform public.oncall_page('You''re on call: urgent bug #' || new.id, left(new.title, 300), '', coalesce(auth.uid(), new.user_id));
  end if;
  return new;
end $$;
drop trigger if exists oncall_bug_page on public.feedback_reports;
create trigger oncall_bug_page after insert or update of priority on public.feedback_reports for each row execute function public.oncall_bug_page();

-- =====================================================================================================
-- 3) Daily digest
-- =====================================================================================================
create or replace function public.admin_daily_digest(p_day date default ((now() at time zone 'utc')::date - 1)) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d0 timestamptz := p_day::timestamptz; d1 timestamptz := (p_day + 1)::timestamptz; r jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('success', false, 'error', 'not_admin'); end if;
  r := jsonb_build_object('success', true, 'day', p_day,
    'new_users', (select count(*) from auth.users where created_at >= d0 and created_at < d1),
    'active_users', (select count(distinct user_id) from public.user_presence where seen_at >= d0 and seen_at < d1),
    'by_surface', (select coalesce(jsonb_object_agg(surface, n), '{}'::jsonb) from (select surface, count(distinct user_id) n from public.user_presence where seen_at >= d0 and seen_at < d1 group by surface) s),
    'feedback', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) n from public.feedback_reports where created_at >= d0 and created_at < d1 group by kind) s),
    'bugs_open', (select count(*) from public.feedback_reports where kind in ('bug', 'featfix') and status in ('new', 'triaged', 'working') and duplicate_of is null),
    'urgent_open', (select count(*) from public.feedback_reports where priority = 'urgent' and status in ('new', 'triaged', 'working') and duplicate_of is null),
    'unanswered', (select count(*) from public.feedback_reports where status = 'new' and duplicate_of is null and created_at < now() - interval '1 day'),
    'replies', (select count(*) from public.feedback_replies where is_staff and created_at >= d0 and created_at < d1),
    'reports', (select count(*) from public.content_reports where created_at >= d0 and created_at < d1),
    'incidents', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'severity', severity, 'status', status) order by started_at desc), '[]'::jsonb)
      from public.status_incidents where (started_at >= d0 and started_at < d1) or resolved_at is null),
    'premium_tasks', (select count(*) from public.premium_turns where day = p_day),
    'try_answers', (select coalesce(sum(main), 0) from public.try_usage where day = p_day),
    'releases_soon', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'version', version, 'title', title, 'target_date', target_date, 'status', status) order by target_date), '[]'::jsonb)
      from public.admin_release_plans where target_date between p_day and p_day + 8 and status not in ('released', 'done', 'dropped')),
    'oncall', (select coalesce(p.nickname, p.username, split_part(u.email, '@', 1)) from auth.users u left join public.profiles p on p.id = u.id where u.id = public.oncall_user()),
    'admin_actions', (select count(*) from public.moderation_log where created_at >= d0 and created_at < d1));
  return r;
end $$;

-- =====================================================================================================
-- 4) Bug duplicates
-- =====================================================================================================
alter table public.feedback_reports add column if not exists duplicate_of bigint references public.feedback_reports(id) on delete set null;
create index if not exists feedback_reports_dupe on public.feedback_reports (duplicate_of) where duplicate_of is not null;

create or replace function public.feedback_words(p_title text, p_body text) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array(select distinct w from unnest(tsvector_to_array(to_tsvector('english', coalesce(p_title, '') || ' ' || coalesce(p_title, '') || ' ' || left(coalesce(p_body, ''), 600)))) w
    where char_length(w) > 2 and w !~ '^[0-9.]+$' and w not in ('nexus', 'app', 'work', 'get', 'use', 'click', 'button', 'tri', 'pleas', 'doesn', 'isn', 'can', 'cant', 'thing')), '{}')
$$;

create or replace function public.admin_feedback_similar(p_id bigint, p_limit int default 5) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me public.feedback_reports; a text[];
begin
  if not public.is_admin() then return jsonb_build_object('success', false, 'error', 'not_admin'); end if;
  select * into me from public.feedback_reports where id = p_id; if not found then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  a := public.feedback_words(me.title, me.body);
  if cardinality(a) = 0 then return jsonb_build_object('success', true, 'similar', '[]'::jsonb); end if;
  return jsonb_build_object('success', true, 'similar', (select coalesce(jsonb_agg(x order by (x->>'score')::numeric desc), '[]'::jsonb) from (
    select jsonb_build_object('id', f.id, 'title', f.title, 'kind', f.kind, 'status', f.status, 'created_at', f.created_at, 'duplicate_of', f.duplicate_of,
      'score', round((s.shared::numeric / greatest(1, least(cardinality(a), cardinality(s.b))))::numeric, 2), 'shared', s.shared) x
    from public.feedback_reports f
    cross join lateral (select public.feedback_words(f.title, f.body) b) w
    cross join lateral (select w.b, (select count(*) from unnest(a) x1 where x1 = any(w.b))::int shared) s
    where f.id <> me.id and f.created_at > now() - interval '240 days'
      and (f.kind = me.kind or (f.kind in ('bug', 'featfix') and me.kind in ('bug', 'featfix')))
      and s.shared >= 2 and s.shared::numeric / greatest(1, least(cardinality(a), cardinality(s.b))) >= 0.34
    order by s.shared::numeric / greatest(1, least(cardinality(a), cardinality(s.b))) desc, f.created_at desc limit greatest(1, least(p_limit, 20))) q));
end $$;

-- open bug reports that look like each other (for the Duplicates list)
create or replace function public.admin_feedback_dupes(p_days int default 60) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('success', false, 'error', 'not_admin'); end if;
  return jsonb_build_object('success', true, 'pairs', (select coalesce(jsonb_agg(jsonb_build_object('a', a_id, 'a_title', a_title, 'b', b_id, 'b_title', b_title, 'score', round(score, 2)) order by score desc), '[]'::jsonb) from (
    with f as (select id, title, kind, created_at, public.feedback_words(title, body) w from public.feedback_reports
      where kind in ('bug', 'featfix') and status in ('new', 'triaged', 'working') and duplicate_of is null and created_at > now() - make_interval(days => greatest(1, least(p_days, 365))) order by created_at desc limit 300)
    select x.id a_id, x.title a_title, y.id b_id, y.title b_title,
      (select count(*) from unnest(x.w) t where t = any(y.w))::numeric / greatest(1, least(cardinality(x.w), cardinality(y.w))) score
    from f x join f y on y.id > x.id
    where cardinality(x.w) > 0 and cardinality(y.w) > 0) p where score >= 0.5 limit 60));
end $$;

-- merge p_id into p_into: p_id becomes a duplicate (closed), optionally telling its reporter; known issues pick it up
create or replace function public.admin_feedback_merge(p_id bigint, p_into bigint, p_tell boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare root bigint := p_into; guard int := 0; me public.feedback_reports; nm text;
begin
  if not public.is_admin() then return jsonb_build_object('success', false, 'error', 'not_admin'); end if;
  -- follow p_into to the report it's a duplicate of (if any), so everything points at one report
  loop exit when guard > 10; perform 1 from public.feedback_reports where id = root and duplicate_of is not null; exit when not found; select duplicate_of into root from public.feedback_reports where id = root; guard := guard + 1; end loop;
  if root = p_id then return jsonb_build_object('success', false, 'error', 'A report can’t be a duplicate of itself.'); end if;
  select * into me from public.feedback_reports where id = p_id; if not found then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  update public.feedback_reports set duplicate_of = root, status = 'closed', updated_at = now() where id = p_id;
  update public.feedback_reports set duplicate_of = root, updated_at = now() where duplicate_of = p_id;   -- its own duplicates follow
  select coalesce(p.nickname, p.username, 'Apoji Team') into nm from public.profiles p where p.id = auth.uid();
  if p_tell and me.user_id is not null then
    insert into public.feedback_replies (report_id, author, author_name, is_staff, internal, body)
      values (p_id, auth.uid(), coalesce(nm, 'Apoji Team'), true, false, 'Thanks! Someone already reported this, so we''re tracking it in one place (report #' || root || '). You''ll hear from us there when it''s fixed.');
    update public.feedback_reports set reply_at = now() where id = p_id;
  end if;
  update public.known_issues set report_ids = array_append(report_ids, p_id), updated_at = now() where root = any(report_ids) and not (p_id = any(report_ids));
  insert into public.moderation_log (action, performed_by, details) values ('feedback_merged', auth.uid(), jsonb_build_object('report', p_id, 'into', root));
  return jsonb_build_object('success', true, 'into', root);
end $$;

-- =====================================================================================================
-- 6) Admin activity heatmap: what admins did, by hour (the page buckets it by your own weekday + hour)
-- =====================================================================================================
create or replace function public.admin_activity_heatmap(p_days int default 28) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 120)));
begin
  if not public.is_admin() then return jsonb_build_object('success', false, 'error', 'not_admin'); end if;
  return jsonb_build_object('success', true, 'since', since, 'hours', (select coalesce(jsonb_agg(jsonb_build_object('u', u, 'h', h, 'n', n, 'k', k)), '[]'::jsonb) from (
    select u, date_trunc('hour', at) h, count(*) n, jsonb_object_agg_strict_kinds(k) k from (
      select performed_by u, created_at at, 'actions' k from public.moderation_log where created_at >= since and performed_by in (select user_id from public.admin_roles)
      union all select sender, created_at, 'chat' from public.admin_messages where created_at >= since
      union all select author, created_at, 'replies' from public.feedback_replies where is_staff and created_at >= since
      union all select created_by, created_at, 'incidents' from public.status_incidents where created_at >= since and created_by is not null
    ) e where u is not null group by u, date_trunc('hour', at)) g));
end $$;
-- helper aggregate: counts per kind inside an hour ({"chat": 3, "actions": 1})
create or replace function public.kinds_acc(acc jsonb, k text) returns jsonb language sql immutable as $$ select coalesce(acc, '{}'::jsonb) || jsonb_build_object(k, coalesce((acc->>k)::int, 0) + 1) $$;
drop aggregate if exists public.jsonb_object_agg_strict_kinds(text);
create aggregate public.jsonb_object_agg_strict_kinds(text) (sfunc = public.kinds_acc, stype = jsonb, initcond = '{}');

-- =====================================================================================================
-- 7) Staff (aARgon3): shift reminders, swaps, more on each person
-- =====================================================================================================
-- the coming shifts, copied in by Apoji Admin from the aARgon3 schedule whenever a manager opens or changes it
create table if not exists public.staff_shift_feed (
  shift_id bigint primary key,                     -- the aARgon3 schedule id
  email text not null check (char_length(email) between 3 and 200),
  name text not null default '' check (char_length(name) <= 80),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  store text not null default '' check (char_length(store) <= 80),
  note text not null default '' check (char_length(note) <= 200),
  reminded_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists staff_shift_feed_when on public.staff_shift_feed (starts_at) where reminded_at is null;
alter table public.staff_shift_feed enable row level security;
drop policy if exists ssf_select on public.staff_shift_feed;
create policy ssf_select on public.staff_shift_feed for select using (public.is_admin());

create table if not exists public.staff_reminder_prefs (
  email text primary key check (char_length(email) between 3 and 200),
  enabled boolean not null default true,
  lead_minutes int not null default 60 check (lead_minutes between 5 and 1440),
  updated_at timestamptz not null default now()
);
alter table public.staff_reminder_prefs enable row level security;
drop policy if exists srp_select on public.staff_reminder_prefs;
create policy srp_select on public.staff_reminder_prefs for select using (public.is_admin());
drop policy if exists srp_own on public.staff_reminder_prefs;
create policy srp_own on public.staff_reminder_prefs for all using (lower(email) = lower(coalesce(auth.jwt()->>'email', '')) or public.get_my_admin_level() = 'high-admin')
  with check (lower(email) = lower(coalesce(auth.jwt()->>'email', '')) or public.get_my_admin_level() = 'high-admin');

create or replace function public.staff_publish_shifts(p_from timestamptz, p_to timestamptz, p_shifts jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb; n int := 0;
begin
  if not public.is_admin() then return jsonb_build_object('success', false, 'error', 'not_admin'); end if;
  if jsonb_typeof(p_shifts) <> 'array' or jsonb_array_length(p_shifts) > 1000 or p_to <= p_from or p_to - p_from > interval '62 days' then return jsonb_build_object('success', false, 'error', 'bad_window'); end if;
  delete from public.staff_shift_feed where starts_at >= p_from and starts_at < p_to and shift_id not in (select (x->>'id')::bigint from jsonb_array_elements(p_shifts) x where x->>'id' ~ '^\d+$');
  for s in select * from jsonb_array_elements(p_shifts) loop
    continue when coalesce(s->>'email', '') = '' or coalesce(s->>'id', '') !~ '^\d+$' or coalesce((s->>'time_off')::boolean, false);
    insert into public.staff_shift_feed (shift_id, email, name, starts_at, ends_at, store, note, published_by)
      values ((s->>'id')::bigint, lower(s->>'email'), left(coalesce(s->>'name', ''), 80), (s->>'starts_at')::timestamptz, (s->>'ends_at')::timestamptz, left(coalesce(s->>'store', ''), 80), left(coalesce(s->>'note', ''), 200), auth.uid())
    on conflict (shift_id) do update set email = excluded.email, name = excluded.name, store = excluded.store, note = excluded.note, ends_at = excluded.ends_at, published_by = excluded.published_by, updated_at = now(),
      starts_at = excluded.starts_at, reminded_at = case when staff_shift_feed.starts_at = excluded.starts_at and staff_shift_feed.email = excluded.email then staff_shift_feed.reminded_at else null end;
    n := n + 1;
  end loop;
  delete from public.staff_shift_feed where ends_at < now() - interval '2 days';
  return jsonb_build_object('success', true, 'shifts', n);
end $$;

-- every 5 minutes (pg_cron): remind people with a Nexus account before their shift (Nexus app + phone)
create or replace function public.staff_send_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; u uuid; n int := 0;
begin
  for r in select f.*, coalesce(p.lead_minutes, 60) lead from public.staff_shift_feed f left join public.staff_reminder_prefs p on lower(p.email) = lower(f.email)
      where f.reminded_at is null and f.starts_at > now() and coalesce(p.enabled, true) and f.starts_at - make_interval(mins => coalesce(p.lead_minutes, 60)) <= now() for update of f skip locked loop
    select id into u from auth.users where lower(email) = lower(r.email) limit 1;
    if u is not null then
      insert into public.broadcasts (title, body, audience, to_user, created_by, expires_at)
        values ('Your shift starts at ' || to_char(r.starts_at at time zone 'utc', 'HH24:MI') || ' UTC', 'Shift ' || to_char(r.starts_at at time zone 'utc', 'Dy Mon DD, HH24:MI') || '–' || to_char(r.ends_at at time zone 'utc', 'HH24:MI') || ' UTC' || case when r.store <> '' then ' at ' || r.store else '' end || case when r.note <> '' then '. ' || r.note else '' end,
          'user', u, coalesce(r.published_by, u), r.ends_at);
      n := n + 1;
    end if;
    update public.staff_shift_feed set reminded_at = now() where shift_id = r.shift_id;
  end loop;
  return n;
end $$;
revoke all on function public.staff_send_reminders() from public, anon, authenticated;
grant execute on function public.staff_send_reminders() to service_role;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'staff-shift-reminders';
    perform cron.schedule('staff-shift-reminders', '*/5 * * * *', 'select public.staff_send_reminders()');
  end if;
exception when others then raise notice 'pg_cron not set up: shift reminders need it (Database → Extensions → pg_cron), then run this file again.';
end $$;

-- shift swaps: ask (someone or anyone) → they accept → a manager approves (and Apoji Admin moves the shift in aARgon3)
create table if not exists public.staff_shift_swaps (
  id bigint generated always as identity primary key,
  shift_id bigint not null,
  shift jsonb not null default '{}'::jsonb check (pg_column_size(shift) < 4000),   -- { starts_at, ends_at, store, name } when asked
  from_email text not null check (char_length(from_email) between 3 and 200),
  to_email text check (char_length(to_email) between 3 and 200),                     -- null = anyone can take it
  taker_email text,
  status text not null default 'asked' check (status in ('asked', 'accepted', 'approved', 'declined', 'cancelled')),
  note text not null default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz
);
create unique index if not exists staff_shift_swaps_open on public.staff_shift_swaps (shift_id) where status in ('asked', 'accepted');
alter table public.staff_shift_swaps enable row level security;
drop policy if exists sss_select on public.staff_shift_swaps;
create policy sss_select on public.staff_shift_swaps for select using (public.is_admin());

create or replace function public.staff_swap(p_action text, p_id bigint default null, p_shift jsonb default null, p_to text default null, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := lower(coalesce(auth.jwt()->>'email', '')); s public.staff_shift_swaps; u uuid; nid bigint;
begin
  if not public.is_admin() or me = '' then return jsonb_build_object('success', false, 'error', 'not_admin'); end if;
  if p_action = 'ask' then
    if coalesce(p_shift->>'id', '') !~ '^\d+$' then return jsonb_build_object('success', false, 'error', 'Pick a shift.'); end if;
    if lower(coalesce(p_shift->>'email', me)) <> me and public.get_my_admin_level() <> 'high-admin' then return jsonb_build_object('success', false, 'error', 'You can only offer your own shifts.'); end if;
    if exists (select 1 from public.staff_shift_swaps where shift_id = (p_shift->>'id')::bigint and status in ('asked', 'accepted')) then return jsonb_build_object('success', false, 'error', 'Someone already asked to swap that shift.'); end if;
    insert into public.staff_shift_swaps (shift_id, shift, from_email, to_email, note)
      values ((p_shift->>'id')::bigint, jsonb_build_object('starts_at', p_shift->>'starts_at', 'ends_at', p_shift->>'ends_at', 'store', coalesce(p_shift->>'store', ''), 'name', coalesce(p_shift->>'name', '')),
        lower(coalesce(p_shift->>'email', me)), nullif(lower(coalesce(p_to, '')), ''), left(coalesce(p_note, ''), 300)) returning id into nid;
    if p_to is not null then select id into u from auth.users where lower(email) = lower(p_to);
      if u is not null then insert into public.broadcasts (title, body, audience, to_user, created_by) values ('Can you take a shift?', coalesce(p_shift->>'name', 'A coworker') || ' asked you to take their shift ' || to_char((p_shift->>'starts_at')::timestamptz at time zone 'utc', 'Dy Mon DD HH24:MI') || ' UTC. Answer in Apoji Admin → Shifts.', 'user', u, auth.uid()); end if; end if;
    return jsonb_build_object('success', true, 'id', nid);
  end if;
  select * into s from public.staff_shift_swaps where id = p_id; if not found then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  if p_action = 'cancel' then
    if s.from_email <> me and public.get_my_admin_level() <> 'high-admin' then return jsonb_build_object('success', false, 'error', 'Only who asked can cancel it.'); end if;
    update public.staff_shift_swaps set status = 'cancelled', decided_at = now(), decided_by = auth.uid() where id = p_id and status in ('asked', 'accepted');
  elsif p_action = 'accept' then
    if s.status <> 'asked' or (s.to_email is not null and s.to_email <> me) or s.from_email = me then return jsonb_build_object('success', false, 'error', 'This swap isn’t yours to take.'); end if;
    update public.staff_shift_swaps set status = 'accepted', taker_email = me where id = p_id;
  elsif p_action = 'refuse' then
    if s.status <> 'asked' or s.to_email is distinct from me then return jsonb_build_object('success', false, 'error', 'Nothing to answer.'); end if;
    update public.staff_shift_swaps set status = 'declined', decided_at = now(), decided_by = auth.uid() where id = p_id;
  elsif p_action in ('approve', 'decline') then   -- Apoji Admin only calls approve after the staff function moved the shift (that's where managers are checked)
    if s.status <> 'accepted' and p_action = 'approve' then return jsonb_build_object('success', false, 'error', 'Nobody has taken it yet.'); end if;
    update public.staff_shift_swaps set status = case when p_action = 'approve' then 'approved' else 'declined' end, decided_at = now(), decided_by = auth.uid() where id = p_id;
    for u in select id from auth.users where lower(email) in (s.from_email, coalesce(s.taker_email, '')) loop
      insert into public.broadcasts (title, body, audience, to_user, created_by) values (case when p_action = 'approve' then 'Shift swap approved' else 'Shift swap declined' end,
        'The shift ' || to_char((s.shift->>'starts_at')::timestamptz at time zone 'utc', 'Dy Mon DD HH24:MI') || ' UTC' || case when p_action = 'approve' then ' now belongs to ' || coalesce(s.taker_email, 'them') || '.' else ' stays as it was.' end, 'user', u, auth.uid());
    end loop;
  else return jsonb_build_object('success', false, 'error', 'unknown_action'); end if;
  return jsonb_build_object('success', true);
end $$;

-- more about each person (managers; everyone can see and edit their own)
create table if not exists public.staff_profiles_ext (
  email text primary key check (char_length(email) between 3 and 200),
  start_date date,
  birthday text not null default '' check (birthday = '' or birthday ~ '^\d{2}-\d{2}$'),   -- MM-DD
  pronouns text not null default '' check (char_length(pronouns) <= 30),
  skills text[] not null default '{}' check (cardinality(skills) <= 20),
  availability jsonb not null default '{}'::jsonb check (pg_column_size(availability) < 4000),   -- { mon: "9-17", … }
  emergency_name text not null default '' check (char_length(emergency_name) <= 80),
  emergency_phone text not null default '' check (char_length(emergency_phone) <= 40),
  goals text not null default '' check (char_length(goals) <= 600),
  manager_notes text not null default '' check (char_length(manager_notes) <= 2000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.staff_profiles_ext enable row level security;
drop policy if exists spe_rw on public.staff_profiles_ext;
create policy spe_rw on public.staff_profiles_ext for all
  using (public.is_admin() and (lower(email) = lower(coalesce(auth.jwt()->>'email', '')) or public.get_my_admin_level() = 'high-admin'))
  with check (public.is_admin() and (lower(email) = lower(coalesce(auth.jwt()->>'email', '')) or public.get_my_admin_level() = 'high-admin'));

-- realtime: the Shifts page and on-call card update live
do $$ begin
  begin alter publication supabase_realtime add table public.staff_shift_swaps; exception when others then null; end;
  begin alter publication supabase_realtime add table public.admin_oncall; exception when others then null; end;
end $$;
