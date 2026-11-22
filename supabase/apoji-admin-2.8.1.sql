-- Apoji Admin 2.8.1 — run in the NEXUS Supabase project (yzbnxpkuhlxsuwzbjifx), after apoji-admin-2.8.sql.
-- Safe to run more than once.
--   Reply to a testing result: the Apoji Team answers a tester's pass / fail / skip ("can you try again on 3.13?").
--   The tester sees it under the item in Nexus (Settings → Beta → Needs testing) and gets a notification.

alter table public.test_results add column if not exists reply text;
alter table public.test_results drop constraint if exists test_results_reply_len;
alter table public.test_results add constraint test_results_reply_len check (reply is null or char_length(reply) <= 1000);
alter table public.test_results add column if not exists reply_by uuid references auth.users(id) on delete set null;
alter table public.test_results add column if not exists reply_at timestamptz;

-- Reply (or clear the reply with an empty body). Testers can't write these columns themselves: their own policy only
-- lets them change their row, and Nexus never sends reply fields, so a re-test keeps the reply until the team clears it.
create or replace function public.admin_test_reply(p_item bigint, p_user uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b text := nullif(btrim(coalesce(p_body, '')), ''); n int;
begin
  if not (public.admin_has_perm('testing') or public.is_admin()) then return jsonb_build_object('ok', false, 'error', 'Only the Apoji Team can reply to test results.'); end if;
  if b is not null and char_length(b) > 1000 then return jsonb_build_object('ok', false, 'error', 'Keep it under 1000 characters.'); end if;
  update test_results set reply = b, reply_by = case when b is null then null else auth.uid() end, reply_at = case when b is null then null else now() end
   where item_id = p_item and user_id = p_user;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'That result is gone (the tester may have removed it).'); end if;
  return jsonb_build_object('ok', true, 'reply_at', case when b is null then null else now() end);
end $$;
revoke all on function public.admin_test_reply(bigint, uuid, text) from public, anon;
grant execute on function public.admin_test_reply(bigint, uuid, text) to authenticated;

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
