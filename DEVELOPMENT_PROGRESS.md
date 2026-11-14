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

## P2 begins: the agent schema

Four migrations, none applied to Supabase: `0006_agents.sql` (tables),
`0007_agents_rls.sql` (privileges and policies), `0008_agents_invariants.sql`
(triggers) and `0009_agents_rpc.sql` (`create_agent`, `publish_agent_version`,
`set_agent_archived`). `docs/adr/0008-p2-agent-schema.md` records the reasoning.

Three choices are worth knowing before reading the SQL:

**Version numbers are assigned at publish, not at draft creation.** `version` is
nullable with a CHECK tying it to `published_at`, so a row is either an
unnumbered draft or a numbered published version and nothing else can be
represented. Numbering drafts burns a number on every abandoned one and gives
two concurrent drafters the same number. Numbering at publish under
`select ... for update` removes the race instead of detecting it.

**The active-version pointer references `(agent_id, id)`, not `(org_id, id)`.**
That rejects an agent pointing at another agent's version, and org containment
follows transitively from `agent_versions`' own composite key. One key, both
guarantees, checked by PostgreSQL on every write — including one arriving
straight through PostgREST with a forged body.

**Immutability is enforced twice; deletion is not enforced at all.** The policy
keeps customers off published rows; a trigger repeats it for the service role
and the schema owner, which RLS does not constrain. There is deliberately no
DELETE trigger: deleting an organisation cascades to its versions, a trigger
cannot tell a cascade from a direct delete, and a DELETE guard would make
organisations undeletable — turning a rule about editing history into a block on
erasure requests.

`member` can publish; only `owner` and `admin` can archive. A team whose members
need an admin for every change is not what a five-seat business is buying, and
spend is bounded by P3's per-run budget caps rather than by who pressed publish.

**36 new checks, `PASS 93 FAIL 0 SKIP 0`**, still against local PostgreSQL 16
with the Supabase shim. They include both cross-tenant negatives, the full role
matrix, the withheld columns (`published_at`, `version`, `status`,
`active_version_id`), published-version immutability from both RLS and the
trigger, the three key-level rejections, and two concurrent publishes of the same
agent producing versions 1 and 2 with no duplicate and no spurious error.

Four of those checks failed on first run, all four for bugs in the tests rather
than in the schema: fixture agents were created as the schema owner, where
`create_agent()` correctly answers `AUTH_REQUIRED`, and two assertions were
reaching a different constraint than the one they named. Worth recording,
because a test that passes for the wrong reason is the failure mode this suite
exists to prevent.

---

## Agent Studio is real

`/app/agents` lists the organisation's agents and creates one; `/app/agents/[id]`
edits the draft, publishes a version and shows the published history. Five API
routes sit behind them, each guarded by `guardApi` and each delegating state
transitions to the RPCs rather than writing columns it has no privilege on.

The draft is saved leniently and validated strictly only at publish. That split
is the point: `AgentConfigSchema` requires ten characters of instructions, and
an editor that could not save four of them would lose the user's work every time
they stepped away mid-sentence. `validateForPublish()` is the single place the
strict gate is applied, and it names the fields that are missing so the error is
actionable rather than "publishing failed".

**The spend cap is edited in dollars and stored as integer micros.** The
conversion rounds to the nearest cent before scaling, so a typed `0.1` cannot
arrive as `100000.00000000001`. `DATA_MODEL.md` forbids floating point for money
and a float that reached a frozen version would be a rounding error nobody could
trace back.

**The provider and model pickers come from `MODEL_PROVIDERS`, and every option
says "not configured".** A banner above the form states that no provider is
connected, that an agent can be defined and published but not run, and that a
real provider arrives in P3. That is stated before anything is published rather
than discovered after.

### The P0 demo studio is gone, not left beside the real one

`/app/agents/studio` was a mock editor with every button disabled. With a working
editor at `/app/agents/[id]`, a second fake one under the same section is a trap
rather than a placeholder, so the route, its component and its dictionary block
were removed and the dashboard card now points at the real screen.

