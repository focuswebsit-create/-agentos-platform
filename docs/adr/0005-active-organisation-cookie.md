# ADR-0005 — The active organisation is a cookie, and the cookie is not authority

- **Status:** Accepted (P1)
- **Date:** 2026-11-14

## Context
`API_CONTRACT.md` requires that `org_id` is "resolved from authenticated selected workspace and authorizations, never blindly trusted from request body". Two shapes were available: a server-side cookie holding the selected workspace, or an organisation segment in the URL (`/app/[orgSlug]/…`).

## Decision
A server-side cookie, `agentos_active_org`: `httpOnly`, `SameSite=Lax`, `Secure` on HTTPS, containing a bare UUID — no role, no permissions.

**The cookie is a pointer, never authority.** `resolveOrgContext()` re-reads the membership and the role from the database on every request. A cookie naming an organisation the user cannot reach falls back **silently** to their default; it does not error, because an error would confirm that the organisation exists.

Switching workspace is protected by three independent layers: POST only, an `Origin`/`Sec-Fetch-Site` check, and a double-submit token compared in constant time.

## Known limitation, and its mitigation
A cookie is per-browser, so **two tabs cannot be in two organisations at once**, and switching in one tab changes the context of a form already open in another.

Left alone this is not merely inconvenient — it is a silent write to the wrong tenant. So every mutation carries the `orgId` the screen was rendered with, and the server refuses a mismatch with `STALE_ORG_CONTEXT` instead of guessing.

## Migration path to org-scoped URLs, prepared but not taken
1. `organizations.slug` is unique and indexed from the first migration.
2. All context resolution goes through `resolveOrgContext()`, so the source of the id changes in **one function**.
3. No `orgId` appears in client-side links.

Revisit when customers routinely belong to several organisations. Until then the refactor of 13 routes, the navigation config and the E2E suite buys nothing.

## Consequences
- Clean URLs, no change to the P0 route structure.
- Reading a cookie makes `/app/*` dynamic; with `cacheComponents` enabled those routes carry `export const instant = false`, which is correct regardless — a per-user screen must never be served from a shared cache.
