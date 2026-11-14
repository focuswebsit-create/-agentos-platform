-- =============================================================================
-- 0008_agents_invariants.sql — triggers that hold the agent model together
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
--
-- 0007 withholds the privileges and writes the policies that keep customers out
-- of published versions. This file enforces the same rule for connections RLS
-- does not constrain — the service role, the schema owner, a future background
-- job — because DATA_MODEL.md states it without qualification:
--
--   "Published versions cannot be mutated in place"
--
-- A rule that holds only for one class of connection is a convention, not an
-- invariant, and the row that eventually gets rewritten will be rewritten by the
-- connection that was exempt.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A published agent version is frozen
--
-- UPDATE only, deliberately. There is no DELETE guard, and the reason is worth
-- recording: deleting an organisation cascades to its agents and from there to
-- their versions, and a trigger cannot tell a cascade from a direct delete. A
-- DELETE guard would therefore make an organisation undeletable — turning a rule
-- about editing history into a block on erasure requests. What stops a customer
-- deleting a version is the absence of the DELETE privilege in 0007, which no
-- cascade needs.
-- -----------------------------------------------------------------------------

create or replace function public.agent_versions_guard_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.published_at is not null then
    raise exception 'AGENT_VERSION_IMMUTABLE'
      using errcode = 'insufficient_privilege',
            detail = 'A published agent version is a record of what ran. '
                     'Publish a new version instead of editing this one.';
  end if;

  -- Identity columns, checked even while the row is still a draft. A draft that
  -- can change agent_id can be moved under another organisation's agent, and the
  -- composite foreign key would not object: the new (org_id, agent_id) pair is
  -- perfectly valid, just not this tenant's.
  if new.agent_id is distinct from old.agent_id
     or new.org_id is distinct from old.org_id
     or new.id is distinct from old.id then
    raise exception 'AGENT_VERSION_IDENTITY_IMMUTABLE'
      using errcode = 'insufficient_privilege',
            detail = 'id, org_id and agent_id cannot be reassigned.';
  end if;

  return new;
end;
$$;

create trigger agent_versions_guard
  before update on public.agent_versions
  for each row execute function public.agent_versions_guard_mutation();

-- -----------------------------------------------------------------------------
-- agents: identity columns, and updated_at
-- -----------------------------------------------------------------------------

create or replace function public.agents_guard_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.org_id is distinct from old.org_id or new.id is distinct from old.id then
    raise exception 'AGENT_IDENTITY_IMMUTABLE'
      using errcode = 'insufficient_privilege',
            detail = 'id and org_id cannot be reassigned.';
  end if;
  return new;
end;
$$;

create trigger agents_guard
  before update on public.agents
  for each row execute function public.agents_guard_mutation();

-- touch_updated_at is defined in 0004.
create trigger agents_touch_updated_at
  before update on public.agents
  for each row execute function public.touch_updated_at();
