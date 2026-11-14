# AgentOS — release readiness

**Verdict: NOT ready for paying customers.** This file says exactly why, and what
closes each gap. It is updated at every milestone and never claims more than the
evidence in `TEST_RESULTS.md` supports.

Last updated: 2026-11-14 · last pushed commit: `0dbc0da`

## 1. Verified working (automated tests in this repository)

| Feature | Evidence |
|---|---|
| Tenant isolation for organisations, members, invitations, audit, agents, versions, templates, runs, trace, usage | RLS suite, local PG16 + Supabase shim (198 checks) |
| Role matrix incl. three privilege-escalation vectors | RLS suite group 2–3 |
| Last-owner and seat-quota invariants under concurrency | RLS suite group 6–7 |
| Single-use, hashed invitations | RLS suite group 8 |
| CSRF on every mutation method, across preview URLs | unit `csrf-methods` |
| Run lifecycle: dispatch → claim → trace → usage → settle; one winner under concurrent claims; double settlement safe (with 0019) | RLS suite group 12, unit `executor`, `run-execute`, `run-recovery` |
| Spend cap and budget reservation, incl. concurrent dispatch | RLS suite group 12 |
| Suspension blocks runs, keeps read access | RLS suite group 13 |

**Scope of "verified":** against PostgreSQL 16 with a compatibility shim, not
against Supabase itself; unit tests use fakes for the database and the SDK.

## 2. Tested simulated features

| Feature | How |
|---|---|
| Agent run end to end with the simulation provider | unit tests (fake DB) + SQL-level lifecycle on local PG |
| Anthropic request shape, budget bound, fallback pricing, error mapping | unit tests with a fake SDK call |

## 3. Tested real integrations

| Integration | Status |
|---|---|
| Supabase Auth (sign-up, sign-in, org creation) | Used by the owner on the preview: FOCUS created, MARKET agent visible and published. Not automated. |
| Supabase Development schema | Read-only probe 2026-11-14: all tables and runtime RPCs present, anonymous access refused |

## 4. Unverified external integrations

| Integration | What is needed |
|---|---|
| A completed run on the preview | Owner: see §7 step 1, then run MARKET on the Simulation provider |
| Real Claude call | Owner approval + `AGENTOS_ENABLE_LIVE_AI=1` (see §8 smoke test) |
| Email delivery (confirmation, reset) | Custom SMTP |
| Payments | Not built (P5); merchant not chosen |
| WhatsApp Business | Not built; Meta credentials |
| Vercel Cron | Runs only on Production; not exercised |

## 5. Security findings

| # | Finding | Status |
|---|---|---|
| S1 | CSRF refused all non-POST mutations | Fixed `aed5111` |
| S2 | Anon held EXECUTE on 12 functions via Supabase default privileges | Fixed by 0017 (applied on Development) |
| S3 | A key in the environment alone enabled billed calls | Fixed `0dbc0da` — `AGENTOS_ENABLE_LIVE_AI` required |
| S4 | `settle_run` could double-count a run's cost | Fixed by 0019 — **not yet applied** |
| S5 | gitleaks not runnable locally | Mitigated: runs in CI on every push |

## 6. Business / legal blockers

- Privacy policy and terms of service: drafts needed, then legal review.
- Merchant / payment provider choice; VAT invoicing.
- Custom SMTP domain.
- Pricing (299 / 799 / 1,990 ILS) are hypotheses to validate in pilots.

## 7. Owner actions to unblock preview verification

1. agentos-demo → Settings → Environment Variables → **Preview**:
   `SUPABASE_SECRET_KEY` (the `sb_secret_…` key of AgentOS-Development),
   `AGENTOS_CRON_SECRET` (≥ 24 random characters), `AGENTOS_ENABLE_MOCK_PROVIDER=1`.
   Leave `AGENTOS_ENABLE_LIVE_AI` unset. Redeploy the latest commit.
2. In Agent Studio set MARKET's provider to **Simulation**, save, publish, run.
   Expected: status reaches "הסתיים", the output starts with
   "[סימולציה — לא תשובת מודל]", the trace has one `model_call` step, usage shows tokens.
   If it fails, the run page shows the code and — for owners — the runtime
   status panel, including whether the database accepts the server key.
3. Apply migration 0019 (`docs/APPLY_MIGRATIONS.md`, incremental section).
4. Confirm Production Branch = `main` in both Vercel projects.

## 8. Proposed real Anthropic smoke test (awaiting approval)

- Deployment: agentos-demo Preview only. Set `AGENTOS_ENABLE_LIVE_AI=1` for the test, unset afterwards.
- Agent: MARKET switched to Anthropic → **Claude Haiku 5.5**, spend cap $0.05 per run.
- One run, short input ("מה השירותים שלכם? ענה במשפט אחד").
- Worst case cost: bounded by the $0.05 cap (the provider computes `max_tokens` from it).
- Pass: status "הסתיים", real Hebrew answer, usage event with model `claude-haiku-5-5`, cost recorded as estimated.

## 9. Production deployment prerequisites

All of §4 resolved or explicitly deferred, §5 closed, §6 cleared, P5 billing in
sandbox, full customer-journey E2E on the preview, a written deploy and rollback
plan, and the owner's explicit Go-Live.
