# AgentOS — master development plan

The ordered list of what remains, kept current so any session can resume.
Status of what is already built lives in `DEVELOPMENT_PROGRESS.md`; evidence in
`TEST_RESULTS.md`; launch gating in `RELEASE_READINESS.md`.

**Branch:** `claude/agentos-p1-infrastructure-9gibn2` · never merged to `main` · no production deploy.

## Ground rules (from CLAUDE.md and the owner)

- One scoped change per commit; lint, typecheck, unit, build, E2E, RLS suite and
  secret scan green before every push.
- Migrations are written as files and verified on the local PostgreSQL 16
  cluster. **Nothing is applied to a hosted database without owner approval.**
- No billed AI call, real charge, outbound customer message or production
  deploy without owner approval.
- No simulated result presented as real. Every simulated output says so.

## Order of work

| # | Item | Phase | Status | Depends on |
|---|---|---|---|---|
| 1 | Runs stuck in QUEUED: claim, kick, recovery, explanations | P3 | ✅ `0dbc0da` | — |
| 2 | Verify simulated save → publish → run on the agentos-demo preview | P3 | ⏳ owner | env vars, see RELEASE_READINESS |
| 3 | Apply migrations 0019 → 0022 to Development | P3–P5 | ⏳ owner | — |
| 4 | Agent Studio: duplicate agent, restore an earlier version, business goals field | P2 | ✅ this commit | — |
| 5 | Agent Studio: test the DRAFT in the playground before publishing | P2/P3 | ✅ `6248dce` (0021) | 4 |
| 6 | Strictly limited real Anthropic smoke test | P3 | ⏳ owner approval | 2 |
| 7 | Entitlements: plan catalog, subscriptions, webhook dedupe, `effective_entitlements()`; budget + concurrency enforced in `start_run`; billing screen (migration 0020, ADR-0013) | P5 | ✅ code; ⏳ owner applies 0020 | — |
| 8 | Billing UI: plan selection, usage vs allowance, sandbox checkout behind a provider adapter; webhook verify + dedupe; never grant access on redirect | P5 | planned | 7, merchant choice |
| 9 | Knowledge: upload, org-isolated storage and retrieval, injection-resistant prompting | P4 | ✅ `ec00dc5` (0022, text/markdown, full-text search) | — |
| 10 | Web Chat channel: embeddable widget, conversations, human handoff | P4 | next | ADR (public endpoint abuse limits) |
| 11 | Tools + human approval on exact arguments | P4 | planned | ADR |
| 12 | WhatsApp Business adapter (testable, not live) | P4 | planned | Meta credentials (owner) |
| 13 | Super Admin: incidents/alerts, plan overrides | P6 | planned | 7 |
| 14 | Durable execution (Inngest) | P3 | planned | owner account |
| 15 | Security audit, full customer-journey E2E, mobile/desktop pass | P7 | planned | most of the above |
| 16 | Legal drafts (privacy, terms) for legal review; business launch kit | P7 | in progress | — |

## Resume instructions

1. `git fetch origin claude/agentos-p1-infrastructure-9gibn2 && git checkout claude/agentos-p1-infrastructure-9gibn2`
2. `npm ci`
3. Local DB cluster: `/root/.agentos-rls-test/rls-cluster.sh start` (if present), then `npm run test:rls`.
   If the cluster does not exist in a new container, see `docs/adr/0004-local-db-verification.md`.
4. Gates: `npm run lint && npm run typecheck && npm run format:check && npm test && npm run build && npm run test:e2e`.
5. Pick the first row above whose status is "next" or "planned" and whose dependency is met.
