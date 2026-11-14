-- =============================================================================
-- 01_supabase_shim.sql — LOCAL TEST SHIM
--
-- NEVER applied to Supabase. Supabase provides all of this itself; running this
-- against a real project would collide with GoTrue's own schema.
--
-- It exists so the P1 migrations can be exercised on a plain PostgreSQL 16
-- cluster: they reference auth.users, auth.uid() and auth.jwt(), which only
-- exist inside a Supabase project.
--
-- WHERE THE SIMULATION DIFFERS FROM THE REAL THING (ADR-0004):
--
--   * No JWT verification. Tests call set_config('request.jwt.claims', ...)
--     directly, so what is proven is what RLS does GIVEN a set of claims - not
--     that the claims are authentic. Signature, expiry and refresh-token
--     rotation are untested here.
--   * The `aal` claim is injected by hand. That AAL2 is only ever issued after
--     a genuinely verified second factor is a GoTrue property, untested here.
--   * auth.users has five columns, not GoTrue's full schema, and there are no
--     auth.identities, auth.sessions or auth.mfa_factors tables.
--   * No PostgREST, so HTTP-level behaviour and the schema cache are untested.
-- =============================================================================

create schema if not exists auth;

-- Minimal stand-in for GoTrue's auth.users: only the columns the P1 migrations
-- actually read. handle_new_user() reads id/email/raw_user_meta_data; the RPCs
-- in 0005 read email and email_confirmed_at.
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Supabase's own definitions, reproduced. They read the GUC that PostgREST
-- populates from the verified JWT; the tests set the same GUC directly.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim',  true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )
$$;

grant usage on schema auth to anon, authenticated, service_role;

-- service_role may read users, mirroring Supabase. anon and authenticated get
-- NOTHING on auth.users: email addresses stay unreadable to clients, which is
-- exactly why public.profiles exists.
grant select on auth.users to service_role;

-- -----------------------------------------------------------------------------
-- Supabase's default privileges
--
-- A real Supabase project ships with:
--
--   alter default privileges in schema public
--     grant all on tables, sequences, functions to anon, authenticated, service_role;
--
-- so every function a migration creates is EXECUTABLE BY anon AND authenticated
-- DIRECTLY - not through PUBLIC. `revoke execute ... from public` does not
-- touch a direct grant, so a migration that revokes only from public leaves
-- anon able to call the function in production.
--
-- This shim did not reproduce that, and the gap was real: twelve RPCs revoked
-- only from public. All twelve happen to reject an anonymous caller internally
-- (each checks auth.uid() first), so nothing was exploitable - but every
-- "anon cannot execute X" assertion in the suite was passing for the wrong
-- reason, and a future function that forgot its internal check would have been
-- anon-callable in production while passing every local test.
--
-- Scoped to the migrator role, because default privileges are per-grantor and
-- the migrations run as agentos_migrator here (as `postgres` does on Supabase).
-- -----------------------------------------------------------------------------
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
