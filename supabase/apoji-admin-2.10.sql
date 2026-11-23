-- Apoji Admin 2.10 (run in the Nexus Supabase project, after apoji-admin-2.8.2.sql). Safe to run more than once.
--  1) Schedules can do more: send a broadcast, post or close a status-page notice, take Axiom offline or bring it back.
--  2) Schedules can repeat: every day, every weekday, every week or every month (optionally until a date).
--  3) Announcements get a title, a style, a button link, which apps show them, and pinning. Start and end times
--     are done with Schedules (the announcement is switched on and off), so older apps keep working.

-- 1) -----------------------------------------------------------------------------------------------
alter table public.admin_schedules drop constraint if exists admin_schedules_kind_check;
alter table public.admin_schedules add constraint admin_schedules_kind_check check (kind in (
  'announcement_on', 'announcement_off', 'maintenance_on', 'maintenance_off', 'flag_stage',
  'broadcast_send', 'incident_post', 'incident_resolve', 'axiom_offline', 'axiom_online'));

-- 2) a finished repeating schedule books its next run --------------------------------------------------
create or replace function public.admin_next_run(p_at timestamptz, p_repeat text)
returns timestamptz language sql immutable as $$
  select case p_repeat
    when 'daily' then p_at + interval '1 day'
    when 'weekly' then p_at + interval '7 days'
    when 'monthly' then p_at + interval '1 month'
    when 'weekdays' then p_at + (case extract(isodow from p_at) when 5 then 3 when 6 then 2 else 1 end) * interval '1 day'
    else null end;
$$;
create or replace function public.admin_finish_schedule(p_id bigint, p_ok boolean, p_result text default '')
returns void language plpgsql security definer set search_path = public as $$
declare j admin_schedules; nxt timestamptz; stop timestamptz;
begin
  if not public.is_admin() then return; end if;
  update admin_schedules set status = case when p_ok then 'done' else 'failed' end, result = left(coalesce(p_result, ''), 500)
    where id = p_id and status = 'running' returning * into j;
  if j.id is null then return; end if;
  -- repeats book the next one even if this run failed (a missed day shouldn't end the series)
  if coalesce(j.payload ->> 'repeat', '') in ('daily', 'weekdays', 'weekly', 'monthly') then
    nxt := public.admin_next_run(j.run_at, j.payload ->> 'repeat');
    while nxt <= now() loop nxt := public.admin_next_run(nxt, j.payload ->> 'repeat'); end loop;   -- skip runs we slept through
    stop := nullif(j.payload ->> 'until', '')::timestamptz;
    if stop is null or nxt <= stop then
      insert into admin_schedules (kind, target, label, payload, run_at, created_by)
      values (j.kind, j.target, j.label, j.payload, nxt, j.created_by);
    end if;
  end if;
end $$;
grant execute on function public.admin_finish_schedule(bigint, boolean, text) to authenticated;
-- stop a whole repeating series (every pending run with the same series id)
create or replace function public.admin_stop_series(p_series text)
returns int language sql security definer set search_path = public as $$
  with x as (update admin_schedules set status = 'cancelled' where status = 'pending' and payload ->> 'series' = p_series and public.is_admin() returning 1)
  select count(*)::int from x;
$$;
grant execute on function public.admin_stop_series(text) to authenticated;

-- 3) richer announcements ------------------------------------------------------------------------------
alter table public.announcements add column if not exists title text not null default '' check (char_length(title) <= 80);
alter table public.announcements add column if not exists style text not null default 'info' check (style in ('info', 'success', 'warning', 'critical', 'celebrate'));
alter table public.announcements add column if not exists link_url text not null default '' check (link_url = '' or link_url ~ '^https://');
alter table public.announcements add column if not exists link_label text not null default '' check (char_length(link_label) <= 30);
alter table public.announcements add column if not exists apps text[] not null default array['desktop', 'phone', 'web'];
alter table public.announcements add column if not exists pinned boolean not null default false;
alter table public.announcements add column if not exists dismissible boolean not null default true;
alter table public.announcements add column if not exists updated_at timestamptz not null default now();
