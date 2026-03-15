# iOS AR Trajectory Implementation Plan

Date: 2026-03-15

## Platform Matrix

- Web: included for shared API/BFF support only. No user-facing web AR changes.
- iOS: included.
- Android: not included because the requested native AR runtime is iOS-specific.
- Admin/internal impact: yes, additive telemetry and rollout visibility.
- Shared API/backend impact: yes.
- Customer-facing: yes.

## Scope Implemented

- Added additive launch-detail AR summary data to the shared `/api/v1` mobile payload.
- Added premium-authenticated `/api/v1/launches/:id/trajectory` and `/api/v1/ar/telemetry/session`.
- Added additive Supabase migration fields for iOS-native AR telemetry.
- Added a premium-gated AR entry card on mobile launch detail.
- Added a dedicated native AR route at `/launches/ar/[id]`.

Route note:
- The original `/launches/[id]/ar` shape would require renaming the existing Expo Router file `apps/mobile/app/launches/[id].tsx` into a folder-based route, which is a higher-risk route refactor in a dirty tree.
- The additive `/launches/ar/[id]` path was chosen to avoid that blast radius while preserving direct deep-link entry.

## Native Runtime Baseline

- Local Expo module under `apps/mobile/modules/tmz-ar-trajectory`.
- ARKit + RealityKit baseline world-tracking session.
- Dynamic orientation lock through the local module and app delegate override.
- Capability introspection for AR support, depth, reconstruction, geo-tracking support, and high-res capture availability.
- Native session status/error events bridged to React Native.
- Baseline trajectory rendering scaffold driven by serialized trajectory JSON.

## Safety And Rollout

- Premium gating remains enforced both on launch detail entry and on the dedicated AR route.
- Unsupported devices fail closed before the native view is mounted.
- AR launch eligibility still comes from the shared server-side eligibility logic.
- Native telemetry is additive and versioned through the existing `/api/v1` contract layer.
- Rollback path is straightforward: disable the launch-detail CTA and AR route usage while leaving additive schema/API changes in place.

## Verification Set

- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

Current local constraint:
- The active shell is not yet on the pinned Node `20.19.6` and npm `10.8.2`, so final verification must be run under the pinned toolchain before release.
