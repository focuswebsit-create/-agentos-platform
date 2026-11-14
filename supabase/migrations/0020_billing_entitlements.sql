-- =============================================================================
-- 0020_billing_entitlements.sql — plans, subscriptions, and one entitlement answer
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
--
-- WHAT THIS ADDS (BILLING_AND_PLANS.md, DATA_MODEL.md "Billing and plan management")
--
--   plans / plan_versions     the catalog; versions are immutable once published
--   subscriptions             at most one EFFECTIVE subscription per organisation
--   subscription_events       every state change, with its cause
--   billing_webhook_events    provider event dedupe: UNIQUE (provider, event_id)
--   entitlement_overrides     time-boxed, reasoned, approved exceptions
--   effective_entitlements()  THE authoritative answer to "what may this org do"
--   start_run()               now asks it: monthly AI budget, concurrent runs,
--                             and whether runs are allowed at all
--
-- WHAT IT DOES NOT DO
--
--   No payment provider, no checkout, no webhook endpoint. Those need a chosen
--   merchant and its official documentation (CLAUDE.md rule 7). Every plan
--   version is inserted with purchasable = false: nothing here can be bought.
--   Subscriptions are written only by service_role - i.e. by a future,
--   signature-verified webhook processor - never by a customer and never on a
--   browser redirect.
--
-- BEHAVIOUR FOR EXISTING ORGANISATIONS: UNCHANGED
--
--   An organisation that has never had a subscription resolves to source
--   'pilot': its seat limit and monthly spend cap are exactly the columns it
--   has today, concurrency is not capped, and runs are allowed. So applying
--   this changes nothing for FOCUS or any other current organisation.
--
-- DATA IT CHANGES: inserts the three plans and their version 1 (reference
-- data, prices from BILLING_AND_PLANS.md, purchasable = false). No existing
-- row is updated or deleted.
-- =============================================================================

create type public.subscription_status as enum (
  'trialing', 'active', 'past_due', 'grace', 'suspended', 'canceled', 'expired'
);

-- -----------------------------------------------------------------------------
-- catalog
-- -----------------------------------------------------------------------------

create table public.plans (
  code         text primary key check (code in ('starter', 'business', 'pro')),
  public_label text not null check (length(public_label) between 1 and 60),
  active       boolean not null default true,
  sort_order   integer not null default 0
);

create table public.plan_versions (
  id                    uuid primary key default gen_random_uuid(),
  plan_code             text not null references public.plans (code),
  version               integer not null check (version > 0),
  -- Integer minor units, excluding VAT. DATA_MODEL.md forbids floats for money.
  price_minor           bigint not null check (price_minor >= 0),
  currency              text not null check (currency in ('ILS', 'USD')),
  billing_interval      text not null default 'month' check (billing_interval = 'month'),
  -- NULL = no fixed product-level count (anti-abuse limits still apply).
  max_seats             integer check (max_seats is null or max_seats > 0),
  max_concurrent_runs   integer check (max_concurrent_runs is null or max_concurrent_runs > 0),
  max_active_teams      integer check (max_active_teams is null or max_active_teams > 0),
  knowledge_bases       integer check (knowledge_bases is null or knowledge_bases > 0),
  -- Included direct model-cost ceiling per month. A budget, not credits.
  monthly_model_budget_usd_micros bigint not null check (monthly_model_budget_usd_micros >= 0),
  provider_price_id     text check (provider_price_id is null or length(provider_price_id) <= 200),
  -- Only true after sandbox verification and the owner's approval.
  purchasable           boolean not null default false,
  published_at          timestamptz not null default now(),
  constraint plan_versions_plan_version_key unique (plan_code, version)
);

