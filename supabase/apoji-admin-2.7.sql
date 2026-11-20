-- Apoji Admin 2.7 — run once in the Supabase SQL editor (Nexus project). Safe to run again.
-- These early features are now for everyone: Citation helper, Daily challenge, Homework helper, Nexus Wrapped, Orb skins
-- and the phone companion (N28C). Apps pick it up within a minute.
-- (The Paragon & Axiom models picked on Apoji Admin → API usage are saved in admin_settings 'premium_models'; nothing to
-- create for that, the table and its high-admin rules already exist.)
update public.feature_flags set stage = 'all', updated_at = now()
 where key in ('citations', 'daily_challenge', 'homework_helper', 'nexus_wrapped', 'orb_skins', 'phone_companion');
insert into public.moderation_log (action, details)
select 'flags_to_everyone', jsonb_build_object('keys', array['citations', 'daily_challenge', 'homework_helper', 'nexus_wrapped', 'orb_skins', 'phone_companion']);
select key, stage from public.feature_flags where key in ('citations', 'daily_challenge', 'homework_helper', 'nexus_wrapped', 'orb_skins', 'phone_companion') order by key;
