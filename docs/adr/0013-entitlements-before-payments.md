# ADR-0013 — Entitlements before payments

**Status:** accepted · **Date:** 2026-11-14 · **Phase:** P5 (first slice)

## Context

P5 needs plans, subscriptions, quota enforcement, checkout, webhooks and a
billing portal. Checkout and webhooks depend on a merchant that has not been
chosen, and CLAUDE.md rule 7 requires the chosen provider's official
documentation before any payment flow is written. Quota enforcement and the
billing screen do not depend on the provider.

## Decision

1. **Migration 0020** adds `plans`, immutable `plan_versions`, `subscriptions`
   (at most one effective per org), `subscription_events`,
   `billing_webhook_events` (`UNIQUE (provider, event_id)`) and time-boxed,
   reasoned `entitlement_overrides`.
2. **One resolver.** `org_entitlements(org)` (internal) and
   `effective_entitlements(org)` (members only) return the effective limits.
   `start_run` uses the same resolver under the organisation lock:
   runs-allowed, monthly AI budget, concurrency.
3. **No behaviour change for existing organisations.** Never subscribed →
   `pilot`: the org's own `seat_limit` and `monthly_spend_cap_usd_micros`,
   uncapped concurrency. Had a subscription, none effective → `lapsed`: new
   runs refused (`SUBSCRIPTION_INACTIVE`), data readable.
4. **Nothing is purchasable.** Plan versions are inserted with
   `purchasable = false`; the billing screen says purchase opens only once a
   payment provider is connected. Customers can read their subscription; only
   `service_role` writes it — i.e. a future signature-verified webhook
   processor, never a browser redirect.
5. Plan rows ship in the migration (reference data the product cannot run
   without), not in a development seed.

## Not decided here (owner input required)

- **The payment provider.** Candidates for an Israeli SaaS charging ILS with
  VAT invoices include international processors and local ones; the choice
  depends on merchant approval, invoicing (חשבונית מס) integration and fees.
  The `BillingProvider` interface in `src/modules/billing/provider.ts` is
  provider-agnostic; the implementation follows the chosen provider's docs.
- Seat-limit sync from a plan on activation (`organizations.seat_limit` ←
  `plan_versions.max_seats`) belongs to the webhook processor.

## Consequences

- Quotas are enforced server-side today for any org that has a subscription row.
- The billing screen is truthful on every deployment: it reads the resolver,
  falls back to the planned catalog when 0020 is absent, and says so.
- Webhook replay protection exists in the schema before any webhook does.
