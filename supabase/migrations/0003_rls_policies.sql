-- =============================================================================
-- 0003_rls_policies.sql — RLS and table privileges
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
--
-- Two independent mechanisms are used together, because RLS alone cannot express
-- "may edit this row but not this column":
--
--   * TABLE/COLUMN PRIVILEGES decide which columns a role may touch at all.
--     This is what stops an org owner raising their own `seat_limit` or clearing
--     their own `suspended` status: the privilege simply is not granted, so no
--     policy, API bug or direct PostgREST call can do it.
--
--   * ROW LEVEL SECURITY decides which rows are visible and writable.
--
-- Supabase configures default privileges that grant new tables in `public` to
-- `anon` and `authenticated`. Every table below therefore starts with an explicit
-- REVOKE ALL, so access is additive from zero rather than subtractive from full.
--
-- This is layer 4 of the five described in the P1 plan. Layers 1-3 (proxy,
-- resolveOrgContext, server permission guard) are independent checks in the
-- application, as DATA_MODEL.md requires: "RLS AND backend tenant membership
-- checks". Neither layer is allowed to be the only one.
-- =============================================================================

grant usage on schema public to anon, authenticated;

-- -----------------------------------------------------------------------------
-- organizations
-- -----------------------------------------------------------------------------

alter table public.organizations enable row level security;

revoke all on public.organizations from anon, authenticated;

grant select on public.organizations to authenticated;

-- Deliberately narrow. `seat_limit` and `status` are NOT updatable by customers:
-- the first is the P1 quota source, the second is a platform safety control.
-- Creating an organisation goes through the RPC in 0005, so no INSERT is granted.
grant update (name, locale, timezone) on public.organizations to authenticated;

create policy organizations_select on public.organizations
  for select to authenticated
  using (public.is_org_member(id));

create policy organizations_update on public.organizations
  for update to authenticated
  using (public.has_org_role(id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(id, array['owner', 'admin']::public.org_role[]));

-- No DELETE policy and no DELETE privilege: organisations are suspended, never
-- deleted (SECURITY.md 4, SUPER_ADMIN.md "never silently delete").

-- -----------------------------------------------------------------------------
-- memberships
--
-- This is where privilege escalation would happen, so the three vectors from the
-- approved role matrix are blocked in the policy body:
--
--   USING      inspects the row as it is now  -> an admin cannot target an owner.
--   WITH CHECK inspects the row as it will be -> an admin cannot mint an admin.
--   user_id <> auth.uid()                     -> nobody edits their own role.
--
-- Only an owner may appoint or remove an admin, or touch an owner row. Ownership
-- transfer runs through the RPC in 0005 as a single transaction.
-- -----------------------------------------------------------------------------

alter table public.memberships enable row level security;

revoke all on public.memberships from anon, authenticated;

grant select on public.memberships to authenticated;
grant update (role) on public.memberships to authenticated;
grant delete on public.memberships to authenticated;

-- No INSERT privilege: memberships are created only by create_organization() and
-- accept_invitation() in 0005, both SECURITY DEFINER and both seat-gated.

create policy memberships_select on public.memberships
  for select to authenticated
  using (public.is_org_member(org_id));

create policy memberships_update on public.memberships
  for update to authenticated
  using (
    case
      when public.has_org_role(org_id, array['owner']::public.org_role[])
        then user_id <> (select auth.uid())
      when public.has_org_role(org_id, array['admin']::public.org_role[])
        then role in ('member', 'viewer') and user_id <> (select auth.uid())
      else false
    end
  )
  with check (
    case
      when public.has_org_role(org_id, array['owner']::public.org_role[])
        then user_id <> (select auth.uid())
      when public.has_org_role(org_id, array['admin']::public.org_role[])
        then role in ('member', 'viewer') and user_id <> (select auth.uid())
      else false
    end
  );

create policy memberships_delete on public.memberships
  for delete to authenticated
  using (
    case
      when public.has_org_role(org_id, array['owner']::public.org_role[])
        then user_id <> (select auth.uid())
      when public.has_org_role(org_id, array['admin']::public.org_role[])
        then role in ('member', 'viewer') and user_id <> (select auth.uid())
      else false
    end
  );

-- Note: self-removal ("leave organisation") is intentionally not possible in P1.
-- It needs its own confirmation flow and last-owner handling; deferred, not forgotten.

-- -----------------------------------------------------------------------------
-- profiles
--
-- Readable by co-members so a member list can show names. Email addresses are NOT
-- here — they stay in auth.users, which clients cannot read at all. That is what
-- lets a `viewer` see the team without being handed personal data.
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

-- No INSERT privilege: rows are created by the handle_new_user() trigger in 0004.

create policy profiles_select on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or public.shares_org_with(user_id));

