# Super Admin — platform owner control plane

## Identity boundary
Super Admin identity is **platform-scoped**, not a regular customer membership or organization owner impersonation. Enforce MFA, short sessions, rate limiting, explicit allowlist of authorized staff, server-side RBAC and logged sensitive actions. Separate `/admin/*` routes and server module from customer `/app/*` modules. Avoid generic service role queries made directly through public-facing routes.

## Sidebar
1. Overview — MRR from verified active paid subscriptions, ARR estimate, new customers, activation, churn, gross billed and refunds (show definitions/timezone).
2. Organizations — accounts, plan, created, status, active seats, last run, onboarding progress; status filter and org overview.
3. Subscriptions — subscription state, plan version, renewal, failed payments, grace, payment-source mapping, reconciliation drift.
4. Usage & Unit Economics — spend per org/provider/model, reservations, largest consumers, throttling, direct margin estimates and outliers.
5. Runs & Incidents — queue delay, failed runs by reason, provider incident, retry/dead letter, global kill switch per tool.
6. Agent/Template Catalog — global read-only template revisions, staged publishing and rollback; never silently override customers' pinned versions.
7. Support — tickets, non-sensitive account metadata, sanitized diagnostics; private customer prompt/file not accessible by default.
8. Feature Flags — enable rollout by org, kill switch, plan entitlements; audit all changes.
9. Audit & Security — logins, admin actions, suspicious use, exports, system event logs.
10. Settings — tax/currency settings, provider mapping and billing plans config, lifecycle policies; secrets in secret manager only.

## Actions and safeguards
- Suspend account from new runs with reason, warning and safety audit; never silently delete account/content.
- Plan override: explicit reason + expiration + second approval for high impact; audit before/after.
- Refunds: route to provider in supported authorized workflow with 2-person approval; don't implement direct unreviewed refunds in MVP.
- Export org metadata to approved support staff; deny raw prompt/message access unless break-glass with customer permission, finite scope/time, audit and applicable law.
- Drill down: sanitized trace, request/run IDs, incident history. Never expose full card number, OAuth tokens or API keys.

## Required widgets
Stat cards: paid MRR, paid organizations, trial-to-paid conversion, estimated API costs, run success, open incidents, overdue payments. Tables: tenants with status/plan/usage, billing events, audit. Charts: daily signups, activation, net MRR and costs. Empty states must state 'No data' not invented sample production numbers. Use safe seed demo data only in development with clear DEMO watermark.

## Platform financial semantics
MRR derived from recognized contracted recurring prices on active paid subs (annual amounts normalized per month); **not** revenue received. Amount collected = successful settled provider transactions; refund/chargeback net flows separately. Gross margin estimate = collected revenue minus direct model, infrastructure variable, payment transaction and other directly variable service costs; do not confuse with net income. Use versioned FX and currency dimension; present VAT exclusive when applicable.
