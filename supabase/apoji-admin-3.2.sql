-- Apoji Admin 3.2 (run in the Nexus project's SQL editor, after nexus-v4.0.6.sql). Safe to run more than once.
--  1) Profiles review: everyone's profile looks in one place (custom banner pictures, things made in the shop, bios and
--     statuses, reported profiles), with resets that tell the person why.
--  2) One Apoji account: an account's whole picture for admins, and a fuller public look for aARgon3 and other apps.
--  3) Apoji-wide search for admins (known issues, incidents, release plans, test items, Spaces, profiles).

-- 1) ------------------------------------------------------------------------------------------------------
create or replace function public.admin_profiles(p_filter text default 'all', p_q text default '', p_limit int default 60)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := '%' || replace(replace(left(trim(coalesce(p_q, '')), 60), '%', ''), '_', '') || '%'; n int := greatest(1, least(coalesce(p_limit, 60), 200));
begin
  if not public.is_admin() then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x order by x.at desc) from (
    select p.id, p.username, coalesce(p.nickname, '') as nickname, p.avatar_url, p.id = any(public.app_owner_ids()) as owner,
      to_jsonb(s) - 'user_id' - 'stats' as style, s.updated_at as at,
      (select count(*) from cosmetic_uploads u where u.user_id = p.id and u.status = 'pending') as pending,
      (select count(*) from content_reports r where r.kind = 'profile' and r.target_id = p.id::text and r.status = 'open') as reports
    from profile_style s join profiles p on p.id = s.user_id
    where (coalesce(p_q, '') = '' or p.username ilike q or coalesce(p.nickname, '') ilike q or s.bio ilike q or s.status_text ilike q or s.display_name ilike q)
      and case coalesce(p_filter, 'all')
        when 'banner' then s.banner_url is not null
        when 'mine' then s.custom <> '{}'::jsonb or s.frame_img is not null or s.overlay_img is not null or coalesce(s.frame, '') like '%:mine' or coalesce(s.pframe, '') like '%:mine' or coalesce(s.effect, '') like '%:mine'
        when 'text' then coalesce(s.bio, '') <> '' or coalesce(s.status_text, '') <> '' or coalesce(s.display_name, '') <> '' or coalesce(s.pronouns, '') <> ''
        when 'reported' then exists (select 1 from content_reports r where r.kind = 'profile' and r.target_id = p.id::text and r.status = 'open')
        else true end
    order by s.updated_at desc limit n) x), '[]'::jsonb);
end $$;

