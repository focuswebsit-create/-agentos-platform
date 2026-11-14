-- =============================================================================
-- 00_preflight.sql — READ-ONLY. Run this FIRST. It changes nothing.
--
-- Answers three questions before anything is applied:
--   1. Is this project empty? (Applying onto an existing schema is refused.)
--   2. Does it look like Supabase? (auth.users and the three roles exist.)
--   3. Who am I connected as? (Must be able to create in public.)
--
-- It does NOT tell you the project's name: SQL cannot see that. Check it in
-- the dashboard under Project Settings → General before you go further, and
-- confirm the Reference ID is the AgentOS-Development project.
-- =============================================================================

select 'current_user'              as item, current_user::text as result
union all
select 'database',                           current_database()::text
union all
select 'auth.users exists',
  (to_regclass('auth.users') is not null)::text
union all
select 'role anon exists',
  exists(select 1 from pg_roles where rolname = 'anon')::text
union all
select 'role authenticated exists',
  exists(select 1 from pg_roles where rolname = 'authenticated')::text
union all
select 'role service_role exists',
  exists(select 1 from pg_roles where rolname = 'service_role')::text
union all
select 'can create in public',
  has_schema_privilege('public', 'CREATE')::text
union all
-- The decisive one. Must be 0 for the bundle to run.
select 'AgentOS objects already in public',
  (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('organizations','memberships','agents','runs','global_templates'))
union all
select 'AgentOS types already in public',
  (select count(*)::text from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname in ('org_role','agent_status','run_status'));

-- Expected on a fresh AgentOS-Development project:
--   auth.users exists ................... true
--   role anon/authenticated/service_role  true
--   can create in public ................ true
--   AgentOS objects already in public ... 0
--   AgentOS types already in public ..... 0
-- If the last two are not 0, STOP: something is already installed.
