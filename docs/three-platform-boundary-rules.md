# Three-Platform Boundary Rules

Last updated: 2026-03-08

This document defines the layer boundaries that phase 0 locked before the repo was reshaped into a web + mobile monorepo.

## Runtime Layers

- `apps/web/app/`, `apps/web/components/`, `apps/web/middleware.ts`, and `apps/web/lib/server/` remain web/server-only code.
- `apps/mobile` is the native shell and can use Expo / React Native APIs, but it cannot depend on Next.js or `apps/web/*` modules.
- `packages/contracts`, `packages/domain`, `packages/api-client`, `packages/query`, `packages/navigation`, and `packages/design-tokens` are the shared layer.

## Allowed Dependency Direction

- Web and mobile shells may depend on shared packages.
- API routes, server loaders, and edge/backend code may depend on shared packages.
- Shared packages may depend on other shared packages and environment-neutral npm libraries only.

## Forbidden in Shared Packages

- `next/*` and any other Next.js runtime module.
- `lib/server/*` and other server-only loaders/helpers.
- Web UI modules from `apps/web/app/*`, `apps/web/components/*`, or `apps/web/middleware.ts`.
- Browser/service-worker-only APIs such as `window`, `document`, `localStorage`, `sessionStorage`, `navigator.serviceWorker`, `Notification`, `PushManager`, `caches`, and `clients`.

## Forbidden in `apps/mobile`

- `next/*`
- `lib/server/*`
- Web UI modules from `apps/web/app/*`, `apps/web/components/*`, or `apps/web/middleware.ts`

## Enforcement

- CI now runs `npm run check:three-platform:boundaries`.
- The boundary check scans `packages/**` and `apps/mobile/**` for forbidden imports and common browser/service-worker API usage.
- The check is intentionally in place before the shared/mobile packages deepen so the monorepo layout cannot introduce invalid dependencies silently.

## Current Debt To Resolve During Extraction

- `apps/web/lib/ar/alignmentFeedback.ts` currently imports trajectory contract types from `apps/web/lib/server/trajectoryContract`.
- `apps/web/lib/jep/guidance.ts` currently imports trajectory contract types from `apps/web/lib/server/trajectoryContract`.

Those contracts need to move into the shared layer during phase 3 so extracted portable code does not keep a server-only dependency edge.
