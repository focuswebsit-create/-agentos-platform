# ADR-0012 — The Anthropic provider

**Status:** accepted · **Date:** 2026-11-14 · **Phase:** P3

## Context

ADR-0011 defined `ModelProvider` and shipped only a deterministic simulation.
Agent Studio listed Anthropic as "not configured" on every deployment, because
the catalog hardcoded it and no implementation existed. The owner asked for a
real Anthropic integration with keys held server-side only, and with no new
charges without their approval.

## Decision

1. **Official SDK, pinned.** `@anthropic-ai/sdk` 1.8.0, exact version in the
   lockfile. One call: `client.beta.messages.create`, non-streaming.
2. **Real model ids.** `claude-opus-5-5`, `claude-sonnet-5-5`,
   `claude-haiku-5-5`. Published versions are immutable, so the earlier picker
   keys `anthropic:sonnet-family` / `anthropic:haiku-family` resolve to the
   current Sonnet / Haiku through `resolveModelId()` instead of being migrated.
3. **The budget bounds the request before it is sent.** `max_tokens` is the
   largest value whose worst-case cost fits the run's budget, computed from an
   upper bound on prompt tokens (UTF-8 bytes + framing) and, where fallback is
   enabled, two billed attempts with the second at the highest Claude list
   price known. Capped at 8,000; below 512 the run is refused
   (`BUDGET_TOO_LOW`) at no cost. This keeps CLAUDE.md rule 8's reservation a
   real ceiling rather than an estimate.
4. **Server-side fallback** (`fallbacks: "default"`, beta
   `server-side-fallback-2026-07-01`) for Opus 5.5 and Sonnet 5.5, so a
   classifier refusal on benign business content is retried on Anthropic's
   recommended model. Not sent to Haiku 5.5 (unsupported). Each attempt in
   `usage.iterations` is priced at its own model's rate; an unlisted Claude
   model is priced at the ceiling.
5. **Retry only what was not billed.** SDK retries off. One retry on
   429/500/503/529. Never on a timeout: the request may have completed and been
   billed upstream.
6. **Key containment.** `ANTHROPIC_API_KEY` is read only by
   `src/config/provider-keys.server.ts`, importable only from
   `src/modules/agent-engine/providers/` (ESLint ring 3). A `NEXT_PUBLIC_`
   copy disables the provider. Readiness leaves the server only as a boolean.
7. **Refuse before reserving.** Run dispatch checks the runtime key and the
   published version's provider before `start_run` reserves budget.
8. **Prices are list prices, recorded as estimates.** The API returns no cost;
   every Anthropic usage event has `estimate_source = 'estimated'` and the rate
   card version `anthropic-list-2026-11-14`.

## Consequences

- Setting `ANTHROPIC_API_KEY` on a deployment enables real, billed calls on the
  key owner's account. That is an owner decision and is documented as one.
- Live behaviour is unverified until a key is set: every test in this repository
  uses a fake SDK call.
- No streaming, tools, conversation history or prompt caching yet. Each is a
  scoped follow-up; tools additionally need the approval flow of CLAUDE.md
  rule 9 before any sensitive action exists.
- Execution is still inline (`after()`); durable execution remains ADR-0011's
  open item.
