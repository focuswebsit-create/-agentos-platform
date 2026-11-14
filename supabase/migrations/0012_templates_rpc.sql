-- =============================================================================
-- 0012_templates_rpc.sql — installing a template
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
--
-- Same contract as 0005 and 0009: SECURITY DEFINER, `set search_path = ''`,
-- caller re-derived from auth.uid(), no role or membership accepted as an
-- argument.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- global_template_versions_guard_mutation — published versions are frozen
--
-- DATA_MODEL.md calls these versions immutable. Customers cannot write here at
-- all, so the only connection that could rewrite one is the privileged one —
-- precisely the connection a policy would not constrain. A trigger is the only
-- place the rule can actually live.
-- -----------------------------------------------------------------------------

create or replace function public.global_template_versions_guard_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.published_at is not null then
    raise exception 'TEMPLATE_VERSION_IMMUTABLE'
      using errcode = 'insufficient_privilege',
            detail = 'A published template version is what organisations installed. '
                     'Publish a new version instead of editing this one.';
  end if;
  if new.template_id is distinct from old.template_id or new.id is distinct from old.id then
    raise exception 'TEMPLATE_VERSION_IDENTITY_IMMUTABLE'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger global_template_versions_guard
  before update on public.global_template_versions
  for each row execute function public.global_template_versions_guard_mutation();

create trigger global_templates_touch_updated_at
  before update on public.global_templates
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- install_template — copy a template version into the organisation
--
-- "Installation creates an organisational copy" (PRD.md section 3). A copy, not
-- a reference: the organisation then edits its agent freely, and the platform
-- retiring or republishing the template cannot change what is already running
-- in someone's workspace.
--
-- Three rows in one transaction — the agent, its draft, and the installation
-- record — because any two of them without the third describes something that
-- did not happen.
-- -----------------------------------------------------------------------------

create or replace function public.install_template(
  p_org_id              uuid,
  p_template_version_id uuid,
  p_name                text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_definition jsonb;
  v_template   uuid;
  v_name       text;
  v_agent_id   uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'insufficient_privilege';
  end if;

  if not public.has_org_role(
       p_org_id, array['owner', 'admin', 'member']::public.org_role[]
     ) then
    raise exception 'ORG_ACCESS_DENIED' using errcode = 'insufficient_privilege';
  end if;

  -- The same two conditions the SELECT policy applies, restated because this
  -- function is SECURITY DEFINER and therefore not subject to that policy. A
  -- definer function that trusts its argument to have been filtered by RLS is
  -- the standard way a hidden row becomes reachable.
  select v.definition_json, v.template_id into v_definition, v_template
  from public.global_template_versions v
  join public.global_templates t on t.id = v.template_id
  where v.id = p_template_version_id
    and v.published_at is not null
    and t.visibility = 'public';

  if v_definition is null then
    -- Not found, not published, or the template is draft/retired: one answer,
    -- so this cannot be used to discover templates the platform is preparing.
    raise exception 'TEMPLATE_NOT_AVAILABLE' using errcode = 'no_data_found';
  end if;

  v_name := nullif(btrim(coalesce(p_name, v_definition ->> 'name', '')), '');
  if v_name is null or length(v_name) < 2 then
    raise exception 'VALIDATION_FAILED' using errcode = 'invalid_parameter_value';
  end if;
  v_name := left(v_name, 120);

  insert into public.agents (org_id, name, description, created_by)
  values (
    p_org_id,
    v_name,
    left(nullif(btrim(coalesce(v_definition ->> 'description', '')), ''), 500),
    v_uid
  )
  returning id into v_agent_id;

  -- The draft starts as the template's definition, so the installer opens a
  -- working configuration rather than an empty form. `name` is dropped: the
  -- agent row owns the name, and a stale copy inside the config would survive
  -- a later rename and reappear in the next published version.
  insert into public.agent_versions (org_id, agent_id, config_json, created_by)
  values (p_org_id, v_agent_id, v_definition - 'name', v_uid);

  insert into public.template_installations
    (org_id, template_version_id, linked_agent_id, installed_by)
  values (p_org_id, p_template_version_id, v_agent_id, v_uid);

  perform public.log_audit(
    p_org_id, 'user', 'template.installed', 'agent', v_agent_id,
    jsonb_build_object('template_id', v_template, 'template_version_id', p_template_version_id)
  );

  return v_agent_id;
end;
$$;

revoke execute on function public.install_template(uuid, uuid, text) from public;
grant execute on function public.install_template(uuid, uuid, text) to authenticated;
