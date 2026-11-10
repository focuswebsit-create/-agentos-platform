# Quality gates and acceptance criteria

## Cross-cutting
- Fresh clone install, lint, typecheck, tests, production build from clean env without prod secrets.
- No integration described as operational unless verified end-to-end.
- RLS unit/policy tests for every org table, full API cross-tenant E2E, role denial; composite org foreign keys.
- UI 375px/mobile and desktop, RTL accessibility test and price disclosure.
- All endpoints Zod input validation, stable problem codes and request IDs, idempotent write requests.
- Real payments cannot be activated until signed webhook, double-event, refund, cancellation and reconciliation tests pass.

## P0 demo acceptance, with seeded sandbox only
1. Visitor sees public site & public pricing and can create a user account.
2. User creates org; second org user cannot read/run/invite in org1.
3. Authenticated customer clones template, edits agent, publishes immutable version.
4. User runs a **real provider configured in development**, sees output, persisted trace and consumed usage, with spend cap.
5. Two agents hand off and reviewer returns structured result; version pinning proven.
6. User with no AI allowance receives friendly blocked result before expensive call.
7. An approval-gated outbound tool cannot execute without verified same-org action approval of exact args; duplicate event does not execute twice.
8. Trial org cannot start paid-only feature, even by calling API directly.
9. Checkout in payment sandbox yields verified active entitlement. Fake redirect/unverified webhook yields none.
10. Duplicate/out-of-order webhook cannot double grant or charge through our system; provider reconciliation recovers mismatch.
11. Failed payment enters defined grace and eventually stops new runs without deleting content; customer sees recovery path.
12. Admin with MFA sees subscription/usage metadata only; support staff cannot access tenant private documents by default.
13. Marketing metrics originate from real events and admin numbers compute from real billing, not static sample data.
14. GitHub CI is green, migration rollback/backup note exists, staging smoke test recorded. A human explicitly approves production launch.

## Nonfunctional alert thresholds (initial hypotheses)
- P95 page nav under 3 sec on representative connection; tracked rather than promised.
- Provider call max deadline configurable; failures should not produce duplicate side effects.
- Work queue latency metrics and dead-letter visibility.
- Daily reconciliation of subscriptions, budget reservations and stuck runs.
- Secrets scanned before CI; no card data stored; audit redaction checks.
