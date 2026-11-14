# ADR-0008 — Agent and version schema for P2

- **Status:** Accepted (P2)
- **Date:** 2026-11-14

## Context

`DATA_MODEL.md` lists the two tables as a column sketch:

```
agents(id,org_id,name,status,active_version_id,created_by,created_at)
agent_versions(id,org_id,agent_id,version,config_json,published_at,created_by, UNIQUE(agent_id,version))
```

and states two rules that the sketch does not itself enforce:

> Org foreign-key containment: a run cannot reference a different org's agent/version
> Published versions cannot be mutated in place

`ROADMAP.md` P2's gate is "create, edit, version and install; unauthorized
template editing denied". `CLAUDE.md` rule 14 requires anything beyond the
documented plan to be recorded here rather than slipped in.

## Decisions

### 1. `version` is assigned at publish time, not at draft creation

`version` is nullable, with a CHECK tying it to `published_at`: a row is either
an unnumbered draft or a numbered published version, and nothing else is
representable.

Numbering a draft when it is created burns a number on every abandoned draft,
and gives two people drafting at once the same number before either has
published. Numbering at publish, under `select ... from agents ... for update`,
removes the race rather than detecting it: the unique constraint is still there,
but it now catches bugs instead of ordinary concurrency.

Verified by `tests/db/rls-suite.mjs` group 10: two concurrent publishes of the
same agent produce versions 1 and 2, never a duplicate and never an error the
user did not cause.

### 2. Exactly one draft per agent, enforced by a partial unique index

`unique (agent_id) where published_at is null`. `publish_agent_version()` freezes
the draft and immediately opens a fresh one cloned from the configuration it just
published, so the invariant holds at every instant and the UI never has to handle
"this agent has no draft".

The alternative — letting clients open drafts — would need `INSERT` on
`agent_versions`, and a client-side insert can race the index. No customer role
has `INSERT` on either table.

### 3. The active-version pointer references `(agent_id, id)`, not `(org_id, id)`

`agents.active_version_id` is checked by

```sql
foreign key (id, active_version_id) references public.agent_versions (agent_id, id)
```

which rejects an agent pointing at *another agent's* version. Org containment
then follows transitively, because `agent_versions` already references
`agents (org_id, id)`. One key gives both guarantees, and PostgreSQL checks it on
every write including one that arrives straight through PostgREST.

Two details are load-bearing and easy to lose in a later edit:

- **MATCH SIMPLE** (the default). With `active_version_id` NULL the constraint is
  not checked, which is what lets a draft agent exist. `MATCH FULL` would reject
  every draft agent.
- **DEFERRABLE INITIALLY DEFERRED.** The reference is circular: deleting an agent
  cascades to its versions while the agent row still points at one of them.
  Checking at commit is the only ordering that works.

### 4. Immutability is enforced twice, and deletion is not enforced at all

The RLS policy restricts customers to rows with `published_at is null`. A trigger
repeats the rule for connections RLS does not constrain — the service role, the
schema owner, a future background job — because a rule that holds for only one
class of connection is a convention, not an invariant.

There is **no DELETE trigger**, deliberately. Deleting an organisation cascades to
its agents and from there to their versions, and a trigger cannot tell a cascade
from a direct delete; a DELETE guard would make organisations undeletable, turning
a rule about editing history into a block on erasure requests. What stops a
customer deleting a version is the absence of the DELETE privilege, which no
cascade needs.

### 5. Role matrix: `member` can publish, only `owner`/`admin` can archive

|            | read | create | edit draft | publish | archive |
| ---------- | :--: | :----: | :--------: | :-----: | :-----: |
| owner      | yes  |  yes   |    yes     |   yes   |   yes   |
| admin      | yes  |  yes   |    yes     |   yes   |   yes   |
| member     | yes  |  yes   |    yes     |   yes   |   no    |
| viewer     | yes  |  no    |    no      |   no    |   no    |

Agent Studio is the working surface of this product. A team whose members cannot
ship an agent needs an admin for every change, which is not what a 5-seat business
is buying. Spend is bounded by the per-run budget caps in P3, not by who pressed
publish. Archiving withdraws something other people's work may depend on, so it
stays with owner and admin.

`viewer` can read `config_json`. It holds prompts, a model name and a tool
allowlist — the workspace's own working material, not member email addresses,
billing or audit records, which are the categories P1 withheld from viewers.

### 6. Additions beyond `DATA_MODEL.md`

| Addition | Why |
|---|---|
| `agents.description` | The agent list is unusable when every row is a bare name. 500 characters, nullable. |
| `agents.updated_at` | "Last edited" is the only ordering that makes sense in a studio list. Maintained by the trigger from 0004, not by clients. |
| `public.agent_status` enum (`draft`/`published`/`archived`) | `DATA_MODEL.md` names the column and no values. `archived` rather than deletion, per `SECURITY.md` 4. |
| `agent_versions.version` nullable + CHECK | Decision 1. |
| `unique (org_id, id)` on both tables | Targets for the composite foreign keys that P3's `runs` and `run_steps` will need to satisfy "a run cannot reference a different org's agent/version". |
| `create_agent`, `publish_agent_version`, `set_agent_archived` | Each spans rows that must change together; 0007 grants no INSERT, so there is no client-side path that could be atomic. |

### 7. What is NOT in this change

Templates (`global_templates`, `template_installations`), the Agent Studio UI, the
onboarding wizard and config schema validation. P2's gate also covers "install
copy" and "unauthorized template editing denied", which the template tables
deliver; this change is the agent half, verified at the database layer first for
the same reason P1 was.

`config_json` has no CHECK on its shape. A constraint on jsonb structure has to
be migrated in lockstep with every configuration change, and P3 is when a runtime
first has an opinion about what a valid config contains. Until then the shape is
validated with Zod in the application, and `publish_agent_version()` refuses an
empty object so a version that does nothing cannot be frozen.

## Consequences

- A published version can never be edited, by anyone, through any connection.
- A version, and anything that later references one, cannot cross an organisation
  boundary, because the keys forbid it rather than the application remembering to.
- Publishing is serialised per agent, so version numbers are gap-free and unique.
- Agents accumulate: there is no delete. An organisation with many archived agents
  will need list filtering in the UI, which P2's studio work covers.
