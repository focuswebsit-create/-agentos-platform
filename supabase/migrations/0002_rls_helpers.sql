-- =============================================================================
-- 0002_rls_helpers.sql — membership resolution for RLS (approved decision 1)
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
--
-- Decision 1: membership is resolved by querying the database, not by reading a
-- claim out of the JWT. The consequence that matters commercially is that removing
-- a member revokes access immediately, instead of when their access token happens
-- to refresh. SECURITY.md classes a cross-tenant leak as a release blocker, and a
-- stale-token window is exactly such a leak.
--
-- Every function here follows four rules, each a security requirement:
--
--   1. `set search_path = ''` with fully-qualified names. Without it the caller
--      controls search_path and can shadow `public.memberships` with their own
--      table, which in a SECURITY DEFINER function means privilege escalation.
--
--   2. `security definer` is what makes a policy on `memberships` able to read
--      `memberships` without infinite recursion: the body runs as the table owner,
--      for whom RLS is not applied. This is why `force row level security` must
--      NEVER be set on public.memberships — doing so reintroduces the recursion.
--      0004 and tests/db assert that it is off.
--
--   3. `(select auth.uid())` rather than a bare `auth.uid()`. The subselect is
--      cached as an InitPlan and evaluated once per statement instead of once per
--      row; this is what keeps the subquery approach cheap.
--
--   4. `stable`, so results can be reused within a statement.
--
-- EXECUTE is revoked from public/anon and granted only to `authenticated`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- is_org_member — the base tenancy predicate
-- -----------------------------------------------------------------------------

create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = p_org_id
      and m.user_id = (select auth.uid())
  );
$$;

comment on function public.is_org_member(uuid) is
  'True when the current user holds any membership in the organisation.';

-- -----------------------------------------------------------------------------
-- has_org_role — role-gated tenancy predicate
-- -----------------------------------------------------------------------------

create or replace function public.has_org_role(p_org_id uuid, p_roles public.org_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = p_org_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

comment on function public.has_org_role(uuid, public.org_role[]) is
  'True when the current user holds one of the given roles in the organisation.';

-- -----------------------------------------------------------------------------
-- shares_org_with — lets a member see co-members'' display names (not emails)
-- -----------------------------------------------------------------------------

create or replace function public.shares_org_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships me
    join public.memberships other on other.org_id = me.org_id
    where me.user_id = (select auth.uid())
      and other.user_id = p_user_id
  );
$$;

-- -----------------------------------------------------------------------------
-- current_aal — Authenticator Assurance Level of the live session
--
-- 'aal2' means a second factor was verified for this session. Used by the
-- platform-admin guard and available to RESTRICTIVE policies in later phases.
-- Returns 'aal1' when the claim is absent so the function never yields NULL into
-- a boolean expression (NULL would make a policy neither true nor false).
-- -----------------------------------------------------------------------------

create or replace function public.current_aal()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1');
$$;

-- -----------------------------------------------------------------------------
-- org_seats_taken — the seat accounting rule, in one place
--
-- Seats taken = active memberships + live pending invitations.
--
-- Counting pending invitations is what closes the main quota bypass: without it,
-- an organisation on a 5-seat plan could issue 100 invitations and have every one
-- of them accepted. Expired invitations do not hold a seat.
--
-- Callers MUST hold a row lock on the organisation first (see 0004); this function
-- only counts and makes no atomicity guarantee on its own.
-- -----------------------------------------------------------------------------

create or replace function public.org_seats_taken(p_org_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.memberships m where m.org_id = p_org_id)
    +
    (select count(*)
       from public.invitations i
      where i.org_id = p_org_id
        and i.status = 'pending'
        and i.expires_at > now())
$$;

-- -----------------------------------------------------------------------------
-- log_audit — the only way a client-reachable path can write an audit row
--
-- SECURITY DEFINER so that `authenticated` needs no INSERT privilege on
-- audit_events. Combined with the append-only trigger in 0004, audit history
-- cannot be forged, amended or erased from a customer session.
-- -----------------------------------------------------------------------------

