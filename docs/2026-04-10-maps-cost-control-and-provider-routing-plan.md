# 2026-04-10 Maps Cost Control And Provider Routing Plan

## Scope

- Customer-facing: yes
- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes

## Goal

Reduce Google Maps spend to a deliberately conservative baseline that stays below one-tenth of the free monthly threshold while preserving a clear growth path.

This slice also locks provider boundaries:

- Safari web must not load Google Maps products.
- iOS native must not load Google Maps products or open Google Maps links.
- Android may continue to use Google Maps only where explicitly budgeted and gated.

## Current Audit

### Web

- `apps/web/app/launches/[id]/page.tsx`
  - builds a Google Maps satellite pad URL
  - builds a Static Maps preview URL when `GOOGLE_MAPS_STATIC_API_KEY` exists
  - renders the pad preview card
  - passes `GOOGLE_MAPS_WEB_API_KEY` into the FAA map client
- `apps/web/lib/utils/googleMaps.ts`
  - generates the `maps.googleapis.com/maps/api/staticmap` URL
  - keys the public preview path by `launchId`, not pad identity
- `apps/web/app/api/launches/[id]/pad-satellite/route.ts`
  - proxies Google Static Maps server-side
  - accepts arbitrary `latitude` and `longitude`
  - caches the returned image for only one hour
- `apps/web/components/LaunchFaaMapClient.tsx`
  - loads Google Maps JavaScript and renders FAA polygons on satellite imagery

### iOS native

- `apps/mobile/modules/tmz-launch-map/ios/TmzLaunchMapView.swift`
  - uses `MapKit`
- `apps/mobile/src/utils/mapLinks.ts`
  - already routes iOS pad links to `https://maps.apple.com`
- `apps/mobile/app/launches/[id].tsx`
  - already labels iOS pad actions as Apple Maps / native Apple preview

### Android native

- `apps/mobile/modules/tmz-launch-map/android/.../TmzLaunchMapModule.kt`
  - uses the native Google map module when `GOOGLE_MAPS_ANDROID_API_KEY` is configured
- `apps/mobile/src/utils/mapLinks.ts`
  - routes Android pad links to Google Maps
- Android does not currently use the web Static Maps pad-preview proxy

### Cross-surface leak that must be fixed

- `apps/web/lib/server/v1/mobileApi.ts`
  - currently generates a Google Maps URL for shared launch external links
  - that means iOS can still receive a Google Maps external map link from shared server payloads even though the native launch-detail surface already has Apple Maps-specific handling

### Live pad footprint snapshot

- Snapshot date:
  - `2026-04-10`
- Source:
  - current `launches_public_cache`
- Future launches in cache:
  - `365`
- Unique future pad keys:
  - `55`
- Next `30` days:
  - `21` launches
  - `16` unique pad keys
- Next `90` days:
  - `57` launches
  - `26` unique pad keys
- Next `180` days:
  - `75` launches
  - `29` unique pad keys
- Current larger sample:
  - `1000` cached launches
  - `87` unique pad keys across that sample

Implication:

- The pad universe is small enough that the main cost problem is not pad count.
- The main cost problem is the current launch-based cache key and weak cache lifetime.
- Even if every currently known future pad required one Google refresh inside a 30-day window, the result would still be far below the `1,000/month` operating target.

## Locked Decisions

- Use one-tenth of the current free monthly threshold as the operational budget target for Google map usage.
- Treat `10,000` free monthly billable events for Essentials SKUs as the planning baseline until Google changes the threshold again.
- Set the monthly budget target to `1,000` billable events per relevant Google SKU family.
- Set the daily budget target to `32` billable events per relevant Google SKU family.
  - `floor(10,000 / 31) = 322`
  - one-tenth daily ceiling becomes `32`
- For Static Maps, enforce both:
  - Google-side quota/alerts where supported
  - app/server-side budget gating before upstream fetches
- For Android native Google map usage, treat app-side gating as the primary guard.
  - Current Google documentation does not clearly guarantee editable hard map-load quotas for ordinary Maps SDK map loads.
