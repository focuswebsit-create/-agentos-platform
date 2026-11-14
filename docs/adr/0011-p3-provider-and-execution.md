# ADR-0011 — Provider abstraction, a deterministic mock, and inline execution

- **Status:** Accepted (P3)
- **Date:** 2026-11-14

## Context

`ROADMAP.md` P3's gate reads: "actual provider runs **and** deterministic
mocked unit tests; per-tenant spend cap and idempotency pass."

The cap and idempotency landed with the schema (ADR-0010). This change is the
executor and the provider boundary. One half of the gate — a real provider —
cannot be built here: it means an API key, which means real charges on the
owner's account, which `CLAUDE.md` rule 3 and the owner's own standing
instructions put behind an explicit decision.

The other half is not a workaround for that. "Deterministic mocked unit tests"
is in the gate because a suite that needs a network call and a credit card is a
suite nobody runs, and because a non-deterministic provider cannot prove that
cost arithmetic is right.

## Decisions

### 1. One `ModelProvider` interface, with three rules

```ts
interface ModelProvider {
  readonly id: string;
  isConfigured(): boolean;
  complete(request: ProviderRequest): Promise<ProviderResult>;
}
```

- **It never throws for a provider-side failure.** A refusal, a rate limit and a
  timeout are outcomes, not exceptions. An implementation that threw would skip
  the settlement path and leave the run's reservation held until the sweeper
  found it an hour later.
- **It reports usage even when it fails.** A request that was billed and then
  errored still costs money. `usage` is null only when nothing was sent.
- **`isConfigured()` is asked before dispatch, not during.** The executor
  refuses to start rather than failing mid-run, and the UI asks the same
  question so it never offers a button that cannot work.

`reportedCostUsdMicros` is nullable, and the distinction is carried all the way
to `usage_events.estimate_source`. A bill assembled from our own rate-card
arithmetic and presented as the provider's figure would be a fabricated number.

### 2. The mock says, in its own output, that it is not a model

Its reply begins `[סימולציה — לא תשובת מודל] This text was generated locally by
AgentOS's deterministic test provider. No language model was called…`.

A plausible-looking paragraph would end up in a screenshot, and then in a
conversation about what the product does. `CLAUDE.md` rule 4 forbids production
dummy results; this is built so it cannot be mistaken for one even with no
context attached.

Token counts come from a SHA-256 of the request: stable across machines and
runs, but different for different inputs. A mock that returned one fixed number
would let an executor that ignored usage entirely pass every test.

`__FAIL__` and `__REFUSE__` are reserved inputs, so the two failure paths have
deterministic coverage without a test stubbing the provider and thereby no
longer testing it.

### 3. Two registries, because they answer different questions

`model-registry.ts` is the display list the Studio pickers render — what exists.
`registry.ts` is what will actually answer — what is configured. Keeping them
apart is what lets the UI show a provider marked "not configured" while the
executor remains unable to dispatch to it.

The mock is registered only when `AGENTOS_ENABLE_MOCK_PROVIDER=1`. Production
does not set it, so the production state is "no provider", and the product says
it cannot run rather than serving a simulated answer to a paying customer. The
registry is rebuilt per call rather than cached, because a cached map would
ignore a test toggling the flag.

### 4. Every dispatched run settles

This is the property the executor is arranged around, and the one its tests
assert hardest. Success, provider failure, cancellation, a config that no longer
parses, an exception in our own code — every path reaches `settle_run`, which
returns the reserved budget.

The `catch` deliberately swallows the original error rather than rethrowing.
This code runs detached from any request, so a rethrow becomes an unhandled
rejection and the settlement never happens.

The one path that must **not** settle is a run that is no longer `queued`:
`cancel_run` has already released the reservation, and settling again would
credit the period a second time and quietly inflate the tenant's headroom. Both
invariants were checked by mutation — the fix reverted, the test watched to
fail, the fix restored.

### 5. Prompt and completion text never reach the trace

`run_steps` stores kinds, models, counts, costs and error codes.
`summary_json` holds `inputTokens`, `outputTokens` and `outputChars` — lengths,
not content. The answer goes to `runs.result_json`, which is the customer's own
output; the prompt is written nowhere.

`SECURITY.md` keeps conversation content out of rows support staff can read, and
`DATA_MODEL.md` names the column `redacted_trace_ref` for the same reason. A
test asserts that neither the prompt nor the model output appears anywhere in
what the executor writes.

### 6. Execution is inline, and that is stated rather than papered over

The dispatch route calls `start_run()`, returns, and then runs the executor in
`after()`. `ARCHITECTURE.md` wants a durable background function and names
Inngest; it is not wired.

`after()` runs in the same invocation. A process that dies takes the run with
it, and nothing retries. What makes that survivable rather than silent is the
reservation: `expire_stale_reservations()` reclaims the budget and marks the run
`RUN_ABANDONED`, so an abandoned run costs the tenant nothing permanent and does
not sit in the UI claiming to be running.

The sweeper has no schedule yet. It is a function; nothing calls it. That is the
remaining gap and it is recorded as one.

A reused idempotent dispatch is **not** executed — the run is already going or
already finished, and executing it again would charge the tenant twice for one
dispatch, which is the exact thing the key exists to prevent.

### 7. The service-role client moved out of the platform-admin module

It used to live in `src/modules/platform-admin/client.ts`, so the executor would
have had to import from there and pretend to be an administrator.
`ARCHITECTURE.md` names two authorities that legitimately hold this credential
and they are different things: the platform-admin boundary, which reads across
tenants on purpose, and the execution plane, which writes run state and spend
that no customer may write.

It is now `src/modules/service-role/client.ts`, with the ESLint containment
split into two rings:

- **Ring 1** — `@/config/env.server` is importable only from
  `src/modules/service-role/`. This is *tighter* than before, when all of
  `platform-admin` could read the secret.
- **Ring 2** — `@/modules/service-role/client` is importable only from
  `platform-admin` and `runtime`.

`platform-admin/guard.ts` asked `hasSupabaseSecretKey()`, which is the wrong
question in the wrong place; it now asks `isServiceRoleConfigured()`, which is
the question it meant.

### 8. `server-only` is stubbed in the test config

The package ships a browser build that throws, which is exactly its job. Under
jsdom that makes every server module untestable, and the usual workaround —
deleting the import from the module — trades a production guarantee for a test
convenience.

`vitest.config.mts` aliases it to an empty stub. Nothing is lost: the guarantee
is enforced by `next build`, which fails if a server-only module reaches a
client bundle, and that runs in CI on every push.

### 9. Rounding is up, always

`priceTokens()` rounds each side of the call up to the next micro. Rounded to
nearest, a long tail of sub-micro calls each costs zero, and a tenant spends
indefinitely against a cap that never moves. Over-charging by at most one
millionth of a dollar per call is the cheaper mistake by a wide margin.

The rate card is versioned and every usage event records which version priced
it. Without that, a price change silently rewrites history: last month's run is
re-costed at this month's rate the moment anyone recomputes a total.

**No number in the rate card is a real provider price.** They are placeholders,
and the ids are internal picker keys, not provider model ids. Real prices come
from the provider's published card, checked at the time it is connected.

## Consequences

- An agent can be run end to end, today, against a provider that says in every
  reply that it is not a model.
- The cost path, the settlement path and the trace are exercised by
  deterministic tests that need no network and no credit card.
- Connecting a real provider is one new file implementing `ModelProvider`, one
  registry entry, and the owner's decision to accept charges.
- Execution is not durable. A crash loses the run; it does not lose the money.
- The sweeper needs a schedule before this is production-ready.