-- take part of someone's profile back to plain. parts: banner, design, bio, status, display_name, pronouns, picture, uploads, looks
create or replace function public.admin_profile_reset(p_user uuid, p_parts text[], p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare parts text[] := coalesce(p_parts, '{}'); what text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
  if p_user = any(public.app_owner_ids()) and not public.is_owner() then return jsonb_build_object('ok', false, 'error', 'Only the Owner can change the Owner''s profile.'); end if;
  if cardinality(parts) = 0 then return jsonb_build_object('ok', false, 'error', 'Pick what to reset.'); end if;
  update profile_style set
    banner = case when 'banner' = any(parts) and banner = 'banner:custom' then null else banner end,
    banner_url = case when 'banner' = any(parts) then null else banner_url end,
    custom = case when 'design' = any(parts) then '{}'::jsonb else custom end,
    frame = case when ('design' = any(parts) and frame like '%:mine') or 'looks' = any(parts) then null else frame end,
    pframe = case when ('design' = any(parts) and pframe like '%:mine') or 'looks' = any(parts) then null else pframe end,
    effect = case when ('design' = any(parts) and effect like '%:mine') or 'looks' = any(parts) then null else effect end,
    ptheme = case when 'looks' = any(parts) then null else ptheme end,
    font = case when 'looks' = any(parts) then null else font end,
    color = case when 'looks' = any(parts) then null else color end,
    frame_img = case when 'uploads' = any(parts) or 'design' = any(parts) then null else frame_img end,
    overlay_img = case when 'uploads' = any(parts) or 'design' = any(parts) then null else overlay_img end,
    bio = case when 'bio' = any(parts) then '' else bio end,
    status_text = case when 'status' = any(parts) then '' else status_text end,
    display_name = case when 'display_name' = any(parts) then '' else display_name end,
    pronouns = case when 'pronouns' = any(parts) then '' else pronouns end,
    updated_at = now()
  where user_id = p_user;
  if 'uploads' = any(parts) or 'design' = any(parts) then update cosmetic_uploads set status = 'rejected', note = left(coalesce(p_note, ''), 300), reviewed_at = now(), reviewed_by = auth.uid() where user_id = p_user and status in ('pending', 'approved'); end if;
  if 'picture' = any(parts) then update profiles set avatar_url = null where id = p_user; end if;
  update content_reports set status = 'actioned', action_note = left('Profile reset: ' || array_to_string(parts, ', ') || coalesce(' · ' || nullif(p_note, ''), ''), 500), handled_by = auth.uid(), handled_at = now()
    where kind = 'profile' and target_id = p_user::text and status = 'open';
  what := array_to_string(array(select case x when 'banner' then 'banner picture' when 'design' then 'things you made in the shop' when 'display_name' then 'display name' when 'picture' then 'profile picture' when 'uploads' then 'uploaded pictures' when 'looks' then 'frames, themes and name style' else x end from unnest(parts) x), ', ');
  begin
    insert into broadcasts (title, body, audience, to_user, created_by)
    values ('Part of your profile was reset', left(format('The Apoji Team reset your %s%s. You can set it up again in Settings → Profile.', what, case when coalesce(p_note, '') <> '' then ' (' || left(p_note, 200) || ')' else '' end), 400), 'user', p_user, auth.uid());
  exception when others then null; end;
  insert into moderation_log (action, target_user_id, details, performed_by) values ('profile_reset', p_user, jsonb_build_object('parts', to_jsonb(parts), 'note', p_note), auth.uid());
  return jsonb_build_object('ok', true);
end $$;

-- 2) ------------------------------------------------------------------------------------------------------
-- everything about one account's Apoji profile, for the user drawer
create or replace function public.admin_profile_detail(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then jsonb_build_object('ok', false) else jsonb_build_object('ok', true,
    'card', (select jsonb_build_object('id', p.id, 'username', p.username, 'nickname', coalesce(p.nickname, ''), 'avatar_url', p.avatar_url, 'owner', p.id = any(public.app_owner_ids()),
       'style', coalesce((select to_jsonb(s) - 'user_id' from profile_style s where s.user_id = p.id), '{}'::jsonb),
       'online', (select max(seen_at) from user_presence u where u.user_id = p.id) > now() - interval '5 minutes', 'self', true) from profiles p where p.id = p_user),
    'apps', coalesce((select jsonb_agg(jsonb_build_object('surface', surface, 'version', version, 'first_seen', first_seen, 'seen_at', seen_at) order by seen_at desc) from user_presence where user_id = p_user), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(jsonb_build_object('app', used_by, 'at', used_at) order by used_at desc) from apoji_link_codes where user_id = p_user and used_at is not null), '[]'::jsonb),
    'uploads', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'url', url, 'status', status, 'note', note, 'created_at', created_at) order by created_at desc) from cosmetic_uploads where user_id = p_user and status <> 'removed'), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'reason', reason, 'details', details, 'status', status, 'at', created_at) order by created_at desc) from content_reports where kind = 'profile' and target_id = p_user::text), '[]'::jsonb),
    'friends', (select count(*) from friendships f where p_user in (f.user_a, f.user_b) and f.status = 'accepted'),
    'cirkts', (select jsonb_build_object('earned', w.earned, 'spent', w.spent, 'owned', (select count(*) from cirkts_owned o where o.user_id = p_user)) from cirkts_wallet w where w.user_id = p_user)
  ) end;
$$;