create or replace function public.log_audit(
  p_org_id      uuid,
  p_actor_type  public.actor_type,
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.audit_events (
    org_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata_redacted
  )
  values (
    p_org_id, (select auth.uid()), p_actor_type, p_action, p_entity_type, p_entity_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- org_seat_usage — the ONLY seat figure a client may read
--
-- org_seats_taken() is internal (see the grants below): it takes an arbitrary
-- org UUID and would otherwise let any authenticated user probe the existence
-- and headcount of organisations they have nothing to do with.
--
-- This wrapper exposes the same number only to someone who administers that
-- organisation, which is what the team screen needs.
-- -----------------------------------------------------------------------------

create or replace function public.org_seat_usage(p_org_id uuid)
returns table (seats_taken integer, seat_limit integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_org_role(p_org_id, array['owner', 'admin']::public.org_role[]) then
    raise exception 'ORG_ACCESS_DENIED' using errcode = 'insufficient_privilege';
  end if;

  return query
    select public.org_seats_taken(p_org_id),
           o.seat_limit
    from public.organizations o
    where o.id = p_org_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Execute privileges
--
-- EXECUTE on a function defaults to PUBLIC, so every function is revoked first
-- and then granted back deliberately.
--
-- THREE functions MUST stay executable by `authenticated`, and not by oversight:
-- is_org_member, has_org_role and shares_org_with are called from inside RLS
-- policy expressions. Policies are evaluated with the privileges of the user
-- running the query, so revoking EXECUTE would make every policy fail with
-- "permission denied for function" and take the whole tenancy layer down.
-- Each of them only ever reports on the caller's own membership, so exposing
-- them discloses nothing about anyone else.
--
-- TWO functions are internal only:
--
--   log_audit        SECURITY DEFINER taking org_id, actor_type and action as
--                    free parameters. Granted to `authenticated` it would let
--                    any signed-in user forge an audit record in ANY
--                    organisation, and impersonate actor_type 'system' or
--                    'platform_admin'. That destroys the evidentiary value of
--                    the whole audit trail (SECURITY.md 6, "immutable logs").
--                    It is reachable only from the SECURITY DEFINER RPCs in
--                    0005, which run as the function owner and therefore need
--                    no grant.
--
--   org_seats_taken  Takes an arbitrary org UUID and returns a headcount, so it
--                    is an existence-and-size oracle for other tenants. The
--                    seat gate in 0004 calls it from SECURITY DEFINER trigger
--                    functions, which run as the owner, so revoking EXECUTE
--                    does not weaken the quota in any way. Clients use the
--                    membership-checked org_seat_usage() wrapper above.
-- -----------------------------------------------------------------------------

revoke execute on function public.is_org_member(uuid) from public, anon, authenticated;
revoke execute on function public.has_org_role(uuid, public.org_role[]) from public, anon, authenticated;
revoke execute on function public.shares_org_with(uuid) from public, anon, authenticated;
revoke execute on function public.current_aal() from public, anon, authenticated;
revoke execute on function public.org_seats_taken(uuid) from public, anon, authenticated;
revoke execute on function public.org_seat_usage(uuid) from public, anon, authenticated;
revoke execute on function public.log_audit(
  uuid, public.actor_type, text, text, uuid, jsonb
) from public, anon, authenticated;

-- Required by RLS policy expressions.
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.org_role[]) to authenticated;
grant execute on function public.shares_org_with(uuid) to authenticated;
-- Reads only the caller's own session claim.
grant execute on function public.current_aal() to authenticated;
-- Membership-checked seat figure.
grant execute on function public.org_seat_usage(uuid) to authenticated;

-- public.log_audit and public.org_seats_taken are intentionally NOT granted to
-- anon or authenticated. Do not add such a grant without re-reading the note
-- above: it would let any signed-in user forge audit records.

-- service_role is the trusted internal identity, reachable only with the secret
-- key from src/modules/platform-admin/. SUPER_ADMIN.md requires every privileged
-- admin action to be audited, so that module must be able to write audit rows.
-- This is the designed trust boundary, not a hole in it: the forgery risk came
-- from exposing log_audit to ordinary sessions, which remains closed.
grant execute on function public.log_audit(
  uuid, public.actor_type, text, text, uuid, jsonb
) to service_role;
