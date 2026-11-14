# Applying the migrations to Supabase Development

**Owner action. Nothing in this document has been run against any Supabase
project.** Every step below was rehearsed end to end on a local PostgreSQL 16
cluster whose shim reproduces Supabase — including its default privileges and
the case of users who signed up before the schema existed.

---

## Why "create your first organisation" failed

A read-only probe of the Development project returned:

```
GET  /rest/v1/organizations          →  PGRST205  Could not find the table 'public.organizations'
POST /rest/v1/rpc/create_organization →  PGRST202  Could not find the function
                                          public.create_organization(p_name, p_slug)
```

**The database is empty.** None of the migrations has been applied, so the
function the onboarding screen calls does not exist. No code change can create
it; the migrations have to be applied.

The screen said "משהו השתבש. נסו שוב." because the error mapper did not
recognise PostgREST's codes and fell through to a generic retry message —
advice that could never have worked. It now answers with a message that says
the data environment is not installed and that retrying will not help.

---

## What gets applied

Eighteen migrations, bundled into **one transaction**:
`supabase/apply/01_bundle_development.sql` (generated from
`supabase/migrations/` by `scripts/build-apply-bundle.sh`; a unit test fails if
it ever drifts from them).

| Migrations | Creates |
|---|---|
| 0001–0005 | organisations, memberships, profiles, invitations, platform admins, audit log, RLS, last-owner and seat guards, `create_organization` |
| 0006–0009 | agents and agent versions |
| 0010–0012 | template catalog and `install_template` |
| 0013–0016 | runs, trace, usage ledger, spend cap, suspension |
| **0017** | revokes `EXECUTE` from `anon` on twelve functions (see below) |
| **0018** | backfills a profile for every user who signed up before the schema existed |

### Data it changes

**Only 0018 touches existing rows, and it only inserts.** It adds a `profiles`
row for each `auth.users` row that has none. Nothing is updated or deleted, in
any table. Without it, anyone who registered through the preview before this
point would create an organisation and then not appear in their own team list —
reproduced locally: one real owner membership, zero members shown.

### Two problems the local rehearsal found, and fixed, before you apply

1. **`anon` could have called twelve functions.** Supabase grants `EXECUTE` on
   every new function to `anon` *directly*, through default privileges, so
   `revoke … from public` does not remove it. The local shim did not reproduce
   that, and every "anon cannot execute" test was passing for the wrong reason.
   None of the twelve was exploitable — each rejects an anonymous caller in its
   first line — but that was one layer where there should be two. The shim now
   reproduces Supabase's defaults; 0017 closes it.
2. **Early sign-ups had no profile.** Fixed by 0018, and the team query no
   longer uses an inner join that could hide a member for any reason.

---

## Step 0 — confirm the project

In the Supabase dashboard: **Project Settings → General**. Check the project
name is **AgentOS-Development** and note the Reference ID.

SQL cannot see a project's name. This check is the only thing that stops the
bundle being applied to the wrong project, so do not skip it.

## Step 1 — preflight (read-only)

**SQL Editor → New query →** paste the contents of
`supabase/apply/00_preflight.sql` → **Run**.

Expected:

| item | result |
|---|---|
| auth.users exists | true |
| role anon / authenticated / service_role exists | true |
| can create in public | true |
| AgentOS objects already in public | **0** |
| AgentOS types already in public | **0** |

If either of the last two is not `0`, **stop**: something is already installed.

## Step 2 — apply (one transaction)

**SQL Editor → New query →** paste the contents of
`supabase/apply/01_bundle_development.sql` → **Run**.

It is all-or-nothing. If any statement fails, the whole transaction rolls back
and the project is exactly as it was. It also:

- **refuses to start** if AgentOS is already installed, so running it twice is
  harmless — the second run changes nothing (verified: identical schema
  fingerprint before and after);
- **refuses to finish** if any expected table or function is missing, or if
  `anon` can execute any function afterwards.

A successful run prints no error.

## Step 3 — verify (read-only)

**SQL Editor → New query →** paste `supabase/apply/02_verify.sql` → **Run**.

**Every row should read `true`.** Any `false` sorts to the top. In the local
rehearsal: 53 checks, 53 true.

## Step 4 (optional) — starter templates

`supabase/seed/dev_templates.sql` adds the four starter templates. Development
only, idempotent, and kept outside `migrations/` so nothing applies it by
accident.

---

## Then: YADINOS

1. Open the preview and sign in.
2. **Create your first organisation** — name `YADINOS`, slug `yadinos`.
3. You land on "your first agent": install a template or create a blank one.
4. The dashboard shows you as the owner, with one member.

Each of those steps is exercised through the real RPCs by
`tests/db/rls-suite.mjs` group 15, including the early-sign-up case.

**Running the agent** additionally needs `AGENTOS_ENABLE_MOCK_PROVIDER=1` on the
preview (it answers with a clearly labelled simulation; no real model is called)
and `SUPABASE_SECRET_KEY`, which the executor uses to record the run. See
`docs/DEPLOYMENT.md`.

---

## If something goes wrong

| Symptom | Meaning |
|---|---|
| "AgentOS is already installed… refusing" | Already applied. Run Step 3 to confirm. |
| "auth.users does not exist" | Not a Supabase project. Check Step 0. |
| "post-check: …" | Rolled back. Nothing was applied. Report the message. |
| Any other error | Rolled back. Nothing was applied. Report the message. |

---

## Alternative: Supabase CLI — **not verified from this session**

`supabase db push` records which migrations ran, so later migrations can be
applied incrementally. The SQL Editor bundle does not record that history.

```bash
npx supabase login
npx supabase link --project-ref <the Reference ID from Step 0>
npx supabase db push --dry-run   # lists what would be applied; changes nothing
npx supabase db push
```

This could not be rehearsed here — the CLI is not installed and the Supabase
management API is unreachable from this environment — so it carries no
guarantee from this document. **Choose one method and keep to it.** If you apply
the bundle through the SQL Editor and adopt the CLI later, the CLI will not know
these migrations ran and must be told before its first `push`.
