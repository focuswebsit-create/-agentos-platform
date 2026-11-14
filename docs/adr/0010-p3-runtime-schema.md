# ADR-0010 — Runtime schema: runs, trace, and the money

- **Status:** Accepted (P3)
- **Date:** 2026-11-14

## Context

`ROADMAP.md` P3: "LangGraph + Inngest integration, one actual LLM provider,
caps, trace, retry/cancel, transactional provider-cost reservations, usage
ledger." Gate: "actual provider runs and deterministic mocked unit tests;
per-tenant spend cap and idempotency pass."

This change is the database layer of that: the tables, the cap, and the
transactional reservation. The executor and the provider adapter follow.

`ARCHITECTURE.md` separates the control plane (what the customer configures)
from the execution plane (what actually runs). That separation is the reason
nearly every write here is withheld from customers.

## Decisions

### 1. Money is integer micros, and the unit is in the column name

`DATA_MODEL.md` says "integer minor units or fixed precision numeric; NEVER
floating point" and sketches the columns as `budget_usd`, `spent_usd`. Every one
of them is `*_usd_micros` here: a `bigint` count of millionths of a dollar.

A cent is too coarse. Per-token model pricing puts a single call below $0.0001,
and rounding each one to a cent turns a real bill into zero.

The suffix is the other half. `budget_usd` holding `2000000` invites someone to
read it as two million dollars — a factor of a million, in the direction nobody
notices until the invoice. `budget_usd_micros` holding `2000000` cannot be
misread. The agent configuration already used `maxSpendUsdMicros`, so this is
one unit across the whole system rather than two that need converting at a
boundary, which is where the conversion gets forgotten.

### 2. The organisation row is the lock, always taken first

Every transaction that touches a tenant-wide limit locks
`organizations` with `for update` before reading totals. The seat gate in 0004
already did this; `start_run`, `settle_run` and `cancel_run` now do the same.

Two consequences, both deliberate:

- **One total order per tenant.** A dispatch and a membership change cannot
  deadlock against each other, because both take the same lock first.
- **No upsert race on `usage_periods`.** `insert … on conflict do nothing`
  followed by `select … for update` can see nothing at all: a concurrent
  transaction that inserted the row but has not committed is invisible to the
  select and does not block it. Locking a row that is guaranteed to exist has
  no such hole.

### 3. Reserved budget counts against the cap

`start_run` refuses when `spent + reserved + this_run_budget > cap`. Without
counting reservations, N runs dispatched before any of them settles each see the
same headroom and all proceed — the same hole the seat gate closes by counting
pending invitations, and the same fix.

Verified under concurrency: two simultaneous dispatches against a cap with room
for one produce exactly one run and one `USAGE_LIMIT_REACHED`.

### 4. Reservations expire, because workers die

A reservation holds budget. A worker that crashes mid-run never settles or
releases it, and the organisation's cap shrinks by that much permanently —
silently, and more with each crash.

`expire_stale_reservations()` reclaims them and marks the run `failed` with
`RUN_ABANDONED`, because a run nobody will ever report on is finished whatever
its row says, and leaving it `running` leaves it spinning in the UI forever.
`for update skip locked` so the sweeper never blocks a live dispatch.

### 5. Idempotency returns the run, it does not raise

`ARCHITECTURE.md` requires idempotency keys. A client that retries a dispatch it
is unsure about must get the same run back — raising "duplicate key" would leave
it unable to tell whether the first attempt had worked, which is the exact
uncertainty the key exists to remove.

`start_run` checks the key before taking the lock, and catches `unique_violation`
for the case where two requests race past that check. The handler re-raises when
there is no key, or when the row still cannot be found: swallowing a unique
violation that was not this one would hide a real bug.

Verified under concurrency: two simultaneous dispatches with one key produce one
run and no error.

### 6. A run pins a published version

`runs.agent_version_id` is set from `agents.active_version_id` at dispatch and
references `agent_versions (org_id, id)`. `CLAUDE.md` rule 8 requires a published
version pin; editing the draft afterwards, or publishing a newer version, must
not change what a finished run did. A draft-only agent raises
`AGENT_VERSION_MISSING` — it is not runnable however complete it looks.

The budget comes from that pinned version's `maxSpendUsdMicros`, not from the
request. A budget supplied by the caller would be a cap the caller sets.

### 7. Customers read; the execution plane writes

No customer role has INSERT, UPDATE or DELETE on `runs`, `run_steps`,
`usage_events`, `usage_reservations` or `usage_periods`. A customer who could
write `spent_usd_micros` could spend without paying; one who could write
`status` could mark a failed run succeeded.

Who reads what:

| Table | owner | admin | member | viewer |
|---|:--:|:--:|:--:|:--:|
| `runs` | yes | yes | yes | yes |
| `run_steps` (trace) | yes | yes | yes | yes |
| `usage_events` (per-call spend) | yes | yes | no | no |
| `usage_periods` (monthly totals) | yes | yes | no | no |
| `usage_reservations` | no | no | no | no |

The trace is visible to everyone because watching what the workspace is doing is
the whole of a viewer's job, and it carries no prompt or completion text:
`redacted_trace_ref` is a pointer and `summary_json` is bounded. Spend is
commercial information, and P1 already settled that viewers and members do not
see billing. Reservations are visible to nobody — a reservation is a number held
mid-flight, not yet a fact about the organisation, and showing it would display
spend that may never happen.

### 8. `monthly_spend_cap_usd_micros` on `organizations`

The same shape as `seat_limit` in P1, for the same reason: the gate requires a
per-tenant cap, the entitlement engine that should supply it is P5, and a cap
with no source cannot be enforced. $50/month by default — generous enough not to
fight development and the first customers, small enough that a runaway loop
stops. Not customer-updatable, and 0014 contains a `DO` block that fails the
migration if it ever becomes so.

### 9. Deviations from `DATA_MODEL.md`'s column list

| Change | Why |
|---|---|
| `*_usd` → `*_usd_micros` (bigint) | Decision 1 |
| `version_ref` → `agent_version_id`, `workflow_ref` → `workflow_version_id` | They are foreign keys; naming them `_ref` hides that |
| `input_ref` / `result_ref` → `input_json` / `result_json` | P3 inputs and results are small and structured. A blob reference needs a blob store, which is P4's knowledge work. |
| `usage_periods` keyed `(org_id, period_start)` | The documented key includes `subscription_id`, and there is no subscriptions table until P5. Every organisation has at most one subscription — the concept does not exist yet — so the keys are the same thing today. |
| `runs.error_code`, `run_steps.summary_json` | A failed run with no reason, and a trace with no content, are not usable. |
| `usage_events` has no foreign key to `runs` | A usage event outlives the run it came from, because it is what the organisation was charged for. Deleting a run must not erase the spend. |

### 10. `awaiting_approval` exists before approvals do

`run_status` includes a value P4 will use. Adding an enum value later is
possible, but a status a run can reach is not something to retrofit while runs
are live, and the set is cheapest to get right before anything depends on it.

## Consequences

- An organisation cannot spend past its cap, under concurrency, with
  reservations counted.
- A crashed worker costs an organisation nothing permanent.
- A retried dispatch costs nothing extra.
- Nobody outside the execution plane can write a number that appears on a bill.
- A finished run is a permanent record of which version produced it.
- There is still no executor and no provider. Nothing in this change can run an
  agent, and nothing claims to.
