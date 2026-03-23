# AR Trajectory Live Zoom Phase 0 + iOS Risk Deep Dive

Date: 2026-03-18
Parent plan: `docs/ar-trajectory-live-zoom-three-platform-plan-2026-03-17.md`

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes (telemetry + rollout evidence)
- Shared API/backend impact: yes (additive telemetry fields)
- Customer-facing: yes

## What “Super Smooth” Means (Phase 0 Acceptance)

Phase 0 is a go/no-go spike, so we set hard gates before implementation.

- Zoom input -> camera zoom application: p95 <= 45 ms
- Zoom application -> overlay reprojection sync: p95 <= 16.7 ms (1 frame at 60 fps)
- Total input -> visually correct overlay: p95 <= 67 ms
- No persistent choppiness during continuous pinch:
  - `dropped_frame_bucket` high-drop share increase <= +3 percentage points vs baseline
  - no repeated visible jumps while zooming in a single direction

## Phase 0 Objectives

1. Prove true camera zoom can be driven per platform (not simulated-only FOV).
2. Prove trajectory projection can track live zoom without lag.
3. Prove tracking quality stays stable while zoom changes.
4. Produce a decision package: GO / PARTIAL GO / NO GO per platform.

## Phase 0 Deliverables

- Device capability matrix for zoom support and quality.
- Instrumented spike builds for web, iOS, android.
- One markdown evidence report with measurements and recommendations.
- Feature-flag strategy and fallback behavior per platform profile.

## Workstreams

### WS0 — Shared instrumentation baseline (required first)

Add temporary/dev-only instrumentation fields and local capture:
- `zoom_supported`
- `zoom_ratio`
- `zoom_control_path`
- `zoom_input_to_apply_ms`
- `zoom_apply_to_projection_sync_ms`
- `projection_source`
- `tracking_state_during_zoom`

Output artifacts:
- `.artifacts/ar-live-zoom-phase0/<platform>-sessions.json`
- `.artifacts/ar-live-zoom-phase0/summary.md`

### WS1 — Web spike

Goal:
- Validate browser-level zoom control path and lag characteristics.

Scope:
- Use `MediaStreamTrack` capability probe for zoom.
- Apply zoom via constraints when supported.
- Bind projection updates to effective zoom/settings.
- Keep fallback to existing FOV preset path when unsupported.

Pass criteria:
- At least one major browser profile meets smoothness gates.
- Unsupported browsers fail gracefully with no regression.

### WS2 — iOS spike (deep risk focus)

Goal:
- Validate whether ARKit runtime can sustain smooth true camera zoom with stable trajectory alignment.

Initial integration points:
- `apps/mobile/modules/tmz-ar-trajectory/ios/TmzArTrajectoryModule.swift`
- `apps/mobile/modules/tmz-ar-trajectory/ios/TmzArTrajectoryView.swift`
- `apps/mobile/modules/tmz-ar-trajectory/src/TmzArTrajectory.types.ts`
- `apps/mobile/app/launches/ar/[id].tsx`

iOS APIs to validate in practice:
- `ARConfiguration.configurableCaptureDeviceForPrimaryCamera`
- `ARCamera.intrinsics` + `imageResolution` per frame
- `AVCaptureDevice.videoZoomFactor` / `rampToVideoZoomFactor`
- `AVCaptureDevice.virtualDeviceSwitchOverVideoZoomFactors`

#### iOS risk register

1. `configurableCaptureDeviceForPrimaryCamera` may be `nil` on some devices/session states.
- Impact: cannot drive true camera zoom in active AR session.
- Mitigation: capability gate by device/profile; fallback to non-zoom AR.

2. Zoom updates may trigger tracking degradation or reconfiguration spikes.
- Impact: jitter, relocalization, visible overlay jumps.
- Mitigation: use ramped zoom, clamp update cadence, avoid abrupt boundary crossings, pause zoom while tracking is limited.

