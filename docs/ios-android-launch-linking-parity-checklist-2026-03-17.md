# iOS/Android Launch Linking Parity Checklist

Date: 2026-03-17

## Platform Matrix

- Web: included as parity reference and link-shape source
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes (additive where needed)
- Customer-facing: yes

## Goal

Enable this chain to stay in native iOS/Android for the core entities:

1. launch feed -> launch detail
2. launch detail -> provider
3. launch detail -> vehicle/rocket
4. launch detail -> pad/location
5. each entity page -> upcoming + past launches

## P0 (Must-Have Native Chain)

### P0.1 Add native route support for provider/rocket/location/pad targets

- Status: completed on 2026-03-17
- Add mobile routes for provider, vehicle, and location hubs.
- Normalize web href handoff to native routes when path is known.

Primary touchpoints:

- `apps/mobile/app/(tabs)/search.tsx`
- `apps/mobile/app/launches/[id].tsx`
- `packages/navigation/src/index.ts`
- `apps/mobile/app/_layout.tsx`

Acceptance:

- Tapping provider/vehicle/pad from launch detail no longer leaves native when target exists.
- Search results for these entities route native (not browser).

Delivered in this slice:

- Added native normalization + mapping for provider/rocket/location/pad URL families.
- Routed launch detail and search entity links through native normalization before browser fallback.
- Added native route shells:
  - `/launch-providers`
  - `/launch-providers/[slug]`
  - `/providers/[slug]`
  - `/rockets/[id]`
  - `/locations/[id]`
  - `/catalog/pads/[id]`

### P0.2 Make launch detail entity fields explicitly tappable

- Status: completed on 2026-03-17
- Convert provider, vehicle/rocket, and pad/location rows from display-only to actionable route links.
- Keep external links external.

Primary touchpoints:

- `apps/mobile/app/launches/[id].tsx`

Acceptance:

- User can tap these fields from launch detail and navigate internally to native entity pages.

Delivered in this slice:

- Launch Info cards for provider, vehicle, rocket, pad, and location are now tappable.
- Provider card routes to `/launch-providers/:slug`.
- Vehicle and rocket cards route to `/rockets/:id`.
- Pad card routes to `/catalog/pads/:id` when LL2 pad id exists; otherwise it falls back to location route.
- Location card routes to `/locations/:id`.

### P0.3 Build native entity pages with upcoming + history

- Status: completed on 2026-03-17
- Implement native provider, rocket, and location/pad pages.
- Include two sections per page: `Upcoming launches` and `Launch history`.
- Route each listed launch back to native launch detail.

Primary touchpoints:

- `apps/mobile/app/providers/[slug].tsx` (new)
- `apps/mobile/app/rockets/[id].tsx` (new)
- `apps/mobile/app/locations/[id].tsx` (new)
- `apps/mobile/src/api/queries.ts`
- `apps/mobile/src/components/*` (shared list modules)
- `apps/web/app/api/v1/*` (only if additive endpoints are required)

Acceptance:

- Provider/rocket/location pages are native on both iOS and Android.
- Each page shows both future and past launches.
- Launch row tap always returns to native launch detail.

Delivered in this slice:

- Replaced route-shell placeholders with native timeline screens for:
  - `/launch-providers/[slug]`
  - `/providers/[slug]`
  - `/rockets/[id]`
  - `/locations/[id]`
  - `/catalog/pads/[id]`
- Added shared native timeline component with:
  - `Upcoming launches` section
  - `Launch history` section
  - launch-row tap routing back to native launch detail
  - in-app search + web fallback actions
- Added additive `/api/v1/launches` filters for entity timeline queries:
  - `rocketId`
  - `padId`
- Wired new filter fields through shared `@tminuszero/api-client` and `@tminuszero/query` request/query-key types.

## P1 (Parity Hardening)

### P1.1 Catalog and pad deep-link compatibility

- Status: completed on 2026-03-17
- Map `/catalog/pads/:id` and other web entity URLs to equivalent native location/pad routes.
- Avoid browser fallback for known core entities.

