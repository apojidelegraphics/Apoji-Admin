-- aARgon3 — Mexel for the owner and the staff the owner picks (for Apoji Admin 2.7.1). Run once in the aARgon3 project's
-- SQL editor (yuergfrpfhtcxjkcgjrx). Safe to run again.
-- Before: every Nexus admin was added to the staff list automatically the first time they opened Mexel or the terminal.
-- Now: only the owner (OWNER_EMAILS in the staff function) gets in automatically; everyone else has to be on the staff
-- list (Apoji Admin → STAFF → Employees → Add someone) and switched on.
create or replace function public.a3_staff_sync(p_user uuid, p_email text, p_name text, p_level text, p_owner boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.staff;
begin
  select * into s from staff where user_id = p_user limit 1;
  if s.id is null then select * into s from staff where lower(email) = lower(p_email) limit 1; end if;
  if s.id is null then
    if not coalesce(p_owner, false) then return null; end if;          -- not on the list: no access (admins included)
    insert into staff (user_id, email, name, role, active) values (p_user, lower(p_email), p_name, 'owner', true) returning * into s;
  else
    update staff set user_id = p_user, email = coalesce(nullif(lower(p_email), ''), email), name = coalesce(nullif(p_name, ''), name), last_seen = now(),
      role = case when p_owner then 'owner' else role end, active = case when p_owner then true else active end
     where id = s.id returning * into s;
  end if;
  return public.a3_staff_json(s, false);
end $$;
revoke all on function public.a3_staff_sync(uuid, text, text, text, boolean) from public, anon, authenticated;

-- Who's on the list now (people added automatically before this change are still here; switch off anyone who shouldn't
-- have Mexel in Apoji Admin → STAFF → Employees → their card → "Can use aARgon3 and Mexel").
select email, role, active, last_seen from public.staff order by role, email;

-- Optional: switch everyone except the owner off in one go, then switch on the people you pick in Employees.
-- update public.staff set active = false where role <> 'owner';