Its tests went with it except for the model-registry assertions, which moved to
`tests/unit/model-registry.test.ts`. Those are not a test of that screen — they
are the guarantee that nothing in this product can claim to run an agent until a
provider is actually configured, and deleting them along with the page they
happened to live in would have quietly dropped it.

### A bug the compiler caught, and one it did not

`onClick={saveDraft}` passed React's `MouseEvent` as the function's first
argument; TypeScript refused it. The one it could not catch: `publish()` called
`saveDraft()` and carried on regardless of the result, so a failed save would
have published the previously stored configuration while the screen showed the
newer one. It now stops.

---

## The template catalog, and the first table that is not tenant data

Three migrations (`0010`–`0012`), a development seed, an install route and
`/app/templates`. `docs/adr/0009-p2-template-catalog.md` records the reasoning.

Every table before this one is owned by an organisation and scoped by
`is_org_member`. A template is shared by every tenant, which inverts the risk:
the danger is not one tenant reading another's row, it is one tenant **writing**
a row that every other tenant then installs.

**Write access is withheld, not denied by a policy.** `global_templates` and
`global_template_versions` grant `select` and nothing else; there is no INSERT,
UPDATE or DELETE policy because there is no privilege for one to apply to. A
policy can be widened by a later `create policy` that reads innocuously in a
diff; re-granting needs someone to write `grant insert … to authenticated`,
which is a line a reviewer stops at. Six write attempts by an organisation owner
— insert, update and delete on both tables — are tested and refused.

**A draft template is invisible, not unlisted.** The versions table repeats the
visibility check rather than trusting the template to be hidden, because
otherwise a published version of a draft template would be readable through it —
and the definition is the part worth hiding. `install_template()` re-checks both
conditions too: it is `SECURITY DEFINER` and therefore not subject to the policy
at all, and a definer function that trusts its argument to have been filtered by
RLS is the standard way a hidden row becomes reachable.

**Install copies, it does not reference.** Three rows in one transaction, and
the copy is what makes the rest safe: the organisation edits its agent freely
because it is ordinary tenant data, and the platform can retire or republish
without touching what is already running in someone's workspace. Both directions
are tested.

**29 new checks; `PASS 122 FAIL 0 SKIP 0`.**

### A seed that would have worked on the second run

`supabase/seed/dev_templates.sql` first set every new template's
`active_version_id` to null while reporting success. The sub-statements of a
`WITH` clause share one snapshot and cannot see each other's effects on a target
table, so the final `UPDATE` could not see the templates the same statement had
just inserted. On any machine that had run the seed before, it would have
worked.

It is three statements now. The seed lives outside `supabase/migrations/` so
nothing that applies migrations can apply it by accident, and it says plainly
what it is: plausible first drafts, picker keys rather than real provider model
ids, and no provider connected — installing one produces an agent that can be
edited and published but not run.

---

## First run now ends with an agent, and a proxy hole closed

`/onboarding/start` is the second first-run step: install a template, or create
a blank agent. Creating an organisation lands there instead of on an empty
`/app`, and the step redirects to `/app` as soon as the organisation has one
agent — leaving it reachable afterwards would make it a second, worse copy of
`/app/templates`.

**There is deliberately no synthetic sample output.** `ROADMAP.md` P2 lists
"onboarding wizard with synthetic sample", and with no provider connected any
output would be hand-written text sitting where a run result goes — a
production dummy result, which `CLAUDE.md` rule 4 forbids. The screen says
plainly that an agent can be configured and published but not run, that real
runs arrive in P3, and that no simulated output is shown. A real sample becomes
possible when a run can produce one.

### The proxy was not covering the new route

`src/proxy.ts` gated onboarding with `pathname === "/onboarding"`, and the
matcher listed `/onboarding` without `:path*`. `/onboarding/start` therefore ran
outside the proxy entirely: no session redirect, and — the part that matters —
no CSRF cookie, so every button on the page would have been refused by the
double-submit check with nothing on screen explaining why.

