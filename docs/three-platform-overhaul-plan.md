# Three-Platform Overhaul Plan

Last updated: 2026-03-08

This is the living master checklist for moving T-Minus Zero from a web-only product to a maintainable, high-performance web + iOS + Android product line.

## Purpose

- Keep one source of truth for the overhaul.
- Track progress phase by phase with explicit acceptance and rollback gates.
- Protect web continuity while shared foundations, mobile, billing, notifications, and native-only capability are introduced.

## Current State Snapshot

- Current app shape: single-package Next.js App Router app at the repo root.
- Platform coupling snapshot:
  - `118` client files
  - `285` files importing `next/*`
  - `31` browser-side raw `/api/*` fetch call sites
  - `135` route files under `app/api`
  - `62` Supabase Edge Functions in `supabase/functions`
- Major blockers already confirmed:
  - Cookie/browser-oriented auth
  - Tailwind + DOM + `next/*` UI coupling
  - Web Stripe billing flow
  - Web Push service worker flow
  - Browser-only AR runtime
- Backup refs already created before overhaul work:
  - Branch: `backup/pre-mobilechanges3-7-26`
  - Tag: `pre-mobilechanges3-7-26`
  - Schema tag: `pre-mobilechanges3-7-26-schema`

## Locked Decisions

- [x] Use an Expo-based monorepo for mobile.
- [x] Share code domain-first, not UI-first.
- [x] Ship core mobile product first: feed, search, detail, auth, saved items, preferences, push registration.
- [x] Keep Next.js API routes as the shared BFF during the overhaul.
- [x] Use native IAP on mobile and keep Stripe on web behind shared entitlements.
- [x] Use Expo Notifications first for native push.
- [x] Keep admin web-only until the core three-platform product is stable.

## Non-Negotiable Guardrails

- [ ] Shared packages must not import `next/*`, DOM APIs, service-worker APIs, or `lib/server/*`.
- [ ] Mobile-critical APIs must not perform sync-on-read, warm-on-read, or admin retry fallback on the hot path.
- [ ] DB and auth changes remain additive until the final cutover window.
- [ ] Web remains releasable at the end of every phase.
- [ ] Each phase ends with explicit smoke coverage, rollback notes, and perf validation.
- [ ] New shared client flows must use typed contracts rather than ad hoc JSON shapes.
- [ ] Request dedupe, cache policy, and refresh cadence must be centralized, not component-local.

## Success Criteria

- [ ] Web, iOS, and Android are first-class products with platform-appropriate UX.
- [ ] Shared code is concentrated in domain logic, contracts, API client, query policy, navigation intents, and design tokens.
- [ ] The backend remains low-IO and avoids scaling request amplification as mobile traffic is added.
- [ ] The repo is easier to evolve than the current web-only app, not harder.

## Phase Dashboard

- [ ] Phase 0 complete: Safety rails and baseline
- [ ] Phase 1 complete: Monorepo extraction
- [ ] Phase 2 complete: Contracts and auth hardening
- [ ] Phase 3 complete: Web decoupling
- [ ] Phase 4 complete: Mobile core product
- [ ] Phase 5 complete: Billing and entitlements unification
- [ ] Phase 6 complete: Advanced native capability
- [ ] Phase 7 complete: Hardening and cutover

## Phase 0 - Safety Rails and Baseline

Goal: lock the architecture, preserve rollback points, and capture the current system before structural changes begin.

- [x] Create pre-mobile Git backup branch/tag.
- [x] Create remote schema dump backup and preserve it in Git.
- [x] Complete repo architecture audit for web/mobile blockers.
- [x] Create this master tracking document.
- [ ] Capture baseline metrics for web and API behavior:
  - request counts for home feed, search, account
  - TTFB for public launches and search
  - search request fan-out and cache behavior
  - feed render/scroll performance
- [x] Define shared package boundary rules and enforce them with lint or CI checks.
- [x] Inventory the mobile-critical API surface and map it to planned `/api/v1` contracts.
- [x] Record rollback docs for phases 1-3 before repo reshaping starts.

Acceptance gate:

- [ ] Baseline metrics are captured and stored in the repo.
- [x] All architectural decisions needed for phases 1-3 are written down.

Rollback gate:

- [x] Backup refs exist and are verified.
- [x] Baseline can be restored without guessing which commit or schema snapshot to use.

## Phase 1 - Monorepo Extraction

Goal: restructure the repo into a workspace monorepo without changing live product behavior.

- [x] Add npm workspaces for `apps/*` and `packages/*`.
- [x] Add `turbo.json` for workspace task orchestration and cache reuse.
- [x] Move the current Next app into `apps/web` with zero functional change.
- [x] Create `apps/mobile` as an Expo shell with routing, theme bootstrap, auth bootstrap, and no production features yet.
- [x] Add shared package scaffolds:
  - `packages/domain`
  - `packages/contracts`
  - `packages/api-client`
  - `packages/navigation`
  - `packages/design-tokens`
  - `packages/query`