- Safari web and iOS native must not use Google maps products.
- If the temporary cache allowance is treated as `30` consecutive calendar days, use that as the maximum stored preview lifetime.
- Do not permanently store or treat Google map imagery as a first-party indefinite asset.

## Cost-Control Policy

### Static Maps policy

- Target SKU family:
  - `Maps Static API`
  - `Static Maps`
- Hard monthly target:
  - `1,000`
- Hard daily target:
  - `32`
- Budget exhaustion behavior:
  - stop fetching Google Static Maps
  - render the non-Google fallback path instead
  - continue exposing a provider-appropriate external map link

### Android native Google map policy

- Target SKU family:
  - `Maps SDK for Android`
- Hard monthly target:
  - `1,000`
- Hard daily target:
  - `32`
- Budget exhaustion behavior:
  - disable native Google map preview/fullscreen entry points
  - keep the rest of launch detail functional
  - fall back to non-Google copy or external-link-only behavior

### Safari and iOS policy

- No Google Static Maps
- No Google Maps JavaScript
- No Google Maps external links generated by product UI we control
- Safari FAA Apple-backed web rendering is tracked separately in:
  - `docs/2026-04-10-safari-faa-apple-maps-web-plan.md`
- Use:
  - Apple Maps links for pad/location deep links
  - MapKit on iOS native
  - non-Google web fallback behavior on Safari until a separate Safari-safe map implementation is intentionally added

## Architecture Plan

### Phase 1: provider routing and leak closure

- Add a single server-owned provider policy helper for launch detail map surfaces.
- Web policy:
  - Safari user agents must not receive:
    - Google Static Maps preview URLs
    - Google Maps JavaScript FAA map props
    - Google Maps pad links
  - non-Safari browsers may continue to use Google maps behind the new budget and cache rules
- Mobile policy:
  - iOS continues to use Apple Maps and MapKit only
  - Android continues to use Google only where explicitly allowed
- Remove Google map URLs from shared mobile external-link payload shaping in `apps/web/lib/server/v1/mobileApi.ts`.
  - Shared payloads should either:
    - omit the provider-specific map link and let native build it locally, or
    - accept a platform hint and shape provider-specific links intentionally

### Phase 2: cache redesign for pad previews

- Replace the launch-based pad preview cache key with a canonical pad-based key.
- Preferred key order:
  1. stable pad identifier from launch data when available
  2. normalized latitude/longitude pair as fallback
- Remove arbitrary `latitude` / `longitude` overrides from the public preview route.
- Route behavior should become:
  - request known pad preview by canonical pad identity
  - serve cached preview if present and not expired
  - only call Google if cache is absent or expired and budget remains
- Persist the cached preview for up to `30` consecutive calendar days.
- Use a two-threshold cache policy so previews do not all expire on the same day:
  - `soft_refresh_at = fetched_at + deterministic 21-28 day window`
  - `hard_expire_at = fetched_at + 30 days`
- The soft refresh window must be deterministic per pad key so refreshes spread naturally across days instead of clustering on a single expiry boundary.
- On access, use this policy:
  - before `soft_refresh_at`:
    - serve cached preview
    - do not call Google
  - from `soft_refresh_at` until `hard_expire_at`:
    - serve cached preview
    - refresh only if budget remains
  - after `hard_expire_at`:
    - refresh only if budget remains
    - otherwise fail into the non-Google fallback path for that request
- Refresh must be lazy-on-access, not proactive for the full pad inventory.
- Store cache metadata:
  - `pad_key`
  - `provider`
  - `created_at`
  - `soft_refresh_at`
  - `expires_at`
  - `etag` or content hash if available
  - byte size
- Keep browser/CDN cache headers aligned to the same bounded lifetime where appropriate.

### Phase 3: budget gates and quota alignment

- Static Maps server gate:
  - before any upstream Google fetch, check:
    - current day count
    - current month count
  - if either limit is reached, fail closed into fallback UI
- Android gate:
  - expose a shared map-policy decision to native so Android can avoid instantiating Google maps after the budget is exhausted
  - this can be:
    - additive launch-detail payload metadata, or
    - a small shared `/api/v1` config endpoint
