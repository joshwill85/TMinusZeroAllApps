# Low-IO Launch Refresh Three-Platform Plan

Date: 2026-03-19

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Customer-facing: yes

## Goal

Ship consistent launch-feed and launch-detail refresh behavior across web, iOS, and Android without tying UI refresh directly to the 15-second ingest cadence or amplifying hot-path reads.

## Locked Decisions

- Keep backend ingest at `15s`.
- Keep customer refresh cadence by tier:
  - `premium`: `15s`
  - `free`: `15m`
  - `anon`: `2h`
- Use cheap version checks first and only refetch full payloads when the version changes.
- Do not silently reorder active feeds while the user is reading.
- Show a persistent refresh banner on feeds until the user applies the update.
- Auto-apply refreshes on launch detail because it is a single-entity view.
- Exclude scheduled watchlist/following polling from this first slice.

## Source Of Truth

- Shared launch feed/detail contracts: `packages/contracts/src/index.ts`
- Shared client transport: `packages/api-client/src/index.ts`
- Shared query/cache policy: `packages/query/src/index.ts`
- Shared launch-feed server loaders: `apps/web/lib/server/v1/launchFeedApi.ts`
- Shared launch-detail server loader: `apps/web/lib/server/v1/mobileApi.ts`
- Web feed: `apps/web/components/LaunchFeed.tsx`
- Web detail refresh: `apps/web/components/LaunchDetailAutoRefresh.tsx`
- Mobile feed: `apps/mobile/app/(tabs)/feed.tsx`
- Mobile detail: `apps/mobile/app/launches/[id].tsx`
- Three-platform architecture anchor: `docs/three-platform-overhaul-plan.md`

## Implementation Shape

### Shared contracts and transport

- Add additive `/api/v1` response schemas for:
  - `launchFeedVersion`
  - `launchDetailVersion`
- Add additive shared API-client methods:
  - `getLaunchFeedVersion`
  - `getLaunchDetailVersion`
- Add shared query keys and zero-stale query options for version checks so concurrent checks dedupe without pretending unchanged data is fresh.

### Shared server loaders and routes

- Add additive routes:
  - `/api/v1/launches/version`
  - `/api/v1/launches/[id]/version`
- Feed version route requirements:
  - supports `scope=public|live`
  - accepts the existing feed filter set
  - returns a minimal payload with `version`, `scope`, `tier`, `intervalSeconds`, `matchCount`, and `updatedAt`
- Detail version route requirements:
  - resolves to the viewer-tier-appropriate freshness source
  - premium uses live detail freshness
  - free/anon use public snapshot freshness
- Keep all version routes `private, no-store` and based on cheap selects / counts / latest timestamps only.

### Web behavior

- Feed:
  - extend scheduled refresh beyond premium-only behavior by using the shared version route for each tier cadence
  - only run checks while the page is visible and online
  - on mismatch, store a pending refresh state and show a persistent refresh banner
  - do not auto-refetch or reorder the visible feed until the user taps refresh
  - premium may fetch `/api/v1/launches/changed` only after a version mismatch to enrich the banner
- Detail:
  - replace blind non-premium `router.refresh()` cadence with version checks for all tiers
  - keep auto-apply behavior when the version changes

### Mobile behavior

- Feed:
  - keep the existing infinite query for full feed payloads
  - add focus-gated and app-foreground-gated version checks
  - add pull-to-refresh
  - on mismatch, keep the current list in place and show a persistent “new updates” card until applied
- Detail:
  - add focus-gated and app-foreground-gated detail version checks
  - add pull-to-refresh
  - auto-refetch only when the version changes

## IO Guardrails

- Full feed/detail requests occur only on:
  - initial load
  - explicit manual refresh
  - version mismatch
  - existing mutation-driven invalidation
- Do not fetch changed-launch summaries unless a premium feed version mismatch already occurred.
- Do not introduce global React Query focus polling for all screens.
- Pause refresh timers when the app or page is not actively visible.

## Rollout Order

1. Dated plan doc plus master-plan linkage
2. Shared contracts, API-client methods, and query primitives
3. Additive `/api/v1` feed/detail version routes plus server loaders
4. Web feed/detail migration to shared version checks
5. Mobile feed/detail migration to shared version checks and pull-to-refresh
6. Pinned-toolchain verification

## Risks

- Accidentally turning version checks into full-feed queries would increase disk IO rather than reduce it.
- Feed auto-apply would reorder cards and break reading context, especially on mobile.
- Global focus refetch would cause request amplification on mounted-but-hidden tabs.
- Shared route changes must stay additive so the current web and mobile payload consumers remain compatible.

## Rollback Notes

- The new contracts and routes are additive and can be left unused if a client regression appears.
- Existing feed/detail payload routes remain unchanged.
- Legacy web-only live-version routes can stay in place during migration and be retired later.

## Verification

Run under the pinned toolchain:

- `node -v && npm -v`
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

Targeted smoke:

- Web public feed shows a pending refresh banner instead of silently changing cards.
- Web premium feed still shows recent change context only after a real mismatch.
- Web detail refreshes only when the version changes for anon, free, and premium.
- iOS feed/detail refresh checks stop in background and resume on foreground.
- Android feed/detail refresh checks stop in background and resume on foreground.
- Mobile pull-to-refresh applies updates immediately and clears pending state.