-- A published price never changes: a customer's subscription points at a
-- version, and rewriting it would change what they agreed to pay. Only the
-- provider mapping and the purchasable switch may move.
create or replace function public.plan_versions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.plan_code, new.version, new.price_minor, new.currency, new.billing_interval,
      new.max_seats, new.max_concurrent_runs, new.max_active_teams, new.knowledge_bases,
      new.monthly_model_budget_usd_micros, new.published_at)
     is distinct from
     (old.plan_code, old.version, old.price_minor, old.currency, old.billing_interval,
      old.max_seats, old.max_concurrent_runs, old.max_active_teams, old.knowledge_bases,
      old.monthly_model_budget_usd_micros, old.published_at) then
    raise exception 'PLAN_VERSION_IMMUTABLE: publish a new version instead';
  end if;
  return new;
end;
$$;

create trigger plan_versions_immutable
  before update on public.plan_versions
  for each row execute function public.plan_versions_immutable();

create or replace function public.plan_versions_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'PLAN_VERSION_IMMUTABLE: plan versions are never deleted';
end;
$$;

create trigger plan_versions_no_delete
  before delete on public.plan_versions
  for each row execute function public.plan_versions_no_delete();

-- -----------------------------------------------------------------------------
-- subscriptions
-- -----------------------------------------------------------------------------

create table public.subscriptions (
  id                         uuid primary key default gen_random_uuid(),
  org_id                     uuid not null references public.organizations (id) on delete cascade,
  plan_version_id            uuid not null references public.plan_versions (id),
  provider                   text not null check (length(provider) between 1 and 40),
  provider_customer_id       text check (provider_customer_id is null or length(provider_customer_id) <= 200),
  provider_subscription_id   text check (provider_subscription_id is null or length(provider_subscription_id) <= 200),
  status                     public.subscription_status not null,
  trial_ends_at              timestamptz,
  current_period_start       timestamptz,
  current_period_end         timestamptz,
  cancel_at_period_end       boolean not null default false,
  scheduled_plan_version_id  uuid references public.plan_versions (id),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint subscriptions_provider_id_key unique (provider, provider_subscription_id),
  constraint subscriptions_trial_has_end check (status <> 'trialing' or trial_ends_at is not null),
  constraint subscriptions_org_id_key unique (org_id, id)
);

-- "One effective primary active subscription per org" (DATA_MODEL.md).
create unique index subscriptions_one_effective_per_org
  on public.subscriptions (org_id)
  where status in ('trialing', 'active', 'past_due', 'grace');

create table public.subscription_events (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  subscription_id uuid not null,
  old_state       public.subscription_status,
  new_state       public.subscription_status not null,
  cause           text not null check (length(cause) between 1 and 200),
  created_at      timestamptz not null default now(),
  constraint subscription_events_sub_fk
    foreign key (org_id, subscription_id) references public.subscriptions (org_id, id)
    on delete cascade
);
create index subscription_events_org_created_idx
  on public.subscription_events (org_id, created_at desc);

-- -----------------------------------------------------------------------------
-- provider webhook dedupe
-- -----------------------------------------------------------------------------

create table public.billing_webhook_events (
  id             uuid primary key default gen_random_uuid(),
  provider       text not null check (length(provider) between 1 and 40),
  event_id       text not null check (length(event_id) between 1 and 200),
  event_type     text check (event_type is null or length(event_type) <= 100),
  -- A digest of the verified raw body: enough to detect a replay with changed
  -- content, without storing the payload (which can carry personal data).
  payload_digest bytea not null,
  status         text not null default 'received'
                 check (status in ('received', 'processed', 'ignored', 'failed')),
  received_at    timestamptz not null default now(),
  processed_at   timestamptz,
  constraint billing_webhook_events_dedupe unique (provider, event_id)
);

-- -----------------------------------------------------------------------------
-- overrides
-- -----------------------------------------------------------------------------

create table public.entitlement_overrides (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  entitlement_key text not null check (entitlement_key in (
                    'max_seats', 'max_concurrent_runs', 'knowledge_bases',
                    'monthly_model_budget_usd_micros')),
  value           bigint not null check (value >= 0),
  reason          text not null check (length(btrim(reason)) between 3 and 500),
  approved_by     uuid not null references auth.users (id),
  -- Time-boxed by construction: an override that never expires is a plan
  -- change nobody priced.
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  constraint entitlement_overrides_future check (expires_at > created_at)
);
create index entitlement_overrides_org_key_idx
  on public.entitlement_overrides (org_id, entitlement_key, created_at desc);

