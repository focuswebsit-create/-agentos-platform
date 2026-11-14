-- =============================================================================
-- 0021_test_runs.sql — test the draft before publishing it
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
-- Requires 0020 (it calls org_entitlements()).
--
-- WHY
--
-- PRD.md section 5 asks for a playground that tests an agent before it is
-- published. Until now a run could only execute a PUBLISHED version, so the
-- only way to try a change was to publish it - which puts it live.
--
-- HOW IT STAYS SAFE
--
--   * The run still pins an immutable configuration (CLAUDE.md rule 8). The
--     draft itself is mutable, so start_test_run() SNAPSHOTS its config_json
--     into runs.config_snapshot at dispatch, and the executor runs the
--     snapshot. Editing the draft afterwards cannot change what a test ran.
--   * The snapshot is read from the database, never accepted from the caller:
--     a client calling the RPC directly cannot smuggle in a configuration.
--   * Every limit start_run applies applies here too, read under the same
--     organisation lock: suspension, entitlements (runs allowed, concurrency,
--     monthly budget) and the budget reservation. A test run costs money like
--     any other and is accounted like any other.
--   * runs.is_test marks it, so the product can label it and reports can tell
--     tests from production use.
--
-- DATA IT CHANGES: adds two columns to runs (existing rows: is_test = false,
-- config_snapshot = null, which satisfies the new check). No row is updated.
-- =============================================================================

alter table public.runs
  add column is_test boolean not null default false,
  add column config_snapshot jsonb;

alter table public.runs
  add constraint runs_test_has_snapshot check (is_test = (config_snapshot is not null));

create or replace function public.start_test_run(
  p_agent_id uuid,
  p_input    jsonb default '{}'::jsonb
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
  v_draft     uuid;
  v_config    jsonb;
  v_budget    bigint;
  v_cap       bigint;
  v_org_state public.org_status;
  v_period    date := public.current_usage_period();
  v_spent     bigint;
  v_reserved  bigint;
  v_run_id    uuid;
  v_ent       jsonb;
  v_live      integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'insufficient_privilege';
  end if;

  select a.org_id, a.status into v_org_id, v_status
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

  select v.id, v.config_json into v_draft, v_config
  from public.agent_versions v
  where v.agent_id = p_agent_id and v.published_at is null;

  if v_draft is null then
    raise exception 'AGENT_VERSION_MISSING' using errcode = 'no_data_found';
  end if;

  -- The database's floor: the fields a run cannot start without. The
  -- application validates the full schema first and names what is missing.
  if coalesce(btrim(v_config ->> 'role'), '') = ''
     or length(coalesce(btrim(v_config ->> 'instructions'), '')) < 10
     or coalesce(v_config ->> 'provider', '') = ''
     or coalesce(v_config ->> 'model', '') = '' then
    raise exception 'AGENT_CONFIG_INVALID' using errcode = 'invalid_parameter_value';
  end if;

  select o.status into v_org_state
  from public.organizations o
  where o.id = v_org_id
  for update;

  if v_org_state = 'suspended' then
    raise exception 'ORG_SUSPENDED' using errcode = 'insufficient_privilege';
  end if;

  v_ent := public.org_entitlements(v_org_id);

  if not coalesce((v_ent ->> 'runsAllowed')::boolean, false) then
    raise exception 'SUBSCRIPTION_INACTIVE' using errcode = 'insufficient_privilege';
  end if;

  if (v_ent ->> 'maxConcurrentRuns') is not null then
    select count(*) into v_live
    from public.runs r
    where r.org_id = v_org_id and r.status in ('queued', 'running', 'awaiting_approval');
    if v_live >= (v_ent ->> 'maxConcurrentRuns')::integer then
      raise exception 'RUN_CONCURRENCY_LIMIT' using errcode = 'insufficient_resources';
    end if;
  end if;

  v_cap := (v_ent ->> 'monthlyModelBudgetUsdMicros')::bigint;

  begin
    v_budget := (v_config ->> 'maxSpendUsdMicros')::bigint;
  exception when others then
    v_budget := null;
  end;
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
     budget_usd_micros, is_test, config_snapshot)
  values
    (v_org_id, p_agent_id, v_draft, v_uid, coalesce(p_input, '{}'::jsonb),
     v_budget, true, v_config)
  returning id into v_run_id;

  insert into public.usage_reservations (org_id, run_id, max_usd_micros, expires_at)
  values (v_org_id, v_run_id, v_budget, now() + interval '1 hour');

  update public.usage_periods
  set reserved_usd_micros = reserved_usd_micros + v_budget, updated_at = now()
  where org_id = v_org_id and period_start = v_period;

  perform public.log_audit(
    v_org_id, 'user', 'run.test_started', 'run', v_run_id,
    jsonb_build_object('agent_id', p_agent_id, 'draft_version_id', v_draft,
                       'budget_usd_micros', v_budget)
  );

  return jsonb_build_object('run_id', v_run_id, 'reused', false);
end;
$$;

revoke execute on function public.start_test_run(uuid, jsonb) from public, anon;
grant execute on function public.start_test_run(uuid, jsonb) to authenticated;
