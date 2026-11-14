-- =============================================================================
-- 0015_runtime_rpc.sql — dispatch, settlement and cancellation
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
--
-- ROADMAP.md's P3 gate: "per-tenant spend cap and idempotency pass". Both are
-- enforced here, inside the transaction that creates the run, because a cap
-- checked before the insert and a run created after it are two facts that can
-- disagree.
--
-- THE LOCK ORDER IS THE ORGANISATION ROW, ALWAYS FIRST.
--
-- `organizations` is already the serialisation point for the seat gate in
-- 0004. Reusing it here gives one total order per tenant across every
-- transaction that touches tenant-wide limits, which is what stops a deadlock
-- between a dispatch and a membership change. It also sidesteps the upsert race
-- on usage_periods: taking a lock on a row that is guaranteed to exist is
-- reliable, whereas `insert … on conflict do nothing` followed by
-- `select … for update` can see nothing at all when a concurrent transaction
-- has inserted the row but not yet committed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- current_usage_period — one row per organisation per calendar month
-- -----------------------------------------------------------------------------

create or replace function public.current_usage_period()
returns date language sql stable
set search_path = ''
as $$
  select date_trunc('month', now() at time zone 'utc')::date;
$$;

-- -----------------------------------------------------------------------------
-- start_run — pin the version, reserve the budget, create the run
--
-- Returns {run_id, reused}. `reused` is true when an idempotency key matched an
-- existing run: ARCHITECTURE.md requires idempotency keys, and the point of one
-- is that a client which retries a dispatch it is unsure about gets the same
-- run back rather than a second one that also costs money.
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
  v_config    jsonb;
  v_budget    bigint;
  v_cap       bigint;
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

  -- Unknown agent and someone else's agent answer alike, as everywhere else.
  if v_org_id is null
     or not public.has_org_role(
          v_org_id, array['owner', 'admin', 'member']::public.org_role[]
        ) then
    raise exception 'ORG_ACCESS_DENIED' using errcode = 'insufficient_privilege';
  end if;

  if v_status = 'archived' then
    raise exception 'AGENT_ARCHIVED' using errcode = 'invalid_parameter_value';
  end if;

  -- CLAUDE.md rule 8: runs execute a published version pin. A draft is not
  -- runnable, however complete it looks in the editor.
  if v_version is null then
    raise exception 'AGENT_VERSION_MISSING' using errcode = 'no_data_found';
  end if;

  -- Idempotency, checked before the lock so a retry is cheap.
  if p_idempotency_key is not null then
    select r.id into v_existing
    from public.runs r
    where r.org_id = v_org_id and r.idempotency_key = p_idempotency_key;
    if v_existing is not null then
      return jsonb_build_object('run_id', v_existing, 'reused', true);
    end if;
  end if;

  -- The serialisation point. Everything below reads tenant-wide totals that a
  -- concurrent dispatch would otherwise be changing underneath it.
  select o.monthly_spend_cap_usd_micros into v_cap
  from public.organizations o
  where o.id = v_org_id
  for update;

  select (v.config_json ->> 'maxSpendUsdMicros')::bigint into v_budget
  from public.agent_versions v
  where v.id = v_version;

  if v_budget is null or v_budget <= 0 then
    -- A published version with no spend cap would be a run with no ceiling.
    raise exception 'AGENT_CONFIG_INVALID' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.usage_periods (org_id, period_start)
  values (v_org_id, v_period)
  on conflict (org_id, period_start) do nothing;

  select p.spent_usd_micros, p.reserved_usd_micros into v_spent, v_reserved
  from public.usage_periods p
  where p.org_id = v_org_id and p.period_start = v_period;

  -- Reserved counts against the cap as well as spent. Without that, N runs
  -- dispatched before any of them settles would each see the same headroom —
  -- the same hole the seat gate closes by counting pending invitations.
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
    -- Two concurrent dispatches with the same idempotency key. One won; return
    -- its run rather than an error the caller cannot act on. Re-raised if the
    -- violation was something else, because swallowing it would hide a bug.
    if p_idempotency_key is null then raise; end if;
    select r.id into v_existing
    from public.runs r
    where r.org_id = v_org_id and r.idempotency_key = p_idempotency_key;
    if v_existing is null then raise; end if;
    return jsonb_build_object('run_id', v_existing, 'reused', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- settle_run — the execution plane reports what actually happened
--
-- service_role only. This writes spend, so a customer-reachable version of it
-- would be a way to spend without paying, or to mark a failed run succeeded.
-- -----------------------------------------------------------------------------

create or replace function public.settle_run(
  p_run_id     uuid,
  p_status     public.run_status,
  p_cost_usd_micros bigint,
  p_result     jsonb default null,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id   uuid;
  v_period   date;
  v_reserved bigint;
begin
  if p_status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'VALIDATION_FAILED' using errcode = 'invalid_parameter_value',
      detail = 'settle_run finalises a run; use it only for a terminal status.';
  end if;
  if p_cost_usd_micros < 0 then
    raise exception 'VALIDATION_FAILED' using errcode = 'invalid_parameter_value';
  end if;

  select r.org_id into v_org_id from public.runs r where r.id = p_run_id;
  if v_org_id is null then
    raise exception 'RUN_NOT_FOUND' using errcode = 'no_data_found';
  end if;

  perform 1 from public.organizations o where o.id = v_org_id for update;

  -- Settle the reservation first: the amount released is whatever it was
  -- holding, which is not necessarily this run's budget if a sweeper already
  -- expired it. Taking the figure from the row rather than from the run is what
  -- keeps the period total from drifting.
  update public.usage_reservations
  set status = 'settled', settled_at = now()
  where run_id = p_run_id and status = 'active'
  returning max_usd_micros into v_reserved;

  v_period := public.current_usage_period();

  update public.usage_periods
  set reserved_usd_micros = greatest(reserved_usd_micros - coalesce(v_reserved, 0), 0),
      spent_usd_micros = spent_usd_micros + p_cost_usd_micros,
      updated_at = now()
  where org_id = v_org_id and period_start = v_period;

  update public.runs
  set status = p_status,
      spent_usd_micros = p_cost_usd_micros,
      result_json = p_result,
      error_code = p_error_code,
      ended_at = now(),
      started_at = coalesce(started_at, now())
  where id = p_run_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- cancel_run — stop a run and give the budget back
-- -----------------------------------------------------------------------------

create or replace function public.cancel_run(p_run_id uuid)
returns public.run_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_org_id   uuid;
  v_status   public.run_status;
  v_reserved bigint;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'insufficient_privilege';
  end if;

  select r.org_id, r.status into v_org_id, v_status
  from public.runs r where r.id = p_run_id;

  if v_org_id is null
     or not public.has_org_role(
          v_org_id, array['owner', 'admin', 'member']::public.org_role[]
        ) then
    raise exception 'ORG_ACCESS_DENIED' using errcode = 'insufficient_privilege';
  end if;

  if v_status not in ('queued', 'running', 'awaiting_approval') then
    -- Already finished. Not an error worth raising — the caller wanted it
    -- stopped and it is stopped — but the status says it was not this call.
    return v_status;
  end if;

  perform 1 from public.organizations o where o.id = v_org_id for update;

  update public.usage_reservations
  set status = 'released', settled_at = now()
  where run_id = p_run_id and status = 'active'
  returning max_usd_micros into v_reserved;

  update public.usage_periods
  set reserved_usd_micros = greatest(reserved_usd_micros - coalesce(v_reserved, 0), 0),
      updated_at = now()
  where org_id = v_org_id and period_start = public.current_usage_period();

  update public.runs
  set status = 'cancelled', ended_at = now()
  where id = p_run_id;

  perform public.log_audit(v_org_id, 'user', 'run.cancelled', 'run', p_run_id, '{}'::jsonb);

  return 'cancelled'::public.run_status;
end;
$$;

-- -----------------------------------------------------------------------------
-- expire_stale_reservations — reclaim budget a crashed worker is holding
--
-- Without this, a worker that dies mid-run holds its reservation forever and
-- the organisation's cap shrinks by that much permanently. service_role only;
-- it is a maintenance task, not a customer action.
-- -----------------------------------------------------------------------------

create or replace function public.expire_stale_reservations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_row   record;
begin
  for v_row in
    select id, org_id, max_usd_micros
    from public.usage_reservations
    where status = 'active' and expires_at < now()
    order by org_id
    for update skip locked
  loop
    update public.usage_reservations
    set status = 'expired', settled_at = now()
    where id = v_row.id;

    update public.usage_periods
    set reserved_usd_micros = greatest(reserved_usd_micros - v_row.max_usd_micros, 0),
        updated_at = now()
    where org_id = v_row.org_id and period_start = public.current_usage_period();

    -- The run is finished as far as anyone can tell: nothing is going to report
    -- on it. Left 'running', it would sit in the UI forever.
    update public.runs
    set status = 'failed', error_code = 'RUN_ABANDONED', ended_at = now()
    where id = (select run_id from public.usage_reservations where id = v_row.id)
      and status in ('queued', 'running', 'awaiting_approval');

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- org_usage_summary — the numbers a billing screen shows
--
-- Membership-checked, for the same reason org_seat_usage is: a function that
-- takes any organisation id and returns its spend is a commercial-intelligence
-- oracle for every other tenant.
-- -----------------------------------------------------------------------------

create or replace function public.org_usage_summary(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cap bigint;
  v_row record;
begin
  if not public.has_org_role(p_org_id, array['owner', 'admin']::public.org_role[]) then
    raise exception 'ORG_ACCESS_DENIED' using errcode = 'insufficient_privilege';
  end if;

  select o.monthly_spend_cap_usd_micros into v_cap
  from public.organizations o where o.id = p_org_id;

  select coalesce(p.spent_usd_micros, 0) as spent,
         coalesce(p.reserved_usd_micros, 0) as reserved
  into v_row
  from (select 1) one
  left join public.usage_periods p
    on p.org_id = p_org_id and p.period_start = public.current_usage_period();

  return jsonb_build_object(
    'periodStart', public.current_usage_period(),
    'capUsdMicros', v_cap,
    'spentUsdMicros', coalesce(v_row.spent, 0),
    'reservedUsdMicros', coalesce(v_row.reserved, 0)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Execute privileges
-- -----------------------------------------------------------------------------

revoke execute on function public.current_usage_period() from public;
revoke execute on function public.start_run(uuid, jsonb, text) from public;
revoke execute on function public.settle_run(uuid, public.run_status, bigint, jsonb, text)
  from public, anon, authenticated;
revoke execute on function public.cancel_run(uuid) from public;
revoke execute on function public.expire_stale_reservations() from public, anon, authenticated;
revoke execute on function public.org_usage_summary(uuid) from public;

grant execute on function public.current_usage_period() to authenticated, service_role;
grant execute on function public.start_run(uuid, jsonb, text) to authenticated;
grant execute on function public.cancel_run(uuid) to authenticated;
grant execute on function public.org_usage_summary(uuid) to authenticated;

-- The execution plane only. These write spend.
grant execute on function public.settle_run(uuid, public.run_status, bigint, jsonb, text)
  to service_role;
grant execute on function public.expire_stale_reservations() to service_role;
