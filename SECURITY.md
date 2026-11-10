# Security, Privacy, Compliance — AgentOS Commercial v1.0

1. **Isolation:** org membership check in API and strict RLS for DB tables, vector queries, storage paths and nested relations. Negative cross-tenant tests are release blockers. Backend service role used only in private modules with explicit org filters.
2. **Plan/usage security:** backend entitlement checks at write entry and worker step; transactional spend reservation and rate limiting per org, IP, session. Trials protected against abuse.
3. **Tool and AI trust boundary:** model output is untrusted. Tools execute only through curated server handlers after policy intersection (user, org, agent, workflow, plan). Prompt injection in uploaded docs cannot elevate privileges.
4. **Sensitive operations:** outbound messages, external writes, deletions, publishing, payments require bounded explicit approval displaying full recipient/action/arguments, hash, expiry, RBAC and replay prevention. No arbitrary code/shell/untrusted MCP in MVP.
5. **Payment security:** PCI card data stays in provider-hosted UI; never store PAN/CVV. Validate signed webhook on raw body, idempotency/replay, amount, currency, org provider IDs, periodic reconciliation. No access on client redirect alone.
6. **Admin:** MFA and separate platform admin policy, scoped metadata visibility, no uncontrolled impersonation, dual control for refunds/high-impact overrides, audit with reason/time and immutable logs.
7. **Secrets:** managed secret store; no API keys in browser, AI context, analytics, traces, screenshots or repo. OAuth least-privilege and rotate/revoke handling.
8. **SSRF/data loss:** no arbitrary outbound URLs; restrict safe connectors and redirect resolution, deny private IPs, bound payload, file antivirus/scanning where feasible, MIME+size validations.
9. **Operational:** retry with backoff, dead letter, timeout, cancellation, incident alerts, backup/restore testing, security headers, dependency scanning, rate limiting and replay tests.
10. **Privacy and legal:** privacy policy, data processing terms, consent basis, retention/deletion/export processes and vendor DPA review. Israel Privacy Protection Amendment 13 in force since 2025; obtain legal advice on controller/processor duties, security classification, DPO/registration where applicable. GDPR considerations if expanding abroad. No claim of compliance certification without formal audit.
11. **Regulated uses:** avoid automated medical/legal/credit/financial determinations in MVP; human review and clear terms. Do not claim AI output is guaranteed accurate.
12. **Messaging compliance:** any real outgoing email/WhatsApp/SMS must respect applicable anti-spam and provider policies; MVP action requires opt-in/approval; no bulk cold outreach by autonomous agent.

Release blockers: cross-tenant leak, unauthorized tool call, unsigned billing grant, duplicate money-related action, uncontrolled model spend, hardcoded secrets, accidental private admin data access.