-- -----------------------------------------------------------------------------
-- RLS and grants
-- -----------------------------------------------------------------------------

alter table public.plans enable row level security;
alter table public.plan_versions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_events enable row level security;
alter table public.billing_webhook_events enable row level security;
alter table public.entitlement_overrides enable row level security;

-- The catalog is public: the pricing page reads it signed out.
revoke all on public.plans, public.plan_versions from anon, authenticated;
grant select on public.plans, public.plan_versions to anon, authenticated;
create policy plans_read on public.plans for select to anon, authenticated using (active);
create policy plan_versions_read on public.plan_versions for select to anon, authenticated
  using (true);
grant select, insert, update on public.plans, public.plan_versions to service_role;

-- Billing is the owner's and admin's business (0003's matrix), never a
-- member's or viewer's. Customers read; only the platform writes.
revoke all on public.subscriptions, public.subscription_events from anon, authenticated;
grant select on public.subscriptions, public.subscription_events to authenticated;
create policy subscriptions_read on public.subscriptions for select to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));
create policy subscription_events_read on public.subscription_events for select to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));
grant select, insert, update on public.subscriptions, public.subscription_events to service_role;

-- Raw provider traffic: nobody but the platform, in any role.
revoke all on public.billing_webhook_events from anon, authenticated;
grant select, insert, update on public.billing_webhook_events to service_role;

revoke all on public.entitlement_overrides from anon, authenticated;
grant select on public.entitlement_overrides to authenticated;
create policy entitlement_overrides_read on public.entitlement_overrides for select to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));
grant select, insert on public.entitlement_overrides to service_role;

-- -----------------------------------------------------------------------------
-- the entitlement answer
-- -----------------------------------------------------------------------------

