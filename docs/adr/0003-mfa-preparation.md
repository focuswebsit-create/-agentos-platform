# ADR-0003 — MFA: enforced for platform admins, not offered to customers yet

- **Status:** Accepted (P1)
- **Date:** 2026-11-14

## Context
MFA is specified only for Super Admin: `PRD.md` §5 "MFA ל-superadmin", `ROADMAP.md` P6 "MFA admin scope", `QUALITY_GATES.md` 12 "Admin with MFA…". There is **no** customer MFA requirement anywhere, and no data model for one. Supabase supports TOTP for every user, so adding it for customers was possible — and would have been new, undocumented scope.

## Decision
- **Platform admins:** AAL2 is enforced **server-side on every admin request** when the `platform_admins` row says `mfa_required`. Reading `aal` only in the UI would be a suggestion, not a boundary.
- **Customers:** no MFA UI in P1. `public.current_aal()` exists so a future `RESTRICTIVE` policy (`auth.jwt()->>'aal' = 'aal2'`) can be added without a migration to the helper layer.
- The per-row `mfa_required` column, rather than a project-wide Supabase setting, keeps enforcement in database state where it can be audited and varied per administrator.

## Consequences
- The privileged boundary is protected from the first commit that exposes it.
- Customer-facing MFA, and any per-organisation "require MFA" policy, is a later scoped PR: a column on `organizations`, a restrictive policy, and a lockout-recovery flow.
- **Not verified locally:** the shim injects the `aal` claim by hand. That GoTrue only issues `aal2` after a genuinely verified second factor is a property of GoTrue, and can only be confirmed against the Supabase Development project.
