# 2026-04-10 Safari FAA Apple Maps Web Plan

## Scope

- Customer-facing: yes
- Web: included
- iOS: not included for implementation changes
- Android: not included
- Admin/internal impact: no
- Shared API/backend impact: yes

## Goal

Replace the current Safari web FAA advisory-only fallback with a real Apple-backed interactive launch-zone map on launch detail surfaces, while keeping the existing non-Safari Google renderer and the existing iOS native MapKit path unchanged.

This slice is intentionally narrow:

- Safari web launch detail should render FAA polygons on an Apple map.
- iOS native remains the source of truth for Apple MapKit on native.
- Android remains unchanged.
- Non-Safari web browsers remain on the current Google FAA map path.

## Why This Follow-Up Exists

The 2026-04-10 maps cost-control slice deliberately removed Google Maps from Safari web and iOS-native-controlled surfaces. That solved the provider-boundary and spend-control problem, but it left Safari web on a degraded FAA experience:

- Safari pad/location links already route to Apple Maps.
- iOS native launch maps already use MapKit.
- Safari web FAA sections still fall back to advisory text because there is no Apple web polygon renderer in place.

The next safe step is to add an Apple-backed FAA renderer for Safari web only, without reopening Google on Safari and without refactoring the working iOS native implementation.

## Current State

### Canonical launch detail page

- `apps/web/app/launches/[id]/page.tsx`
  - resolves `webMapPolicy`
  - disables Google FAA rendering on Safari
  - renders the current fallback copy when Safari has FAA geometry but no interactive renderer

### Tab-based launch detail view

- `apps/web/components/launch/tabs/LiveTab.tsx`
  - uses the same Google FAA client when Google is allowed
  - falls back to the same non-interactive message when Safari is blocked from Google

### Existing Google FAA renderer

- `apps/web/components/LaunchFaaMapClient.tsx`
  - is Google-specific
  - assumes a Google Maps JavaScript key and Google map primitives

### Provider policy

- `apps/web/lib/server/mapProviderPolicy.ts`
  - currently treats Safari as:
    - no Google Static Maps pad preview
    - no Google Maps JavaScript FAA renderer
    - Apple Maps pad links only
    - FAA advisory-only fallback copy

### Existing Apple coverage

- `apps/mobile/modules/tmz-launch-map/ios/TmzLaunchMapView.swift`
  - already uses native `MapKit`
- `apps/mobile/src/utils/mapLinks.ts`
  - already routes iOS external map links to Apple Maps

### Confirmed gap

- There is no `MapKit JS` token, signing helper, web client component, or Safari FAA overlay renderer in the repo today.

## Locked Safety Decisions

- Do not change the existing iOS native MapKit implementation in this slice.
- Do not change Android behavior in this slice.
- Do not reintroduce Google Maps JavaScript or Google map imagery on Safari web.
- Do not make breaking `/api/v1` changes.
- Keep the existing advisory-only fallback available when Apple web map configuration is missing, token generation fails, or Apple map rendering fails at runtime.
- Prefer additive components and helpers over rewriting the current Google FAA map client.
- Cover both web launch-detail surfaces in one slice:
  - canonical launch detail page
  - tab-based launch detail FAA section

## Preferred Architecture

### 1. Add an Apple web FAA renderer instead of rewriting the Google one

Preferred shape:

- keep `LaunchFaaMapClient.tsx` as the current Google renderer
- add a new Safari-only Apple renderer, for example:
  - `apps/web/components/LaunchFaaMapAppleClient.tsx`
- add a small server-side selection layer so launch detail can choose:
  - Google renderer for supported non-Safari browsers
  - Apple renderer for Safari when Apple config is present
  - current advisory-only fallback otherwise

This keeps the working Google path stable and avoids a risky provider-agnostic rewrite in the same slice.

### 2. Use server-owned Apple token signing

Preferred approach:

- sign a short-lived MapKit JS token on the server during page render
- pass the token only to the Safari Apple FAA component that needs it
- do not expose Apple private-key material to the client

Preferred over a general-purpose public token endpoint because it:

- minimizes public API surface
- avoids a new `/api/v1` contract
- keeps rollout simpler
- reduces the chance of token abuse or accidental cross-surface coupling

If runtime testing later proves a token refresh endpoint is required, that should be added as a small follow-up, not assumed up front.

### 3. Keep provider policy as the routing authority

`apps/web/lib/server/mapProviderPolicy.ts` should remain the single place that decides:

- whether Safari is on the Apple FAA renderer
- whether non-Safari stays on Google
- when the launch detail falls back to advisory-only copy

The policy should evolve from a simple boolean gate to an explicit FAA map mode, for example:

- `google`
- `apple`
- `fallback`

That makes the decision clearer and reduces conditional drift between the page and the tab surface.

### 4. Reuse the existing FAA map payload

Do not redesign the FAA geometry payload for this slice unless Apple rendering proves it is missing a required field.

The current server payload already supports the Google FAA map path and should remain the source of truth if it contains:

- polygon coordinates
- advisory counts
- pad anchor or fit context

If a renderer-specific adaptation is needed, do it in the web layer, not by breaking the existing FAA map payload.

## Required Prerequisites

### Apple portal and credentials

- create or confirm an Apple Maps web identifier suitable for the product domains
- create or confirm the associated private key used for signing MapKit JS tokens
- confirm ownership and storage of:
  - Apple team identifier
  - Apple key identifier
  - Maps identifier
  - private signing key

