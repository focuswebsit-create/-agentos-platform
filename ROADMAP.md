# Stepwise build plan — commercial SaaS, vertical slices

Each stage gets its own PR, docs update, tests, demo, user sign-off. Do not ship all phases at once. Before first charge complete ALL gates P0–P7. Work can be parallelized by independent units after foundations are stable.

## P0 — Scaffold and CI
Create separate repo, package lockfile, Next.js skeleton with marketing vs `/app` vs `/admin`, placeholders labeled DEMO, unit test framework, eslint/typecheck/build GitHub Action, env.example, migrations directory, docs/decision logs.
**Gate:** clean setup and CI pass; no production resources or credentials.

## P1 — Auth + tenancy + UI shell
Supabase Auth, org create/switch, memberships, RLS tests; RTL mobile menu, pricing/public routes, gated app routes.
**Gate:** 2-org cross-tenant negative E2E; invitation seat checking, app loads at mobile widths.

## P2 — Agents + template library
Create draft agent, validated version publishing, global template catalog and install copy; onboarding wizard with synthetic sample, no provider simulation described as real.
**Gate:** create, edit, version and install; unauthorized template editing denied.

## P3 — Runtime single-agent
LangGraph + Inngest integration, one actual LLM provider, caps, trace, retry/cancel, transactional provider-cost reservations, usage ledger.
**Gate:** actual provider runs and deterministic mocked unit tests; per-tenant spend cap and idempotency pass.

## P4 — Teams + knowledge + approval
2–3 agent workflow and curated read-only tool; upload/search org-isolated docs; exact action approval flow for one optional outbound connector. Templates operational.
**Gate:** research→draft→review, no cross-org RAG, forged/expired approval impossible.

## P5 — Subscriptions + entitlements
Plan version catalog, pricing page, trial/paid states, hosted provider sandbox checkout, webhook verification/dedupe/reconciliation, billing portal, cancel/grace, invoices metadata.
**Gate:** no payment redirect grants access; duplicate events safe; cancellation and overdue access policy tested; contract/merchant selected.

## P6 — Super Admin + analytics
MFA admin scope, overview/organizations/subscriptions/usage, safe suspension, audit, support flow, funnels. Synthetic dev labels; no raw content access default.
**Gate:** non-admin denied; suspension auditable; MRR and cost computed from actual transaction/use events.

## P7 — Security, UAT, launch readiness
End-to-end 2+ org QA, payment provider sandbox AND approved live handshake with a low-risk controlled charge, backup restore, incident runbook, legal/terms/privacy/accounting review, accessibility/mobile, activation test with five early users. Controlled release only with human production approval.
**Gate:** `QUALITY_GATES.md` full checklist; no critical/high defects and clear support path.

## Post-launch P8+
Annual pricing, optional top-ups, more OAuth integrations, visual DAG builder, billing experiments, enterprise security features, template marketplace, scale infrastructure. Avoid adding features without user demand and retention evidence.
