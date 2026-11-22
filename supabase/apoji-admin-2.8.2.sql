-- Apoji Admin 2.8.2 — run in the NEXUS Supabase project (yzbnxpkuhlxsuwzbjifx). Safe to run more than once.
-- (Also included at the end of apoji-admin-2.8.1.sql, so running either is fine.)

-- "Make it a bug report" from a failed test. The page used to insert the report itself with the TESTER as user_id,
-- which the reports' insert policy refuses (you can only file reports as yourself). This makes it on the server instead:
-- filed under the tester (so they see it and get replies), and only for the Apoji Team.
create or replace function public.admin_test_to_bug(p_item bigint, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it test_items; r test_results; nid bigint; plat text;
begin
  if not (public.admin_has_perm('testing') or public.is_admin()) then return jsonb_build_object('ok', false, 'error', 'Only the Apoji Team can do that.'); end if;
  select * into it from test_items where id = p_item;
  select * into r from test_results where item_id = p_item and user_id = p_user;
  if it.id is null or r.item_id is null then return jsonb_build_object('ok', false, 'error', 'That test result is gone.'); end if;
  plat := case r.platform when 'mac' then 'Mac' when 'windows' then 'Windows' when 'web' then 'Test Run' when 'phone' then 'N28C' else coalesce(nullif(r.platform, ''), 'all') end;
  insert into feedback_reports (user_id, kind, title, body, source, channel, info, status, priority, attachments)
  values (p_user, 'bug', left('Test failed: ' || it.title, 160),
          left(coalesce(nullif(r.note, ''), '(no note)') || E'\n\nRelease ' || it.release || ' · ' || plat || case when coalesce(it.steps, '') <> '' then E'\nSteps:\n' || it.steps else '' end, 8000),
          case when r.platform = 'web' then 'web' when r.platform = 'phone' then 'phone' else 'desktop' end, 'portal',
          'Added in Apoji Admin from Testing', 'new', 'normal', case when r.image is not null then jsonb_build_array(r.image) else '[]'::jsonb end)
  returning id into nid;
  return jsonb_build_object('ok', true, 'id', nid);
end $$;
revoke all on function public.admin_test_to_bug(bigint, uuid) from public, anon;
grant execute on function public.admin_test_to_bug(bigint, uuid) to authenticated;
