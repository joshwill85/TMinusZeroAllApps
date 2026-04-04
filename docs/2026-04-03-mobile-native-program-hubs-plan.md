# 2026-04-03 Mobile Native Program Hubs Plan

## Platform matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Scope: customer-facing program hub parity and native rollout

## Goal

Make the three customer-facing program hubs live natively in the shared Expo client for both iOS and Android while keeping web as the reference surface and preserving additive `/api/v1` compatibility.

## Non-goals

- Do not port admin, ops, SEO, share-redirect, or other intentionally web-only surfaces into mobile.
- Do not make breaking `/api/v1` contract changes.
- Do not force pixel-identical web layouts onto native screens.
- Do not widen rollout from one hub to all hubs at once.

## Current repo-backed gaps

### SpaceX

1. `/spacex/drone-ships` and `/spacex/drone-ships/[slug]` are web-only.
2. `/starship` currently collapses into generic SpaceX mission routing on mobile.
3. The native root does not yet surface recovery, media, finance, discovery, or FAQ depth comparable to web.

### Blue Origin

1. The native root is present but thinner than the web root.
2. Manifest, timeline, procurement, media, and richer status content are not represented natively.

### Artemis

1. The native root is still a launcher-style preview.
2. The web root acts as a Mission Control workbench with timeline, intel, and budget/procurement depth that mobile does not yet expose.

### Rollout and routing

1. Program hub rollout flags exist but still allow partial or indirect behavior.
2. Canonical hub URL normalization is incomplete for the missing native route families.

## Locked implementation decisions

1. Build one shared native implementation in `apps/mobile` for both iOS and Android.
2. Keep all new shared behavior additive through `packages/contracts`, `packages/api-client`, `packages/query`, `packages/navigation`, and `/api/v1`.
3. Roll out by hub in this order: `SpaceX`, `Blue Origin`, `Artemis`.
4. Treat `nativeEnabled` as the gate for native discovery and in-app routing for the full hub family.
5. Treat `externalDeepLinksEnabled` as the gate for canonical web URL interception into native on mobile.
6. Prefer dedicated section endpoints over oversized overview payloads when root parity needs richer data.

## Delivery phases

### Phase 1: Shared contracts and routes

1. Add additive contracts and `/api/v1` routes for:
   - SpaceX drone ships index/detail
   - Starship index/detail
   - Blue Origin root-depth sections
   - Artemis Mission Control sections
2. Extend shared API client and query helpers for every new route.
3. Update navigation normalization for canonical SpaceX drone ship and Starship paths.

### Phase 2: Mobile root parity

1. Upgrade the SpaceX root with recovery, media, finance, discovery, and FAQ sections.
2. Upgrade the Blue Origin root with manifest, timeline, procurement, media, and status sections.
3. Rebuild the Artemis root as a Mission Control surface with overview, missions, timeline, intel, and budget/procurement sections.

### Phase 3: Native route families

1. Add native SpaceX drone ship list/detail screens.
2. Add native Starship list/detail screens.
3. Ensure search results, in-hub navigation, and deep links resolve to those native routes when enabled.

### Phase 4: Rollout and verification

1. Keep each hub dark until its shared contracts, routes, and primary mobile journeys pass validation.
2. Enable Docking Bay discovery, search exposure, and deep-link interception together per hub.
3. Preserve rollback by leaving fallback-to-web behavior intact when a hub flag is disabled.

## Contract and API worklist

### SpaceX

1. Add schema coverage for drone ship index/detail payloads.
2. Add schema coverage for Starship root/detail payloads.
3. Extend the overview or section route layer for recovery, media, finance, discovery, and FAQ-backed sections.

### Blue Origin

1. Add root-depth section payloads for manifest, timeline, procurement, media, and status.
2. Keep existing mission, flight, traveler, vehicle, engine, and contract routes unchanged except for additive reuse.

### Artemis

1. Add Mission Control section payloads for timeline, intel, and budget/procurement.
2. Keep current mission, contract, awardee, and content routes intact.

## Acceptance checklist

### SpaceX

1. `/spacex` opens natively with richer root sections.
2. `/spacex/drone-ships` opens natively from search and deep links.
3. `/starship` and `/starship/[slug]` open natively without collapsing into generic mission routing.

### Blue Origin

1. `/blue-origin` opens natively with manifest, timeline, procurement, and media sections.
2. Existing child routes remain intact.

### Artemis

1. `/artemis` opens natively as a Mission Control root.
2. Timeline, intel, and budget/procurement sections cross-link into the existing Artemis child routes.

## Verification set

Run under the pinned toolchain only.

1. `node -v && npm -v`
2. `npm run doctor`
3. `npm run check:three-platform:boundaries`
4. `npm run test:v1-contracts`
5. `npm run test:mobile-query-guard`
6. `npm run type-check:ci`
7. `npm run type-check:mobile`
8. `npm run lint`
9. `npm run lint --workspace @tminuszero/mobile`

## Rollback notes

1. New routes and schema fields remain additive.
2. Hub discovery stays controlled by the existing per-hub rollout flags.
3. If a hub regresses, disable that hub’s native flag and keep the others live.
