-- =============================================================================
-- 0016_suspension.sql — make suspension actually suspend something
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
--
-- `organizations.status` has existed since 0001 and `SUPER_ADMIN.md` lists
-- "suspend account from new runs with reason, warning and safety audit" as a
-- safeguard. Nothing checked the column. A suspended organisation could
-- dispatch runs and spend money exactly as before, and the only effect of
-- suspending one was a different word on an admin screen.
--
-- This file closes that, and adds the two things the safeguard names and the
-- schema could not express: a reason, and when it happened.
--
-- WHAT SUSPENSION DOES AND DOES NOT DO.
--
-- It blocks new runs. It does NOT block reading, editing drafts, or managing
-- the team. That is deliberate: `SUPER_ADMIN.md` says "suspend account from new
-- runs" and separately forbids silently deleting account or content, and a
-- suspension that locked a customer out of their own data would be closer to
-- the second than the first. A suspended organisation can see everything it
-- had, fix whatever caused the suspension, and export — it simply cannot spend
-- money.
-- =============================================================================

alter table public.organizations
  add column suspended_at timestamptz,
  add column suspension_reason text
    check (suspension_reason is null or length(trim(suspension_reason)) between 3 and 500);

-- The three facts move together or not at all. Without this, "suspended with no
-- reason and no date" is representable, and that is precisely the record an
-- audit asks for and cannot find.
alter table public.organizations
  add constraint organizations_suspension_consistent check (
    (status = 'suspended') = (suspended_at is not null)
    and (suspended_at is null) = (suspension_reason is null)
  );

comment on column public.organizations.suspension_reason is
  'Shown to the customer. SUPER_ADMIN.md requires a reason and a warning, so this '
  'is deliberately readable by members rather than admin-only: a workspace that '
  'stops working without saying why is an outage, not a suspension.';

-- Customers still cannot write any of it: 0003 grants update on exactly
-- (name, locale, timezone), and a column added later is not in that grant.
-- Stated as an executable check rather than a comment, because "we never
-- granted it" is easy to lose track of after sixteen migrations.
do $$
begin
  if has_column_privilege('authenticated', 'public.organizations', 'status', 'UPDATE')
     or has_column_privilege('authenticated', 'public.organizations', 'suspended_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.organizations', 'suspension_reason', 'UPDATE')
  then
    raise exception 'suspension columns are customer-updatable; they are a platform safety control';
  end if;
end;
$$;

-- The platform-admin module writes these, and only these. An explicit grant
-- rather than relying on the service role's default privileges: defaults are a
-- property of how the project was provisioned, and this is a safety control.
grant update (status, suspended_at, suspension_reason) on public.organizations to service_role;

-- -----------------------------------------------------------------------------
-- start_run — supersedes the definition in 0015
--
-- Replaced in full rather than patched, because that is the only way a
-- function changes. The single difference from 0015 is the suspension check
-- below, marked where it sits.
-- -----------------------------------------------------------------------------

