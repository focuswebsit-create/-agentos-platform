# API Contract — AgentOS Commercial v1.0
All customer APIs authenticate user and check org membership and entitlement on server. `org_id` is resolved from authenticated selected workspace and authorizations, never blindly trusted from request body. Zod validation. Errors `{code,message,requestId}`. API version later for public integrations.

## Public/auth
| Method | Route | Purpose |
|---|---|---|
| GET | `/api/public/plans` | Published plans/prices (no secrets) |
| GET | `/api/public/templates` | Safe published catalog |
| POST | `/api/orgs` | Create workspace with defaults |
| POST | `/api/invitations` | Authorized invite subject to seat entitlement |

## Product
| Method | Route | Purpose |
|---|---|---|
| GET/POST | `/api/agents` | List/create agent |
| GET/PATCH | `/api/agents/:id` | Read/edit draft |
| POST | `/api/agents/:id/publish` | Immutable version |
| GET | `/api/templates` | Catalog filtered by permissions |
| POST | `/api/templates/:id/install` | Clone published template into org |
| GET/POST | `/api/teams` | List/create team |
| GET/POST | `/api/workflows` | List/create workflows |
| POST | `/api/runs` | Validate+reserve+enqueue with idempotency |
| GET | `/api/runs/:id` | Status, redacted steps, usage |
| POST | `/api/runs/:id/cancel` | Request cancellation |
| POST | `/api/approvals/:id/decision` | Exact signed-context approval/denial |
| POST | `/api/knowledge/upload` | Validated file upload |
| GET | `/api/usage` | Tenant usage and reservations |

## Billing
| Method | Route | Purpose |
|---|---|---|
| GET | `/api/billing/summary` | Effective plan, period, measured usage, grace |
| POST | `/api/billing/checkout` | Server validated plan -> provider hosted session |
| POST | `/api/billing/portal` | Verified customer->provider portal redirect |
| POST | `/api/billing/cancel` | Server-authorized cancellation request |
| POST | `/api/billing/change-plan` | Quote & accept supported upgrade/downgrade |
| POST | `/api/webhooks/billing/:provider` | Raw signed event + dedupe, not a user session |
| GET | `/api/billing/invoices` | Authorized invoice URLs |

## Platform Super Admin (`/api/admin/...`)
`/overview`, `/organizations`, `/organizations/:id`, `/subscriptions`, `/usage`, `/incidents`, `/feature-flags`, `/audit`; POST to `/organizations/:id/suspend`, `/entitlement-overrides` with reason/approval; all require platform role + MFA + audit. No raw prompt/file access in routine admin.

## Events
- `agentos/run.requested {orgId,runId}`
- `agentos/run.cancel.requested {orgId,runId}`
- `agentos/approval.decided {orgId,runId,approvalId}`
- `agentos/billing.reconcile.requested {provider,subscriptionId}`
Internal event payloads contain IDs only, never raw PII/tokens.

## Error taxonomy
`AUTH_REQUIRED`, `ORG_ACCESS_DENIED`, `PLAN_FEATURE_UNAVAILABLE`, `SEAT_LIMIT_REACHED`, `USAGE_LIMIT_REACHED`, `RUN_CONCURRENCY_LIMIT`, `TRIAL_EXPIRED`, `SUBSCRIPTION_PAST_DUE`, `BILLING_NOT_CONFIGURED`, `INVALID_WEBHOOK_SIGNATURE`, `PAYMENT_PENDING`, `AGENT_VERSION_MISSING`, `APPROVAL_EXPIRED`, `RATE_LIMITED`.

## Example `POST /api/runs`
```json
{"agentId":"<uuid>","input":"Summarize the attached document","idempotencyKey":"<uuid>"}
```
Response `202`: `{"runId":"<uuid>","status":"queued","requestId":"<uuid>"}`. Status/entitlement checked before queueing. Never accept client-provided cost totals or plan price.
