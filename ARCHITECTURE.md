# Architecture — AgentOS v1.0 SaaS

## Stack (recommended)
- `Next.js` App Router, TypeScript, Tailwind, shadcn/ui, Zod; React Server Components for fast website; Vercel as UI/API hosting.
- Supabase Auth/PostgreSQL/Storage/RLS/pgvector; migrations in repo.
- Agent runtime: LangGraph.js with persisted checkpoints; async orchestration via Inngest with events, retries and per-tenant concurrency.
- AI model adapter: versioned provider registry for Anthropic/OpenAI, model IDs config-driven; at least one genuinely working provider MVP.
- Billing adapter: provider-agnostic `BillingProvider`; first live integration selected after legal/commercial approval, merchant sandbox first.
- Observability: structured sanitized logs, correlation IDs, usage/cost/incident events.
- Quality: GitHub Actions CI (lint/typecheck/tests/build, secret check), Vercel preview/staging, production approval gate.

## Monorepo layout
```
apps/web/                    # public marketing + /app customer + /admin platform + API routes
packages/contracts/         # Zod, event types, plan features
packages/agent-engine/      # LangGraph graphs, tool policy, provider adapters
packages/billing/           # BillingProvider, entitlements, usage reservations, webhook normalization
packages/templates/         # curated immutable template definitions
supabase/migrations/        # SQL with RLS and referential integrity
supabase/tests/             # RLS + isolation tests
tests/e2e/                  # browser+API smoke tests
docs/                       # ADRs, runbooks, implementation log
```

## Authority boundaries
1. Public web: marketing, authenticated redirects only; no tenant data.
2. Customer control plane: validate session, org membership, entitlements; persist agent configs, requests, approval decisions.
3. Execution plane: durable runner loads published snapshots, enforces budget/policy, executes only curated server-side tools; does **not** accept arbitrary user code.
4. Billing authority: signed provider events + reconciliation; browser redirect cannot grant access. `entitlementResolver` used by *every* protected API and worker.
5. Platform admin: separate server policies, privileged identity/MFA, audited commands, no default raw customer content access.
6. Data plane: Postgres/storage/vector; every tenant-owned item with org_id; service-role strictly internal and always tenant-scoped queries.

## Run lifecycle
`POST /api/runs` validates session/org/plan/provider/config/budget → transaction creates run + usage reserve + outbox event → worker processes pinned version via LangGraph steps → calls model, verifies tool policy, optional waiting approval → budget ledger updated → finalized status + trace. Client polls or subscribes to sanitized updates. On cancellation check safe boundaries, release unused reservations. Worker must not rely on long-lived browser requests; Vercel API handles enqueue, background durable function handles execution.

## SaaS billing lifecycle
User chooses plan → hosted checkout → provider signed webhook → `billing_webhook_events` dedupe → resolve org/subscription + verify provider state where needed → update subscriptions/payments/billing_period → recompute entitlements → send notice. Daily reconciliation identifies missed events; never trust price/plan supplied from browser. Paid feature access based on server entitlements alone.

## Universal template system
Curated `global_templates` (immutable versions, tags/use-case) → `template_installations` clones into org-local agent/workflow definitions pinned to version → customer edits local draft. Restrict required tool scopes and model config; deactivated templates never break existing pinned runs. No per-vertical code branches in orchestrator.

## Data retention/region
Per-org data retention configuration supported later; MVP published deletion/retention policy and data export/delete request workflow. Keep PII minimal, encrypted, restricted. Cross-region/data processing choices and privacy obligations need legal review before live signup. Logs sanitized and bounded. No fake SOC2 claims.

## Concurrency/resilience
Tenant queues, atomic reservation and max in-flight counts, outbox/polling reconciliation, idempotency keys, dead letter, bounded retries. Do not claim exactly-once external delivery without verified provider idempotency; return uncertainty for ambiguous external outcomes. Suppress duplicate side effects where possible.