3. Lens switch boundaries (0.5x/1x/2x) may cause discontinuities.
- Impact: sudden FOV/intrinsics jump and perceived stutter.
- Mitigation: detect switch-over factors and animate through transitions; recompute projection directly from new intrinsics on the same frame.

4. Depth/occlusion quality may regress at certain zoom factors.
- Impact: poor visual quality and confidence loss.
- Mitigation: collect occlusion mode + depth stability metrics per zoom band; degrade gracefully.

5. Thermal/perf risk during sustained pinch and AR rendering.
- Impact: fps collapse after short sustained usage.
- Mitigation: 3-5 minute sustained run tests; enforce upper zoom limits per profile if required.

#### iOS experiment matrix (Phase 0)

Required devices:
- iPhone Pro-class (triple camera)
- iPhone non-Pro dual camera
- iPhone single-camera class (or minimal-lens profile still supported)

Scenarios (per device):
1. Continuous pinch from min -> max -> min for 20 seconds.
2. Discrete chips `0.5x/1x/2x/3x` with hold at each level.
3. Rapid oscillation around lens switch-over points.
4. Sustained 3-minute session with intermittent zoom changes.

Captured metrics:
- zoom request latency
- first-frame intrinsics change latency
- projection sync latency
- tracking state transitions and relocalization count
- dropped frame buckets and thermal notes

#### iOS pass/fail gates

GO (full):
- Smoothness gates pass on Pro + non-Pro devices.
- Tracking degradation negligible (no material increase in relocalization/limited state during zoom).

PARTIAL GO:
- Works smoothly only in constrained zoom band (for example, avoid lens switch boundaries).
- Ship profile-based clamped zoom ranges.

NO GO:
- Capture device control unavailable or unstable across target profiles.
- Tracking instability materially exceeds baseline during routine zoom.

Fallback if NO GO:
- Keep iOS AR at fixed camera zoom for production.
- Continue web + android true zoom rollout independently.
- Revisit iOS with alternate runtime architecture in a separate initiative.

### WS3 — Android spike

Goal:
- Validate ARCore + Camera2 zoom path and per-frame intrinsics sync.

Scope:
- Stand up Android native module path in `tmz-ar-trajectory`.
- Test zoom control path and projection sync from ARCore intrinsics.
- Capture same smoothness metrics as iOS.

Pass criteria:
- At least one Pixel-class and one Samsung-class device pass smoothness gates.

## Decision Output (End of Phase 0)

Produce one decision memo with:
- Platform result: GO / PARTIAL GO / NO GO
- Required constraints per platform profile
- Recommended rollout order and flags
- Explicit “ship/no-ship” recommendation for iOS true zoom

## Suggested Phase 0 Timeline

- Day 1: WS0 instrumentation + baselines
- Day 2: WS1 web spike
- Day 3-4: WS2 iOS deep spike + evidence
- Day 4-5: WS3 android spike + final decision memo

## Verification (Pinned Toolchain)

- `node -v && npm -v`
- `npm run doctor`
- `npm ci`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts` (if telemetry contract changes)
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`
- `npm run test:smoke` (AR trajectory logic touched)

## Primary References

- W3C Media Capture Image (`zoom` constrainable property): https://w3c.github.io/mediacapture-image/#zoom
- ARCore Camera intrinsics update behavior: https://developers.google.com/ar/reference/java/com/google/ar/core/CameraIntrinsics
- ARCore camera sharing (Camera2 + ARCore): https://developers.google.com/ar/develop/java/camera-sharing
- Local iOS SDK headers:
  - `/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS26.2.sdk/System/Library/Frameworks/ARKit.framework/Headers/ARConfiguration.h`
  - `/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS26.2.sdk/System/Library/Frameworks/ARKit.framework/Headers/ARCamera.h`
  - `/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS26.2.sdk/System/Library/Frameworks/ARKit.framework/Headers/ARVideoFormat.h`
  - `/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS26.2.sdk/System/Library/Frameworks/AVFoundation.framework/Headers/AVCaptureDevice.h`
