# Deployment — what a Vercel Preview needs, and what it will do without it

This answers two questions that came up when the preview deployment's sign-in
screen appeared to hang: which environment variables a deployment needs, and
what the application does when each one is missing.

Nothing here applies a migration or changes a cloud setting. Every item marked
**owner** is a step only the owner can take.

## 1. Environment variables

| Variable | Needed for | Without it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | everything behind a login | The auth screens render "ההתחברות אינה זמינה כרגע" and name the two missing variables. No form is shown. `/app/*` redirects to sign-in, `/admin/*` answers 404. The marketing site is unaffected. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | as above | as above |
| `SUPABASE_SECRET_KEY` | Super Admin, the run executor, the reservation sweeper | `/admin/*` answers 404 even to a real administrator. A dispatched run cannot settle and is reclaimed by the sweeper as `RUN_ABANDONED`. Customer screens are unaffected. |
| `AGENTOS_CRON_SECRET` | the reservation sweeper | `/api/internal/sweep-reservations` answers 404 to everyone, so nothing reclaims budget from crashed runs. **Required in any deployment that executes runs.** At least 24 characters; shorter is treated as absent. |
| `AGENTOS_ENABLE_MOCK_PROVIDER` | running an agent in a non-production environment | No provider is registered, so a run fails with `PROVIDER_NOT_CONFIGURED`. This is the correct production state. Set it to `1` on previews only. |
| `NEXT_PUBLIC_SITE_URL` | CSRF origin checks, email redirect links | Falls back to the request's own origin, which is correct on Vercel but means an email link may point at a preview URL rather than the canonical one. |

`.env.example` is the authoritative list and carries the same notes.

### Setting them for Preview specifically

Vercel scopes variables per environment. A variable set only for Production is
**absent** on Preview deployments, which produces exactly the "identity service
is not configured" screen above. In Vercel: Project → Settings → Environment
Variables → tick **Preview** (and **Development**, if you run `vercel dev`).

## 2. Migration status — none applied

All **sixteen** migrations in `supabase/migrations/` are written, reviewed and
verified against a local PostgreSQL 16 cluster with a Supabase compatibility
shim. **None has been applied to any Supabase project**, because `CLAUDE.md`
rule 3 requires explicit owner approval and it has not been given.

| File | What it creates |
|---|---|
| `0001_identity_tenancy.sql` | organisations, memberships, profiles, invitations, platform_admins, audit_events |
| `0002_rls_helpers.sql` | `is_org_member`, `has_org_role`, `log_audit`, `log_platform_audit` |
| `0003_rls_policies.sql` | RLS and column privileges for the identity tables |
| `0004_invariants.sql` | last-owner guard, seat gate, audit immutability, `handle_new_user` |
| `0005_rpc.sql` | `create_organization`, `accept_invitation`, `transfer_ownership` |
| `0006`–`0009` | agents and agent versions: tables, RLS, invariants, lifecycle RPCs |
| `0010`–`0012` | the global template catalog and `install_template` |
| `0013`–`0015` | runs, trace, usage ledger, spend cap, dispatch and settlement |
| `0016_suspension.sql` | suspension that actually blocks runs, with a reason |

### What a deployment does today, with the variables set but no migrations

- Sign-in and sign-up **screens work**, and the requests reach Supabase Auth.
- Sign-up creates an `auth.users` row. The `handle_new_user` trigger does not
  exist yet, so no `profiles` row is created with it.
- **Creating an organisation fails**: `create_organization()` does not exist.
  That is the first wall, and everything past it — agents, templates, runs — is
  behind it.

So the honest summary is: authentication can be exercised; the product cannot.

### Applying them — **owner**

Review the SQL, then run the files in numeric order in the Supabase SQL Editor
against the **Development** project, each in its own transaction. Confirm first
that the project reference starting `krys…` is AgentOS-Development; this session
has no way to verify a project's name.

`supabase/seed/dev_templates.sql` is **development only** and lives outside
`migrations/` so nothing that applies migrations can apply it by accident.

## 3. `NEXT_PUBLIC_*` is a build-time value, not a runtime one

This is the single most confusing thing about these two variables, and it was
the root cause of "the variables are set in Vercel and the screen still says
not configured".

A browser has no `process.env`. The only way a `NEXT_PUBLIC_*` value reaches
one is that Next.js **replaces the literal text** `process.env.NEXT_PUBLIC_X`
with the value while the build runs. It is a textual substitution.

Two consequences:

1. **The read has to be literal.** `source.NEXT_PUBLIC_SUPABASE_URL`, where
   `source` is a parameter, is a dynamic property access. The bundler never
   sees the pattern and substitutes nothing, so the value is absent from the
   client bundle no matter what the host has. This project had exactly that
   bug; `tests/unit/public-env.test.ts` now asserts against it.
2. **Setting the variable after a build changes nothing.** The value is in the
   bundle or it is not. A restart cannot add it. Neither can a redeploy that
   reuses a cached build. The build has to run with the variables present.

So "the variable is set in the dashboard" and "the browser can sign in" are
**not the same statement**, and the first does not imply the second.

### `/diagnostics/config` tells you which

The page shows the four checks twice — once as the server sees them (the live
process) and once as the browser sees them (whatever the build baked in). The
disagreement is the diagnosis:

| Server | Browser | Meaning |
|---|---|---|
| true | true | Configured. A sign-in failure is something else — check the Supabase project is running. |
| **true** | **false** | **The build ran before the variables were set.** They are on the host and not in the bundle. Rebuild without the build cache. |
| false | false | Genuinely absent. Set them for this environment, then rebuild. |
| false | true | The host lost a variable the build had. |

`GET /api/diagnostics/config` returns the server half as JSON. Both show four
booleans and never any part of a value.

## 4. Diagnosing a stuck auth screen

Before this change, a failed request left the button on "רגע…" indefinitely:
the Supabase client call was not inside a try/catch, so a throw became an
unhandled rejection and the pending state was never cleared. Every auth call
now goes through `callAuth` (`src/components/auth/auth-client.ts`), which never
throws and times out at 15 seconds.

What the message now tells you:

| Message | Meaning |
|---|---|
| "שירות ההזדהות אינו מוגדר…" | The variables are missing. Retrying will not help. |
| "השרת לא הגיב בזמן" | Supabase did not answer within 15s. A paused project does this. |
| "לא הצלחנו להגיע לשרת" | The request threw: wrong URL, DNS, CORS, TLS. |
| "האימייל או הסיסמה שגויים" | Supabase answered and rejected the credentials — the stack is working. |

A **paused Supabase project** is the most common cause of the timeout. Free-tier
projects pause after inactivity and resume from the dashboard.
