# Repo Map

Date: `2026-04-10`

## High-Level Shape

| Area | Role | Approx size / count | Audit note |
| --- | --- | --- | --- |
| `apps/web` | customer web + admin + BFF/API | `875` clean source files | hottest product area |
| `apps/mobile` | Expo native client | `275` clean source files | raw file count is inflated by local native/generated trees |
| `packages/*` | shared logic/contracts/navigation/query/UI primitives | `8` packages | real shared layer; mostly aligned with intended architecture |
| `supabase/migrations` | database history | `323` migration files | own cleanup lane required |
| `supabase/functions` | backend jobs/edge functions | `71` function folders | large runtime surface |
| `scripts` | guards, audits, backfills, ops tools | `154` files | too coupled to app internals |
| `docs` | plans, runbooks, audits, evidence | `121` files | needs archive taxonomy |
| `shared` | shared WS45 helpers | `3` files | structural drift; belongs in `packages/` |

## Root-Level Inventory

Root-level items that look intentional and should remain minimal:
- `package.json`
- `package-lock.json`
- `turbo.json`
- `tsconfig*.json`
- `.nvmrc`
- `.node-version`
- `.npmrc`
- `Dockerfile`
- `docker-compose.yml`
- `AGENTS.md`
- `README.md`

Root-level clutter candidates:
- `THREAD_PLAN_SEO_AUDIT_VS_LAUNCH_SITES_FULL_PATCH_LOG.md`
- `SESSION_CODE_CHANGES.md`
- `ROLLBACK_DOCS.md`
- `DEPLOYMENT_GUIDE.md`
- `MISSION_CONTROL_IMPLEMENTATION_GUIDE.md`
- `SUPABASE_CLI_GUIDE.md`
- `agent.md`
- `samSessionToken.eq.*`
- `tmp-check.cjs`
- `tmp_sam_*`

## Active First-Party Code Areas

### `apps/web`

- Includes:
  - public site
  - SEO/share/discovery surfaces
  - admin/internal surfaces
  - Next.js BFF/API layer
- Notable hotspots:
  - `apps/web/app/api/**`
  - `apps/web/lib/server/**`
  - launch detail and feed UI
- Notable cleanup seam:
  - `apps/web/lib/server/v1/mobileApi.ts` is an oversized consolidation point

### `apps/mobile`

- Includes:
  - Expo Router customer app
  - native auth/billing/push/device flows
  - local Expo modules under `apps/mobile/modules/*`
- Important note:
  - raw file count is misleading because local native/generated trees are present
  - generated local folders are ignored and not tracked

### `packages`

- `api-client`, `contracts`, `domain`, `navigation`, `query` are the main architectural win in the current repo
- `launch-detail-ui` and `launch-animations` are useful shared seams, not obvious deletion targets
- `design-tokens` is small and mobile-focused

### `supabase`

- `migrations/`
  - long-running history with significant churn in policy, scheduler, and function definitions
- `functions/`
  - large family of ingestion, monitoring, notification, and trajectory jobs
- `templates/`
  - auth email templates
- `seed.sql`
  - single canonical seed file

## Drift And Bloat Areas

### `shared/`

Files:
- `shared/ws45LiveBoard.ts`
- `shared/ws45Parser.ts`
- `shared/ws45PlanningParser.ts`

Why it matters:
- this is shared business logic outside the shared package layer
- it is imported by both `apps/web` and `supabase/functions`
- it makes the real package graph harder to reason about

### `.artifacts/`

- Tracked in git
- currently contains generated evidence, logs, JSON reports, markdown outputs, and local acceptance artifacts
- this is the most obvious tracked non-source bloat area

### `docs/evidence/`

- tracked evidence summaries
- overlaps conceptually with `.artifacts/`
- adds another permanent home for generated proof without a clear retention rule

### `docs/2026-*.md`

- `48` dated docs at the top level of `docs/`
- mix of plans, audits, runbooks, and one-off decision logs
- no clear split between active reference docs and historical archives

### `scripts/`

- operationally important but structurally messy
- many scripts import `apps/web` internals directly
- several script entrypoints have no package/workflow/doc callers

## Generated / Vendor Areas

These should be excluded from architecture judgments but still reported:

- `apps/web/.next`
- `.turbo`
- `node_modules`
- `apps/mobile/.expo`
- `apps/mobile/ios`
- `apps/mobile/android`
- `apps/mobile/node_modules`
- `supabase/.temp`

Tracked vs untracked:
- tracked: `.artifacts/**`, `docs/evidence/**`, `supabase/.branches/_current_branch`
- untracked/ignored: `.next`, `.turbo`, `node_modules`, Expo native/generated folders

## Hot Vs Cold

Recent churn over the last 90 days shows:

Hot:
- `apps/web`
- `apps/mobile`
- `supabase/migrations`
- `supabase/functions`
- `packages/domain`
- `docs/three-platform-overhaul-plan.md`

Cold or likely stale:
- root temp files tracked since initial commit
- one-off root guides last materially touched in mid-March
- old audit/session logs that still reference `/Users/petpawlooza/Documents/TMinusNow`
- missing-doc references preserved in active plan docs

## What The Repo Really Optimizes For Today

- shipping web features quickly
- shipping additive mobile parity work without breaking web
- using shared packages for contracts/query/navigation/domain, but not fully enforcing that discipline for all shared logic
- keeping a lot of operational and planning context in git, even when that context is ephemeral

That last point is the main source of repository bloat.

