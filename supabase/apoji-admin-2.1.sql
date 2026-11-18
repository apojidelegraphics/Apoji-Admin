-- Apoji Admin 2.1: chat rooms per admin level. "Team Chat" (room 'all') stays for everyone; these three only let
-- in people of that level, plus the Owner, who is in all of them. Run after apoji-admin-1.7.sql.
create or replace function public.admin_can_room(r text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() and (
    r = 'all'
    or (r in ('lvl:high-admin', 'lvl:admin', 'lvl:mod') and (
          public.is_owner()
          or exists (select 1 from public.admin_roles ar where ar.user_id = auth.uid() and ar.level = substring(r from 5))))
    or (r ~ '^dm:[0-9a-f-]{36}:[0-9a-f-]{36}$' and position(auth.uid()::text in r) > 0)
    or (r ~ '^g:[0-9a-f-]{36}$' and exists (select 1 from public.admin_group_members m where m.group_id = substring(r from 3)::uuid and m.user_id = auth.uid()))
  );
$$;
