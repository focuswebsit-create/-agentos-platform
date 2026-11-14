-- =============================================================================
-- 0013_runtime.sql — runs, steps, and the usage ledger
--
-- Source of truth: DATA_MODEL.md "Agent + runtime" and "Usage and operations";
-- ARCHITECTURE.md "Run lifecycle" and "Concurrency/resilience"; ROADMAP.md P3
-- ("caps, trace, retry/cancel, transactional provider-cost reservations,
-- usage ledger"; gate: "per-tenant spend cap and idempotency pass").
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
--
-- MONEY IS INTEGER MICROS, EVERYWHERE.
--
-- DATA_MODEL.md: "financial values as integer minor units or fixed precision
-- numeric; NEVER floating point for invoices". Its column sketch names these
-- `budget_usd` / `spent_usd`; every one of them is `*_usd_micros` here, as a
-- bigint count of millionths of a dollar.
--
-- Two reasons, both recorded in docs/adr/0010-p3-runtime-schema.md. A cent is
-- too coarse for per-token model pricing, where a single call can cost less
-- than $0.0001 and rounding each one to a cent would turn a real bill into
-- zero. And the unit belongs in the name: `budget_usd` holding 2000000 is a
-- bug waiting for someone to read it as two million dollars, which is a factor
-- of a million in the direction nobody notices until the invoice.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Per-tenant spend cap
--
-- The same shape as `seat_limit` in P1, for the same reason: ROADMAP.md's P3
-- gate requires a per-tenant spend cap, the entitlement engine that should
-- supply it is P5, and a cap with no source cannot be enforced. Replaced by
-- `entitlementResolver` in P5; NOT customer-updatable, because 0014 grants no
-- privilege on the column.
--
-- $50/month by default: generous enough that development and the first real
-- customers are not fighting it, small enough that a runaway loop stops.
-- -----------------------------------------------------------------------------

alter table public.organizations
  add column monthly_spend_cap_usd_micros bigint not null default 50000000
    check (monthly_spend_cap_usd_micros >= 0);

comment on column public.organizations.monthly_spend_cap_usd_micros is
  'P3 spend cap source, in millionths of a dollar. Replaced by plan entitlements in P5. '
  'Customers have no column privilege on it.';

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

-- 'awaiting_approval' is P4 (approval requests). Declared now because the only
-- safe moment to add an enum value is before anything depends on the set, and a
-- status a run can reach is not something to retrofit under load.
create type public.run_status as enum (
  'queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled'
);

create type public.run_step_kind as enum ('model_call', 'tool_call', 'approval', 'system');

create type public.run_step_status as enum (
  'pending', 'running', 'succeeded', 'failed', 'skipped'
);

-- 'active'   — holding budget that has not been spent.
-- 'settled'  — the run reported what it actually cost.
-- 'released' — the run ended without spending it (cancelled, failed early).
-- 'expired'  — nobody settled or released it before expires_at. The sweeper
--              reclaims these; without the state, a crashed worker would hold
--              an organisation's budget hostage forever.
create type public.usage_reservation_status as enum ('active', 'settled', 'released', 'expired');

-- -----------------------------------------------------------------------------
-- runs
-- -----------------------------------------------------------------------------

create table public.runs (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade,
  agent_id           uuid not null,
  -- The PUBLISHED version this run executes, pinned at dispatch. CLAUDE.md
  -- rule 8: "published version pin". Editing the draft afterwards, or
  -- publishing a newer version, must not change what a finished run did.
  agent_version_id   uuid not null,
  initiator_user_id  uuid references auth.users (id) on delete set null,
  status             public.run_status not null default 'queued',
  -- P4. Declared so the column list matches DATA_MODEL.md's `workflow_ref`;
  -- the foreign key arrives with the workflows table.
  workflow_version_id uuid,

  input_json         jsonb not null default '{}'::jsonb,
  result_json        jsonb,
  error_code         text check (error_code is null or length(error_code) between 1 and 64),

  -- ARCHITECTURE.md "Concurrency/resilience": idempotency keys. Unique per
  -- organisation, so a client that retries a dispatch it is unsure about gets
  -- the same run rather than a second one that also costs money.
  idempotency_key    text check (idempotency_key is null or length(idempotency_key) between 8 and 200),

  budget_usd_micros  bigint not null check (budget_usd_micros > 0),
  spent_usd_micros   bigint not null default 0 check (spent_usd_micros >= 0),

  created_at         timestamptz not null default now(),
  started_at         timestamptz,
  ended_at           timestamptz,

  -- A run that has ended has an end time, and one that has not, has not. Both
  -- halves matter: without the first, a finished run can report no duration;
  -- without the second, a running one can claim to have finished.
  constraint runs_ended_consistent check (
    (status in ('succeeded', 'failed', 'cancelled')) = (ended_at is not null)
  ),
  constraint runs_started_before_ended check (
    started_at is null or ended_at is null or ended_at >= started_at
  ),

  constraint runs_agent_fk
    foreign key (org_id, agent_id) references public.agents (org_id, id) on delete cascade,
  constraint runs_version_fk
    foreign key (org_id, agent_version_id)
    references public.agent_versions (org_id, id),
  constraint runs_org_id_key unique (org_id, id)
);

-- DATA_MODEL.md: "Provide indexes on (org_id,status,created_at) for runs".
create index runs_org_status_created_idx on public.runs (org_id, status, created_at desc);
create index runs_org_agent_created_idx on public.runs (org_id, agent_id, created_at desc);

-- Partial, so a run without a key costs nothing. NULLs are distinct under a
-- unique constraint anyway, but the partial index also keeps it small.
create unique index runs_org_idempotency_key
  on public.runs (org_id, idempotency_key)
  where idempotency_key is not null;

-- -----------------------------------------------------------------------------
-- run_steps — the trace
-- -----------------------------------------------------------------------------

create table public.run_steps (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  run_id           uuid not null,
  step_index       integer not null check (step_index >= 0),
  kind             public.run_step_kind not null,
  status           public.run_step_status not null default 'pending',
  provider         text check (provider is null or length(provider) between 1 and 64),
  model            text check (model is null or length(model) between 1 and 120),
  -- What this step cost. Null while it is still running: zero would be a claim,
  -- and a claim of zero is the one that disappears from a bill.
  usage_usd_micros bigint check (usage_usd_micros is null or usage_usd_micros >= 0),
  -- A POINTER to a redacted trace, never the trace itself. SECURITY.md keeps
  -- prompt and completion content out of rows that support staff can read;
  -- DATA_MODEL.md calls the column `redacted_trace_ref` for the same reason.
  redacted_trace_ref text check (redacted_trace_ref is null or length(redacted_trace_ref) <= 400),
  -- Bounded, redacted summary for the trace view: step titles and counts, never
  -- prompt or completion text.
  summary_json     jsonb not null default '{}'::jsonb,
  error_code       text check (error_code is null or length(error_code) between 1 and 64),
  started_at       timestamptz,
  ended_at         timestamptz,
  created_at       timestamptz not null default now(),

  constraint run_steps_run_fk
    foreign key (org_id, run_id) references public.runs (org_id, id) on delete cascade,
  constraint run_steps_run_index_key unique (run_id, step_index),
  constraint run_steps_org_id_key unique (org_id, id)
);

create index run_steps_run_index_idx on public.run_steps (run_id, step_index);

-- -----------------------------------------------------------------------------
-- usage_events — append only
-- -----------------------------------------------------------------------------

create table public.usage_events (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  -- No cascade and no composite key to runs: a usage event outlives the run it
  -- came from, because it is what the organisation was charged for. Deleting a
  -- run must not erase the spend.
  run_id            uuid,
  step_id           uuid,
  provider          text not null check (length(provider) between 1 and 64),
  model             text not null check (length(model) between 1 and 120),
  -- Token counts and whatever else the provider reports. Shape varies by
  -- provider, which is why DATA_MODEL.md leaves it as jsonb.
  units_json        jsonb not null default '{}'::jsonb,
  cost_usd_micros   bigint not null check (cost_usd_micros >= 0),
  -- 'provider_reported' is authoritative; 'estimated' is our own rate-card
  -- arithmetic when the provider does not report cost. A bill built from
  -- estimates without saying so is a fabricated number.
  estimate_source   text not null default 'estimated'
                      check (estimate_source in ('provider_reported', 'estimated')),
  rate_card_version text check (rate_card_version is null or length(rate_card_version) <= 40),
  created_at        timestamptz not null default now()
);

create index usage_events_org_created_idx on public.usage_events (org_id, created_at desc);
create index usage_events_run_idx on public.usage_events (run_id) where run_id is not null;

-- -----------------------------------------------------------------------------
-- usage_reservations
--
-- DATA_MODEL.md: "unique active reservations per dispatch". Money is held
-- before the provider is called and released or settled afterwards, so two
-- concurrent runs cannot each see the same headroom and both spend it.
-- -----------------------------------------------------------------------------

create table public.usage_reservations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  run_id          uuid not null,
  max_usd_micros  bigint not null check (max_usd_micros > 0),
  status          public.usage_reservation_status not null default 'active',
  expires_at      timestamptz not null,
  settled_at      timestamptz,
  created_at      timestamptz not null default now(),

  constraint usage_reservations_run_fk
    foreign key (org_id, run_id) references public.runs (org_id, id) on delete cascade
);

create unique index usage_reservations_one_active_per_run
  on public.usage_reservations (run_id)
  where status = 'active';

create index usage_reservations_sweep_idx
  on public.usage_reservations (expires_at)
  where status = 'active';

-- -----------------------------------------------------------------------------
-- usage_periods — the row the spend cap is enforced against
--
-- `subscription_id` is nullable until P5 exists. DATA_MODEL.md keys this by
-- (org_id, subscription_id, period_start); with no subscriptions table the key
-- is (org_id, period_start), which is the same thing for an organisation that
-- has one subscription — and every organisation has at most one until P5
-- introduces the concept at all.
--
-- This is the single row every dispatch locks. Keeping it one row per month per
-- organisation is what makes the lock cheap and the ordering total.
-- -----------------------------------------------------------------------------

create table public.usage_periods (
  org_id            uuid not null references public.organizations (id) on delete cascade,
  period_start      date not null,
  subscription_id   uuid,
  spent_usd_micros  bigint not null default 0 check (spent_usd_micros >= 0),
  reserved_usd_micros bigint not null default 0 check (reserved_usd_micros >= 0),
  updated_at        timestamptz not null default now(),

  primary key (org_id, period_start)
);