- [x] Keep `supabase/` at repo root as the shared backend and operations layer.
- [x] Update CI and Docker to understand the workspace layout.

Acceptance gate:

- [x] `apps/web` builds and serves the current site without regression.
- [x] CI runs workspace-aware tasks successfully.
- [ ] No unexpected behavior changes land in web routes, auth, or billing.

Rollback gate:

- [ ] Root-to-`apps/web` move is isolated to a dedicated commit range.
- [ ] Restoring the pre-monorepo backup does not require manual file reconstruction.

## Phase 2 - Contracts and Auth Hardening

Goal: make the backend and auth model safe for native clients.

- [ ] Create `/api/v1` for all mobile-used routes.
- [x] Define versioned Zod contracts for:
  - viewer session
  - launch feed
  - launch detail
  - search
  - entitlements
  - profile
  - watchlists
  - filter presets
  - notification preferences
  - notification device registration
- [ ] Build `packages/api-client` as the only shared transport layer.
- [x] Introduce a single `resolveViewerSession(request)` path that supports web cookies and bearer tokens.
- [x] Keep current browser cookie auth for web while adding native bearer-token auth for API routes.
- [ ] Move auth callback and reset flows to platform-aware web + deep-link paths.
- [ ] Define API compatibility policy for mobile release lag.

Acceptance gate:

- [ ] Contract tests pass for every new `/api/v1` route.
- [ ] Protected APIs work with both cookie and bearer-token auth.
- [ ] Web behavior remains unchanged on legacy routes.

Rollback gate:

- [ ] Legacy routes remain functional until both web and mobile are migrated.
- [ ] New auth handling can be disabled without locking out web users.

## Phase 3 - Web Decoupling

Goal: break the current web app into shared logic plus web-only UI so mobile can reuse the right layers.

- [ ] Replace raw browser `fetch('/api/...')` usage in core surfaces with `packages/api-client`.
- [ ] Refactor the highest-risk mixed-concern components first:
  - `LaunchFeed`
  - `LaunchCard`
  - `SiteChrome`
  - account/preferences flows
- [ ] Move pure logic into shared packages:
  - time/countdown
  - search parsing
  - entitlement interpretation
  - navigation intents
  - trajectory math/contracts
- [ ] Replace web path-string helpers with shared navigation intents.
- [ ] Standardize web data access on a shared query/cache layer.
- [ ] Replace per-card countdown intervals with a centralized ticker.

Acceptance gate:

- [ ] Web uses shared contracts and API client on mobile-critical surfaces.
- [ ] Shared packages are free of `next/*`, DOM APIs, and server-only imports.
- [ ] Feed, account, and search behavior match pre-refactor behavior.

Rollback gate:

- [ ] Feature-level refactors are landed in isolated commits or PR slices.
- [ ] The old fetch paths can be re-enabled quickly if the shared client regresses.

## Phase 4 - Mobile Core Product

Goal: ship a first-class iOS and Android core product without billing purchase flow or AR.

- [ ] Build native feed.
- [ ] Build native search.
- [ ] Build native launch detail.
- [ ] Build native auth bootstrap and deep-link callback handling.
- [ ] Build native saved items, watchlists, and presets.
- [ ] Build native preferences and notification settings.
- [ ] Register Expo push tokens through the shared backend.
- [ ] Match shared entitlement reads used by web.

Acceptance gate:

- [ ] Mobile core journeys are covered by E2E tests.
- [ ] Feed, search, and detail screens do not duplicate avoidable requests.
- [ ] Native performance is acceptable on representative low-end devices.

Rollback gate:

- [ ] Mobile release can be held back independently of web.
- [ ] Backend changes required for mobile are backward compatible with web.

## Phase 5 - Billing and Entitlements Unification

Goal: separate product access from purchase provider and support web Stripe plus native IAP cleanly.

- [ ] Introduce provider-neutral entitlement records and server logic.
- [ ] Keep Stripe as the web purchase adapter.
- [ ] Add Apple App Store purchase adapter.
- [ ] Add Google Play purchase adapter.
- [ ] Implement restore-purchases and server-side receipt validation.
- [ ] Migrate web billing reads/writes behind the new entitlement model.
- [ ] Ensure the shared entitlement contract is identical across web and mobile.

Acceptance gate:

- [ ] Entitlements reconcile correctly across Stripe, Apple, and Google.
- [ ] Web billing flows still work during and after migration.
- [ ] Mobile can read premium state before native purchase UI launches.

