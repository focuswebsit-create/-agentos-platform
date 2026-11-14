-- =============================================================================
-- 0019_settle_run_idempotent.sql — settling a run twice must not count twice
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
--
-- WHY
--
-- `settle_run()` (0015) finalised whatever run it was given. Called a second
-- time - by a retry, by stale-run recovery racing a late worker, or by a
-- worker finishing a run the user had already cancelled - it:
--
--   * overwrote the run's status, result and error with the second caller's;
--   * added the second cost to the period's spend again, so the tenant's cap
--     shrank by money nobody spent.
--
-- The application now claims runs atomically, so the common races are gone,
-- but a settlement path that is only correct when every caller behaves is the
-- kind of invariant this schema keeps in the database (see 0004, 0008).
--
-- WHAT CHANGES
--
--   * The run row is locked and its status re-read under the organisation lock.
--   * succeeded / failed: already final. Returns without changing anything.
--   * cancelled: `cancel_run()` already released the reservation. If the worker
--     reports a cost, the work WAS billed, so that cost is added to the run and
--     to the period - and the status stays `cancelled`, which is what the user
--     asked for.
--   * queued / running / awaiting_approval: exactly as before.
--
-- Same signature and return type, so `create or replace` suffices and every
-- existing grant (service_role only) is kept.
--
-- DATA IT CHANGES: none. Function definition only.
-- =============================================================================

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

  -- The organisation lock serialises every settlement, cancellation and
  -- dispatch in this tenant; the status read below is therefore current.
  perform 1 from public.organizations o where o.id = v_org_id for update;
  select r.status into v_current from public.runs r where r.id = p_run_id for update;

  v_period := public.current_usage_period();

  if v_current in ('succeeded', 'failed') then
    return;
  end if;

  if v_current = 'cancelled' then
    if p_cost_usd_micros > 0 then
      update public.usage_periods
      set spent_usd_micros = spent_usd_micros + p_cost_usd_micros,
          updated_at = now()
      where org_id = v_org_id and period_start = v_period;

      update public.runs
      set spent_usd_micros = spent_usd_micros + p_cost_usd_micros
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
