# ADR-0009 — Template catalog: platform data inside a tenant database

- **Status:** Accepted (P2)
- **Date:** 2026-11-14

## Context

`DATA_MODEL.md` sketches three tables:

```
global_templates(id, slug, category, visibility, active_version_id)   -- platform-managed
global_template_versions(id,template_id,version,definition_json,required_tools,published_at) -- immutable
template_installations(id,org_id,template_version_id,installed_by,linked_workflow_id,created_at)
```

`ROADMAP.md` P2's gate is "create, edit, version and install; unauthorized
template editing denied". `PRD.md` section 3: "system templates are read-only;
installation creates an organisational copy".

This is the first table in the schema that is **not tenant data**. Everything
before it is owned by one organisation and scoped by `is_org_member`. A template
is shared by every tenant, which inverts the question: the risk is not one
tenant reading another's row, it is one tenant *writing* a row that every other
tenant then installs.

## Decisions

### 1. Write access is withheld, not denied by policy

`global_templates` and `global_template_versions` grant `select` to
`authenticated` and nothing else. There is no INSERT, UPDATE or DELETE policy,
because there is no privilege for one to apply to.

The alternative — grant the privileges and write policies that deny — fails in a
way this does not. A policy can be widened by a later `create policy` that looks
innocuous in a diff. Re-granting a privilege requires someone to write
`grant insert on public.global_templates to authenticated`, which is a line a
reviewer will stop at.

The P2 gate is verified by `tests/db/rls-suite.mjs` group 11: six write
attempts by an organisation owner — insert, update and delete, on both tables —
each refused with `permission denied`.

### 2. `draft` templates are invisible, not unlisted

`visibility` is `draft` / `public` / `retired`, and the SELECT policy admits
only `public`. A template the platform is still writing returns no row to a
customer querying PostgREST directly, not merely one absent from a UI list.

`global_template_versions` repeats the check rather than relying on the template
being hidden:

```sql
published_at is not null
and exists (select 1 from public.global_templates t
            where t.id = template_id and t.visibility = 'public')
```

Without the second condition, a published version of a draft template would be
readable through the versions table even though its template is hidden — the
definition is the part worth hiding, so that would be a side door rather than a
leak of metadata. Tested directly.

### 3. `install_template()` re-checks what the policy already checks

The function is `SECURITY DEFINER` and therefore **not** subject to the SELECT
policy. It re-applies both conditions itself. A definer function that trusts its
argument to have been filtered by RLS is the standard route by which a hidden row
becomes reachable: the caller passes an id the policy would have hidden, and the
function, running as the owner, finds it.

All four failure modes — unknown id, unpublished version, draft template,
retired template — raise the same `TEMPLATE_NOT_AVAILABLE`, so the endpoint
cannot be used to discover what the platform is preparing.

### 4. Install copies; it does not reference

Three rows in one transaction: the agent, its draft, and the installation
record. Any two without the third describes something that did not happen.

The copy is what makes the rest safe. The organisation edits its agent freely
because the agent is ordinary tenant data from the moment it exists; and the
platform can retire or republish a template without changing what is already
running in someone's workspace. The suite tests both directions: a member can
edit the installed draft, and retiring the template leaves the copy untouched.

`name` is stripped from the copied configuration (`v_definition - 'name'`). The
agent row owns the name; a stale copy inside the config would survive a rename
and reappear in the next published version.

### 5. `linked_agent_id`, an addition to the documented column list

`DATA_MODEL.md` lists `linked_workflow_id`, which is the P4 analogue — workflows
do not exist yet. Without an agent link, nothing connects an installation to
what it produced, and the installation record is then unable to answer the one
question it exists to answer.

Both columns are nullable and `linked_agent_id` carries the organisation in a
composite foreign key to `agents (org_id, id)`, so an installation cannot point
at another tenant's agent. `linked_workflow_id` is declared now, without a
foreign key, so the column list matches the document and the key arrives with
the workflows table rather than being retrofitted.

`global_templates` also gains `name` and `description`: the documented list has
`slug` and `category` but nothing to render in a catalog.

### 6. `required_tools` is recorded and not enforced

There is no tool registry until P4. Validating a template against a registry
that does not exist would reject every template, so the field is stored, shown
to the installer, and left advisory. P4 enforces it.

### 7. Seed content is development-only

`CLAUDE.md` rule 11 restricts seeds to development. `supabase/seed/dev_templates.sql`
holds the four templates `PRD.md` names and lives **outside** `supabase/migrations/`,
so nothing that applies migrations can apply it by accident.

The content is honest about what it is: plausible first drafts, with model ids
that are internal picker keys from `model-registry.ts` rather than real provider
models, and no provider connected — installing one produces an agent that can be
edited and published but not run. The production catalog is platform content,
published through Super Admin in P6 or by an explicit owner-run step.

The seed is three statements rather than one `WITH` chain. The sub-statements of
a `WITH` clause share one snapshot and cannot see each other's effects on a
target table, so a single statement that inserted the templates and then set
their `active_version_id` left every new template pointing at nothing — while
appearing to work on the second run, once the rows already existed. That is the
failure mode worth recording: it is invisible in any environment that has run
the seed before.

## Consequences

- A customer cannot write the catalog through any path: no privilege, no policy,
  no RPC.
- A template under preparation is undiscoverable, including through the versions
  table and through the install endpoint's error codes.
- An installed agent is independent of the template it came from, in both
  directions.
- Publishing production templates needs a path that does not exist yet. Until
  P6's Super Admin, the catalog is empty in production unless the owner inserts
  rows deliberately, which is the correct default for content that every tenant
  sees.