### Domain inventory

- confirm every Safari-served environment that should be allowed:
  - local development strategy
  - preview/staging hostnames
  - production hostnames

### Server configuration

- add server-only environment validation for the Apple web-map credentials
- ensure missing config fails safely into the current advisory fallback

## Implementation Phases

### Phase 0: prerequisite and policy lock

- write down the exact Apple credential and domain requirements
- decide whether this slice targets:
  - Safari only, or
  - all iOS/macOS Apple-browser surfaces that should avoid Google
- keep the initial blast radius narrow if browser classification remains uncertain
- confirm that the Safari FAA feature applies to:
  - canonical launch detail page
  - tab-based launch detail FAA section

Exit criteria:

- one agreed browser policy
- one agreed environment-variable naming scheme
- one agreed rollout surface list

### Phase 1: server signing helper and configuration

- add a server-only helper that signs a short-lived Apple web-map token
- keep the private key fully server-side
- add environment validation and a clear disabled-state path
- make the server helper easy to consume from both launch-detail web surfaces

Safety requirements:

- no client exposure of private key material
- no new shared-package dependency on web server code
- additive only

Exit criteria:

- Safari page render can obtain a valid Apple token when config is present
- missing or invalid config resolves to a known fallback state without throwing the page

### Phase 2: Safari Apple FAA renderer

- add a dedicated Apple web FAA component
- load the Apple web map library only when Safari Apple mode is selected
- convert the existing FAA geometry payload into Apple map overlays
- preserve practical behavior from the Google map block where possible:
  - fit-to-geometry
  - pad anchor visibility if applicable
  - polygon styling that clearly distinguishes launch-zone geometry
  - launch-detail context copy and action affordances

Safety requirements:

- do not change the existing Google FAA component during this phase except for minimal shared prop cleanup if unavoidable
- keep failure handling local to the component and fail into the existing text fallback

Exit criteria:

- Safari can render FAA polygons on an Apple-backed map in isolation
- renderer failure degrades cleanly to the advisory block

### Phase 3: web launch-detail integration

- integrate the Apple FAA path into:
  - `apps/web/app/launches/[id]/page.tsx`
  - `apps/web/components/launch/tabs/LiveTab.tsx`
- keep both surfaces driven by the same server-side provider policy
- keep non-Safari behavior unchanged
- keep Safari pad links on Apple Maps

Safety requirements:

- no duplicated provider-selection logic between the two surfaces
- no regression to non-Safari Google FAA rendering
- no regression to current Safari fallback when Apple is unavailable

Exit criteria:

- both web launch-detail surfaces behave consistently on Safari
- both surfaces keep their existing behavior on Chrome/other non-Safari browsers

### Phase 4: observability, fallback hardening, and rollout

- add targeted logging for:
  - Apple token generation failure
  - Safari Apple FAA render initialization failure
  - fallback activation rate
- add explicit user-facing copy for:
  - Apple map temporarily unavailable
  - FAA geometry unavailable
- roll out behind an environment gate or feature flag if needed

Exit criteria:

- Safari failures are diagnosable
- turning the feature off returns Safari to the current advisory-only fallback without further code changes

## Verification Set

### Required engineering checks

- `node -v && npm -v`
- `npm run doctor`
- `npm run type-check:ci`
- `npm run lint`
- `npm run check:three-platform:boundaries`

### Product verification

- Safari macOS:
  - canonical launch detail FAA section renders Apple-backed polygons
  - tab-based launch detail FAA section renders Apple-backed polygons
  - no Google Maps JavaScript is loaded for FAA on Safari
  - Safari pad links still open Apple Maps
- iPhone Safari:
  - FAA polygons render on the Apple web map path
  - interactions do not break page scroll or fullscreen presentation
- Non-Safari web:
  - existing Google FAA map still works
  - existing Google budget and cache policy remains intact
- iOS native:
  - existing MapKit launch maps still behave exactly as before
  - no web-plan regression leaks into native code
- Failure modes:
  - missing Apple config falls back to the current advisory-only state
  - invalid token falls back without crashing launch detail
  - geometry-absent launches still show the current non-map advisory state

## Rollback Plan

- Apple Safari FAA rendering must be independently disableable from the current Google FAA renderer.
- If the Apple web map path misbehaves, rollback should restore the present Safari advisory-only fallback without touching:
  - iOS native MapKit
  - Android
  - non-Safari Google FAA rendering
- Any server signing helper should be removable without schema or contract rollback work.

## Open Questions

- Should this slice stay Safari-only, or should all iOS/macOS Apple-browser surfaces that avoid Google use the Apple FAA path?
- Does the current FAA map payload already contain every field needed for Apple fit/bounds behavior, or does the web layer need a renderer-only adapter?
- Is fullscreen parity required for the Safari FAA Apple map in this slice, or is in-card launch-detail parity sufficient for the first rollout?
- Should rollout begin only on the canonical launch page, or should canonical plus tabbed launch detail ship together as the safe default?

## Recommended Default Answers

- Browser scope:
  - start with Safari web as the explicit target in this slice
  - evaluate broader Apple-browser expansion only after Safari verification is stable
- API strategy:
  - prefer server-render token injection over a new public token endpoint
- Launch-detail scope:
  - ship canonical page and tab-based launch detail together so Safari launch detail stays internally consistent
- Fallback:
  - keep the current advisory-only Safari fallback until Apple config and rendering are both proven healthy
