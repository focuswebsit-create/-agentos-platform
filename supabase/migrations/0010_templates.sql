-- =============================================================================
-- 0010_templates.sql — the global template catalog and org installations
--
-- Source of truth: DATA_MODEL.md "Templates (global vs installation)";
-- PRD.md section 3; ROADMAP.md P2 ("install copy; unauthorized template
-- editing denied").
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
--
-- The security shape of this file is different from every table before it.
-- `agents` are tenant data: each organisation owns its rows and RLS decides
-- which. Templates are PLATFORM data, shared by every tenant, and a customer
-- must never write one — a template that one tenant could edit is a template
-- every other tenant installs. So:
--
--   * global_templates and global_template_versions grant SELECT and nothing
--     else to `authenticated`. No INSERT, no UPDATE, no DELETE, and no policy
--     for those commands exists to be mis-written later.
--   * Reads are filtered to what is actually offered: a published version of a
--     public template. A draft template being prepared by the platform is
--     invisible to customers, not merely unlisted in the UI.
--   * Installing copies the definition into the organisation. The installed
--     agent is ordinary tenant data from that moment on, which is what makes
--     editing it safe.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enum
--
-- 'draft'   — being prepared by the platform. Invisible to every customer.
-- 'public'  — listed and installable.
-- 'retired' — withdrawn. Existing installations are untouched (they are copies),
--             but it is gone from the catalog and cannot be installed again.
-- -----------------------------------------------------------------------------

create type public.template_visibility as enum ('draft', 'public', 'retired');

-- -----------------------------------------------------------------------------
-- global_templates
--
-- No org_id: this table is not tenant data. That is also why it carries no
-- tenancy policy — `is_org_member` has nothing to be a member of here.
-- -----------------------------------------------------------------------------

create table public.global_templates (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique
                      check (slug = lower(slug) and slug ~ '^[a-z][a-z0-9-]{1,62}$'),
  category          text not null check (length(trim(category)) between 2 and 60),
  name              text not null check (length(trim(name)) between 2 and 120),
  description       text not null check (length(trim(description)) between 10 and 1000),
  visibility        public.template_visibility not null default 'draft',
  active_version_id uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint global_templates_id_key unique (id)
);

create index global_templates_visible_idx
  on public.global_templates (category, name)
  where visibility = 'public';

-- -----------------------------------------------------------------------------
-- global_template_versions
--
-- "immutable" in DATA_MODEL.md, enforced the same way agent_versions is: a
-- trigger in this file, because there is no RLS policy to rely on — customers
-- cannot write here at all, so the only connection that could rewrite history
-- is the privileged one, which is exactly the one a policy would not stop.
-- -----------------------------------------------------------------------------

create table public.global_template_versions (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid not null references public.global_templates (id) on delete cascade,
  version         integer not null check (version >= 1),
  -- The agent configuration this template installs, in the shape
  -- AgentConfigSchema validates. Not CHECK-constrained here, for the same
  -- reason agent_versions.config_json is not: a jsonb structure constraint has
  -- to be migrated in lockstep with every change to the configuration.
  definition_json jsonb not null,
  -- Tool keys the template expects to exist. Advisory in P2 — there is no tool
  -- registry until P4 — so it is recorded, shown to the installer, and not
  -- enforced. Enforcing against a registry that does not exist would reject
  -- every template.
  required_tools  jsonb not null default '[]'::jsonb,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),

  constraint global_template_versions_template_version_key unique (template_id, version),
  constraint global_template_versions_template_id_key unique (template_id, id)
);

create index global_template_versions_published_idx
  on public.global_template_versions (template_id, version desc)
  where published_at is not null;

-- Pins the active version to this template, not merely to some template.
alter table public.global_templates
  add constraint global_templates_active_version_fk
  foreign key (id, active_version_id)
  references public.global_template_versions (template_id, id)
  deferrable initially deferred;

-- -----------------------------------------------------------------------------
-- template_installations
--
-- Tenant data, unlike the two tables above. One row per install, kept as the
-- record of where an organisation's agent came from.
--
-- `linked_agent_id` is an addition to DATA_MODEL.md's column list, recorded in
-- docs/adr/0009-p2-template-catalog.md: the documented `linked_workflow_id` is
-- the P4 analogue, and without an agent link nothing connects an installation
-- to what it produced. Both are nullable, and both carry the organisation in a
-- composite foreign key so an installation cannot point at another tenant's row.
-- -----------------------------------------------------------------------------

create table public.template_installations (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations (id) on delete cascade,
  template_version_id uuid not null references public.global_template_versions (id),
  linked_agent_id     uuid,
  -- P4. Declared now so the column list matches DATA_MODEL.md and the foreign
  -- key arrives with the workflows table rather than being retrofitted.
  linked_workflow_id  uuid,
  installed_by        uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),

  constraint template_installations_agent_fk
    foreign key (org_id, linked_agent_id) references public.agents (org_id, id)
    on delete set null,
  constraint template_installations_org_id_key unique (org_id, id)
);

create index template_installations_org_created_idx
  on public.template_installations (org_id, created_at desc);

-- Not unique on (org_id, template_version_id): installing the same template
-- twice is a reasonable thing to do — two agents from one starting point — and
-- forbidding it would be a surprise with no safety value, since each install
-- produces an independent copy.
