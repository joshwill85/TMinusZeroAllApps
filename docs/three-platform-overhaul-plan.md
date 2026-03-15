# Three-Platform Overhaul Plan

Last updated: 2026-03-10

This is the living master checklist for moving T-Minus Zero from a web-only product to a maintainable, high-performance web + iOS + Android product line.

## Purpose

- Keep one source of truth for the overhaul.
- Track progress phase by phase with explicit acceptance and rollback gates.
- Protect web continuity while shared foundations, mobile, billing, notifications, and native-only capability are introduced.

## Current State Snapshot

- Current app shape: npm workspace monorepo with `apps/web`, `apps/mobile`, and source-based shared packages under `packages/*`.
- Platform coupling snapshot:
  - `685` tracked JS/TS source files across `apps/web`, `apps/mobile`, and `packages/*`
  - `301` files importing `next/*`
  - `37` browser-side raw `/api/*` fetch call sites still left in `apps/web`
  - `147` route files under `apps/web/app/api`
  - `62` Supabase Edge Functions in `supabase/functions`
- Major blockers already confirmed:
  - Remaining raw web `fetch('/api/...')` usage in mobile-critical surfaces
  - Browser/service-worker push parity vs Expo-native push lifecycle
  - Native purchase adapters and receipt validation
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

- [x] Shared packages must not import `next/*`, DOM APIs, service-worker APIs, or `lib/server/*`.
- [x] Mobile-critical APIs must not perform sync-on-read, warm-on-read, or admin retry fallback on the hot path.
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

- Compatibility policy: `/api/v1` changes are additive-only within the version. Any breaking contract change requires a new version and a two-mobile-release compatibility window.

- [x] Create `/api/v1` for all mobile-used routes.
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
- [x] Build `packages/api-client` as the only shared transport layer.
- [x] Introduce a single `resolveViewerSession(request)` path that supports web cookies and bearer tokens.
- [x] Keep current browser cookie auth for web while adding native bearer-token auth for API routes.
- [x] Move auth callback and reset flows to platform-aware web + deep-link paths.
- [x] Define API compatibility policy for mobile release lag.

Acceptance gate:

- [x] Contract tests pass for every new `/api/v1` route.
- [x] Protected APIs work with both cookie and bearer-token auth.
- [ ] Web behavior remains unchanged on legacy routes.

Rollback gate:

- [x] Legacy routes remain functional until both web and mobile are migrated.
- [ ] New auth handling can be disabled without locking out web users.

## Phase 3 - Web Decoupling

Goal: break the current web app into shared logic plus web-only UI so mobile can reuse the right layers.

- [x] Replace raw browser `fetch('/api/...')` usage in core surfaces with `packages/api-client`.
- [x] Refactor the highest-risk mixed-concern components first:
  - `LaunchFeed`
  - `LaunchCard`
  - `SiteChrome`
  - account/preferences flows
- [x] Move pure logic into shared packages:
  - time/countdown
  - search parsing
  - entitlement interpretation
  - navigation intents
  - trajectory math/contracts
- [x] Replace web path-string helpers with shared navigation intents.
- [x] Standardize web data access on a shared query/cache layer.
- [x] Replace per-card countdown intervals with a centralized ticker.

Acceptance gate:

- [x] Web uses shared contracts and API client on mobile-critical surfaces.
- [x] Shared packages are free of `next/*`, DOM APIs, and server-only imports.
- [ ] Feed, account, and search behavior match pre-refactor behavior.

Rollback gate:

- [ ] Feature-level refactors are landed in isolated commits or PR slices.
- [x] The old fetch paths can be re-enabled quickly if the shared client regresses.

## Phase 4 - Mobile Core Product

Goal: ship a first-class iOS and Android core product without billing purchase flow or AR.

- [x] Build native feed.
- [x] Build native search.
- [x] Build native launch detail.
- [x] Build native auth bootstrap and deep-link callback handling.
- [x] Build native saved items, watchlists, and presets.
- [x] Build native preferences and notification settings.
- [x] Register Expo push tokens through the shared backend.
- [x] Match shared entitlement reads used by web.

Acceptance gate:

