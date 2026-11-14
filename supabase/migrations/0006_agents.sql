-- =============================================================================
-- 0006_agents.sql — P2 agent definitions and their versions
--
-- Source of truth: DATA_MODEL.md "Agent + runtime" and "Integrity requirements";
-- PRD.md section 5 (Agent Studio); ROADMAP.md P2.
--
-- NOT APPLIED. Written for owner review. Applying this to any Supabase project
-- requires explicit owner approval (CLAUDE.md rule 3).
--
-- Two integrity rules from DATA_MODEL.md drive the whole shape of this file:
--
--   "Org foreign-key containment: a run cannot reference a different org's
--    agent/version"
--   "Published versions cannot be mutated in place"
--
-- Both are enforced here by keys rather than by application code. A composite
-- foreign key is checked by PostgreSQL on every write, including a write that
-- arrives directly through PostgREST with a forged body; a check in a route
-- handler is only as good as the route the caller happened to use.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enum
--
-- 'draft'     — never published; freely editable.
-- 'published' — has at least one published version and an active one selected.
-- 'archived'  — withdrawn from use. NOT deleted: SECURITY.md 4 forbids silent
--               deletion of records that runs and invoices will refer back to.
-- -----------------------------------------------------------------------------

create type public.agent_status as enum ('draft', 'published', 'archived');

-- -----------------------------------------------------------------------------
-- agents
-- -----------------------------------------------------------------------------

create table public.agents (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  name              text not null check (length(trim(name)) between 2 and 120),
  description       text check (description is null or length(description) <= 500),
  status            public.agent_status not null default 'draft',
  -- Set only by publish_agent_version() in 0009. The foreign key that pins it to
  -- this agent is added at the bottom of this file, once agent_versions exists.
  active_version_id uuid,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Redundant against the primary key, and deliberately so: it is the target a
  -- composite foreign key needs in order to carry org_id along. Every later
  -- table that points at an agent (team_members, runs, run_steps) will reference
  -- (org_id, id), so the database itself refuses a cross-org reference.
  constraint agents_org_id_key unique (org_id, id)
);

create index agents_org_status_created_idx
  on public.agents (org_id, status, created_at desc);

comment on column public.agents.active_version_id is
  'The published version this agent currently runs. NULL until first publish. '
  'Written only by publish_agent_version(); customers have no column privilege on it.';

-- -----------------------------------------------------------------------------
-- agent_versions
--
-- An immutable snapshot of an agent''s configuration once published. config_json
-- holds what PRD.md section 5 lists for Agent Studio: provider, model, prompt,
-- tool allowlist, max_steps, max_spend. Its shape is validated in the
-- application with Zod and will be schema-versioned in P3, when a runtime
-- actually reads it; the column is deliberately not constrained to one shape
-- here, because a CHECK on jsonb structure would have to be migrated in lockstep
-- with every config change.
-- -----------------------------------------------------------------------------

create table public.agent_versions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  agent_id     uuid not null,

  -- Nullable, and numbered only at publish time. Assigning a number when the
  -- draft is created would burn a number on every abandoned draft, and would
  -- make two people drafting at once collide on a number neither has published.
  version      integer check (version is null or version >= 1),
  config_json  jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),

  -- Numbered exactly when published. The two states this allows are "draft"
  -- and "published"; a numbered draft or an unnumbered published version are
  -- both unrepresentable rather than merely unexpected.
  constraint agent_versions_numbered_when_published check (
    (published_at is null and version is null)
    or (published_at is not null and version is not null)
  ),

  -- DATA_MODEL.md: UNIQUE(agent_id, version). NULLs are distinct under a unique
  -- constraint, so this constrains published versions and leaves drafts alone.
  -- Version numbers are assigned under a row lock in 0009; this constraint is
  -- what makes that assignment safe rather than merely likely.
  constraint agent_versions_agent_version_key unique (agent_id, version),

  -- Org containment, enforced by the key: a version cannot be filed under a
  -- different organisation than the agent it belongs to. Without the composite
  -- reference, org_id here would be a free-text claim.
  constraint agent_versions_agent_fk
    foreign key (org_id, agent_id) references public.agents (org_id, id) on delete cascade,

  -- Targets for composite references from later tables, and from
  -- agents.active_version_id below.
  constraint agent_versions_org_id_key unique (org_id, id),
  constraint agent_versions_agent_id_key unique (agent_id, id)
);

create index agent_versions_org_agent_version_idx
  on public.agent_versions (org_id, agent_id, version desc);

-- Exactly one editable draft per agent, enforced rather than assumed. The RPCs
-- in 0009 maintain the invariant (publishing a draft immediately opens a fresh
-- one), and this index is what makes a bug in them fail loudly instead of
-- leaving two drafts that overwrite each other.
create unique index agent_versions_one_draft_per_agent
  on public.agent_versions (agent_id)
  where published_at is null;

-- Published versions, newest first: the lookup P3's runtime will make on every
-- dispatch. Partial, because unpublished drafts are never a dispatch target.
create index agent_versions_published_idx
  on public.agent_versions (agent_id, published_at desc)
  where published_at is not null;

-- -----------------------------------------------------------------------------
-- The active-version pointer
--
-- References (agent_id, id), not (org_id, id). That is the stronger of the two:
-- it rejects an agent pointing at some *other* agent's version, and org
-- containment then follows transitively, because agent_versions.agent_fk already
-- pins the version's org to the agent's org.
--
-- MATCH SIMPLE (the default) matters here: with active_version_id NULL the
-- constraint is not checked at all, which is what lets a draft agent exist with
-- no published version. MATCH FULL would reject every draft.
--
-- DEFERRABLE INITIALLY DEFERRED because the reference is circular: deleting an
-- agent cascades to its versions while the agent row still points at one of
-- them. Checking at commit, when both are gone, is the only ordering that works.
-- -----------------------------------------------------------------------------

alter table public.agents
  add constraint agents_active_version_fk
  foreign key (id, active_version_id) references public.agent_versions (agent_id, id)
  deferrable initially deferred;
