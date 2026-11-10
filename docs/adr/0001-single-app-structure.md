# ADR-0001 — Single Next.js app instead of a monorepo (P0)

- **Status:** Accepted (P0)
- **Date:** 2026-11-10

## Context
`ARCHITECTURE.md` recommends a monorepo (`apps/web`, `packages/contracts`, `packages/agent-engine`, `packages/billing`, `packages/templates`). The P0 prompt (`00_repo_audit_and_scaffold.md`) allows "a simpler safe structure" if justified, and the owner asked for a simple, orderly repository over a monorepo that is not needed yet.

## Decision
One Next.js (App Router) application at the repository root. Domain code lives in `src/modules/*`, mapping 1:1 to the future packages:

| Future package | P0 location |
|---|---|
| `packages/contracts` | `src/modules/contracts` (Zod schemas + types) |
| `packages/billing` | `src/modules/billing` (`BillingProvider` interface, planned plan catalog) |
| `packages/agent-engine` | `src/modules/agent-engine` (model registry + tool catalog, display only) |
| `packages/templates` | `src/modules/templates` (template metadata) |

Boundaries are kept by folders and routes: public site `src/app/(marketing)`, customer workspace `src/app/app` (`/app`), Super Admin `src/app/admin` (`/admin`, separate layout/nav/components), shared UI `src/components/{ui,shared}`.

Rules that keep a later split cheap:
- `src/modules/*` must not import from `src/app` or `src/components`.
- UI imports domain code only via `@/modules/<name>` entry points.

## Consequences
- Faster setup, a single lockfile/CI job, no workspace tooling.
- When the runtime worker (P3, Inngest) or a second deployable appears, revisit and extract `src/modules/*` into workspace packages (new ADR).