- Google Cloud console setup:
  - set `Maps Static API` daily quota to `32`
  - add alerts at `50%`, `80%`, and `100%`
  - add billing budget alerts even though budgets do not cap spend

Capacity note:

- With the current live future-pad footprint of `55` unique pads and a `21-28` day soft refresh window, the expected average refresh pressure is materially below the `32/day` ceiling.
- Near-term operational demand is even lower:
  - next `30` days only require `16` unique pad previews
  - next `90` days only require `26` unique pad previews
- If an unusually large number of pad previews cross `hard_expire_at` on a single day, the excess previews should not trigger Google calls that day. They should fall back and refresh later on the next user access when budget is available.

### Phase 4: Safari-safe and iOS-safe UX

- Web Safari:
  - pad section:
    - do not render Google static preview
    - do not label CTAs as Google Maps
    - use Apple Maps external link for pad coordinates
  - FAA section:
    - do not load Google Maps JavaScript
    - render advisory summary and launch-zone metadata without Google embed
    - optionally keep a provider-neutral fullscreen follow-up as a separate project, not in this cost-control slice
- iOS native:
  - keep existing MapKit rendering
  - ensure all map links remain Apple Maps
  - remove any Google URL that leaks in through shared external-links payloads

### Phase 5: monitoring and abuse resistance

- Stop exposing an open Static Maps proxy.
- Restrict API keys:
  - web key: exact allowed domains only
  - Android key: exact package + SHA only
  - static key: server-side only
- Add server logging around:
  - cache hit
  - cache miss
  - upstream Google fetch
  - budget-denied fallback
  - invalid pad-key request
- Add a small daily ops report or dashboard card for:
  - static preview cache hit rate
  - unique pad keys served
  - upstream Google fetch count
  - budget consumption percentage

## Implementation Order

1. Add this plan and lock the provider-routing rules.
2. Audit and remove Google map leakage from shared mobile external links.
3. Add provider policy resolution for Safari vs non-Safari web.
4. Replace launch-based pad preview URLs with canonical pad-based keys.
5. Remove arbitrary coordinate overrides from the public pad preview route.
6. Add persistent `30`-day preview cache and metadata.
7. Add Static Maps daily/monthly server-side budget checks.
8. Add Android map-policy gating for native Google usage.
9. Apply Google Cloud quotas and alerts.
10. Verify Safari/iOS no longer use Google paths we control.

## Rollback Notes

- Safari suppression can be rolled back independently of cache redesign.
- Shared mobile external-link cleanup can be rolled back without affecting native MapKit/Google view modules.
- The pad preview cache can be disabled while keeping the pad-preview feature alive.
- Budget-deny behavior should fail into existing non-map or external-link fallback UI rather than breaking launch detail.

## Verification Set

- Toolchain must be back on the pinned repo versions before implementation verification:
  - `node -v && npm -v`
  - `npm run doctor`
- Required checks after implementation:
  - `npm run check:three-platform:boundaries`
  - `npm run test:v1-contracts`
  - `npm run test:mobile-query-guard`
  - `npm run type-check:ci`
  - `npm run type-check:mobile`
  - `npm run lint`
  - `npm run lint --workspace @tminuszero/mobile`
- Product verification:
  - Web Safari:
    - no Google Static Maps requests
    - no Google Maps JavaScript load for FAA
    - Apple Maps external links only
  - Web non-Safari:
    - pad preview uses pad-based cache
    - repeated launches on the same pad do not trigger fresh Google requests inside the cache window
  - iOS:
    - MapKit renders correctly
    - no Google map link leaks in launch external links
  - Android:
    - Google map preview remains available when policy allows
    - budget exhaustion path disables Google preview gracefully
  - Static Maps:
    - cache hit rate is high on reused pads
    - upstream Google fetch count stays below the `32/day` ceiling

## Known Blocker In Current Shell

- Current shell reports:
  - Node `24.14.1`
  - npm `11.11.0`
- Final verification must wait until the shell matches the repo pins required by the project instructions.
