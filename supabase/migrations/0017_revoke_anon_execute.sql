-- =============================================================================
-- 0017_revoke_anon_execute.sql — anon may call no function
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
--
-- WHY THIS EXISTS
--
-- A real Supabase project ships with default privileges that grant EXECUTE on
-- every new function in `public` to anon and authenticated DIRECTLY:
--
--   alter default privileges in schema public
--     grant execute on functions to anon, authenticated, service_role;
--
-- Twelve functions in 0005-0016 revoked EXECUTE only from PUBLIC. That removes
-- PostgreSQL's implicit grant and leaves Supabase's explicit one untouched, so
-- on Supabase each of them would have been callable by an anonymous visitor.
--
-- None of the twelve was exploitable. Each checks auth.uid() first and raises
-- AUTH_REQUIRED, so an anonymous call reached the body and was refused there.
-- But that is one layer where there should be two, and the local verification
-- cluster could not show it: its shim did not reproduce Supabase's default
-- privileges, so every "anon cannot execute" assertion was passing for the
-- wrong reason. The shim now does, and tests/db/rls-suite.mjs group 14 failed
-- against these twelve before this file and passes after it.
--
-- A separate file rather than edits to 0005-0016, deliberately. Nothing has
-- been applied to Supabase, so editing in place would have been possible - but
-- it would also silently invalidate any review of those files already done.
-- One file that says what changed and why is the version a reviewer can trust.
--
-- WHAT IT DOES NOT CHANGE
--
-- authenticated keeps every grant it had: these RPCs exist to be called by
-- signed-in users. No table, row, policy or data is touched. Re-running it is
-- harmless: revoking a privilege that is not held is a no-op.
-- =============================================================================

revoke execute on function public.accept_invitation(bytea) from anon;
revoke execute on function public.cancel_run(uuid) from anon;
revoke execute on function public.create_agent(uuid, text, text) from anon;
revoke execute on function public.create_organization(text, text) from anon;
revoke execute on function public.current_usage_period() from anon;
revoke execute on function public.expire_stale_invitations(uuid) from anon;
revoke execute on function public.install_template(uuid, uuid, text) from anon;
revoke execute on function public.org_usage_summary(uuid) from anon;
revoke execute on function public.publish_agent_version(uuid) from anon;
revoke execute on function public.set_agent_archived(uuid, boolean) from anon;
revoke execute on function public.start_run(uuid, jsonb, text) from anon;
revoke execute on function public.transfer_ownership(uuid, uuid) from anon;

-- A function added later without its own revoke would reopen this. Stop the
-- migration rather than let that ship: this block fails the transaction if any
-- non-trigger function in public is still executable by anon.
do $$
declare
  v_open text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_open
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if v_open is not null then
    raise exception 'anon can still execute: %', v_open;
  end if;
end;
$$;
