# FAA Maps Launch Detail Plan

Date: 2026-03-31

## Platform matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Surface type: customer-facing

## Goal

Ship launch-day FAA advisory maps safely across customer surfaces while keeping the data path low-write and ensuring launch slips re-match quickly.

This rollout covers:

- Web inline + fullscreen FAA zone maps using Google Maps
- Android inline + fullscreen FAA zone maps using Google Maps
- iOS inline + fullscreen FAA zone maps using native Apple MapKit
- Correct iOS Apple Maps satellite behavior for launch pad access

## Current state

- FAA advisory cards already exist on web and mobile launch detail.
- FAA records, shapes, matches, and NOTAM detail history already exist in shared Supabase tables.
- The advisory selector already filters to launch-day coverage, but no geometry payload is exposed to clients.
- Web has a Google Maps static pad preview only.
- iOS rewrites external pad-map links to Apple Maps satellite, but the main `Pad` row still routes to the in-app pad detail.
- FAA TFR ingest still rewrites records and shapes even when payloads are unchanged.
- FAA rematching is scheduled hourly, with no prompt launch-change follow-up trigger yet.

## Implementation slices

### Slice 1: shared backend and contracts

Files:

- `packages/contracts/src/index.ts`
- `packages/api-client/src/index.ts`
- `packages/query/src/index.ts`
- `apps/mobile/src/api/queries.ts`
- `apps/web/lib/server/faaAirspace.ts`
- `apps/web/app/api/public/launches/[id]/faa-airspace-map/route.ts`
- `apps/web/app/api/v1/launches/[id]/faa-airspace-map/route.ts`

Work:

- Add a typed FAA map payload for launch-scoped pad, bounds, advisories, and simplified polygon features.
- Reuse the existing launch-day FAA advisory filtering logic.
- Exclude ambiguous polygons from customer-facing geometry payloads.
- Keep the new geometry response additive and separate from the main launch-detail payload.

### Slice 2: low-write FAA backend hardening

Files:

- `supabase/migrations/*faa_maps*.sql`
- `supabase/functions/faa-tfr-ingest/index.ts`
- `supabase/functions/faa-launch-match/index.ts`

Work:

- Add conditional upsert RPCs for FAA records and shapes so unchanged payloads skip rewrites.
- Update `faa-tfr-ingest` to use those RPCs.
- Add a coalesced launch-change follow-up path for `faa-launch-match`.
- Allow `faa-launch-match` to accept scoped launch ids so slip-triggered reruns stay narrow.

### Slice 3: web launch detail map

Files:

- `apps/web/app/launches/[id]/page.tsx`
- `apps/web/components/launch/FaaAirspaceMapPanel.tsx`
- `apps/web/lib/server/env.ts`

Work:

- Render an inline FAA map preview above the advisory cards when map geometry exists.
- Add a fullscreen viewer modal for the same map payload.
- Use Google Maps satellite tiles, draw polygons, fit bounds, and mark the launch pad.
- Keep the existing pad satellite preview card and continue making the preview itself the primary external map target.

### Slice 4: native mobile maps

Files:

- `apps/mobile/modules/tmz-launch-map/**`
- `apps/mobile/app/launches/[id].tsx`
- `apps/mobile/app/launches/faa-map/[id].tsx`
- `apps/mobile/app.config.ts`
- `apps/mobile/app.json`
- `apps/mobile/plugins/withGoogleMapsAndroidApiKey.js`

Work:

- Add a local Expo module for native launch maps.
- iOS renderer: Apple MapKit satellite with polygon overlays and pad annotation.
- Android renderer: Google Maps SDK satellite with polygon overlays and pad marker.
- Normalize quoted `GOOGLE_MAPS_ANDROID_API_KEY` values before writing Android manifest metadata.
- Add inline preview and fullscreen route on mobile launch detail.
- Pull-to-refresh must refetch FAA geometry alongside launch detail so advisory text and polygons stay in sync.
- Make the iOS `Pad` row open Apple Maps satellite directly while leaving `Location` as the in-app detail route.

## Data and UX rules

- Customer-facing FAA maps draw only `matched` and `manual` advisories.
- Advisory cards continue to use the shared selector and launch-day filtering.
- Geometry remains sourced from existing FAA tables; there is no second persisted map cache.
- Missing map keys or missing native map capability must degrade to advisory text and external map links, not broken UI.
- Pad preview taps open the platform map app at the pad.

## Rollout order

1. Shared contracts and launch-scoped FAA map helper/endpoints
2. FAA low-write ingest hardening and scoped follow-up rematch path
3. Web FAA map preview/fullscreen
4. Native mobile map module and mobile launch detail integration
5. Verification pass across shared API and both client renderers

## Verification set

Run under the pinned toolchain:

- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

Feature-specific checks:

- Artemis II on April 1, 2026 returns and draws only `6/5918` and `6/5924`
- A launch slip into April 2 re-matches promptly and swaps both cards and polygons
- Unchanged FAA ingest payloads skip record and shape rewrites
- Web inline map and fullscreen map render the same geometry and fit bounds correctly
- Android inline map and fullscreen map render Google maps correctly
- Android release builds strip quotes from `GOOGLE_MAPS_ANDROID_API_KEY` before manifest injection
- iOS inline map and fullscreen map render MapKit correctly
- Mobile pull-to-refresh updates both advisory text and FAA polygons together
- iOS `Pad` row opens Apple Maps satellite, while `Location` still opens in-app detail