- [ ] Mobile core journeys are covered by E2E tests.
- [x] Feed, search, and detail screens do not duplicate avoidable requests.
- [ ] Native performance is acceptable on representative low-end devices.

Rollback gate:

- [x] Mobile release can be held back independently of web.
- [x] Backend changes required for mobile are backward compatible with web.

## Phase 5 - Billing and Entitlements Unification

Goal: separate product access from purchase provider and support web Stripe plus native IAP cleanly.

- [x] Introduce provider-neutral entitlement records and server logic.
- [x] Keep Stripe as the web purchase adapter.
- [x] Add Apple App Store purchase adapter.
- [x] Add Google Play purchase adapter.
- [x] Implement restore-purchases and server-side receipt validation.
- [x] Migrate web billing reads/writes behind the new entitlement model.
- [x] Ensure the shared entitlement contract is identical across web and mobile.

Acceptance gate:

- [ ] Entitlements reconcile correctly across Stripe, Apple, and Google.
- [x] Web billing flows still work during and after migration.
- [x] Mobile can read premium state before native purchase UI launches.

Rollback gate:

- [x] Stripe-only entitlement flow remains available until native reconciliation is proven stable.
- [x] Provider-specific failures do not corrupt shared entitlement state.

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
- [x] Search freshness and other warm/sync jobs run off-request, not on read paths.
- [ ] Public/mobile-critical reads are cache-backed wherever possible.
- [x] Middleware or rate limiting does not depend on single-instance memory for correctness.
- [ ] CI runs changed-workspace-only tasks and reuses caches aggressively.
- [ ] Large shared packages remain source-based and avoid unnecessary build artifacts.
- [ ] Mobile feed rendering avoids timer storms, image churn, and duplicate fetches.

## Testing and Release Gates