-- the public look of an account for aARgon3 and other Apoji apps: now the whole card (still nothing private)
create or replace function public.apoji_public_profile(p_username text default null, p_code text default null, p_app text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if p_code is not null then
    select user_id into uid from apoji_link_codes where code = upper(p_code) and used_at is null and created_at > now() - interval '15 minutes';
    if uid is not null then update apoji_link_codes set used_at = now(), used_by = left(coalesce(p_app, ''), 40) where code = upper(p_code); end if;
  elsif p_username is not null then select id into uid from profiles where lower(username) = lower(trim(leading '@' from p_username));
  end if;
  if uid is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'profile', (select jsonb_build_object('username', p.username, 'nickname', coalesce(p.nickname, ''), 'avatar_url', p.avatar_url,
    'owner', p.id = any(public.app_owner_ids()), 'frame', s.frame, 'pframe', s.pframe, 'font', s.font, 'color', s.color, 'name_a', s.name_a, 'name_b', s.name_b,
    'ptheme', s.ptheme, 'theme_a', s.theme_a, 'theme_b', s.theme_b, 'banner', s.banner, 'banner_url', s.banner_url, 'effect', s.effect,
    'custom', coalesce(s.custom, '{}'::jsonb), 'frame_img', s.frame_img, 'overlay_img', s.overlay_img,
    'display_name', coalesce(s.display_name, ''), 'pronouns', coalesce(s.pronouns, ''), 'status_text', coalesce(s.status_text, ''), 'bio', coalesce(s.bio, ''))
    from profiles p left join profile_style s on s.user_id = p.id where p.id = uid));
end $$;
grant execute on function public.apoji_public_profile(text, text, text) to anon, authenticated;

-- 3) ------------------------------------------------------------------------------------------------------
create or replace function public.admin_search(p_q text, p_limit int default 8)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := left(trim(coalesce(p_q, '')), 80); pat text; n int := greatest(1, least(coalesce(p_limit, 8), 30));
begin
  if not public.is_admin() or length(q) < 2 then return '[]'::jsonb; end if;
  pat := '%' || replace(replace(q, '%', ''), '_', '') || '%';
  return coalesce((select jsonb_agg(r) from (
    (select jsonb_build_object('kind', 'known_issue', 'id', id, 'title', title, 'sub', status || coalesce(' · fixed in ' || nullif(fixed_in, ''), '')) r from known_issues where title ilike pat or details ilike pat or workaround ilike pat order by updated_at desc limit n)
    union all
    (select jsonb_build_object('kind', 'incident', 'id', id, 'title', title, 'sub', status || ' · ' || to_char(started_at, 'Mon DD')) from status_incidents where title ilike pat order by started_at desc limit n)
    union all
    (select jsonb_build_object('kind', 'release', 'id', id, 'title', version || coalesce(' · ' || nullif(title, ''), ''), 'sub', status || ' · ' || array_to_string(apps, ', ')) from admin_release_plans
       where version ilike pat or title ilike pat or notes ilike pat or items::text ilike pat order by updated_at desc limit n)
    union all
    (select jsonb_build_object('kind', 'test', 'id', id, 'title', title, 'sub', release || ' · ' || platform, 'release', release) from test_items where not archived and (title ilike pat or steps ilike pat) order by id desc limit n)
    union all
    (select jsonb_build_object('kind', 'space', 'id', s.id, 'title', s.name, 'sub', (select count(*) from shared_space_members m where m.space_id = s.id) || ' members · code ' || s.code) from shared_spaces s where s.name ilike pat or s.code ilike pat limit n)
    union all
    (select jsonb_build_object('kind', 'profile', 'id', p.id, 'title', coalesce(nullif(s.display_name, ''), p.username, 'Someone'), 'sub', '@' || coalesce(p.username, '') || coalesce(' · ' || nullif(left(s.status_text, 40), ''), ''))
       from profile_style s join profiles p on p.id = s.user_id where s.bio ilike pat or s.status_text ilike pat or s.display_name ilike pat limit n)
    union all
    (select jsonb_build_object('kind', 'announcement', 'id', id, 'title', coalesce(nullif(title, ''), left(message, 60)), 'sub', case when active then 'showing' else 'off' end) from announcements where coalesce(title, '') ilike pat or message ilike pat order by id desc limit 5)
  ) x), '[]'::jsonb);
exception when undefined_table or undefined_column then return '[]'::jsonb;
end $$;

do $$ declare f text; begin
  foreach f in array array['admin_profiles(text, text, int)', 'admin_profile_reset(uuid, text[], text)', 'admin_profile_detail(uuid)', 'admin_search(text, int)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
