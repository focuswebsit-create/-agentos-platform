-- =============================================================================
-- 0018_backfill_profiles.sql — a profile for every user who signed up early
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
--
-- WHY THIS EXISTS
--
-- `handle_new_user()` (0004) creates a public.profiles row whenever a row is
-- inserted into auth.users. It is a trigger, so it only sees users created
-- AFTER it exists.
--
-- On the AgentOS-Development project, people signed up through the preview
-- deployment before any migration had been applied. Their auth.users rows
-- exist; the trigger did not, so they have no profile. Reproduced locally: such
-- a user creates an organisation, holds one real membership as its owner, and
-- the team screen - which joins memberships to profiles - shows ZERO members.
-- The dashboard's member count reads the same list.
--
-- This inserts the missing rows, using exactly the naming rule the trigger uses
-- (display_name from sign-up metadata, else the email's local part, else
-- "user", capped at 80 characters), so a backfilled profile is
-- indistinguishable from one the trigger would have made.
--
-- DATA IT CHANGES
--
-- Inserts only. It adds a profiles row for each auth.users row that has none,
-- and touches no existing row in any table. `on conflict do nothing` makes it
-- safe to run more than once. On a project with no users it does nothing.
--
-- It reads `raw_user_meta_data` and `email` from auth.users, which only this
-- migration's owner can see; neither value is copied anywhere except the
-- display name that the trigger would have written anyway.
-- =============================================================================

insert into public.profiles (user_id, display_name)
select
  u.id,
  left(
    coalesce(
      nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
      'user'
    ),
    80
  )
from auth.users u
where not exists (select 1 from public.profiles p where p.user_id = u.id)
on conflict (user_id) do nothing;
