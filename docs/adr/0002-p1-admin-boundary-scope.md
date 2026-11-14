# ADR-0002 — Super Admin: build the boundary in P1, the dashboards in P6

- **Status:** Accepted (P1)
- **Date:** 2026-11-14

## Context
`ROADMAP.md` places Super Admin at **P6** ("MFA admin scope, overview/organizations/subscriptions/usage, safe suspension, audit"). P1 is "Auth + tenancy + UI shell". The owner asked for Super Admin in P1. `CLAUDE.md` rule 2 forbids silently widening a phase, and rule 14 asks for an ADR instead of overbuilding.

Doing nothing was not neutral either: P0 shipped `/admin/*` routes hidden only by `ADMIN_SHELL_PREVIEW`, an environment variable. A flag that exposes an admin surface when set to the wrong value is not a boundary.

## Decision
Split the phase along identity versus functionality.

**P1 builds the boundary only:**
- `platform_admins(user_id, role, mfa_required, active, created_at)`, with RLS enabled and **no policies**, plus privileges revoked from `anon`/`authenticated`.
- `requirePlatformAdmin()`: verified session → active `platform_admins` row → `aal2` when `mfa_required`.
- `ADMIN_SHELL_PREVIEW` removed entirely, not left as dead configuration.
- Every failure renders **404, not 403**.

**P6 builds what is behind it:** MRR, organisation tables, subscriptions, usage, suspension, support. Those need billing and usage data that does not exist until P5, so building them now would mean inventing numbers — banned by `CLAUDE.md` rule 4 and `SUPER_ADMIN.md`.

## Consequences
- No admin surface ships without authentication, at any point.
- `/admin/*` screens stay truthfully empty until P6.
- The P6 PR adds data and views to an access boundary that is already proven, instead of building both at once.
- Accepted cost: `/admin` is unreachable for everyone until the owner inserts the first `platform_admins` row and enrols TOTP (see `docs/SUPABASE_SETUP.md`). Failing closed is the intended behaviour.
