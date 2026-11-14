# AgentOS — development progress

Living status file. Update it after every milestone so a new session can pick
up without re-deriving context.

**Last updated:** 2026-11-14
**Branch:** `claude/agentos-p1-infrastructure-9gibn2`
**Last commit:** see `git log -1` (P1: `ae6e48a`, `01cfb60`, `59c4e5b`, plus the hardening commit below)

---

## Where the product is

| Phase | Scope | Status |
|---|---|---|
| **P0** | Scaffold, CI, premium RTL marketing + shells | ✅ Complete, on `main` |
| **P1** | Auth, organisations, memberships, invitations, RLS, admin boundary | ✅ Code complete, ⚠️ unverified against Supabase |
| **P2** | Agents + template library | ⬜ Not started |
| **P3** | Runtime, one real model provider, usage ledger | ⬜ Not started |
| **P4** | Teams, knowledge, approvals | ⬜ Not started |
| **P5** | Subscriptions, entitlements, checkout, webhooks | ⬜ Not started |
| **P6** | Super Admin dashboards and analytics | ⬜ Not started (boundary built in P1) |
| **P7** | Security, UAT, launch readiness | ⬜ Not started |

---

## P1 — what works

Sign up → confirm email → sign in → create organisation → invite by link →
accept invitation → change roles → remove members → switch workspace.
`/admin` is gated by an active `platform_admins` row plus AAL2.

Enforcement is layered and each layer is independent:

1. `src/proxy.ts` — session refresh, turns away requests with no session
2. `resolveOrgContext()` — membership and role re-read from the database every request
3. `guardApi()` — role matrix, CSRF, stale-organisation detection
4. **RLS** — the authority; proven by 57 checks
5. Constraints, triggers and row locks — invariants under concurrency

---

## Test results

| Gate | Result |
|---|---|
| `npm run lint` | 0 |
| `npm run typecheck` | 0 |
| `npm run format:check` | 0 |
| `npm test` | 131 passed (10 files) |
| `npm run build` | 0 — 39 routes |
| `npm run test:e2e` | 18 passed, run with NO Supabase credentials |
| `tests/db/rls-suite.mjs` | 57 passed, 0 failed, 0 skipped |
| `npm audit --omit=dev` | 0 vulnerabilities |

**Precise wording for RLS:** the 57 checks ran against a **local PostgreSQL 16
with a Supabase compatibility shim — not against Supabase.**

The E2E suite runs with **no** Supabase credentials, which also proves safe
degradation: public site serves, auth screens say they are unavailable,
private routes redirect, `/admin` answers 404 — never 500.

**gitleaks does not run locally** (not installed in the dev image), so the
local pre-commit scan reports INCOMPLETE, never PASS. CI was only triggered by
pull requests and pushes to `main`, which meant the full scan had never run on
this branch at all; the workflow now also triggers on `claude/**`.

**CI run 3 on `2cdb20e`: both jobs green.** Secret scan (gitleaks v8.30.1,
full history) success; Lint · Typecheck · Format · Unit · Build · E2E all
success. That closes the gap the local INCOMPLETE verdict leaves open.

---

## NOT verified — never reported as passing

| # | What | Why |
|---|---|---|
| 1 | JWT authenticity: signature, expiry, refresh rotation | the shim injects claims directly |
| 2 | `aal2` follows a genuinely verified second factor | a GoTrue property |
| 3 | GoTrue sign-up, sign-in, confirmation, recovery | no GoTrue locally |
| 4 | Email delivery | no provider configured |
| 5 | Real TOTP enrolment | needs a device and a live session |
| 6 | PostgREST behaviour and schema cache | no PostgREST locally |
| 7 | Two-organisation isolation end to end through the UI | needs real sessions |
| 8 | Password policy, leaked-password protection | dashboard settings |

---

## Blockers — owner action required

| # | Blocker | Blocks |
|---|---|---|
| 1 | **Confirm the `krys…` project is `AgentOS-Development`.** Nothing inside the container can establish this, and applying a migration to the wrong project is irreversible | everything below |
| 2 | Apply migrations `0001`–`0005` to Supabase Development | items 3–7 of "not verified" |
| 3 | Create `SUPABASE_SECRET_KEY` | `/admin` (fails closed without it) |
| 4 | Configure custom SMTP | sign-up, password reset |
| 5 | Insert the first `platform_admins` row + enrol TOTP | `/admin` access |
| 6 | Choose an email provider for invitations, or keep copy-link | automatic invitations |
| 7 | Privacy policy and terms before real sign-ups (`SECURITY.md` 10, Amendment 13) | public launch |

Steps for 1–5 are in `docs/SUPABASE_SETUP.md`.