-- Internal: no caller check. Executable by nobody but its owner; start_run and
-- effective_entitlements() call it.
create or replace function public.org_entitlements(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org        record;
  v_sub        record;
  v_lapsed     boolean;
  v_result     jsonb;
  v_override   record;
  v_now        timestamptz := now();
begin
  select o.seat_limit, o.monthly_spend_cap_usd_micros into v_org
  from public.organizations o where o.id = p_org_id;
  if not found then
    return null;
  end if;

  select s.status, s.trial_ends_at, s.current_period_end, s.cancel_at_period_end,
         pv.plan_code, pv.version, pv.max_seats, pv.max_concurrent_runs,
         pv.knowledge_bases, pv.monthly_model_budget_usd_micros
    into v_sub
  from public.subscriptions s
  join public.plan_versions pv on pv.id = s.plan_version_id
  where s.org_id = p_org_id
    and s.status in ('trialing', 'active', 'past_due', 'grace');

  if found then
    v_result := jsonb_build_object(
      'source', 'subscription',
      'planCode', v_sub.plan_code,
      'planVersion', v_sub.version,
      'status', v_sub.status,
      -- An expired trial still in 'trialing' (the provider has not told us
      -- yet) does not get to keep running.
      'runsAllowed', not (v_sub.status = 'trialing' and v_sub.trial_ends_at <= v_now),
      'maxSeats', v_sub.max_seats,
      'maxConcurrentRuns', v_sub.max_concurrent_runs,
      'knowledgeBases', v_sub.knowledge_bases,
      -- The plan's allowance, or the organisation's own lower cap if it set one.
      'monthlyModelBudgetUsdMicros',
        least(v_sub.monthly_model_budget_usd_micros, v_org.monthly_spend_cap_usd_micros),
      'currentPeriodEnd', v_sub.current_period_end,
      'cancelAtPeriodEnd', v_sub.cancel_at_period_end
    );
  else
    select exists (select 1 from public.subscriptions s where s.org_id = p_org_id) into v_lapsed;
    v_result := jsonb_build_object(
      'source', case when v_lapsed then 'lapsed' else 'pilot' end,
      'planCode', null,
      'planVersion', null,
      'status', null,
      -- Had a subscription, none is effective now: keep the workspace readable,
      -- stop new runs (BILLING_AND_PLANS.md). Never had one: today's behaviour.
      'runsAllowed', not v_lapsed,
      'maxSeats', v_org.seat_limit,
      'maxConcurrentRuns', null,
      'knowledgeBases', null,
      'monthlyModelBudgetUsdMicros',
        case when v_lapsed then 0 else v_org.monthly_spend_cap_usd_micros end,
      'currentPeriodEnd', null,
      'cancelAtPeriodEnd', false
    );
  end if;

  -- The newest unexpired override per key wins.
  for v_override in
    select distinct on (eo.entitlement_key) eo.entitlement_key, eo.value
    from public.entitlement_overrides eo
    where eo.org_id = p_org_id and eo.expires_at > v_now
    order by eo.entitlement_key, eo.created_at desc
  loop
    v_result := v_result || jsonb_build_object(
      case v_override.entitlement_key
        when 'max_seats' then 'maxSeats'
        when 'max_concurrent_runs' then 'maxConcurrentRuns'
        when 'knowledge_bases' then 'knowledgeBases'
        else 'monthlyModelBudgetUsdMicros'
      end,
      v_override.value
    );
  end loop;

  return v_result;
end;
$$;

-- Public face: any member may ask about their own organisation, nobody else's.
create or replace function public.effective_entitlements(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_org_member(p_org_id) then
    raise exception 'ORG_ACCESS_DENIED' using errcode = 'insufficient_privilege';
  end if;
  return public.org_entitlements(p_org_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- start_run — supersedes 0016's definition
--
-- Differences from 0016, all marked "++ 0020": runs-allowed, the monthly
-- budget from entitlements instead of the bare column, and the concurrency cap.
-- All three are read under the organisation lock, so concurrent dispatches
-- cannot both slip under a limit.
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
  v_ent       jsonb;
  v_live      integer;
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

  select o.status into v_org_state
  from public.organizations o
  where o.id = v_org_id
  for update;

  if v_org_state = 'suspended' then
    raise exception 'ORG_SUSPENDED' using errcode = 'insufficient_privilege';
  end if;

  -- ++ 0020: one answer for every limit.
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
  -- -- end 0020

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

-- Function privileges. Supabase grants EXECUTE to anon DIRECTLY through default
-- privileges, so `from public` alone would leave it (see 0017).
revoke execute on function public.org_entitlements(uuid) from public, anon, authenticated;
revoke execute on function public.effective_entitlements(uuid) from public, anon;
grant execute on function public.effective_entitlements(uuid) to authenticated;
revoke execute on function public.plan_versions_immutable() from public, anon, authenticated;
revoke execute on function public.plan_versions_no_delete() from public, anon, authenticated;
-- start_run keeps 0015/0017's grants: authenticated only.
revoke execute on function public.start_run(uuid, jsonb, text) from public, anon;
grant execute on function public.start_run(uuid, jsonb, text) to authenticated;

-- -----------------------------------------------------------------------------
-- the catalog (reference data; prices are hypotheses, nothing is purchasable)
-- -----------------------------------------------------------------------------

insert into public.plans (code, public_label, sort_order) values
  ('starter', 'Starter', 1),
  ('business', 'Business', 2),
  ('pro', 'Pro', 3);

insert into public.plan_versions
  (plan_code, version, price_minor, currency, max_seats, max_concurrent_runs,
   max_active_teams, knowledge_bases, monthly_model_budget_usd_micros, purchasable)
values
  ('starter',  1,  29900, 'ILS',  1,  1,    1,  1,  5000000, false),
  ('business', 1,  79900, 'ILS',  5,  3,    5,  5, 20000000, false),
  ('pro',      1, 199000, 'ILS', 15, 10, null, 20, 60000000, false);
