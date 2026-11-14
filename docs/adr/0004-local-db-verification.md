# ADR-0004 — Verifying migrations and RLS without Docker or Supabase

- **Status:** Accepted (P1)
- **Date:** 2026-11-14

## Context
RLS and cross-tenant isolation are release blockers (`SECURITY.md` 1), so the SQL has to be executed, not merely reviewed. The development environment cannot reach a database:

- no Docker daemon (client binary only), so `supabase start` is impossible;
- no DNS or raw TCP to `db.<ref>.supabase.co:5432` — all egress is an HTTPS CONNECT proxy;
- `api.supabase.com` is denied (403), so the Management API and the CLI are out;
- the owner's standing instruction: no migration applied to Supabase without approval.

## Decision
A dedicated, isolated PostgreSQL 16 cluster on the development machine:

- its own data directory and port, **no TCP listener at all** (`listen_addresses=''`, Unix socket only), `scram-sha-256`, never `trust`;
- three separate identities — `agentos_migrator` owns the schema, `agentos_tester` owns nothing so RLS applies to it, and `agentos_service_probe` is the only account that may `SET ROLE service_role`;
- `supabase/tests/01_supabase_shim.sql` supplies the `auth` schema, a minimal `auth.users`, and `auth.uid()`/`auth.jwt()`/`auth.role()`; it is **never** applied to Supabase;
- `tests/db/rls-suite.mjs` drives it through the `pg` driver, including two genuine concurrency tests.

## Consequences
- 57 checks run on every change, covering cross-tenant isolation, the role matrix, three escalation vectors, audit immutability, the last-owner invariant and the seat quota under two concurrent transactions.
- **The shim proves what RLS does GIVEN a set of claims. It does not prove the claims are authentic.** JWT signature, expiry, refresh rotation, GoTrue, PostgREST and email delivery remain unverified until the migrations are applied to Supabase Development.
- Divergence risk: the shim could drift from Supabase's real `auth` schema. It is deliberately tiny (one table, three functions) to keep that surface small.
