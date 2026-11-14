-- =============================================================================
-- 0007_agents_rls.sql — RLS and table privileges for agents and agent_versions
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
--
-- Same two-mechanism approach as 0003: column privileges decide which columns a
-- role may touch at all, RLS decides which rows. Privileges are what stop a
-- customer writing active_version_id or published_at directly — no policy could
-- express that, and no application bug can grant it back.
--
-- Role matrix for agents (docs/adr/0008-p2-agent-schema.md):
--
--              read   create   edit draft   publish   archive
--   owner       yes     yes        yes        yes       yes
--   admin       yes     yes        yes        yes       yes
--   member      yes     yes        yes        yes       no
--   viewer      yes     no         no         no        no
--
-- member can publish. Agent Studio is the working surface of this product and a
-- team whose members cannot ship an agent would need an admin for every change;
-- spend is bounded by the per-run budget caps in P3, not by who pressed publish.
-- Archiving withdraws something other people may depend on, so it stays with
-- owner and admin.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- agents
-- -----------------------------------------------------------------------------

alter table public.agents enable row level security;

revoke all on public.agents from anon, authenticated;

grant select on public.agents to authenticated;

-- Narrow on purpose. Withheld, and why:
--   id, org_id      — identity; changing either would move the row between tenants
--   active_version_id — written only by publish_agent_version() in 0009
--   created_by, created_at — audit fields
--   updated_at      — maintained by a trigger in 0008, not by the client
-- No INSERT: agents are created by create_agent() in 0009, which also opens the
-- first draft. Two rows that must appear together are not two client calls.
--
-- status is absent from the UPDATE grant as well. 'published' is only true if
-- active_version_id points somewhere, and 'archived' is an owner/admin action;
-- both transitions belong to the RPCs, which set the pointer and the status in
-- one statement. Granting the column would let a client claim a state the data
-- does not support.
grant update (name, description) on public.agents to authenticated;

create policy agents_select on public.agents
  for select to authenticated
  using (public.is_org_member(org_id));

-- No INSERT policy, to match the withheld privilege. create_agent() is
-- SECURITY DEFINER and checks the caller's role itself.

-- USING tests the row as it stands, WITH CHECK the row as it would become. Both
-- are needed: without WITH CHECK a member could move an agent to another
-- organisation, and without USING they could edit one they cannot otherwise see.
--
-- Viewer is excluded by the role list, not by a column privilege: privileges are
-- per-table and cannot tell one member from another.
--
-- The status arm stops a member renaming an archived agent, which would present
-- a withdrawn agent as actively maintained.
create policy agents_update on public.agents
  for update to authenticated
  using (
    case
      when public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]) then true
      when public.has_org_role(org_id, array['member']::public.org_role[])
        then status <> 'archived'
      else false
    end
  )
  with check (
    case
      when public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]) then true
      when public.has_org_role(org_id, array['member']::public.org_role[])
        then status <> 'archived'
      else false
    end
  );

-- No DELETE policy and no DELETE privilege, for anyone. Agents are archived.
-- Runs, usage events and invoices in later phases refer back to the agent that
-- produced them; deleting the row would leave that history pointing at nothing.

-- -----------------------------------------------------------------------------
-- agent_versions
-- -----------------------------------------------------------------------------

alter table public.agent_versions enable row level security;

revoke all on public.agent_versions from anon, authenticated;

grant select on public.agent_versions to authenticated;

-- published_at is absent from both grants. Publishing is a state transition that
-- has to assign a version number and move the agent's pointer in the same
-- transaction, so it belongs to the RPC in 0009 and nowhere else. Without the
-- column privilege, a direct PostgREST call cannot forge it.
-- No INSERT either: drafts are opened by create_agent() and by
-- publish_agent_version(), which clones the version it just froze so editing can
-- continue. A client-side insert could create a second draft for the same agent
-- and race the unique index that forbids it.
--
-- version and published_at appear in no grant at all. Publishing has to assign a
-- number and move the agent's pointer in the same transaction, so it belongs to
-- the RPC in 0009 and nowhere else; without the privilege a direct PostgREST
-- call cannot forge either field.
grant update (config_json) on public.agent_versions to authenticated;

create policy agent_versions_select on public.agent_versions
  for select to authenticated
  using (public.is_org_member(org_id));

-- No INSERT policy, to match the withheld privilege.

-- Drafts only. The USING arm is the rule that matters: a row with published_at
-- set is not an updatable row for any customer role, whatever the columns say.
-- The trigger in 0008 enforces the same thing a second time, for connections
-- that are not subject to RLS at all.
create policy agent_versions_update on public.agent_versions
  for update to authenticated
  using (
    published_at is null
    and public.has_org_role(org_id, array['owner', 'admin', 'member']::public.org_role[])
  )
  with check (
    published_at is null
    and public.has_org_role(org_id, array['owner', 'admin', 'member']::public.org_role[])
  );

-- No DELETE: a published version is the record of what actually ran.
