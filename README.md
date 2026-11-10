# AgentOS

Commercial multi-tenant SaaS for creating, managing and running AI agents and agent teams — no code, with control over permissions and spend.
Hebrew RTL first, English LTR infrastructure.

> **Status: P0 — Foundation & UI preview.** No authentication, no database, no billing, no AI provider.
> Every screen is a truthful empty state or a clearly labeled demo. Nothing executes.

Product/spec documents live at the repository root (`PRD.md`, `ARCHITECTURE.md`, `ROADMAP.md`, …). Work log: [`docs/IMPLEMENTATION_LOG.md`](docs/IMPLEMENTATION_LOG.md).

## Requirements
- Node.js 22 (`.nvmrc`), npm 10+

## Run locally
```bash
npm ci
cp .env.example .env.local   # placeholders only
npm run dev                  # http://localhost:3000
```

| Route | What |
|---|---|
| `/` | Marketing homepage |
| `/pricing` | Planned pricing (not purchasable) |
| `/app` | Customer workspace shell (demo, empty) |
| `/app/agents/studio` | Agent Studio UI preview (no model calls) |
| `/admin` | Super Admin shell — **404 unless** `ADMIN_SHELL_PREVIEW=true` |

To preview the admin shell on your machine only:
```bash
ADMIN_SHELL_PREVIEW=true npm run dev
```

## Scripts
| Command | Purpose |
|---|---|
| `npm run lint` | ESLint (zero warnings) |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` (strict) |
| `npm run test` | Vitest unit/component tests |
| `npm run build` | Production build |
| `npm run test:e2e` | Playwright smoke tests against `next start` (run `npm run build` first) |
| `npm run format` / `format:check` | Prettier |

## Structure
```
src/
  app/(marketing)/   public site        app/app/   customer workspace (/app)
  app/admin/         Super Admin (/admin, separate boundary)
  components/ui      shadcn/ui primitives    components/shared   cross-cutting UI
  components/{marketing,app-shell,studio,admin-shell}
  modules/           contracts · billing · agent-engine · templates (future packages, see ADR-0001)
  i18n/              he (default) / en dictionaries
  proxy.ts           /admin gate (Next.js 16 "proxy", formerly middleware)
supabase/migrations  empty until P1
tests/unit · tests/e2e
```

## Security notes
- `.env.example` holds placeholders only. Never commit real values; never expose secrets via `NEXT_PUBLIC_*`.
- No production deploy, real charge, or provider activation without explicit owner approval (`CLAUDE.md`).
