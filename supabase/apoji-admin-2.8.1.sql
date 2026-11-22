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
