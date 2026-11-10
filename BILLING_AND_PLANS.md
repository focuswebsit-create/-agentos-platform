# Billing, Plans, Usage & Entitlements — commercial specification

## Proposed prices (hypotheses for validation; excluding VAT)
| Tier | Monthly ILS | Included org seats | Active teams | Concurrent runs | Included AI provider-cost budget/mo USD | Knowledge bases |
|---|---:|---:|---:|---:|---:|---:|
| Starter | 299 | 1 | 1 | 1 | 5 | 1 |
| Business | 799 | 5 | 5 | 3 | 20 | 5 |
| Pro | 1990 | 15 | Unlimited defined teams | 10 | 60 | 20 |

Unlimited **agent definitions** only. No unlimited model spend, storage, team runs or connectors. Included AI allowance is a **metered direct model cost ceiling** estimated in USD, not a fixed count of tasks/credits; UI shows local-currency estimated equivalent using recorded FX rate and disclaimer. Allowance and margins must be pilot-tested. Trial proposal: invite/waitlist for early period, limited 7-day trial with one agent and $1 API budget, capped invitations, anti-abuse; these are defaults to validate. Trial usage cannot be farmed with unlimited accounts.

Annual plans: after unit-economics validation, propose annual charge equal to 10 months of list monthly, with clear upfront charge, renewal and cancellation terms; do not enable before legal/payment review. First live launch: monthly plans only.

## Entitlement engine
A single authoritative server-side decision function `getEffectiveEntitlements(orgId, now)` resolves:
- plan version, subscription state and applicable scheduled change;
- max_seats, max_active_teams, max_concurrency, knowledge_bases, connectors, storage_mb, monthly_model_budget_usd, step_budget_per_run, maximum_duration;
- payment grace/access mode and trial expiry;
- admin-created timeboxed overrides with reason + approver + audit.
Never use frontend checks as authorization. Store immutable plan versions and subscription snapshots; only allow capabilities via resolved entitlements. 'Unlimited' means no fixed product-level count for **defined agents**, but DB and anti-abuse protections still apply.

## Subscription state machine
`trialing → active → past_due → grace → suspended / canceled / expired`; also `paused` and `scheduled_cancel` flags/events where supported by provider. Preserve local truthful state of effective entitlement even if provider has different external states.
- Activation after **verified** server-to-server payment or authoritative subscription state, never thanks-page redirect alone.
- Failure: send notice, configurable grace period proposed 3 days, retry through provider, then **disable new runs while preserving read-only access** and ability to update payment method. Never delete data immediately.
- Cancellation: at period end by default; immediate cancellation only when user selects and terms/provider supports; communicate exact date; grant access until `current_period_end` if paid.
- Downgrade: effective next renewal unless explicitly permitted; do not delete excess agents/teams; pause out-of-quota active workflows and block publishing/extra runs until within limits.
- Upgrades: define proration explicitly using provider quote and customer approval, never calculate unauthorized charge in client.
- Trial expiration: block new runs, preserve workspace and show upgrade CTA.
- Refund/chargeback: follow provider event and policy, update financial and access statuses with manual investigation if contested.

## Provider strategy
1. Launch Israel: evaluate **PayPlus Israel** recurring billing, merchant eligibility, API, sandbox, callbacks, receipts/Israeli tax documents integration. The official service advertises recurring payments and API, but verify the exact webhook contract and cancellation semantics against official documentation for your merchant account.
2. International expansion: evaluate **Paddle** Merchant of Record eligibility, KYC, invoicing/tax handling and payout terms. Supported-country listing is NOT a guarantee of onboarding approval.
3. Do NOT assume a local Israeli entity can obtain **Stripe** payments account. Stripe global list does not currently show Israel among supported account countries.
4. MVP implementation uses `BillingProvider` adapter with *one* configured live provider; no double-provider complexity. Keep provider mapping stable when changing vendors; never migrate active subscriptions without explicit supported process.

## Billing architecture
- Hosted checkout (provider tokenization; never hold raw PAN/CVV) → save checkout attempt with idempotency key → provider redirect/hosted flow → provider **signed webhook** → durable dedupe + verified state → subscription record update → entitlements recompute → notification.
- Store raw signed payload only with redaction and bounded retention. Verify cryptographic signature **on raw body**, timestamp if applicable, replay window, event uniqueness, org/customer ID association and amount/currency/plan mapping. Webhooks may arrive duplicated, reordered or late.
- Use `billing_webhook_events` UNIQUE(provider,event_id) processed transactionally. If order uncertain, fetch authoritative provider state and reconcile. Nightly reconciliation job checks active subscriptions/failed payments; alerts on drift.
- Support billing_portal view: plan, next renewal, paid-to-date, invoices/receipts links, payment method update (provider hosted), cancel/renew, history, taxes.
- Internal finance ledger separate `billing_invoices` and `payments`, never claim invoice issued until trusted provider/accounting system confirms it. Israeli tax invoice issuance requires an appropriate solution and review.
- Cancellation and access outcomes are tested via provider sandbox including duplicate events and subscription paused/past_due edge cases.

## AI usage and cost caps
- Each provider invocation records: org, run, model, token types, provider reported quantity, unit rate/rate-card version, estimate vs final, USD cost, source, timestamp.
- `usage_ledger` append-only; aggregate `usage_periods` monthly per org, **atomic reservation before each call** for worst-case estimated cost; finalize after usage result and release unused reserve. Avoid allowing parallel requests to overrun caps.
- Separate amount in USD raw from price in ILS and currency conversion; persist FX basis/date for display. Display estimated costs as estimated until provider reconciled.
- If cap reached: return structured `USAGE_LIMIT_REACHED`, stop safely and show upgrade / admin-configured hard stop. No surprise overage charges.
- Model outages/latencies, failures and retries tracked; retry can consume additional usage; enforce limits at provider gateway rather than trust agent prompt.
- Monthly allowance reset at actual subscription period boundary (timezone safe). Unused amounts do not roll over by default.

## Billing acceptance tests
Signed vs unsigned webhook, duplicate/reordered callbacks, trial expiry, failed charge/grace/suspension, cancel at period end, upgrade/downgrade scheduling, cross-org access, invoice link authorization, race on last budget, post-cancel data read-only, refund/dispute, month rollover, provider outage, reconciliation drift, admin override expiry. Zero live charge unless explicitly approved.
