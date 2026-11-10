# Supabase (future — P1+)

This folder is intentionally empty in **P0**. No Supabase project, keys or schema exist yet.

- `migrations/` — SQL migrations with RLS and composite org foreign keys (see `DATA_MODEL.md`). First migration lands in **P1** (organizations, memberships, invitations, platform_admins).
- `tests/` (P1) — RLS / cross-tenant negative isolation tests; release blockers per `SECURITY.md`.

Rules (`CLAUDE.md`): migrations/seed for development only; a separate **Supabase Development** project; no production migration without explicit owner approval; service-role key is server-only and never reaches the browser, LLM prompts, CI logs or the repo.