---

## Hardening pass (after the first three P1 commits)

Four defects found by running things rather than reading them:

1. **Unhandled rejection crashed the reset-password screen.** `getClaims()`
   inside a `useEffect` with no `.catch` — a dropped connection replaced the
   form with the browser's "this page couldn't load". Found by E2E.
2. **Missing Supabase configuration answered 500 everywhere**, including
   `/admin`, which both broke the site and advertised the misconfiguration.
   Now degrades: public site serves, auth screens say so, private routes
   redirect, `/admin` answers 404.
3. **`listMemberships` was missing its degradation guard** — the import was
   added but the check was not. Caught by `no-unused-vars`, which is exactly
   the kind of thing a zero-warning lint policy is for.
4. **Six components each read the CSRF cookie themselves.** One copy drifting
   would silently unprotect an endpoint. Replaced with a single `sendJson()`
   that attaches the token and never throws.

`/onboarding` is now gated at the proxy alongside `/app`, instead of
redirecting from inside the page.

---

## Organisation settings, and a gate that could lie

`/app/settings` now renames an organisation and sets its locale and timezone,
behind `PATCH /api/orgs`. Until now an organisation could be created and never
corrected, which made the name a one-shot decision at signup.

`UpdateOrgSchema` accepts `name`, `locale` and `timezone` and nothing else.
`seat_limit` and `status` are absent on purpose: migration 0003 grants
`update (name, locale, timezone)` only, so a request carrying either would be
refused by PostgreSQL regardless. The schema and the grant say the same thing,
and the database is the one that enforces it.

The form first shipped with `locale` and `timezone` hardcoded to `"he"` and
`"Asia/Jerusalem"` because `OrgContext` did not carry them — so an organisation
that had set anything else would have seen the defaults, and saving the form
would have silently reset its real values. `resolveOrgContext()` now selects
both columns and passes them through. Members can read them: 0003 grants
`select` on the whole table, and withholds columns only on `update`.

`team` and `settings` no longer carry a "P1" phase marker in the sidebar; they
are built. `tests/unit/navigation.test.ts` was rewritten to assert the rule in
both directions — a delivered section must carry no marker, and an unbuilt one
must say which phase delivers it — so the next delivered page fails the test
until its marker is removed, instead of advertising a finished feature as
pending forever.

### The RLS gate was reporting on the wrong schema

Re-running `tests/db/rls-suite.mjs` produced 5 failures that were not
regressions: `log_platform_audit` and the `service_role` grant on
`platform_admins` had been added to the migration files after the local
database was last built, so the suite was testing an older schema than the one
in the repository.

Five false failures are a nuisance. The same gap in the other direction is not:
a policy deleted from a migration would keep passing, because the old one is
still sitting in the cluster. The suite never created the schema it tested.

`scripts/db-reapply.sh` now rebuilds `public` and `auth` from
`supabase/tests/01_supabase_shim.sql` plus every `supabase/migrations/*.sql`,
one transaction per file under `ON_ERROR_STOP`, and `npm run test:rls` runs it
before the suite. It refuses to start unless `PGHOST` is a unix socket path and
`PGDATABASE` is the disposable test database by name — the verification cluster
has no TCP listener, so a hostname there would mean the target is something
else, and the something else this must never reach is a Supabase project.

After the rebuild: **PASS 57 FAIL 0 SKIP 0**, against local PostgreSQL 16 with
the Supabase shim — not against Supabase.

---

## Decisions on record

`docs/adr/0001` single app · `0002` admin boundary in P1, dashboards in P6 ·
`0003` MFA scope · `0004` local DB verification without Docker ·
`0005` active-organisation cookie and its two-tab limit ·
`0006` schema additions beyond `DATA_MODEL.md` · `0007` prepared OAuth path.

---

## Next task

**UI-level two-organisation E2E against Supabase Development**, once blockers
1–4 clear: sign up → confirm → create organisation → invite → accept from a
second account → prove the second account cannot read the first organisation.

That closes "not verified" items 3 and 7 and completes the `ROADMAP.md` P1
gate at the UI layer, not only at the database layer.

**Only then P2** (agents and template library). Starting P2 before the P1
chain is proven end to end would build on an untested foundation.

### Independent of the blockers, and safe to start now
- **P2 groundwork: `agents` / `agent_versions` migrations with RLS**, following
  the same layered pattern, verified on the local cluster with
  `npm run test:rls`. This is the next task in progress.
- The remaining `/app` section pages (agents, runs, workflows, …) still render
  P0 empty states inside a shell that is now real. The overview page has been
  corrected; the rest carry the same stale "not connected" wording.
