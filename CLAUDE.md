# Claude Code standing rules — AgentOS Commercial SaaS

Read `README_HE.md`, `PRD.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `BILLING_AND_PLANS.md`, `SECURITY.md`, `ROADMAP.md`, `QUALITY_GATES.md` before architecture changes.

1. NEW independent repository. Do NOT modify AutoMind or any existing production project.
2. Implement one P0–P7 phase per PR. Before coding state files/modules, tests and acceptance gate. Do not silently widen scope.
3. No production deploy, real charge, live provider activation, merchant enrollment or irreversible migration without explicit owner approval.
4. No fake screenshots/metrics, placeholder payments labeled 'active', fictional API integrations or production dummy results.
5. Never use company secret keys in browser, LLM prompt, CI logs or committed code. `.env.example` holds placeholders only.
6. Plan entitlements server-side, org-scope everywhere + RLS; add negative isolation tests for each new feature.
7. Payment flows: official provider docs checked before implement; signature verification raw body; idempotency/reconciliation; never grant access on redirect.
8. Agent runs: published version pin, provider budget reservation before invocation, durable run state and retry-safe external actions.
9. Sensitive tool actions: explicit human approval on exact args. Never expose unrestricted shell/network or raw service role to agent.
10. Keep responsive RTL accessibility and light/dark themes. Customer screens and Super Admin are independent auth boundaries.
11. Use pinned dependencies lockfile, migrations/seed only for development, deterministic unit/integration/E2E.
12. Commands before reporting completion: lint, typecheck, tests, build and relevant security tests; copy exact results and note not-run tests honestly.
13. Maintain `docs/IMPLEMENTATION_LOG.md` with changed files, commands/results, blockers and next PR recommendation.
14. If requested functionality exceeds documented plan, propose ADR + scoped follow-up instead of overbuilding.