create or replace function public.start_run(
  p_agent_id        uuid,
  p_input           jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_org_id    uuid;
  v_status    public.agent_status;
  v_version   uuid;
  v_budget    bigint;
  v_cap       bigint;
  v_org_state public.org_status;
  v_period    date := public.current_usage_period();
  v_spent     bigint;
  v_reserved  bigint;
  v_run_id    uuid;
  v_existing  uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'insufficient_privilege';
  end if;

  select a.org_id, a.status, a.active_version_id
    into v_org_id, v_status, v_version
  from public.agents a
  where a.id = p_agent_id;

  if v_org_id is null
     or not public.has_org_role(
          v_org_id, array['owner', 'admin', 'member']::public.org_role[]
        ) then
    raise exception 'ORG_ACCESS_DENIED' using errcode = 'insufficient_privilege';
  end if;

  if v_status = 'archived' then
    raise exception 'AGENT_ARCHIVED' using errcode = 'invalid_parameter_value';
  end if;

  if v_version is null then
    raise exception 'AGENT_VERSION_MISSING' using errcode = 'no_data_found';
  end if;

  if p_idempotency_key is not null then
    select r.id into v_existing
    from public.runs r
    where r.org_id = v_org_id and r.idempotency_key = p_idempotency_key;
    if v_existing is not null then
      return jsonb_build_object('run_id', v_existing, 'reused', true);
    end if;
  end if;

  select o.monthly_spend_cap_usd_micros, o.status into v_cap, v_org_state
  from public.organizations o
  where o.id = v_org_id
  for update;

  -- ++ THE CHANGE IN THIS MIGRATION ++
  -- Checked under the same lock as the budget, so a suspension committed while
  -- a dispatch is in flight cannot be stepped over. A distinct code, because
  -- "your workspace is suspended" is something the customer can act on and
  -- ORG_ACCESS_DENIED is not.
  if v_org_state = 'suspended' then
    raise exception 'ORG_SUSPENDED' using errcode = 'insufficient_privilege';
  end if;

  select (v.config_json ->> 'maxSpendUsdMicros')::bigint into v_budget
  from public.agent_versions v
  where v.id = v_version;

  if v_budget is null or v_budget <= 0 then
    raise exception 'AGENT_CONFIG_INVALID' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.usage_periods (org_id, period_start)
  values (v_org_id, v_period)
  on conflict (org_id, period_start) do nothing;

  select p.spent_usd_micros, p.reserved_usd_micros into v_spent, v_reserved
  from public.usage_periods p
  where p.org_id = v_org_id and p.period_start = v_period;

  if v_spent + v_reserved + v_budget > v_cap then
    raise exception 'USAGE_LIMIT_REACHED' using errcode = 'insufficient_resources';
  end if;

  insert into public.runs
    (org_id, agent_id, agent_version_id, initiator_user_id, input_json,
     idempotency_key, budget_usd_micros)
  values
    (v_org_id, p_agent_id, v_version, v_uid, coalesce(p_input, '{}'::jsonb),
     p_idempotency_key, v_budget)
  returning id into v_run_id;

  insert into public.usage_reservations (org_id, run_id, max_usd_micros, expires_at)
  values (v_org_id, v_run_id, v_budget, now() + interval '1 hour');

  update public.usage_periods
  set reserved_usd_micros = reserved_usd_micros + v_budget, updated_at = now()
  where org_id = v_org_id and period_start = v_period;

  perform public.log_audit(
    v_org_id, 'user', 'run.started', 'run', v_run_id,
    jsonb_build_object('agent_id', p_agent_id, 'agent_version_id', v_version,
                       'budget_usd_micros', v_budget)
  );

  return jsonb_build_object('run_id', v_run_id, 'reused', false);
exception
  when unique_violation then
    if p_idempotency_key is null then raise; end if;
    select r.id into v_existing
    from public.runs r
    where r.org_id = v_org_id and r.idempotency_key = p_idempotency_key;
    if v_existing is null then raise; end if;
    return jsonb_build_object('run_id', v_existing, 'reused', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- set_org_suspended — the platform's safety control
--
-- service_role only. This is not a customer action in any role, including
-- owner: an organisation that could unsuspend itself is not suspended.
--
-- The acting administrator is an argument rather than auth.uid(), because this
-- connection has no JWT. Same reason log_platform_audit takes one.
-- -----------------------------------------------------------------------------

create or replace function public.set_org_suspended(
  p_actor_user_id uuid,
  p_org_id        uuid,
  p_suspended     boolean,
  p_reason        text default null
)
returns public.org_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_new    public.org_status;
begin
  if p_actor_user_id is null then
    raise exception 'PLATFORM_AUDIT_REQUIRES_ACTOR' using errcode = 'invalid_parameter_value';
  end if;

  if p_suspended and (v_reason is null or length(v_reason) < 3) then
    -- SUPER_ADMIN.md requires a reason. Enforced here rather than in the
    -- application so there is no path that suspends without one.
    raise exception 'SUSPENSION_REQUIRES_REASON' using errcode = 'invalid_parameter_value';
  end if;

  if not exists (select 1 from public.organizations o where o.id = p_org_id) then
    raise exception 'ORG_NOT_FOUND' using errcode = 'no_data_found';
  end if;

  v_new := case when p_suspended then 'suspended' else 'active' end::public.org_status;

  update public.organizations
  set status = v_new,
      suspended_at = case when p_suspended then now() else null end,
      suspension_reason = case when p_suspended then v_reason else null end
  where id = p_org_id;

  -- Argument order is (actor, action, entity_type, org_id, entity_id, metadata).
  perform public.log_platform_audit(
    p_actor_user_id,
    case when p_suspended then 'admin.org.suspended' else 'admin.org.restored' end,
    'organization',
    p_org_id,
    p_org_id,
    -- The reason is recorded. It is operator-written text about an account, not
    -- customer content, and an audit record of a suspension without its reason
    -- is the record that cannot answer the question it exists for.
    jsonb_build_object('reason', v_reason)
  );

  return v_new;
end;
$$;

revoke execute on function public.set_org_suspended(uuid, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.set_org_suspended(uuid, uuid, boolean, text) to service_role;
