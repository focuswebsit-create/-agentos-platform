# AgentOS — P07 final acceptance

**Status: NOT READY FOR GO-LIVE REVIEW.** This file is the acceptance record for
the release candidate. Each step is marked with the strongest evidence that
exists for it, and nothing is marked PASS on the strength of a build or a
simulation alone.

Last updated: 2026-11-14 · branch `claude/agentos-p1-infrastructure-9gibn2`

Legend: **PASS-PREVIEW** verified by the owner on the agentos-demo preview ·
**LOCAL** automated tests here (local PostgreSQL 16 + Supabase shim, fakes for
SDKs) · **BLOCKED** needs an owner action or credential · **NOT BUILT**.

## Customer journey (20 steps)

| # | Step | Status | Evidence / what is missing |
|---|---|---|---|
| 1 | Marketing website | LOCAL | E2E smoke (34) renders public pages, RTL, mobile widths |
| 2 | Review plans | LOCAL | `/pricing`; `/app/billing` catalog (0020 applied on Development) |
| 3 | Register | PASS-PREVIEW (owner) | Owner account; no automated GoTrue E2E |
| 4 | Verify email | BLOCKED | Custom SMTP not configured |
| 5 | Create organisation | PASS-PREVIEW (owner) | FOCUS; RLS group 15 |
| 6 | Invite a team member | LOCAL | Copy-link invitations; RLS group 8; automatic email not active |
| 7 | Test subscription in sandbox | BLOCKED | Payment provider not chosen; entitlements enforce once a subscription row exists |
| 8 | Create an agent | PASS-PREVIEW (owner) | MARKET |
| 9 | Add a knowledge source | PASS-PREVIEW (owner) | 1 document / 1 chunk created |
| 10 | Link knowledge to the agent | LOCAL | Selector in Agent Studio; executor retrieval tests |
| 11 | Successful agent test | PASS-PREVIEW (owner, simulation) | MARKET draft test reached "הסתיים" with trace and usage |
| 12 | Publish | PASS-PREVIEW (owner) | Published version visible |
| 13 | Access through a channel | LOCAL · BLOCKED (0024) | Web Chat built (`6cf7cc3`): DB group 20, unit `web-chat`, E2E framing/origin checks. WhatsApp not built (needs Meta credentials + approval) |
| 14 | Review conversations and executions | LOCAL · BLOCKED (0024) | Conversations under Integrations with take over / reply / close; runs with trace, sources, usage |
| 15 | Review usage and costs | LOCAL | Run usage panel, billing usage vs budget |
| 16 | Configure an automation | NOT BUILT | Workflows / schedules not built |
| 17 | Manage team permissions | LOCAL | Team screen, role changes; RLS groups 2–3 |
| 18 | Manage subscription | BLOCKED | Depends on step 7 |
| 19 | Contact support | PARTIAL | Procedures in `docs/business/LAUNCH_KIT_HE.md`; no in-app support channel |
| 20 | No developer help needed | NOT TESTED | Needs 4, 7, 13, 16 |

**Two-organisation isolation:** LOCAL — every DB test group asserts the other
organisation sees zero rows (249 checks). Not yet repeated through the UI with
two real accounts on the preview.

## Knowledge test phrase "מגדלור סגול 47"

| Check | Status |
|---|---|
| Stored as a document/chunk on Development | PASS-PREVIEW (owner) |
| Retrieved by full-text search, incl. Hebrew prefixes ("במגדלור") | LOCAL — real Postgres FTS check + unit tests |
| Reaches the provider boundary, cited as a source | LOCAL — executor test; on the preview, the simulation output now echoes the first excerpt and the run page lists sources |
| A real model uses it correctly | BLOCKED — needs approval for a paid Claude run |

**To verify on the preview (simulation):** link the knowledge base to MARKET,
save, "בדיקת הטיוטה השמורה" with the input `מה הקוד? מגדלור`. Expect the output
to contain `Knowledge excerpts received: 1` and `מגדלור סגול 47`, and the run
page to show the document under "מקורות". This proves the data path only.

## Go-Live checklist (all required)

- [ ] `supabase/apply/04_incremental_0023_0024.sql` applied to Development and verified
- [ ] Customer journey steps 1–20 PASS-PREVIEW with two organisations
- [ ] Email delivery (SMTP) configured and verified
- [ ] Payment provider chosen, sandbox checkout + signed webhooks verified, controlled live charge approved
- [ ] Web Chat verified on the preview (widget enabled, embedded on a test https site, reply, handoff)
- [ ] Approved real Claude smoke test passed
- [ ] Security: no open Critical/High (currently none known); rate limiting on public endpoints
- [ ] Legal review of `docs/legal/` drafts; privacy and terms published
- [ ] Deploy and rollback plan approved; Production Branch = `main` confirmed
- [ ] Owner's explicit Go-Live approval