- [x] Contract tests for every `/api/v1` route used by mobile.
- [x] Shared-domain tests for time, search, entitlements, navigation intents, and trajectory math.
- [ ] Web regression coverage for feed, account, saved items, and preferences.
- [ ] Mobile E2E coverage for auth, deep links, feed, detail, saved items, and push registration.
- [ ] Perf checks for request counts, scroll performance, cache reuse, and CI task graph efficiency.
- [x] Staged rollout gates for dogfood, beta, and public release on mobile.

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
- 2026-03-08: Hardened `/api/v1` payloads and server loaders, removed mobile read-path admin fallback and search warm-on-read behavior, added a shared countdown ticker for web launch cards, and validated `doctor`, `check:three-platform:boundaries`, `test:v1-contracts`, `type-check`, `type-check:mobile`, `lint`, and mobile lint on the pinned toolchain.
- 2026-03-08: Upgraded the mobile shell from placeholders to real native feed/search/detail/profile/saved/preferences screens, added direct native Supabase password auth plus deep-link callback/reset routes, and kept bearer-token reads on the shared `@tminuszero/api-client`.
- 2026-03-08: Added additive provider-neutral billing tables (`purchase_provider_customers`, `purchase_entitlements`, `purchase_events`), mirrored Stripe customer/subscription writes into them, and taught entitlement reads to prefer the new model while preserving legacy Stripe tables and routes.
- 2026-03-08: Added Expo-aware push lifecycle contracts plus `/api/v1` write routes for notification preference updates, push-device removal, and authenticated push self-test; extended notification dispatch/send workers to handle active Expo devices alongside legacy web push subscriptions.
- 2026-03-08: Added app-scoped mobile push registration/sync with secure installation ids, Expo notification response routing, centralized query keys/stale times, and shared launch-detail prefetch for feed/search to reduce avoidable request churn.
- 2026-03-08: Added `eas.json`, Expo mobile app identity config, Detox scaffolding under `apps/mobile/e2e`, a dedicated `mobile-e2e` GitHub Actions workflow, and validated `doctor`, `check:three-platform:boundaries`, `test:v1-contracts`, `lint`, `lint --workspace @tminuszero/mobile`, `type-check:ci`, `type-check:mobile`, `test:smoke`, and `build` on pinned Node `20.19.6` / npm `10.8.2` in Docker. Physical-device Expo push delivery and low-end-device perf validation remain open.
- 2026-03-08: Centralized mobile query option builders under `@tminuszero/query`, added `npm run test:mobile-query-guard`, and used it to lock feed/search/detail plus notification-preference cache reuse to one shared query policy.
- 2026-03-08: Replaced the original schema-only `test:v1-contracts` smoke with route-by-route mobile `/api/v1` client-contract coverage, including guest, cookie, and bearer transport behavior plus protected-route error mapping.
- 2026-03-08: Expanded mobile acceptance coverage with deeper Detox routing scenarios, added Android Detox CI scaffolding, and documented preview/beta/production rollout plus physical-device push and perf evidence requirements in `docs/three-platform-phase4-acceptance.md`.
- 2026-03-08: Validated the new Phase 4 acceptance guards in an isolated pinned-toolchain Docker workspace with `npm run doctor`, `npm run test:v1-contracts`, `npm run test:mobile-query-guard`, `npm run lint --workspace @tminuszero/mobile`, and `npm run type-check:mobile`.
- 2026-03-08: Started the Phase 3 web feed/search shell slice by adding a web `QueryClientProvider`, shared web query/mutation hooks, additive `/api/v1` watchlist/filter-preset/launch-notification write contracts, and migrating `SiteChrome`, web search, launch-alert reads/writes, and the feed’s entitlement/preset/watchlist flows onto the shared client/query layer. Validated in pinned Docker with `npm run doctor`, `npm run test:v1-contracts`, `npm run test:mobile-query-guard`, `npm run type-check:ci`, and `npm run lint`.
- 2026-03-08: Completed the Phase 3 account-settings slice by adding additive `/api/v1` profile update, marketing-email, SMS verification, and account-delete routes plus shared contracts/client hooks, then migrating `/account` and `/me/preferences` off page-local legacy fetches onto the shared web query/mutation layer while keeping browser-push and filter-option reads behind thin web adapters. Validated in pinned Docker with `npm run doctor`, `npm run check:three-platform:boundaries`, `npm run test:v1-contracts`, `npm run type-check:ci`, and `npm run lint`.
- 2026-03-08: Completed the Phase 3 saved-items and integrations slice by adding additive `/api/v1` watchlist rename/delete plus calendar-feed, RSS-feed, and embed-widget contracts/routes, extending the shared web query/mutation layer for those resources, and migrating `/account/saved`, `/account/integrations`, `WatchlistFollows`, `BulkCalendarExport`, `RssFeeds`, and `EmbedNextLaunchCard` off direct legacy fetches. Validated in pinned Docker with `npm run doctor`, `npm run check:three-platform:boundaries`, `npm run test:v1-contracts`, `npm run type-check:ci`, and `npm run lint`.
- 2026-03-08: Completed the Phase 3 LaunchFeed and upgrade-entry slice by promoting the main web feed to a richer additive `/api/v1/launches` contract plus `/api/v1/launches/changed`, routing `LaunchFeed` through the shared query/client path with a legacy-adapter kill switch, and moving `UpgradePageContent` off raw subscription/checkout fetches onto shared viewer entitlements plus the web billing adapter. Validated in pinned Docker with `npm ci`, `npm run doctor`, `npm run check:three-platform:boundaries`, `npm run test:v1-contracts`, `npm run type-check:ci`, and `npm run lint`.
- 2026-03-08: Landed the Phase 3 privacy/auth closeout slice by adding additive `/api/v1/me/privacy/preferences` and `/api/v1/me/export` contracts/routes plus shared rollback-aware adapters, expanding `@tminuszero/query` and `@tminuszero/navigation` for privacy/export and auth/account intent serialization, and migrating `PrivacySignals`, `/legal/privacy-choices`, auth callback/profile hydration, and web push device status in `/me/preferences` onto the shared query/navigation path. Validated in pinned Docker with `npm run doctor`, `npm run check:three-platform:boundaries`, `npm run test:v1-contracts`, `npm run type-check:ci --workspace @tminuszero/web`, and `npm run lint --workspace @tminuszero/web`.
- 2026-03-08: Landed the Phase 3 shared-domain and trajectory closeout slice by adding shared `@tminuszero/domain` modules for viewer-tier logic, search parsing, and trajectory evidence/publish-policy/contracts, adding shared trajectory response schema coverage in `@tminuszero/contracts`, migrating mobile-critical web surfaces onto shared domain/navigation imports, and adding `npm run test:shared-domain` plus `npm run test:phase3-web-guard` to block new direct mobile-critical web `fetch('/api...')` usage and deprecated web-local domain imports. Kept web-local compatibility copies for legacy CJS smoke/runtime paths while the new guards enforce shared imports on mobile-critical surfaces. Validated in pinned Docker with `npm run doctor`, `npm run check:three-platform:boundaries`, `npm run test:shared-domain`, `npm run test:phase3-web-guard`, `npm run test:v1-contracts`, `npm run type-check:ci --workspace @tminuszero/web`, `npm run lint --workspace @tminuszero/web`, `npm run test:smoke`, and `npm run build --workspace @tminuszero/web`.
- 2026-03-08: Landed the Phase 5 billing foundation slice by adding shared `/api/v1/me/billing/{summary,catalog}` plus Apple/Google sync contracts and routes, a provider-aware server billing core with provider-neutral native purchase upserts, web `BillingPanel` migration onto shared billing summary reads while preserving the existing Stripe checkout/portal/setup/cancel/resume routes, and native iOS/Android billing state plus purchase/restore wiring in the Expo app via `expo-iap`. Validated in pinned Docker with `npm run doctor`, `npm run check:three-platform:boundaries`, `npm run test:v1-contracts`, `npm run test:mobile-query-guard`, `npm run type-check:ci`, `npm run type-check:mobile`, `npm run lint`, `npm run lint --workspace @tminuszero/mobile`, and `npm run build`. Live App Store / Play sandbox proof and webhook-driven reconciliation remain open.
- 2026-03-08: Extended the Phase 5 billing slice with provider notification ingestion routes for App Store Server Notifications and Google Play RTDN, extracted shared Stripe route helpers so legacy `/api/billing/*` actions now run through one server billing path, centralized webhook-event idempotency helpers, and tightened Google native sync so verified obfuscated account ids must match the authenticated viewer. Revalidated in pinned Docker with `npm run doctor`, `npm run test:v1-contracts`, `npm run test:mobile-query-guard`, `npm run type-check:ci --workspace @tminuszero/web`, `npm run lint --workspace @tminuszero/web`, and `npm run build --workspace @tminuszero/web`. Live App Store / Play sandbox proof is still required before checking the Phase 5 reconciliation acceptance gates.
- 2026-03-08: Hardened Phase 5 billing notifications to use Apple’s official App Store server library with committed root cert assets plus verified Google Pub/Sub push auth via `google-auth-library`, replaced custom provider-signing code in the shared billing core, expanded `/admin/billing` to show provider-neutral entitlements and per-provider webhook health, and added `npm run check:billing-readiness` plus the setup/acceptance docs `docs/three-platform-phase5-billing-setup.md` and `docs/three-platform-phase5-billing-acceptance.md`. Store-console provisioning and physical-device purchase/restore/cancel proof still remain open before the Phase 5 acceptance and rollback gates can be checked.
- 2026-03-08: Added the repo-owned baseline evidence path in `docs/three-platform-baseline-evidence.md`, expanded `npm run test:mobile-query-guard` to emit request-count and cache-reuse evidence for feed/search/account/saved/preferences, expanded `npm run test:phase3-web-guard` to report the remaining raw `/api` fetch count in `apps/web` while still failing mobile-critical regressions, and added `npm run baseline:three-platform` to write machine-readable request-count, TTFB, and CI task-graph artifacts. Browser/device render-scroll evidence still remains open.
- 2026-03-09: Completed the repo-owned acceptance-readiness validation slice by landing `npm run test:web-regression` as a shared query/navigation regression smoke, `npm run test:billing-regression` as deterministic web-billing continuity plus webhook-idempotency coverage, a simulator-safe E2E push-registration seam for mobile builds, and a checked-in evidence bundle under `docs/evidence/three-platform/`. Validated in pinned Docker with `npm run doctor`, `npm run test:shared-domain`, `npm run test:phase3-web-guard`, `npm run test:web-regression`, `npm run test:billing-regression`, `npm run test:v1-contracts`, `npm run test:mobile-query-guard`, `npm run type-check:mobile`, `npm run lint --workspace @tminuszero/mobile`, `npm run lint`, `npm run test:smoke`, `npm run build`, `npm run type-check:ci` (after build), and `npm run baseline:three-platform -- --out-dir=docs/evidence/three-platform --ttfb-requests=15 --ttfb-warmup=5`. Shared-domain test coverage and web-billing continuity are now repo-proven; real-device push/perf evidence and live store reconciliation remain open.
- 2026-03-09: Added `npm run acceptance:preflight` plus `.github/workflows/acceptance-preflight.yml` to emit one pinned-toolchain artifact bundle for repo-owned acceptance work, expanded mobile Detox with feed pagination plus artifact-producing `mobile:e2e:acceptance` entrypoints, and upgraded the mobile workflow to upload iOS/Android Detox artifacts. Revalidated in pinned Docker with `npm run acceptance:preflight -- --out-dir=.artifacts/three-platform-acceptance --ttfb-requests=5 --ttfb-warmup=2`, which passed doctor, boundaries, shared-domain, web-regression, billing-regression, `/api/v1` contracts, mobile query guard, mobile lint/typecheck, smoke tests, web build, web type-check-after-build, baseline capture, and billing evidence export. The new billing regression now proves Stripe continuity, source-ordered provider failure guards before mutation boundaries, and webhook replay safety; mobile Detox boxes remain open until simulator/emulator or CI artifacts are attached.
- 2026-03-09: Hardened the mobile auth surface by removing raw bearer-token acceptance from native callback/reset routes, adding refresh-token-driven mobile session renewal plus 401 retry recovery, enforcing https-only API/Supabase config in non-development mobile builds, claiming verified `https` auth links in Expo config, and adding Apple/Android app-link association routes plus `npm run test:mobile-security-guard` in CI/preflight. Revalidated in pinned Docker with `npm run acceptance:preflight -- --out-dir=.artifacts/mobile-security-hardening --ttfb-requests=5 --ttfb-warmup=2`. Remaining operational follow-up: populate app-link signing identifiers (`APPLE_DEVELOPER_TEAM_ID` or explicit `APPLE_APP_LINK_APP_IDS`, plus `ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS`) before verified auth links can be proven on devices.
- 2026-03-10: Added `npm run acceptance:local` plus deterministic local fixtures in `scripts/three-platform-local-fixture.ts` and `scripts/three-platform-local-acceptance-seed.ts`, so the repo-owned acceptance path can reset local Supabase, seed free/premium users plus launch/watchlist/preset/billing data, boot `apps/web`, and emit one local artifact bundle with the seed, pinned preflight output, billing evidence export, rate-limit smoke output, and web server log. The repeatable dry-run bundle now lives under `.artifacts/local-acceptance-dryrun/`.
- 2026-03-10: Fixed local Supabase reset blockers by repairing the malformed `0225_status_name_backfill_from_status_text.sql` CTE scope and guarding remote-storage trigger creation in `20260301141801_remote_commit.sql`, then removed remaining repo-known hot-path read side effects by making legacy search warming a deprecated no-op, disabling read-time Stripe reconciliation in legacy subscription and shared billing-summary reads, and moving correctness-critical rate limiting out of `apps/web/middleware.ts` into route-level Supabase-backed helpers. Added `npm run test:three-platform:hot-path` plus `npm run test:rate-limit-smoke`, and validated the repo-owned local acceptance flow on pinned Node `20.19.6` / npm `10.8.2` with `npm run acceptance:local -- --skip-mobile-e2e --out-dir=.artifacts/local-acceptance-dryrun`. Mobile Detox, real push delivery, low-end-device perf, and live store reconciliation remain open.
- 2026-03-15: Added `docs/entitlements-alert-rules-realignment-plan-2026-03-15.md` to capture the three-platform anon/free/premium realignment, additive `/api/v1/me/alert-rules` rollout, downgrade behavior, and the verification set before changing shared entitlements plus customer alert behavior.
- 2026-03-15: Added `docs/entitlement-realignment-plan-2026-03-15.md` to lock the cross-platform tier matrix for free filters/calendar, premium-only saved items/follows, free mobile alerts, premium browser alerts, and tokenized premium integrations before implementation across shared contracts, `/api/v1`, notification workers, web, and mobile.
