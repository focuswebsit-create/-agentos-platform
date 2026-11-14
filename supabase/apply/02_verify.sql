-- =============================================================================
-- 02_verify.sql — READ-ONLY. Run this AFTER the bundle. It changes nothing.
--
-- One row per thing that must be true. Every `ok` should read true.
-- =============================================================================

with expected_tables(name) as (
  values ('organizations'),('memberships'),('profiles'),('invitations'),
         ('platform_admins'),('audit_events'),('agents'),('agent_versions'),
         ('global_templates'),('global_template_versions'),('template_installations'),
         ('runs'),('run_steps'),('usage_events'),('usage_reservations'),('usage_periods')
),
expected_functions(name) as (
  values ('create_organization'),('accept_invitation'),('transfer_ownership'),
         ('create_agent'),('publish_agent_version'),('set_agent_archived'),
         ('install_template'),('start_run'),('cancel_run'),('settle_run'),
         ('expire_stale_reservations'),('org_usage_summary'),('set_org_suspended'),
         ('is_org_member'),('has_org_role'),('log_audit'),('log_platform_audit')
)
select 'table ' || e.name as item,
       (to_regclass('public.' || e.name) is not null) as ok
from expected_tables e
union all
select 'RLS enabled on ' || e.name,
       coalesce((select c.relrowsecurity from pg_class c
                  join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relname = e.name), false)
from expected_tables e
union all
select 'function ' || e.name,
       exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = e.name)
from expected_functions e
union all
select 'trigger on_auth_user_created on auth.users',
       exists(select 1 from pg_trigger where tgname = 'on_auth_user_created')
union all
-- 0017's whole point. Must be true.
select 'anon can execute NO public function',
       not exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.prorettype <> 'trigger'::regtype
                     and has_function_privilege('anon', p.oid, 'EXECUTE'))
union all
select 'authenticated CAN execute create_organization',
       has_function_privilege('authenticated',
         'public.create_organization(text, text)', 'EXECUTE')
union all
select 'platform_admins has zero policies (unreachable by clients)',
       not exists(select 1 from pg_policies where schemaname='public' and tablename='platform_admins')
order by ok, item;

-- Any `false` sorts to the top. An all-true result means the schema is
-- installed as reviewed.
