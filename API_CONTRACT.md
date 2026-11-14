# API Contract — AgentOS Commercial v1.0
All customer APIs authenticate user and check org membership and entitlement on server. `org_id` is resolved from authenticated selected workspace and authorizations, never blindly trusted from request body. Zod validation. Errors `{code,message,requestId}`. API version later for public integrations.

## Public/auth
| Method | Route | Purpose |
|---|---|---|
| GET | `/api/public/plans` | Published plans/prices (no secrets) |
| GET | `/api/public/templates` | Safe published catalog |
| POST | `/api/orgs` | Create workspace with defaults |
| POST | `/api/invitations` | Authorized invite subject to seat entitlement |

## Auth and tenancy (P1)
| Method | Route | Purpose |
|---|---|---|
| GET | `/auth/callback` | Landing point for every emailed link (confirm, recovery, invite). Exchanges `code` or `token_hash`+`type` for a session |
| POST | `/auth/sign-out` | Ends the session and clears the active-organisation cookie. POST only |
| POST | `/api/orgs/switch` | Change the active workspace. Membership re-verified before the cookie is written |
| POST | `/api/invitations/:id/revoke` | Status transition to `revoked`; never a DELETE |
| POST | `/api/invitations/accept` | Accept by token. Takes the SHA-256 digest, never the raw token |
| PATCH | `/api/memberships/:userId` | Change a member's role |
| DELETE | `/api/memberships/:userId` | Remove a member from the organisation |

Every state-changing route above verifies, in order: a session, membership,
`Origin`/`Sec-Fetch-Site`, a double-submit CSRF token, and that the submitted
`orgId` matches the active one (`STALE_ORG_CONTEXT`). RLS re-checks all of it
in the database.

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

Added in P1, because this taxonomy predates authentication and tenancy. Folding
them into `AUTH_REQUIRED` or `ORG_ACCESS_DENIED` would make genuinely different
failures indistinguishable to a client (ADR-0006):

`MFA_REQUIRED`, `INVITATION_INVALID`, `ORG_SLUG_TAKEN`, `EMAIL_NOT_VERIFIED`, `STALE_ORG_CONTEXT`, `CSRF_INVALID`, `VALIDATION_FAILED`.

Added in P2, for agents (ADR-0008):

`AGENT_ARCHIVED`, `AGENT_CONFIG_INVALID`, `AGENT_VERSION_IMMUTABLE`, `TEMPLATE_NOT_AVAILABLE`.

There is deliberately no `AGENT_NOT_FOUND`. An unknown agent id and an agent
belonging to another organisation both answer `ORG_ACCESS_DENIED`, so the
endpoint cannot be used to confirm that a given agent exists. `AGENT_VERSION_MISSING`
(already in the taxonomy) covers an agent whose draft is absent.
`TEMPLATE_NOT_AVAILABLE` likewise collapses "no such template", "not published"
and "draft or retired" into one answer, so the install endpoint cannot be used
to discover templates the platform has not released.

Added in P6:

`ORG_SUSPENDED`. Distinct from `ORG_ACCESS_DENIED` because the customer can act
on it: the reason is stored on their own organisation row and shown on every
page of `/app`. Suspension blocks new runs only — reading, editing and export
stay available, so a suspended customer is not locked out of their own data.

`INVITATION_INVALID` is deliberately **one** code for every invitation failure —
unknown token, expired, revoked, already used, or addressed to someone else.
Distinguishing them would turn the accept endpoint into an oracle for
enumerating tokens and discovering who was invited where.

## Example `POST /api/runs`
```json
{"agentId":"<uuid>","input":"Summarize the attached document","idempotencyKey":"<uuid>"}
```
Response `202`: `{"runId":"<uuid>","status":"queued","requestId":"<uuid>"}`. Status/entitlement checked before queueing. Never accept client-provided cost totals or plan price.
