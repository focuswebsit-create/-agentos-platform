# AgentOS — test results

Exact results per pushed milestone, newest first. "Local DB" means PostgreSQL 16
with the Supabase compatibility shim in this container — not Supabase.

## `ec00dc5` — knowledge sources (2026-11-14)

lint 0 · typecheck 0 · format 0 · unit 29 files / 380 passed · build 0 · e2e 34 passed ·
RLS 245 PASS (group 18: roles, cross-org bases/documents/chunks/search, FK containment,
dedupe, delete cascade, plan limit) · secret scan findings=0. New unit files:
`knowledge-text`, `knowledge-routes`; executor retrieval tests (org filter, data framing,
fence escape, trace counts only).

## `6248dce` — draft test runs (2026-11-14)

lint 0 · typecheck 0 · format 0 · unit 27 files / 357 passed · build 0 · e2e 34 passed ·
RLS 232 PASS (group 17) · secret scan findings=0. CI for `f6a936a` (contains `cc32036`):
all jobs success incl. gitleaks; Vercel agentos-demo + agentos-platform completed.

## P5 slice: entitlements and billing screen (2026-11-14)

lint 0 · typecheck 0 · format 0 · unit 26 files / 349 passed · build 0 · e2e 34 passed ·
**RLS 222 PASS** (24 new in group 16: public catalog, immutable prices, nothing purchasable,
pilot orgs keep current limits, member/outsider/anon access, owner cannot self-subscribe,
one effective subscription per org, concurrency and monthly budget enforced in start_run,
overrides with expiry, lapsed stops runs but keeps reads, webhook replay refused,
provider events hidden from customers) · secret scan findings=0.

## Agent Studio: restore, duplicate, goals (2026-11-14)

lint 0 · typecheck 0 · format 0 · unit 25 files / 341 passed · build 0 · e2e 34 passed ·
RLS 198 PASS · secret scan findings=0. New: `tests/unit/agent-studio-actions.test.ts`
(restore writes only the draft; cross-org version or agent refused; drafts not restorable;
duplicate created in caller's org, never published; goals reach the prompt).
CI for `0dbc0da`: Lint/Typecheck/Unit/Build/E2E success, gitleaks success, Vercel
agentos-demo + agentos-platform deployments completed.

## `0dbc0da` — runs stuck in QUEUED (2026-11-14)

| Gate | Command | Result |
|---|---|---|
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Format | `npm run format:check` | exit 0 |
| Unit | `npm test` | 24 files, 332 passed |
| Build | `npm run build` | exit 0 |
| E2E smoke | `npm run test:e2e` | 34 passed |
| Local DB / RLS | `npm run test:rls` | PASS 198 FAIL 0 SKIP 0 |
| Secret scan | pattern scan (incl. Anthropic, Supabase, JWT, AWS, GitHub) | findings=0; gitleaks runs in CI |

Mutation checks (each must fail a test when applied):

| Mutation | Caught by |
|---|---|
| claim without `status='queued'` | unit `executor` — claims atomically |
| 0019 removed (old settle_run) | RLS — second settle; settle after cancel |
| executor sends instructions only | unit `executor` — role test |
| drop fallback ceiling from output budget | unit `anthropic-provider` — budget |
| retry timeouts | unit `anthropic-provider` — no retry on timeout |

New coverage in this milestone: concurrent claim (one winner), double settlement,
settle after cancel, full lifecycle with cross-org invisibility of run/trace/usage,
recovery kick cross-org 404 and no re-execution, stale recovery thresholds and
org scoping, live-AI gate.

Not run: anything against the hosted preview (Vercel is unreachable from this
container); real Anthropic calls (no approval).

## `108de5a` — Anthropic provider (2026-11-14)

lint 0 · typecheck 0 · format 0 · unit 307 · build 0 · e2e 34 · RLS 192 · secret scan 0 ·
CI: Lint/Typecheck/Unit/Build/E2E success, gitleaks success; Vercel agentos-demo and
agentos-platform deployments completed.

## `aed5111` — CSRF method fix

lint 0 · typecheck 0 · format 0 · unit 266 · build 0 · e2e 34 · RLS 192 · secret scan 0.