Both are prefix-matched now. The regression test was checked the only way such a
test is worth anything: reverted the fix, watched the three assertions fail,
restored it.

---

## P3 begins: the money, before the model

Three migrations (`0013`–`0015`) and 37 new checks. `runs`, `run_steps`,
`usage_events`, `usage_reservations`, `usage_periods`, a per-tenant spend cap,
and the transactional reservation that enforces it.
`docs/adr/0010-p3-runtime-schema.md` records the reasoning.

Nothing here runs an agent. The executor and the provider adapter come next;
this is the part that has to be right before a single token is spent.

**Money is integer micros, and the unit is in the column name.**
`DATA_MODEL.md` sketches `budget_usd` / `spent_usd`; every one is
`*_usd_micros`. A cent is too coarse — per-token pricing puts a call below
$0.0001, and rounding each to a cent turns a real bill into zero. And
`budget_usd` holding `2000000` invites someone to read it as two million
dollars, which is a factor of a million in the direction nobody notices until
the invoice.

**The organisation row is the lock, always taken first.** The seat gate already
did this; the three new RPCs do the same. It gives one total order per tenant,
so a dispatch and a membership change cannot deadlock — and it avoids the upsert
race on `usage_periods`, where `insert … on conflict do nothing` followed by
`select … for update` can see nothing at all, because a concurrent uncommitted
insert is invisible to the select and does not block it.

**Reserved budget counts against the cap**, exactly as pending invitations count
against seats. Without it, N runs dispatched before any settles all see the same
headroom. Two concurrent dispatches against a cap with room for one produce
exactly one run and one `USAGE_LIMIT_REACHED`.

**Reservations expire, because workers die.** A crashed worker never settles or
releases, and the organisation's cap would shrink permanently — silently, and
more with each crash. The sweeper reclaims the budget and marks the run `failed`
with `RUN_ABANDONED`, because a run nobody will report on is finished whatever
its row says.

**Idempotency returns the run rather than raising.** A client retrying a
dispatch it is unsure about must get the same run back; "duplicate key" would
leave it unable to tell whether the first attempt worked, which is the exact
uncertainty the key exists to remove. Two concurrent dispatches with one key
produce one run and no error.

**Customers read; the execution plane writes.** No customer role can INSERT or
UPDATE any of the five tables. The trace is visible to everyone, including
viewers, and carries no prompt or completion text. Per-call spend and monthly
totals are owner and admin only. Reservations are visible to nobody — a
reservation is a number held mid-flight, and showing it would display spend that
may never happen.

### A test that would have passed while the bug shipped

The settlement check asserted that `spent` rose by the settled amount and that
`reserved` fell by the reservation. The first assertion passed; the second
caught that the earlier spend-cap block had already released every active
reservation in that organisation, so there was nothing left to free. Had the
test only checked `spent` — the obvious thing to check — a settlement that never
frees budget would have looked correct. The fix was a run of its own for that
test; the lesson is that the ledger has two sides and a test with one side is
half a test.

---

## Decisions on record

`docs/adr/0001` single app · `0002` admin boundary in P1, dashboards in P6 ·
`0003` MFA scope · `0004` local DB verification without Docker ·
`0005` active-organisation cookie and its two-tab limit ·
`0006` schema additions beyond `DATA_MODEL.md` · `0007` prepared OAuth path ·
`0008` P2 agent and version schema ·
`0009` P2 template catalog ·
`0010` P3 runtime schema and the money.

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
- **A production path for the catalog.** Templates are platform content and
  there is no way to publish one except inserting rows by hand until P6's Super
  Admin. In production the catalog is therefore empty, which is the right
  default for content every tenant sees, but it is a gap worth naming.
- The remaining `/app` section pages (agents, runs, workflows, …) still render
  P0 empty states inside a shell that is now real. The overview page has been
  corrected; the rest carry the same stale "not connected" wording.
