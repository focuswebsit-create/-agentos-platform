-- =============================================================================
-- 0005_rpc.sql — transactional operations that RLS alone cannot express
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
--
-- Each function here exists because the operation must be atomic across several
-- rows, or because it must act on behalf of a user who is not yet a member of the
-- organisation (and therefore matches no tenancy policy).
--
-- All are SECURITY DEFINER with `set search_path = ''`, and every one re-derives
-- the caller from `auth.uid()`. None of them accepts a caller identity, an org
-- membership or a role as an argument: API_CONTRACT.md requires that `org_id` is
-- "resolved from authenticated selected workspace and authorizations, never
-- blindly trusted from request body".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- create_organization
--
-- Atomic because an organisation without an owner membership would be invisible
-- to its own creator: the SELECT policy requires membership. Two statements with
-- a failure between them would leak an unreachable row.
-- -----------------------------------------------------------------------------

create or replace function public.create_organization(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from auth.users u
    where u.id = v_uid and u.email_confirmed_at is not null
  ) then
    raise exception 'EMAIL_NOT_VERIFIED' using errcode = 'insufficient_privilege';
  end if;

  begin
    insert into public.organizations (name, slug)
    values (btrim(p_name), lower(btrim(p_slug)))
    returning id into v_org_id;
  exception
    when unique_violation then
      raise exception 'ORG_SLUG_TAKEN' using errcode = 'unique_violation';
  end;

  -- The creator is the first owner. The seat gate allows this: zero seats are
  -- taken at this point.
  insert into public.memberships (org_id, user_id, role)
  values (v_org_id, v_uid, 'owner');

  perform public.log_audit(
    v_org_id, 'user', 'organization.created', 'organization', v_org_id,
    jsonb_build_object('slug', lower(btrim(p_slug)))
  );

  return v_org_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- expire_stale_invitations
--
-- Moves pending invitations past their expiry to `expired`.
--
-- Needed because `invitations_one_pending_per_email_idx` is a partial unique index
-- on `status = 'pending'`, and an index predicate cannot reference now() (it must
-- be immutable). Without this sweep, an expired invitation would permanently block
-- re-inviting the same address.
--
-- Definer, so it re-checks authority itself rather than relying on RLS.
-- -----------------------------------------------------------------------------

create or replace function public.expire_stale_invitations(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'insufficient_privilege';
  end if;

  if not public.has_org_role(p_org_id, array['owner', 'admin']::public.org_role[]) then
    raise exception 'ORG_ACCESS_DENIED' using errcode = 'insufficient_privilege';
  end if;

  update public.invitations
     set status = 'expired'
   where org_id = p_org_id
     and status = 'pending'
     and expires_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- accept_invitation
--
-- Takes the SHA-256 digest, never the token. The raw token is hashed in Node, so
-- it never crosses the database boundary and cannot surface in
-- pg_stat_statements, query logs or error detail (owner condition 5 and 7).
--
-- Must be a definer function for two independent reasons: the accepting user is
-- not yet a member, so no tenancy policy matches them; and the seat check, the
-- membership insert and the single-use transition have to be one atomic unit.
--
-- Every rejection raises the SAME error. A message distinguishing "no such token"
-- from "expired" from "wrong address" would turn this into an oracle for
-- enumerating tokens and discovering who was invited where.
-- -----------------------------------------------------------------------------

create or replace function public.accept_invitation(p_token_hash bytea)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_email    text;
  v_verified boolean;
  v_inv      public.invitations;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'insufficient_privilege';
  end if;

  select lower(u.email), (u.email_confirmed_at is not null)
    into v_email, v_verified
  from auth.users u
  where u.id = v_uid;

  -- Owner condition: only a signed-in user who has verified the address the
  -- invitation was sent to may accept it.
  if not coalesce(v_verified, false) then
    raise exception 'EMAIL_NOT_VERIFIED' using errcode = 'insufficient_privilege';
  end if;

  select * into v_inv
  from public.invitations
  where token_hash = p_token_hash
  for update;

  if not found
     or v_inv.status <> 'pending'
     or v_inv.expires_at <= now()
     or v_inv.email <> v_email
  then
    raise exception 'INVITATION_INVALID' using errcode = 'insufficient_privilege';
  end if;

  -- Single use. The row lock above already serialises concurrent attempts; the
  -- status predicate makes the transition itself conditional, so a replay after
  -- commit also fails.
  update public.invitations
     set status      = 'accepted',
         accepted_by = v_uid,
         accepted_at = now()
   where id = v_inv.id
     and status = 'pending';

  if not found then
    raise exception 'INVITATION_INVALID' using errcode = 'insufficient_privilege';
  end if;

  -- Ordering matters: the invitation is no longer `pending` above, so it no longer
  -- holds a seat when the seat gate evaluates the insert below.
  --
  -- An existing member consumes the invitation without a second membership row.
  -- Skipping the INSERT entirely also avoids running the seat gate for a seat that
  -- is already counted, which at the cap would reject a legitimate acceptance.
  if not exists (
    select 1 from public.memberships
    where org_id = v_inv.org_id and user_id = v_uid
  ) then
    insert into public.memberships (org_id, user_id, role)
    values (v_inv.org_id, v_uid, v_inv.role);
  end if;

  perform public.log_audit(
    v_inv.org_id, 'user', 'invitation.accepted', 'invitation', v_inv.id,
    jsonb_build_object('role', v_inv.role)
  );

  return v_inv.org_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- transfer_ownership
--
-- One transaction, so the organisation is never ownerless and never has two
-- owners by accident. The deferred owner guard from 0004 validates the end state
-- at COMMIT, which is exactly why that trigger is DEFERRABLE INITIALLY DEFERRED.
--
-- Only an owner may do this (approved role matrix), and it is the one operation
-- that changes the caller's own role.
-- -----------------------------------------------------------------------------

create or replace function public.transfer_ownership(p_org_id uuid, p_to_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'insufficient_privilege';
  end if;

  if not public.has_org_role(p_org_id, array['owner']::public.org_role[]) then
    raise exception 'ORG_ACCESS_DENIED' using errcode = 'insufficient_privilege';
  end if;

  if p_to_user_id = v_uid then
    raise exception 'ORG_ACCESS_DENIED' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.memberships
    where org_id = p_org_id and user_id = p_to_user_id
  ) then
    raise exception 'ORG_ACCESS_DENIED' using errcode = 'insufficient_privilege';
  end if;

  update public.memberships
     set role = 'owner'
   where org_id = p_org_id and user_id = p_to_user_id;

  update public.memberships
     set role = 'admin'
   where org_id = p_org_id and user_id = v_uid;

  perform public.log_audit(
    p_org_id, 'user', 'organization.ownership_transferred', 'membership', null,
    jsonb_build_object('to_user_id', p_to_user_id)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Execute privileges
-- -----------------------------------------------------------------------------

revoke execute on function public.create_organization(text, text) from public;
revoke execute on function public.expire_stale_invitations(uuid) from public;
revoke execute on function public.accept_invitation(bytea) from public;
revoke execute on function public.transfer_ownership(uuid, uuid) from public;

grant execute on function public.create_organization(text, text) to authenticated;
grant execute on function public.expire_stale_invitations(uuid) to authenticated;
grant execute on function public.accept_invitation(bytea) to authenticated;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;