Primary touchpoints:

- `packages/navigation/src/index.ts`
- `apps/mobile/app/(tabs)/search.tsx`
- `apps/mobile/app/launches/[id].tsx`

Acceptance:

- Known catalog pad/location links resolve native where data exists.

Delivered in this slice:

- Expanded native core-entity normalization to map additional known catalog URL families:
  - `/catalog/agencies/:id` -> `/launch-providers/:id`
  - `/catalog/launcher_configurations/:id` -> `/rockets/:id`
  - `/catalog/rockets/:id` -> `/rockets/:id`
  - `/catalog/launchers/:id` -> `/rockets/:id`
- Kept existing pad/location mappings active:
  - `/catalog/pads/:id` -> `/catalog/pads/:id`
  - `/catalog/locations/:id` -> `/locations/:id`

### P1.2 Close provider split between news and schedule semantics

- Status: completed on 2026-03-17
- Decide and enforce default native provider destination:
  - schedule-first (`/launch-providers/:slug`) behavior equivalent, and
  - optional provider-news handoff behavior.

Primary touchpoints:

- `packages/navigation/src/index.ts`
- `apps/mobile` provider routes and components

Acceptance:

- Provider taps are predictable and consistent across feed, search, and detail.

Delivered in this slice:

- Enforced schedule-first normalization:
  - `/providers` -> `/launch-providers`
  - `/providers/:slug` -> `/launch-providers/:slug`
  - `/catalog/agencies?q=...` -> `/launch-providers/:slug`
- Added additive provider-id filtering (`providerId`) to shared launch-feed requests and `/api/v1/launches`.
- Updated provider native routes to resolve either:
  - canonical provider slug/name, or
  - strict numeric provider id (for catalog-agency deep links).

### P1.3 Extend beyond Blue Origin partial native hub behavior

- Status: completed on 2026-03-17
- Keep Blue Origin native behavior.
- Do not regress existing rollout gating.
- Ensure generic core entity navigation works independent of program hub rollout.

Primary touchpoints:

- `apps/mobile/src/features/programHubs/rollout.ts`
- `apps/mobile/src/features/programHubs/*`

Acceptance:

- Core provider/vehicle/pad flows work even when program hubs are disabled.

Delivered in this slice:

- Added rollout-safe fallback helpers for program hubs:
  - `resolveNativeProgramHubOrCoreHref(...)`
  - `getProgramHubEntryOrCoreHref(...)`
- Kept hub-gated native behavior for enabled program hubs, while falling back to core provider schedule routes when hubs are disabled:
  - `blueOrigin` -> `/launch-providers/blue-origin`
  - `spacex` -> `/launch-providers/spacex`
- Wired fallback behavior into:
  - search result routing
  - feed program-chip routing
  - mobile manifest program links

## P2 (Quality, Tests, and Regression Guardrails)

### P2.1 Add end-to-end tests for full chain

- Add Detox tests for:
  - feed -> detail -> provider -> launch -> detail
  - detail -> rocket -> launch -> detail
  - detail -> location/pad -> launch -> detail

Primary touchpoints:

- `apps/mobile/e2e/core-shell.e2e.js`
- `apps/mobile/e2e/*`

Acceptance:

- New parity flows pass reliably on iOS and Android test runs.

### P2.2 Add contract/query and boundary guards

- Keep route and data contracts additive.
- Add tests for any new `/api/v1` response shapes.

Primary touchpoints:

- `packages/contracts/*`
- `apps/web/app/api/v1/*`
- `apps/mobile/src/api/*`

Acceptance:

- Contract tests and mobile query guard pass with new entity flows.

## Verification Set (Pinned Toolchain)

Run with pinned Node/npm:

- `node -v && npm -v`
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`
- Detox runs for new navigation journeys when environment supports it

## Execution Order

1. P0.1 route map and deep-link normalization
2. P0.2 tappable launch-detail entities
3. P0.3 native entity pages with upcoming/history
4. P1 hardening and mapping cleanup
5. P2 tests and regression guards
