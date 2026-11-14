# AgentOS — release readiness

**Verdict: NOT ready for paying customers.** Release-candidate code is
progressing, but payments, the hosted migrations 0019–0022, a verified preview
run and a real-model test are all still open. This file never claims more than
the evidence in `TEST_RESULTS.md` supports.

Last updated: 2026-11-14 · last pushed commit: `11bf5c9`

**Owner-verified on the preview (2026-11-14):** login, FOCUS dashboard, MARKET in Agent Studio, a simulation draft test reaching "הסתיים" with trace and usage, one knowledge document + chunk created, migrations 0019–0022 applied (10/10 objects present).

**Legend.** PASS = verified by automated tests in this repository (scope noted).
LOCAL = passes against the local PostgreSQL 16 + Supabase shim or with fakes, not
against the hosted stack. BLOCKED = needs an owner action or credential.
NOT TESTED = no evidence yet. FAIL = known broken.

## 1. Gate matrix

| # | Gate | Status | Evidence / blocker |
|---|---|---|---|
| 1 | Authentication (sign-up, sign-in, reset) | PASS (owner use) · LOCAL | Owner signed in and created FOCUS on the preview; auth client timeouts unit-tested. No automated E2E against GoTrue. |
| 2 | Organisation creation | PASS (owner use) · LOCAL | FOCUS created on the preview; RLS group 15 |
| 3 | Team permissions (4 roles, escalation vectors) | LOCAL | RLS groups 2–3, unit `tenancy` |
| 4 | Tenant isolation | LOCAL | Every group has cross-org negatives (orgs, agents, runs, trace, usage, billing, knowledge) |
| 5 | Agent Studio: save draft | PASS (owner use) · LOCAL | CSRF fix `aed5111`; owner saw the published MARKET version |
| 6 | Publishing | PASS (owner use) · LOCAL | RLS group 10 |
| 7 | Simulated run completes | **PASS-PREVIEW (owner)** | MARKET draft test reached "הסתיים" with trace and usage |
| 8 | Draft test-before-publish | **PASS-PREVIEW (owner)** | 0021 applied; RLS group 17 |
| 9 | Real Anthropic integration ready for authorised test | LOCAL · BLOCKED (approval) | Fake-SDK unit tests; gated by `AGENTOS_ENABLE_LIVE_AI`; smoke test proposal §4 |
| 10 | Usage recording, budget, settlement | LOCAL | RLS group 12 (+ 0019 double-settle), unit `executor` |
| 11 | Stuck-run recovery, no duplicate execution | LOCAL | Unit `run-recovery`, `run-execute`; RLS concurrent claim |
| 12 | Plan entitlements (budget, concurrency, lapsed) | LOCAL · BLOCKED (0020) | RLS group 16 |
| 13 | Knowledge retrieval, org-isolated, injection-framed | LOCAL · storage PASS-PREVIEW | Document + chunk created on the preview; retrieval path verified locally incl. Hebrew prefixes; preview check steps in `P07_FINAL_ACCEPTANCE.md` |
| 14 | Billing sandbox checkout + webhooks | BLOCKED | Payment provider not chosen (ADR-0013). Schema dedupe ready. |
| 15 | Workflows / scheduled runs / web chat / WhatsApp | NOT STARTED | — |
| 16 | Tools with human approval | NOT STARTED | Required before any outbound action exists |
| 17 | Super Admin (orgs, usage, audit, templates, suspension) | LOCAL | RLS groups 8b, 13; unit `platform-admin-data`; needs a `platform_admins` row + TOTP to use |
| 18 | CSRF on all mutation methods | PASS | unit `csrf-methods` (systemic route scan) |
| 19 | Secrets never in browser/repo/logs | PASS | ESLint rings (probed), CI gitleaks on every push, local pattern scan |
| 20 | Vercel Preview deployment builds | PASS | GitHub commit statuses: agentos-demo "Deployment has completed" per commit |
| 21 | Vercel Preview functional verification | BLOCKED | `*.vercel.app` refused by this container's network proxy |
| 22 | Customer onboarding without developer help | NOT TESTED | Needs gates 7, 12–14 on the preview |
| 23 | API rate limiting | NOT STARTED | Runs are bounded by budget, concurrency and auth; no per-IP limiter yet (residual risk R2) |

## 2. Security findings

| # | Finding | Severity | Status |
|---|---|---|---|
| S1 | CSRF refused all non-POST mutations | High (availability) | Fixed `aed5111` |
| S2 | anon held EXECUTE on 12 functions via default privileges | Medium | Fixed by 0017 (applied on Development) |
| S3 | A key alone enabled billed calls | Medium | Fixed `0dbc0da` (`AGENTOS_ENABLE_LIVE_AI`) |
| S4 | `settle_run` could double-count | Medium | Fixed by 0019 — not applied |
| S5 | Plan quotas not enforced server-side | High (commercial) | Fixed by 0020 — not applied |
| S6 | Knowledge content could carry prompt injection | Medium | Mitigated: framed as data, fence tags neutralised, no tools exist that it could trigger |
| S7 | Settlement used the current month, not the run's; cancelled late settlement counted twice on retry | Medium | Fixed by 0023 — **not applied** (0019 as applied has both defects) |
| — | Open Critical/High findings | — | **None known** |

Residual risks: **R1** execution is not durable (inline + recovery, no queue);
**R2** no per-IP rate limiter on public auth pages beyond Supabase's own;
**R3** knowledge search is keyword-based (Hebrew prefixes reduce recall).

## 3. Owner actions to unblock verification

1. agentos-demo → Environment Variables (**Preview**): `SUPABASE_SECRET_KEY`,
   `AGENTOS_CRON_SECRET` (≥ 24 chars), `AGENTOS_ENABLE_MOCK_PROVIDER=1`; leave
   `AGENTOS_ENABLE_LIVE_AI` unset; redeploy the latest commit.
2. ✅ 0019–0022 applied by the owner. **Now apply 0023** (`docs/APPLY_MIGRATIONS.md`,
   incremental sections). Do not run the full bundle on Development.
3. MARKET → provider **Simulation** → save → "בדיקת הטיוטה השמורה" → expect
   status "הסתיים", output starting "[סימולציה — לא תשובת מודל]", one trace
   step, usage shown. Then publish and run the published version.
4. Confirm Production Branch = `main` in both Vercel projects.
5. Choose a payment provider (sandbox first) — unblocks gate 14.

## 4. Proposed real Anthropic smoke test (awaiting approval)

agentos-demo Preview only; `AGENTOS_ENABLE_LIVE_AI=1` for the test then unset;
MARKET on **Claude Haiku 5.5** with a $0.05 per-run cap; one run, one-sentence
Hebrew question. Worst case is bounded by the cap. Pass: "הסתיים", real Hebrew
answer, usage event `claude-haiku-5-5`, cost recorded as estimated.

## 5. Production prerequisites

Gates 7, 12–14, 21, 22 PASS on the preview; payment sandbox verified and a
controlled live charge approved; legal review of `docs/legal/`; a written
deploy + rollback plan; the owner's explicit Go-Live.
