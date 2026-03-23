# AR Trajectory Live Zoom Three-Platform Plan

Date: 2026-03-17

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes (telemetry + rollout dashboards)
- Shared API/backend impact: yes (additive telemetry contract/schema)
- Customer-facing: yes

Notes:
- This request explicitly includes all three customer surfaces.
- Runtime implementation remains platform-specific (no shared UI runtime), while trajectory math/contracts stay shared.

## Feasibility Verdict

Short answer: yes, with platform-specific implementation paths and one hard risk to validate first on iOS.

- Web: feasible where camera zoom is exposed as a constrainable property; graceful fallback required where unsupported.
- iOS native: likely feasible if `ARConfiguration.configurableCaptureDeviceForPrimaryCamera` is available at runtime for world tracking sessions; must be validated on physical devices.
- Android native: feasible via ARCore + Camera2 shared-camera zoom control, with per-frame intrinsics updates.

## Current Baseline (What Exists Today)

- Web AR currently runs camera preview + overlay and uses FOV state (`apps/web/components/ar/ArSession.tsx`).
- Web has lens presets/sliders that modify FOV state, not guaranteed hardware zoom (`apps/web/components/ar/ArSession.tsx`).
- iOS native AR module exists and is iPhone-only for world-tracked runtime (`apps/mobile/modules/tmz-ar-trajectory/ios/*`).
- Android native module path is enabled in Expo config and route (`apps/mobile/modules/tmz-ar-trajectory/expo-module.config.json`, `apps/mobile/app/launches/ar/[id].tsx`) and now includes ARCore shared-camera world-tracking when available, with camera-guidance fallback.

## Target User Experience

1. In AR, users can use familiar zoom options (`0.5x/1x/2x/3x`) and pinch.
2. As zoom changes, trajectory overlays reproject live with no visible lag.
3. Overlay precision remains consistent with zoom level (no scale drift/jump).
4. Unsupported zoom devices fail closed with clear UI and keep today’s guidance quality.

## Architecture Direction

### Shared cross-platform rules

- Keep ECEF/ENU/az-el trajectory math in shared domain/contracts.
- Move projection inputs to a per-frame `CameraProjectionState` model:
  - `timestampMs`
  - `fx/fy/cx/cy` (when available)
  - `imageWidth/imageHeight`
  - `derivedHfov/Vfov`
  - `zoomRatio`
  - `projectionSource`
- Reprojection must use the latest projection state in-frame (not React state churn).

### Web

- Add zoom capability probe on active video track.
- If `zoom` is supported, apply zoom via track constraints and read back settings.
- Derive FOV from live camera settings when available; otherwise derive from intrinsics/projection where available; otherwise fallback to existing FOV model.
- Keep current fallback path for browsers without zoom constraints.

### iOS

- In native module, probe `ARConfiguration.configurableCaptureDeviceForPrimaryCamera`.
- If available, set camera zoom (`videoZoomFactor` / ramp) and read effective values.
- On every AR frame, compute projection from `ARFrame.camera.intrinsics` + `imageResolution`.
- Keep overlay rendering native so zoom/projection updates stay on the render thread.
- If configurable primary camera is unavailable on a device, expose non-zoom fallback and keep AR functional.

### Android

- Add Android implementation for `tmz-ar-trajectory` module (ARCore runtime).
- Use ARCore Shared Camera with Camera2 zoom controls (`CONTROL_ZOOM_RATIO` / crop region path depending on device level).
- On each frame, read ARCore camera intrinsics and update projection state before overlay draw.
- Keep JS bridge updates low-frequency for UI/telemetry; keep render math native per frame.

## Shared API / Backend Changes (Additive Only)

No breaking `/api/v1` behavior.

- Extend telemetry contract (`packages/contracts/src/index.ts`) with optional fields:
  - `zoomSupported`
  - `zoomRatioBucket`
  - `zoomControlPath` (`native_camera`, `track_constraints`, `preset_fallback`, `unsupported`)
  - `zoomApplyLatencyBucket`
  - `projectionSource` (`intrinsics_frame`, `projection_matrix`, `inferred_fov`, `preset`)
- Update telemetry ingestion route and DB table with additive nullable columns.
- Add dashboard slices by platform/profile for zoom adoption + precision drift.

## Phased Rollout

### Phase 0 — Feasibility spikes (required gate)

Deliverables:
- Web: capability matrix for zoom constraints by target browsers.
- iOS: proof that zoom can be applied in-session on target iPhones without breaking tracking.
- Android: proof-of-concept ARCore + Camera2 zoom with stable tracking.

Exit gate:
- At least one production-class device per platform demonstrates live zoom with <1-frame visible desync.

### Phase 1 — Shared projection + telemetry foundation