create policy profiles_update on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- invitations
--
-- Not visible to `member` or `viewer` at all: the rows carry the email addresses
-- of people who have not joined, which is personal data no ordinary member needs.
--
-- The INSERT policy is the second place the "admin cannot invite an admin"
-- escalation is blocked (the first is the CHECK constraint in 0001).
--
-- Clients may only move an invitation to `revoked`. Accepting is done by the
-- SECURITY DEFINER RPC in 0005, so no session can accept an invitation addressed
-- to somebody else by flipping a status column.
-- -----------------------------------------------------------------------------

alter table public.invitations enable row level security;

revoke all on public.invitations from anon, authenticated;

grant select on public.invitations to authenticated;
grant insert (org_id, email, role, token_hash, expires_at, invited_by)
  on public.invitations to authenticated;
grant update (status, revoked_at) on public.invitations to authenticated;

create policy invitations_select on public.invitations
  for select to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

create policy invitations_insert on public.invitations
  for insert to authenticated
  with check (
    invited_by = (select auth.uid())
    and (
      public.has_org_role(org_id, array['owner']::public.org_role[])
      or (
        public.has_org_role(org_id, array['admin']::public.org_role[])
        and role in ('member', 'viewer')
      )
    )
  );

create policy invitations_revoke on public.invitations
  for update to authenticated
  using (
    status = 'pending'
    and public.has_org_role(org_id, array['owner', 'admin']::public.org_role[])
  )
  with check (
    status = 'revoked'
    and public.has_org_role(org_id, array['owner', 'admin']::public.org_role[])
  );

-- No DELETE: revocation is a status transition, so the record survives for audit.

-- -----------------------------------------------------------------------------
-- platform_admins — unreachable from any client session
--
-- RLS is enabled and NO policy is created, which denies everything by default.
-- Privileges are revoked as well, so the two mechanisms fail independently.
-- DATA_MODEL.md: "RLS never exposes platform_admin tables". The common pattern of
-- a policy that grants staff cross-org SELECT is explicitly ruled out there, so
-- platform reads go through an audited service method holding the secret key.
-- -----------------------------------------------------------------------------

alter table public.platform_admins enable row level security;

revoke all on public.platform_admins from anon, authenticated;

-- (intentionally no policies — RLS with zero policies denies every row)

-- service_role needs an EXPLICIT grant here.
--
-- BYPASSRLS bypasses row-level security, NOT table-level privileges. Without
-- this grant the platform-admin guard cannot read its own allowlist and the
-- /admin boundary fails closed for everyone, including real admins.
--
-- Relying on Supabase's implicit default grants instead would make the
-- behaviour depend on project configuration rather than on this migration,
-- and it would differ between Supabase and any other PostgreSQL. Stating it
-- here keeps the privilege model entirely in version control.
--
-- Read-only: rows are added by the owner through the documented setup step,
-- never by application code.
grant usage on schema public to service_role;
grant select on public.platform_admins to service_role;

-- -----------------------------------------------------------------------------
-- audit_events — readable by org administrators, writable by nobody
-- -----------------------------------------------------------------------------

alter table public.audit_events enable row level security;

revoke all on public.audit_events from anon, authenticated;

grant select on public.audit_events to authenticated;

-- No INSERT/UPDATE/DELETE privilege. Writes go through log_audit() (0002); 0004
-- adds a trigger that rejects UPDATE and DELETE even for the table owner.

create policy audit_events_select on public.audit_events
  for select to authenticated
  using (
    org_id is not null
    and public.has_org_role(org_id, array['owner', 'admin']::public.org_role[])
  );

-- Platform-level rows (org_id is null) match no policy, so no customer session can
-- read them regardless of role.
