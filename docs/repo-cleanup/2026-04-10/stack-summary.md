# Stack Summary

Date: `2026-04-10`

Platform matrix:
- `Web: included`
- `iOS: included`
- `Android: included`
- `Admin/internal impact: yes`
- `Shared API/backend impact: yes`
- `Request type: admin/internal repo maintenance`

## Primary Stack

- Package manager: `npm`
- Workspace model: npm workspaces declared in root `package.json`
- Orchestration: `turbo`
- Web app: `Next.js 14.2.35`, `React 18`
- Mobile app: `Expo 55`, `React Native 0.83`, `React 19`
- Shared packages: TypeScript source packages under `packages/*`
- Backend/runtime: `Supabase` migrations + edge functions
- Secondary runtime: `Deno` for the `jep-black-marble-batch` GitHub workflow and script
- Container/dev parity: root `Dockerfile` and `docker-compose.yml`

## Toolchain Enforcement

- Canonical toolchain files:
  - `package.json`
  - `.nvmrc`
  - `.node-version`
  - `Dockerfile`
  - `package-lock.json`
- Enforced pins:
  - Node `24.14.1`
  - npm `11.11.0`
- Enforcement mechanisms:
  - `engine-strict=true` in `.npmrc`
  - `preinstall` script: `node scripts/check-toolchain.cjs`
  - `doctor` script: `node scripts/doctor-toolchain.cjs`
- Current audit environment:
  - `node -v` -> `v24.14.1`
  - `npm -v` -> `11.11.0`
  - `npm run doctor` -> pass

## Workspace Boundaries

Root workspaces:
- `apps/*`
- `packages/*`

Deployable apps:
- `apps/web`
- `apps/mobile`

Shared packages:
- `@tminuszero/api-client`
- `@tminuszero/contracts`
- `@tminuszero/design-tokens`
- `@tminuszero/domain`
- `@tminuszero/launch-animations`
- `@tminuszero/launch-detail-ui`
- `@tminuszero/navigation`
- `@tminuszero/query`

Observed boundary drift:
- `shared/` is outside `packages/` but is imported by both `apps/web` and `supabase/functions`
- `scripts/` imports `apps/web` internals extensively, so tooling is coupled to app implementation details
- `apps/mobile` needs Metro aliasing for `@tminuszero/launch-detail-ui`, which is a sign that package resolution is not fully standardized across the repo

## Package Graph, High Level

- `apps/web`
  - depends on root deps plus shared packages
  - transpiles selected shared packages via `next.config.mjs`
- `apps/mobile`
  - depends on `api-client`, `contracts`, `design-tokens`, `domain`, `launch-animations`, `launch-detail-ui`, `navigation`, `query`
- `packages/api-client`
  - depends on `@tminuszero/contracts`
- `packages/domain`
  - depends on `@tminuszero/contracts`
- `packages/launch-detail-ui`
  - depends on `contracts`, `domain`, `design-tokens`
- `packages/query`
  - depends on `@tanstack/react-query`

## Build / Runtime Tooling

- Web:
  - `next dev`
  - `next build`
  - `next start`
- Mobile:
  - `expo start`
  - `expo run:ios`
  - `expo run:android`
  - Detox iOS/Android commands in `apps/mobile/package.json`
- Repo orchestration:
  - `turbo run lint`
  - `turbo run type-check`
  - `turbo run build`
- Backend:
  - Supabase migrations in `supabase/migrations`
  - Supabase functions in `supabase/functions`
  - root `scripts/` for audits, backfills, guards, and smoke tests

## CI And Merge Gates

Primary workflows:
- `.github/workflows/ci.yml`
- `.github/workflows/acceptance-preflight.yml`
- `.github/workflows/mobile-e2e.yml`
- `.github/workflows/jep-black-marble-batch.yml`

Actual merge-gating checks from `ci.yml`:
- `npm run doctor`
- `npm ci`
- `npm run check:three-platform:boundaries`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`
- `npm run build`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run test:mobile-security-guard`
- `npm run test:shared-domain`
- `npm run test:phase3-web-guard`
- `npm run test:web-regression`
- `npm run test:billing-regression`
- `npm run test:smoke`
- trajectory replay / KPI / baseline evidence steps
- `docker build -t tminusnow:ci .`

## Active Areas

- `apps/web`
  - hottest area by recent churn
  - large App Router API surface under `apps/web/app/api`
- `apps/mobile`
  - Expo Router app with native module folders
  - first-party source is relatively small once generated local trees are excluded
- `packages/*`
  - real shared layer, especially `contracts`, `domain`, `navigation`, `query`
- `supabase/*`
  - very active and large operational surface
- `scripts/*`
  - audit/guard/backfill surface; currently coupled to app internals
- `docs/*`
  - high-volume plan/runbook layer, not cleanly archived

## Generated / Vendor Areas To Exclude From Architecture Analysis

These exist locally and materially affect repo size, but they should not drive architecture decisions:

- `apps/web/.next`
- `.turbo`
- `node_modules`
- `apps/mobile/.expo`
- `apps/mobile/ios`
- `apps/mobile/android`
- `apps/mobile/node_modules`
- `supabase/.temp`

Tracked exceptions worth reporting:
- `.artifacts/**` is tracked
- `docs/evidence/three-platform/*` is tracked
- `supabase/.branches/_current_branch` is tracked

## Multiple Lockfiles / Multiple Package Managers

- `package-lock.json`
  - canonical JS dependency lockfile
- `deno.lock`
  - secondary lockfile for the Deno-based Black Marble batch workflow

Conclusion:
- This is not a pnpm/yarn/bun split-brain repo.
- It is primarily an npm repo with a small Deno sidecar.

## Config Duplication Worth Cleanup

- path alias config exists in multiple places:
  - root `tsconfig.json`
  - `apps/web/tsconfig.json`
  - `apps/mobile/tsconfig.json`
  - `apps/mobile/metro.config.js`
  - `apps/web/next.config.mjs`
- docs and runbooks duplicate toolchain and validation instructions across many files
- root-level operational docs duplicate information that belongs in `README`, `docs/runbooks`, or git history

