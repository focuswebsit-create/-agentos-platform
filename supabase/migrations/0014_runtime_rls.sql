-- =============================================================================
-- 0014_runtime_rls.sql — privileges and policies for the runtime tables
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
--
-- Customers READ their runs and WRITE none of them. Everything a run contains —
-- its status, its cost, its trace — is written by the execution plane, which
-- ARCHITECTURE.md keeps as a separate authority from the control plane. A
-- customer who could set `spent_usd_micros` could spend without paying, and one
-- who could set `status` could mark a failed run succeeded.
--
-- Dispatch and cancellation therefore go through RPCs in 0015, which check the
-- caller and the budget in the same transaction as the write.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- organizations.monthly_spend_cap_usd_micros
--
-- 0003 granted update on exactly (name, locale, timezone). A column added later
-- is not in that grant, so it is already unwritable by customers — this is here
-- to say so out loud, because "we never granted it" is easy to lose track of
-- after a few migrations, and the next person adding a column should see that
-- the question was asked.
-- -----------------------------------------------------------------------------

do $$
begin
  if has_column_privilege('authenticated', 'public.organizations',
                          'monthly_spend_cap_usd_micros', 'UPDATE') then
    raise exception
      'monthly_spend_cap_usd_micros is customer-updatable; it is the P3 spend cap and must not be';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- runs
-- -----------------------------------------------------------------------------

alter table public.runs enable row level security;
revoke all on public.runs from anon, authenticated;
grant select on public.runs to authenticated;
grant select, insert, update on public.runs to service_role;

create policy runs_select on public.runs
  for select to authenticated
  using (public.is_org_member(org_id));

-- No INSERT, UPDATE or DELETE for any customer role. start_run() dispatches,
-- cancel_run() stops; both are in 0015 and both check the caller themselves.

-- -----------------------------------------------------------------------------
-- run_steps — the trace
-- -----------------------------------------------------------------------------

alter table public.run_steps enable row level security;
revoke all on public.run_steps from anon, authenticated;
grant select on public.run_steps to authenticated;
grant select, insert, update on public.run_steps to service_role;

-- A viewer sees the trace. It carries step kinds, models, costs and a pointer
-- to a redacted trace — never prompt or completion text, which is why
-- redacted_trace_ref is a reference and summary_json is bounded. Watching what
-- the workspace is doing is the whole of a viewer's job.
create policy run_steps_select on public.run_steps
  for select to authenticated
  using (public.is_org_member(org_id));

-- -----------------------------------------------------------------------------
-- usage_events — append only, and readable by those who answer for the bill
-- -----------------------------------------------------------------------------

alter table public.usage_events enable row level security;
revoke all on public.usage_events from anon, authenticated;
grant select on public.usage_events to authenticated;
grant select, insert on public.usage_events to service_role;

-- owner and admin only, matching audit_events in 0003. Per-call spend is
-- commercial information about the organisation, and P1 settled that viewers
-- and members do not see billing.
create policy usage_events_select on public.usage_events
  for select to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

-- -----------------------------------------------------------------------------
-- usage_reservations — internal accounting
--
-- Readable by nobody but the execution plane. A reservation is a number held
-- mid-flight; it is not a fact about the organisation yet, and exposing it
-- would show spend that may never happen.
-- -----------------------------------------------------------------------------

alter table public.usage_reservations enable row level security;
revoke all on public.usage_reservations from anon, authenticated;
grant select, insert, update on public.usage_reservations to service_role;

-- RLS on, zero policies, as with platform_admins in 0003.

-- -----------------------------------------------------------------------------
-- usage_periods — the totals the cap is enforced against
-- -----------------------------------------------------------------------------

alter table public.usage_periods enable row level security;
revoke all on public.usage_periods from anon, authenticated;
grant select on public.usage_periods to authenticated;
grant select, insert, update on public.usage_periods to service_role;

-- owner and admin, same reasoning as usage_events: this is the monthly bill in
-- aggregate. `org_usage_summary()` in 0015 is how a screen reads it, so the
-- period row and the cap arrive together rather than the UI joining them.
create policy usage_periods_select on public.usage_periods
  for select to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));
