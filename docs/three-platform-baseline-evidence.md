# Three-Platform Baseline Evidence

This document covers the repo-owned baseline and regression evidence slice for the open tracker items in `docs/three-platform-overhaul-plan.md`.

## Commands

- Capture the consolidated evidence bundle:
  - `npm run baseline:three-platform -- --out-dir=.artifacts/three-platform-baseline`
- Capture the local acceptance bundle against local Supabase:
  - `npm run acceptance:local -- --skip-mobile-e2e --out-dir=.artifacts/three-platform-local-acceptance`
- Run the shared query/request-count guard directly:
  - `npm run test:mobile-query-guard`
- Run the web closeout/static regression guard directly:
  - `npm run test:phase3-web-guard`
- Run the hot-path regression guard directly:
  - `npm run test:three-platform:hot-path`
- Run the durable rate-limit smoke directly:
  - `npm run test:rate-limit-smoke -- --out=.artifacts/three-platform-local-acceptance/rate-limit-smoke.json --markdown=.artifacts/three-platform-local-acceptance/rate-limit-smoke.md`
- Capture API TTFB only after a production web build exists:
  - `npm run perf:ttfb -- --accept=application/json --route=/api/v1/launches?limit=20&region=all --route=/api/v1/search?q=starlink&limit=8 --output=.artifacts/three-platform-baseline/ttfb-bench.json --markdown=.artifacts/three-platform-baseline/ttfb-bench.md`

## Artifacts

`npm run baseline:three-platform` writes these files into the requested output directory:

- `baseline-summary.json`
- `baseline-summary.md`
- `mobile-query-guard.json`
- `mobile-query-guard.md`
- `phase3-web-guard.json`
- `phase3-web-guard.md`
- `ci-task-graph.json`
- `ttfb-bench.json` and `ttfb-bench.md` when a production web build is available

`npm run acceptance:local` additionally writes:

- `seed.json`
- `preflight/summary.md`
- `preflight/billing/billing-evidence.json`
- `rate-limit-smoke.json`
- `rate-limit-smoke.md`

## What Is Captured

- Request-count and cache-reuse evidence for the in-repo query/client layer:
  - viewer bootstrap
  - feed bootstrap
  - search fan-out/cache reuse
  - account bootstrap
  - saved bootstrap
  - preferences bootstrap
- Remaining raw `fetch('/api/...')` call-site count across `apps/web`, plus a hard failure for new regressions on mobile-critical surfaces.
- Static source-shape checks for the high-risk web surfaces tied to this slice:
  - feed
  - account
  - saved
  - preferences
  - auth callback / auth return handling
  - upgrade intent / checkout entry surface
- API TTFB for `/api/v1/launches` and `/api/v1/search` when the production web build is present.
- Static CI task graph inventory from `turbo.json` plus workspace package scripts.
- Hot-path regression proof that legacy search and subscription reads no longer warm or reconcile on read, and that mobile-critical durable limits are enforced at route level instead of in middleware memory.
- Local-stack billing evidence for the deterministic premium fixture user so billing summary, entitlements, purchase events, and webhook-event joins can be inspected without a separate environment.

## Known Gaps

- Feed render and scroll performance still require a browser or device harness. The repo-owned scripts capture request/cache evidence only.
- Auth-return and upgrade-intent coverage is static-source and helper-based, not a browser E2E flow.
- TTFB capture is skipped unless `apps/web/.next/BUILD_ID` exists.

## Tracker Mapping

This evidence slice is intended to support these open Phase 0 / hardening items:

- Phase 0 baseline metrics
- phase-end smoke/perf validation discipline
- request-count and cache-reuse checks
- remaining raw `/api` fetch visibility in `apps/web`
- CI task graph efficiency visibility
