-- =============================================================================
-- 0001_identity_tenancy.sql — P1 identity and multi-tenancy schema
--
-- Source of truth: DATA_MODEL.md "Identity/tenancy" + "Usage and operations".
--
-- NOT APPLIED. Written for owner review. Applying this to any Supabase project
-- requires explicit owner approval (CLAUDE.md rule 3).
--
-- Design notes that differ from a naive implementation:
--
--   * No extensions are required. `gen_random_uuid()` is built into PostgreSQL 13+,
--     and token hashing happens in Node (see 0005), so neither pgcrypto nor citext
--     is needed. That keeps this file portable between the local verification
--     cluster and Supabase, and avoids operator-resolution hazards inside
--     SECURITY DEFINER functions that run with `search_path = ''`.
--
--   * Case-insensitive text (slug, email) is stored normalised to lower case and
--     enforced with a CHECK, instead of using citext. Comparisons are then plain
--     `text` equality, which resolves correctly under an empty search_path.
--
--   * Financial/quota fields are integers. No floating point anywhere.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
--
-- DATA_MODEL.md names these columns but specifies no values; the values below are
-- the owner-approved set (see docs/adr/0006-p1-schema-additions.md).
-- -----------------------------------------------------------------------------

create type public.org_role as enum ('owner', 'admin', 'member', 'viewer');

create type public.org_status as enum ('active', 'suspended');

create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');

create type public.platform_admin_role as enum ('support', 'operator', 'superadmin');

create type public.actor_type as enum ('user', 'platform_admin', 'system');

-- -----------------------------------------------------------------------------
-- organizations
-- -----------------------------------------------------------------------------

create table public.organizations (
  id         uuid primary key default gen_random_uuid(),

  -- Unique, URL-safe and lower-case from day one. This is what a future migration
  -- to org-scoped URLs (/app/[orgSlug]/...) would use; see ADR-0005.
  slug       text not null
             constraint organizations_slug_format
             check (slug = lower(slug) and slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'),

  name       text not null
             constraint organizations_name_length
             check (length(btrim(name)) between 2 and 120),

  locale     text not null default 'he'
             constraint organizations_locale_supported check (locale in ('he', 'en')),

  timezone   text not null default 'Asia/Jerusalem',

  status     public.org_status not null default 'active',

  -- Seat quota source for P1 only. The billing entitlement engine arrives in P5 and
  -- becomes the authority then (ADR-0006). Customers must never be able to raise this:
  -- 0003 withholds the UPDATE column privilege on it.
  --
  -- The default is 5, matching the Business tier's "Included org seats" in
  -- BILLING_AND_PLANS.md. A default of 1 would consume the only seat on the owner
  -- and make invitations — a core P1 deliverable — unusable out of the box, while
  -- protecting revenue that does not exist until P5.
  seat_limit integer not null default 5
             constraint organizations_seat_limit_positive check (seat_limit >= 1),

  created_at timestamptz not null default now(),

  constraint organizations_slug_unique unique (slug)
);

comment on column public.organizations.seat_limit is
  'P1 seat quota. Replaced by the P5 entitlement resolver. Not customer-updatable.';

-- -----------------------------------------------------------------------------
-- memberships
--
-- The authority for tenant access. Every RLS policy in this schema resolves
-- membership through this table (decision 1: SECURITY DEFINER + subquery).
-- -----------------------------------------------------------------------------

create table public.memberships (
  org_id     uuid not null references public.organizations (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.org_role not null,
  created_at timestamptz not null default now(),

  -- Satisfies DATA_MODEL.md's UNIQUE(org_id, user_id) and serves is_org_member().
  primary key (org_id, user_id)
);

-- Required by decision 1 so the membership subquery stays index-only.
create index memberships_user_org_idx on public.memberships (user_id, org_id);

-- Serves the owner-count invariant in 0004 and member lists filtered by role.
create index memberships_org_role_idx on public.memberships (org_id, role);

-- -----------------------------------------------------------------------------
-- profiles
--
-- Exists so a `viewer` can see who is in the organisation (display name + role)
-- without being granted any access to email addresses, which live in auth.users
-- and stay unreadable to clients. See ADR-0006.
-- -----------------------------------------------------------------------------

create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
               constraint profiles_display_name_length
               check (length(btrim(display_name)) between 1 and 80),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- invitations
--
-- Independent of Supabase's inviteUserByEmail(), which carries no org, role, seat
-- or expiry semantics. DATA_MODEL.md mandates token_hash, expires_at and status.
-- -----------------------------------------------------------------------------

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),

  org_id      uuid not null references public.organizations (id) on delete cascade,

  email       text not null
              constraint invitations_email_normalised
              check (email = lower(email) and position('@' in email) > 1),

  -- Ownership is transferred, never invited. Enforced here as well as in 0003,
  -- so no code path can create an owner invitation.
  role        public.org_role not null
              constraint invitations_role_not_owner
              check (role in ('admin', 'member', 'viewer')),

  -- SHA-256 of the raw token, computed in Node. The raw token never reaches the
  -- database, so it cannot appear in pg_stat_statements, query logs or errors.
  -- The length check makes storing a raw token or a weaker digest impossible.
  token_hash  bytea not null
              constraint invitations_token_hash_is_sha256
              check (octet_length(token_hash) = 32),

  expires_at  timestamptz not null,

  status      public.invitation_status not null default 'pending',

  -- Cascade: an invitation issued by a deleted user must not stay live.
  invited_by  uuid not null references auth.users (id) on delete cascade,

  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),

  constraint invitations_token_hash_unique unique (token_hash),

  -- Enables composite (org_id, id) foreign keys in later phases, per DATA_MODEL.md.
  constraint invitations_org_id_unique unique (org_id, id),

  -- Status and its timestamps cannot disagree.
  constraint invitations_accepted_fields check (
    (status = 'accepted') = (accepted_by is not null and accepted_at is not null)
  ),
  constraint invitations_revoked_fields check (
    (status = 'revoked') = (revoked_at is not null)
  )
);

