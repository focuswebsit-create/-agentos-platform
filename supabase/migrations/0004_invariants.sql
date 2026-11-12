-- =============================================================================
-- 0004_invariants.sql — database-enforced invariants
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
--
-- Everything here guards against a state that must never exist, including under
-- concurrency. Application guards produce friendlier messages, but these are the
-- checks that actually hold: they apply to every path, including a direct
-- PostgREST call and a service-role script.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Invariant 1: every organisation keeps at least one owner
--
-- Why a plain `SELECT count(*)` in a trigger is NOT sufficient:
--
--   Under READ COMMITTED (PostgreSQL's default, and Supabase's), two concurrent
--   transactions each removing a *different* owner both read count = 2, both pass
--   the check, and both commit. The organisation ends up with zero owners.
--
-- The fix is the `FOR UPDATE` on the organisation row below. It is a serialisation
-- point: every membership change for a given organisation queues behind it, so the
-- second transaction re-reads the count only after the first has committed.
--
-- `DEFERRABLE INITIALLY DEFERRED` is what makes ownership transfer possible. The
-- check runs once at COMMIT rather than after each statement, so promoting the new
-- owner and demoting the previous one inside one transaction is legal, while
-- leaving the organisation ownerless is not.
-- -----------------------------------------------------------------------------

create or replace function public.assert_org_has_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id      uuid;
  v_owner_count integer;
begin
  -- NEW is unassigned on DELETE and OLD on INSERT, so branch explicitly.
  if tg_op = 'DELETE' then
    v_org_id := old.org_id;
  else
    v_org_id := new.org_id;
  end if;

  -- Serialisation point. Also returns no row when the organisation itself was
  -- deleted and these memberships went with it by cascade — nothing to assert.
  perform 1 from public.organizations where id = v_org_id for update;
  if not found then
    return null;
  end if;

  select count(*) into v_owner_count
  from public.memberships
  where org_id = v_org_id
    and role = 'owner';

  if v_owner_count = 0 then
    raise exception 'ORG_REQUIRES_OWNER'
      using errcode = 'check_violation',
            detail = 'An organisation must always retain at least one owner.';
  end if;

  return null;
end;
$$;

create constraint trigger memberships_owner_guard
  after insert or update or delete on public.memberships
  deferrable initially deferred
  for each row execute function public.assert_org_has_owner();

-- -----------------------------------------------------------------------------
-- Invariant 2: the seat quota cannot be exceeded or raced
--
-- Applied to BOTH seat-consuming inserts, so the quota holds no matter which path
-- is used: issuing an invitation (which reserves a seat) and creating a membership.
--
-- It uses the same organisation-row lock as invariant 1, which means seat writes
-- and ownership writes serialise against each other on the same object.
--
-- Ordering requirement for the accept flow (see 0005): the invitation must be
-- marked `accepted` BEFORE the membership row is inserted. Otherwise the pending
-- invitation and the new membership would both count, and the final seat would be
-- rejected. `org_seats_taken` is STABLE and therefore sees the transaction's own
-- earlier writes.
-- -----------------------------------------------------------------------------

create or replace function public.enforce_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_taken integer;
begin
  select o.seat_limit into v_limit
  from public.organizations o
  where o.id = new.org_id
  for update;

  if not found then
    raise exception 'ORG_NOT_FOUND'
      using errcode = 'foreign_key_violation';
  end if;

  v_taken := public.org_seats_taken(new.org_id);

  -- BEFORE INSERT, so the incoming row is not yet counted.
  if v_taken >= v_limit then
    raise exception 'SEAT_LIMIT_REACHED'
      using errcode = 'check_violation',
            detail = format('seats_taken=%s seat_limit=%s', v_taken, v_limit);
  end if;

  return new;
end;
$$;

create trigger memberships_seat_gate
  before insert on public.memberships
  for each row execute function public.enforce_seat_limit();

create trigger invitations_seat_gate
  before insert on public.invitations
  for each row execute function public.enforce_seat_limit();

-- -----------------------------------------------------------------------------
-- Invariant 3: audit_events is append only
--
-- 0003 grants no UPDATE/DELETE privilege and creates no such policy, which already
-- stops customer sessions. This trigger is the layer that also stops the table
-- owner and any service-role script, satisfying SECURITY.md 6 "immutable logs".
--
-- Not SECURITY DEFINER: it needs no elevated rights to refuse.
-- -----------------------------------------------------------------------------

create or replace function public.audit_events_block_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'AUDIT_EVENTS_APPEND_ONLY'
    using errcode = 'insufficient_privilege',
          detail = 'audit_events is append-only: UPDATE and DELETE are never permitted.';
end;
$$;

create trigger audit_events_no_update
  before update on public.audit_events
  for each row execute function public.audit_events_block_mutation();

create trigger audit_events_no_delete
  before delete on public.audit_events
  for each row execute function public.audit_events_block_mutation();

-- -----------------------------------------------------------------------------
-- profiles: maintain updated_at server-side
-- -----------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Provision a profile for every new auth user
--
-- Runs as the definer because `authenticated` has no INSERT privilege on profiles.
-- The display name falls back to the local part of the address so a member list is
-- never blank; it is truncated to the column limit and never left empty.
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'user'
      ),
      80
    )
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Guard the assumption that decision 1 depends on
--
-- The RLS policies on public.memberships read public.memberships through a
-- SECURITY DEFINER helper. That is only non-recursive because RLS does not apply
-- to the table owner. Turning on FORCE ROW LEVEL SECURITY would reintroduce
-- infinite recursion and take the tenancy layer down. Fail the migration loudly
-- rather than discover it at runtime. tests/db asserts the same thing.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- Trigger functions are internal
--
-- PostgreSQL does not check EXECUTE privilege when firing a trigger, so these
-- need no grant to work. EXECUTE still defaults to PUBLIC, though, and leaving
-- that in place means a client can call them directly. A direct call fails
-- ("can only be called as a trigger"), so the risk is low - but a SECURITY
-- DEFINER function should never be callable by anyone who has no business
-- calling it, and these take row locks on organizations.
-- -----------------------------------------------------------------------------

revoke execute on function public.assert_org_has_owner() from public, anon, authenticated;
revoke execute on function public.enforce_seat_limit() from public, anon, authenticated;
revoke execute on function public.audit_events_block_mutation() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'memberships'
      and c.relforcerowsecurity
  ) then
    raise exception
      'FORCE ROW LEVEL SECURITY is enabled on public.memberships, which makes the '
      'RLS helper functions recurse. Disable it: '
      'ALTER TABLE public.memberships NO FORCE ROW LEVEL SECURITY;';
  end if;
end;
$$;