Deliverables:
- Shared projection state type/helpers.
- Additive contract + migration + ingestion changes.
- Feature flags: `ar_live_zoom_web`, `ar_live_zoom_ios`, `ar_live_zoom_android`.

Exit gate:
- Existing AR behavior unchanged when flags are off.

### Phase 2 — Web implementation

Deliverables:
- Zoom controls + pinch where supported.
- Live projection update path bound to effective zoom.
- Fallback UX for unsupported zoom.

Exit gate:
- No regression in current web AR lock-on/fallback flows.

### Phase 3 — iOS implementation

Deliverables:
- Native zoom control integration in iOS module.
- Per-frame intrinsics projection updates.
- UI parity for zoom controls and capability messaging.

Exit gate:
- Tracking stability and relocalization rates remain within baseline tolerance.

### Phase 4 — Android implementation

Deliverables:
- Android native module + route enablement.
- Camera2 zoom + ARCore intrinsics projection loop.
- Android-specific fallback/capability messaging.

Exit gate:
- Android reaches parity with iOS/web on zoom UX and precision targets.

### Phase 5 — Controlled rollout and hardening

Deliverables:
- Staged rollout by platform + device profiles.
- Field validation checklist updates and telemetry threshold checks.
- Closeout docs and rollback playbook.

## Implementation Status (2026-03-18 Follow-Up)

Completed in repo:
- Web + iOS + Android route now share additive zoom telemetry fields and capability plumbing.
- Android native module now includes an ARCore shared-camera runtime path plus camera-guidance fallback, with native zoom controls and telemetry parity fields (`cameraPermission`, `motionPermission`, `locationPermission`, `headingSource`, `poseSource`, `poseMode`, `visionBackend`).
- Android route permission UX now recovers from denied camera state and includes location-permission parity prompts for launch-site alignment quality.
- Android capability semantics now report whether ARCore world tracking is actually available on-device, otherwise fail over to truthful camera-guidance semantics.

Still open before calling full parity:
- Phase 4 ARCore core gate remains open:
  - Physical-device validation that ARCore shared-camera startup/resume is stable across Pixel + Samsung profiles.
  - Field evidence for per-frame intrinsics projection synchronization quality and zoom latency thresholds.
  - Telemetry-backed proof that fallback rates and tracking stability meet rollout thresholds.
  - Latest local lock-on field report run (`.artifacts/ar-lock-on-field-report-native-followup.md`) shows zero attempted sessions in the window, so rollout gates cannot be evaluated yet.

## Precision and Performance Acceptance Targets

- Zoom-change visual latency: p95 <= 50 ms.
- Overlay angular drift during zoom transitions: p95 <= 0.5 deg.
- Frame-drop regression vs baseline: <= +5 percentage points in high-drop buckets.
- No increase in permission dead-end rate.

## Rollout Order

1. Web (lowest app-store release friction).
2. iOS (existing native runtime already shipped).
3. Android (new native runtime slice).

## Rollback Notes

- Kill-switch each platform independently via feature flags.
- Keep telemetry/schema additive and backward-compatible.
- If native zoom destabilizes tracking on a profile, fall back to non-zoom AR on that profile without disabling AR entirely.

## Verification Set (Pinned Toolchain)

Run under Node `20.19.6` / npm `10.8.2`:

- `node -v && npm -v`
- `npm run doctor`
- `npm ci`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard` (if shared/mobile query behavior is touched)
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`
- `npm run test:smoke` (required when touching AR trajectory logic)

## Key Risks / Open Decisions

1. iOS runtime support variability: confirm which iPhone classes return configurable primary capture devices for AR zoom.
2. Android device fragmentation: zoom control path differs across camera HAL levels; require capability fallback logic.
3. “Default camera zoom options” definition: align on exact UX (`0.5x/1x/2x/3x` chips + pinch) versus pure OS-native controls.
4. Precision definition for sign-off: lock final metric (angular drift threshold and test harness) before Phase 2.

## Primary Technical References

- W3C Media Capture Image spec (`zoom` constrainable property): https://w3c.github.io/mediacapture-image/#zoom
- ARCore Camera intrinsics (updated every `Session.update()`): https://developers.google.com/ar/reference/java/com/google/ar/core/CameraIntrinsics
- ARCore shared camera setup (Camera2 + ARCore): https://developers.google.com/ar/develop/java/camera-sharing
- Local iOS SDK headers:
  - `/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS26.2.sdk/System/Library/Frameworks/ARKit.framework/Headers/ARCamera.h`
  - `/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS26.2.sdk/System/Library/Frameworks/ARKit.framework/Headers/ARConfiguration.h`
  - `/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS26.2.sdk/System/Library/Frameworks/ARKit.framework/Headers/ARVideoFormat.h`
  - `/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS26.2.sdk/System/Library/Frameworks/AVFoundation.framework/Headers/AVCaptureDevice.h`