-- At most one live invitation per address per organisation. Prevents a quota being
-- padded with duplicates for the same person.
create unique index invitations_one_pending_per_email_idx
  on public.invitations (org_id, email)
  where status = 'pending';

create index invitations_org_status_created_idx
  on public.invitations (org_id, status, created_at desc);

-- -----------------------------------------------------------------------------
-- platform_admins
--
-- A platform-scoped allowlist, explicitly "not an org role" (DATA_MODEL.md).
-- 0003 enables RLS on it and creates NO policies, and revokes all table
-- privileges from anon/authenticated: no client can read it through PostgREST in
-- any role. It is reachable only from src/modules/platform-admin/ with the secret
-- key, where every read is audited.
-- -----------------------------------------------------------------------------

create table public.platform_admins (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  role         public.platform_admin_role not null,

  -- Per-row, so MFA is enforced from database state rather than only from a
  -- project-wide Supabase setting. Defaults to required.
  mfa_required boolean not null default true,

  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- audit_events — append only
--
-- Deliberately carries NO foreign keys. An audit record must survive the thing it
-- describes, and an ON DELETE SET NULL would be an UPDATE, which the immutability
-- trigger in 0004 forbids. org_id stays nullable so platform-level actions can be
-- logged without an organisation (DATA_MODEL.md).
-- -----------------------------------------------------------------------------

create table public.audit_events (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid,
  actor_user_id     uuid,
  actor_type        public.actor_type not null,

  action            text not null constraint audit_events_action_present check (btrim(action) <> ''),
  entity_type       text not null
                    constraint audit_events_entity_type_present check (btrim(entity_type) <> ''),
  entity_id         uuid,

  metadata_redacted jsonb not null default '{}'::jsonb,

  created_at        timestamptz not null default now(),

  -- A structural guard for SECURITY.md 7 and QUALITY_GATES.md "audit redaction
  -- checks": an audit row physically cannot carry a credential-shaped key.
  constraint audit_events_no_secret_keys check (
    not (metadata_redacted ?| array[
      'token', 'token_hash', 'raw_token', 'password', 'secret',
      'api_key', 'apikey', 'authorization', 'access_token', 'refresh_token'
    ])
  )
);

create index audit_events_org_created_idx on public.audit_events (org_id, created_at desc);
create index audit_events_actor_created_idx on public.audit_events (actor_user_id, created_at desc);

comment on table public.audit_events is
  'Append only. No UPDATE/DELETE privilege or policy exists; 0004 adds a trigger that '
  'blocks both even for the table owner.';
