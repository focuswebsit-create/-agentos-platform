-- =============================================================================
-- 0009_agents_rpc.sql — agent lifecycle operations
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
--
-- Same contract as 0005: SECURITY DEFINER, `set search_path = ''`, caller
-- re-derived from auth.uid(), and no function takes a role or a membership as an
-- argument. API_CONTRACT.md requires org_id to be "resolved from authenticated
-- selected workspace and authorizations, never blindly trusted from request
-- body"; every function below therefore derives the organisation from the agent
-- it was given, and then checks the caller against that.
--
-- These exist because each one spans rows that have to appear or change
-- together, and because 0007 deliberately grants no INSERT on either table.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- create_agent — a new agent and its first empty draft
--
-- Atomic because an agent with no draft is a dead end in the UI: there is
-- nothing to edit and no client-side way to open one, since INSERT on
-- agent_versions is granted to nobody.
-- -----------------------------------------------------------------------------

create or replace function public.create_agent(
  p_org_id      uuid,
  p_name        text,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_agent_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'insufficient_privilege';
  end if;

  if not public.has_org_role(
       p_org_id, array['owner', 'admin', 'member']::public.org_role[]
     ) then
    -- Same answer for "not a member" and "a viewer": a distinct error would
    -- tell an outsider that the organisation exists. ORG_ACCESS_DENIED is the
    -- existing code for this in API_CONTRACT.md's taxonomy.
    raise exception 'ORG_ACCESS_DENIED' using errcode = 'insufficient_privilege';
  end if;

  insert into public.agents (org_id, name, description, created_by)
  values (p_org_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), v_uid)
  returning id into v_agent_id;

  insert into public.agent_versions (org_id, agent_id, config_json, created_by)
  values (p_org_id, v_agent_id, '{}'::jsonb, v_uid);

  perform public.log_audit(
    p_org_id, 'user', 'agent.created', 'agent', v_agent_id,
    jsonb_build_object('name', btrim(p_name))
  );

  return v_agent_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- publish_agent_version — freeze the draft, number it, point the agent at it,
-- and open a fresh draft from the same configuration
--
-- The row lock is the serialisation point, exactly as in the seat gate: two
-- concurrent publishes both reading max(version) without it would both compute
-- the same next number. One would then fail on the unique constraint, which is
-- correct but turns a routine action into an error the user did not cause.
-- Locking the agent first makes them queue instead.
--
-- Cloning a new draft keeps "exactly one draft per agent" true at every instant,
-- which is what the partial unique index in 0006 asserts. Without it, publishing
-- would consume the draft and the next edit would have nowhere to go.
-- -----------------------------------------------------------------------------

create or replace function public.publish_agent_version(p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_org_id     uuid;
  v_status     public.agent_status;
  v_draft_id   uuid;
  v_config     jsonb;
  v_next       integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'insufficient_privilege';
  end if;

  -- FOR UPDATE: the serialisation point. Everything below reads state that a
  -- concurrent publish would otherwise be changing underneath it.
  select a.org_id, a.status into v_org_id, v_status
  from public.agents a
  where a.id = p_agent_id
  for update;

  -- "No such agent" and "not yours" give the same answer, as the invitation
  -- endpoints do. Separating them would confirm that a given agent id exists to
  -- someone who cannot otherwise see it.
  if v_org_id is null
     or not public.has_org_role(
          v_org_id, array['owner', 'admin', 'member']::public.org_role[]
        ) then
    raise exception 'ORG_ACCESS_DENIED' using errcode = 'insufficient_privilege';
  end if;

  if v_status = 'archived' then
    raise exception 'AGENT_ARCHIVED' using errcode = 'invalid_parameter_value';
  end if;

  select v.id, v.config_json into v_draft_id, v_config
  from public.agent_versions v
  where v.agent_id = p_agent_id and v.published_at is null;

  if v_draft_id is null then
    raise exception 'AGENT_VERSION_MISSING' using errcode = 'no_data_found';
  end if;

  -- An empty configuration is not publishable. P3 adds the real validation,
  -- when there is a runtime with an opinion about what a valid config contains;
  -- until then this at least refuses to freeze a version that does nothing, and
  -- the application validates the shape with Zod before it gets here.
  if v_config is null or v_config = '{}'::jsonb then
    raise exception 'AGENT_CONFIG_INVALID' using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(max(v.version), 0) + 1 into v_next
  from public.agent_versions v
  where v.agent_id = p_agent_id;

  update public.agent_versions
  set version = v_next, published_at = now()
  where id = v_draft_id;

  -- The fresh draft carries the published configuration forward, so the next
  -- edit starts from what is live rather than from an empty object.
  insert into public.agent_versions (org_id, agent_id, config_json, created_by)
  values (v_org_id, p_agent_id, v_config, v_uid);

  update public.agents
  set active_version_id = v_draft_id, status = 'published'
  where id = p_agent_id;

  perform public.log_audit(
    v_org_id, 'user', 'agent.version_published', 'agent_version', v_draft_id,
    jsonb_build_object('agent_id', p_agent_id, 'version', v_next)
  );

  return jsonb_build_object('version_id', v_draft_id, 'version', v_next);
end;
$$;

-- -----------------------------------------------------------------------------
-- set_agent_archived — withdraw an agent from use, or restore it
--
-- owner and admin only (0007's matrix). Archiving withdraws something other
-- people's work may depend on; restoring puts it back into dispatch.
--
-- Restoring returns the agent to 'published' if it has an active version and to
-- 'draft' if it never published one. Returning it to 'published' with no active
-- version would be a state the data does not support.
-- -----------------------------------------------------------------------------

create or replace function public.set_agent_archived(p_agent_id uuid, p_archived boolean)
returns public.agent_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_org_id    uuid;
  v_active    uuid;
  v_new       public.agent_status;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'insufficient_privilege';
  end if;

  select a.org_id, a.active_version_id into v_org_id, v_active
  from public.agents a
  where a.id = p_agent_id
  for update;

  if v_org_id is null
     or not public.has_org_role(v_org_id, array['owner', 'admin']::public.org_role[]) then
    raise exception 'ORG_ACCESS_DENIED' using errcode = 'insufficient_privilege';
  end if;

  if p_archived then
    v_new := 'archived';
  elsif v_active is not null then
    v_new := 'published';
  else
    v_new := 'draft';
  end if;

  update public.agents set status = v_new where id = p_agent_id;

  perform public.log_audit(
    v_org_id, 'user',
    case when p_archived then 'agent.archived' else 'agent.restored' end,
    'agent', p_agent_id, '{}'::jsonb
  );

  return v_new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Execute privileges
--
-- PUBLIC is revoked explicitly: PostgreSQL grants EXECUTE to PUBLIC on every new
-- function by default, so a SECURITY DEFINER function is callable by anon until
-- someone says otherwise.
-- -----------------------------------------------------------------------------

revoke execute on function public.create_agent(uuid, text, text) from public;
revoke execute on function public.publish_agent_version(uuid) from public;
revoke execute on function public.set_agent_archived(uuid, boolean) from public;

grant execute on function public.create_agent(uuid, text, text) to authenticated;
grant execute on function public.publish_agent_version(uuid) to authenticated;
grant execute on function public.set_agent_archived(uuid, boolean) to authenticated;
