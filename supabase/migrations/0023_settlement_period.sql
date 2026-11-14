-- =============================================================================
-- 0023_settlement_period.sql — settle into the period the run was reserved in,
-- and make the cancelled-run branch idempotent
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
-- Forward-only: replaces three functions with identical signatures and grants.
--
-- FINDINGS (re-audit of 0015 / 0019)
--
-- 1. WRONG PERIOD ACROSS A MONTH BOUNDARY. start_run reserves budget in the
--    period of DISPATCH. settle_run, cancel_run and expire_stale_reservations
--    released it from current_usage_period() - the period of SETTLEMENT. For a
--    run dispatched before midnight on the 1st and settled after it:
--      - the old month's reserved_usd_micros was never released;
--      - the new month's was reduced by budget it never reserved (clamped at
--        0), so the new month showed more headroom than it had and a tenant
--        could exceed its cap by up to one run's budget;
--      - the spend landed in the new month.
--    Now every one of them uses the run's own period (its created_at month,
--    UTC - the same rule current_usage_period() applies at dispatch).
--
-- 2. 0019'S CANCELLED BRANCH WAS NOT IDEMPOTENT. A late worker settling a
--    cancelled run added p_cost to the run and the period each time it was
--    called; the executor retries settlement once, so a lost response could
--    count the cost twice. Now it records only the increase over what the run
--    already holds: calling it again with the same cost changes nothing.
--
-- DATA IT CHANGES: none. Function definitions only.
-- =============================================================================

-- The period a run belongs to: the month it was dispatched in, UTC.
create or replace function public.run_usage_period(p_run_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select date_trunc('month', r.created_at at time zone 'utc')::date
  from public.runs r where r.id = p_run_id;
$$;

revoke execute on function public.run_usage_period(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- settle_run
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
  v_current  public.run_status;
  v_spent    bigint;
  v_period   date;
  v_reserved bigint;
  v_delta    bigint;
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
  select r.status, r.spent_usd_micros into v_current, v_spent
  from public.runs r where r.id = p_run_id for update;

  -- ++ 0023: the run's own period, not today's.
  v_period := public.run_usage_period(p_run_id);

  if v_current in ('succeeded', 'failed') then
    return;
  end if;

  if v_current = 'cancelled' then
    -- ++ 0023: only the increase over what is already recorded, so a retried
    -- settlement with the same cost changes nothing.
    v_delta := greatest(p_cost_usd_micros - v_spent, 0);
    if v_delta > 0 then
      update public.usage_periods
      set spent_usd_micros = spent_usd_micros + v_delta, updated_at = now()
      where org_id = v_org_id and period_start = v_period;

      update public.runs
      set spent_usd_micros = spent_usd_micros + v_delta
      where id = p_run_id;
    end if;
    return;
  end if;

  update public.usage_reservations
  set status = 'settled', settled_at = now()
  where run_id = p_run_id and status = 'active'
  returning max_usd_micros into v_reserved;

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
-- cancel_run
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

  perform 1 from public.organizations o where o.id = v_org_id for update;
  -- Re-read under the lock: a settlement may have finished it meanwhile.
  select r.status into v_status from public.runs r where r.id = p_run_id for update;

  if v_status not in ('queued', 'running', 'awaiting_approval') then
    return v_status;
  end if;

  update public.usage_reservations
  set status = 'released', settled_at = now()
  where run_id = p_run_id and status = 'active'
  returning max_usd_micros into v_reserved;

  update public.usage_periods
  set reserved_usd_micros = greatest(reserved_usd_micros - coalesce(v_reserved, 0), 0),
      updated_at = now()
  where org_id = v_org_id and period_start = public.run_usage_period(p_run_id);

  update public.runs
  set status = 'cancelled', ended_at = now()
  where id = p_run_id;

  perform public.log_audit(v_org_id, 'user', 'run.cancelled', 'run', p_run_id, '{}'::jsonb);

  return 'cancelled'::public.run_status;
end;
$$;

-- -----------------------------------------------------------------------------
-- expire_stale_reservations
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
    select id, org_id, run_id, max_usd_micros
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
    where org_id = v_row.org_id and period_start = public.run_usage_period(v_row.run_id);

    update public.runs
    set status = 'failed', error_code = 'RUN_ABANDONED', ended_at = now()
    where id = v_row.run_id
      and status in ('queued', 'running', 'awaiting_approval');

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Grants are preserved by create or replace; restated so this file is
-- self-describing and so a re-created function cannot drift open to anon.
revoke execute on function public.settle_run(uuid, public.run_status, bigint, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.settle_run(uuid, public.run_status, bigint, jsonb, text)
  to service_role;
revoke execute on function public.cancel_run(uuid) from public, anon;
grant execute on function public.cancel_run(uuid) to authenticated;
revoke execute on function public.expire_stale_reservations() from public, anon, authenticated;
grant execute on function public.expire_stale_reservations() to service_role;