Rollback gate:

- [ ] Stripe-only entitlement flow remains available until native reconciliation is proven stable.
- [ ] Provider-specific failures do not corrupt shared entitlement state.

## Phase 6 - Advanced Native Capability

Goal: add platform-native capabilities after the core product is stable.

- [ ] Design native AR architecture around shared trajectory/domain packages.
- [ ] Implement native AR runtime separately from the current web AR runtime.
- [ ] Add platform-native share flows and deep content linking.
- [ ] Evaluate Live Activities / Dynamic Island and Android equivalents.
- [ ] Add any native-only polish work that materially improves product quality.

Acceptance gate:

- [ ] Native-only features do not leak platform complexity back into shared packages.
- [ ] AR math and contract logic remain shared while runtimes stay platform-specific.

Rollback gate:

- [ ] Native advanced features can be disabled without affecting core product behavior.

## Phase 7 - Hardening and Cutover

Goal: finalize the three-platform architecture, remove legacy paths, and lock in maintainability.

- [ ] Deprecate legacy unversioned routes after all clients are migrated.
- [ ] Remove remaining web-only duplication from shared feature flows.
- [ ] Audit request amplification, cache policy, and hot-path IO after mobile traffic is live.
- [ ] Finalize docs for architecture, rollout, and rollback.
- [ ] Set long-term ownership for shared packages and platform shells.

Acceptance gate:

- [ ] Web, iOS, and Android are all on the intended architecture.
- [ ] Shared packages have clear ownership and low churn.
- [ ] Hot-path backend reads stay cache-backed and low-IO.

Rollback gate:

- [ ] Legacy compatibility is retired only after release-train confirmation.
- [ ] Final removals have recreate or restore instructions captured.

## Performance and IO Guardrails

- [ ] Shared client state uses one query/cache policy across web and mobile.
- [ ] Search freshness and other warm/sync jobs run off-request, not on read paths.
- [ ] Public/mobile-critical reads are cache-backed wherever possible.
- [ ] Middleware or rate limiting does not depend on single-instance memory for correctness.
- [ ] CI runs changed-workspace-only tasks and reuses caches aggressively.
- [ ] Large shared packages remain source-based and avoid unnecessary build artifacts.
- [ ] Mobile feed rendering avoids timer storms, image churn, and duplicate fetches.

## Testing and Release Gates

- [ ] Contract tests for every `/api/v1` route used by mobile.
- [ ] Shared-domain tests for time, search, entitlements, navigation intents, and trajectory math.
- [ ] Web regression coverage for feed, account, saved items, and preferences.
- [ ] Mobile E2E coverage for auth, deep links, feed, detail, saved items, and push registration.
- [ ] Perf checks for request counts, scroll performance, cache reuse, and CI task graph efficiency.
- [ ] Staged rollout gates for dogfood, beta, and public release on mobile.

## Open Questions

- [x] Decide whether a cross-platform primitive UI layer is still desirable after phases 2-4, or whether domain-first sharing remains the permanent strategy.
- [x] Decide whether native AR is a v1 premium feature or a follow-on premium feature after mobile core adoption is validated.

## Progress Log

- 2026-03-07: Completed repo audit for web-to-mobile blockers and locked the first-pass architecture decisions.
- 2026-03-07: Created pre-mobile Git backup refs and preserved a live Supabase schema dump.
- 2026-03-07: Created `docs/three-platform-overhaul-plan.md` as the living master checklist.
- 2026-03-07: Added `docs/three-platform-boundary-rules.md` plus `npm run check:three-platform:boundaries` and CI enforcement for future `packages/**` and `apps/mobile/**` boundaries.
- 2026-03-07: Added `docs/three-platform-api-v1-inventory.md` mapping mobile-critical flows to the planned `/api/v1` surface and documenting migration hotspots.
- 2026-03-07: Added `docs/three-platform-phases-1-3-rollback.md` with restore anchors and rollback instructions for phases 1-3.
- 2026-03-08: Moved the Next.js app into `apps/web`, added npm workspaces plus `turbo.json`, preserved `supabase/` at the repo root, and validated the workspace move with pinned-toolchain `lint`, `type-check:ci`, `build`, `test:public-cache`, `test:blue-origin-dossier`, and `test:spacex-hub`.
- 2026-03-08: Added `apps/mobile` as an Expo Router shell with theme bootstrap, secure-token hydration, and shared query bootstrap plus source-based shared packages under `packages/*`.
- 2026-03-08: Added initial `/api/v1` read routes for session, entitlements, launches, launch detail, search, profile, watchlists, filter presets, notification preferences, launch notifications, and push-device registration, backed by one cookie-plus-bearer session resolver in `apps/web/lib/server/viewerSession.ts`.
