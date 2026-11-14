# ADR-0006 — Schema fields P1 adds beyond DATA_MODEL.md

- **Status:** Accepted (P1)
- **Date:** 2026-11-14

## Context
`DATA_MODEL.md` names the P1 tables and most of their columns, but P1 could not be built from that list alone. `CLAUDE.md` rule 14 requires additions to be recorded rather than slipped in.

## Decision — what was added, and why each is load-bearing

| Addition | Why |
|---|---|
| `organizations.seat_limit` (default 5) | `ROADMAP.md` P1 requires "invitation seat checking", but the entitlement engine is P5. Without a seat source there is nothing to check. Replaced by `entitlementResolver` in P5; **not customer-updatable** — 0003 withholds the UPDATE column privilege. The default is 5 rather than 1 so invitations are usable out of the box; there is no revenue to protect before P5. |
| `invitations.invited_by / accepted_by / accepted_at / revoked_at` | Required for revocation, single use, and "audit with reason/time" (`SECURITY.md` 6). The documented column list cannot express who issued or consumed an invitation. |
| `public.profiles(user_id, display_name)` | A `viewer` must see who is on the team without being handed email addresses. `auth.users` is unreadable by clients, so without a profile the member list would be either blank or a list of emails. |
| `public.log_platform_audit(...)` | `log_audit()` derives the actor from `auth.uid()`. The platform-admin module connects with the secret key and has **no JWT**, so every admin action would have been logged with an unknown actor. Granted to `service_role` only — naming an arbitrary actor is a privilege. |
| `public.org_seat_usage(uuid)` | `org_seats_taken()` takes any organisation id and returns a headcount, making it an existence-and-size oracle for other tenants. It is now internal; this wrapper checks membership first. |
| Enum values for `org_role`, `org_status`, `invitation_status`, `platform_admin_role`, `actor_type` | `DATA_MODEL.md` names these columns but specifies no values. |

## Deliberately NOT added
- No `profiles.theme` / `profiles.locale`. `docs/IMPLEMENTATION_LOG.md` floated profile preferences for P1; they are not needed by any P1 gate, so the theme stays in `localStorage`.
- No customer MFA columns (see ADR-0003).

## Consequences
- The schema is a superset of `DATA_MODEL.md`, never a contradiction of it.
- `DATA_MODEL.md` should absorb these in the P5 pass, when `seat_limit` is superseded.
