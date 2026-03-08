# AR Trajectory — QA Matrix (Android-first, iOS-supported)

Generated: 2026-02-07  
Updated: 2026-02-09
Scope: Web AR overlay + trajectory products.  
Goal: Ensure Android/Google experience is **at least as good as iOS**, and ideally better when WebXR is available.

## Support policy (what “works” means)

### Best experience (target)
- **Android Chrome** on ARCore-capable devices with **WebXR immersive-ar** supported.

### Supported fallback
- iOS Safari and Android browsers without WebXR:
  - camera preview + device sensors (`deviceorientation/devicemotion`) + calibration
  - honest uncertainty corridor
  - SkyCompass fallback when permissions/sensors are blocked

## Device / Browser coverage (minimum set)

### Android (must-pass)
- Pixel-class device (Android 14/15)
  - Chrome stable
  - Chrome beta (optional)
- Samsung Galaxy S-class (Android 14/15)
  - Chrome stable
  - Samsung Internet (optional but recommended)
- Mid-tier Android (A-series class)
  - Chrome stable (performance + thermal)

### iOS (must-pass)
- iPhone Pro-class (iOS 17/18): Safari
- Older iPhone (iOS 16/17): Safari

### Desktop (sanity-only)
- Chrome / Safari: ensure page renders and SkyCompass works (AR will be limited).

## Test matrix (run per device/browser)

Use a single “eligible” launch with known pad coords and a trajectory product present. Repeat with:
- **Tier 0** (pad-only)
- **Tier 1** (landing-constrained)
- **Tier 2** (estimate corridor)

### A) Permissions & fallback (no dead ends)
- Camera allow/deny
- Location allow/deny
- Motion allow/deny (iOS prompt path)
- Retry flow: “Retry sensors” works without reload
- Verify SkyCompass renders when any required input is missing

**Pass criteria**
- UI always provides a usable view (AR overlay or SkyCompass) and clear next action.

### B) Pose stability & calibration
- Run calibration while holding still (expected stable yaw offset).
- Move near metal/interference (expected: heading becomes “poor”, corridor wide, user messaging).
- Rotate screen portrait ↔ landscape:
  - pitch mapping remains correct (no 90° pitch error)
- Reset calibration and confirm defaults restored.

**Pass criteria**
- No wild jumps; calibration persists; pitch “Set horizon” behaves intuitively.

### C) WebXR (Android) — start/stop/recover
- If WebXR supported:
  - Start WebXR AR
  - Exit WebXR AR
  - Confirm camera resumes
  - Confirm overlays remain aligned (within expected uncertainty) after re-entry

**Pass criteria**
- WebXR session lifecycle is robust; no “stuck black screen”; no silent failures.

### D) Trajectory rendering correctness (product sanity)
- Tier-1 product:
  - altitude should not return to ground within the product horizon
  - duration should not truncate milestone chips unexpectedly
- Tier-2 product:
  - sigma corridor widens as time increases (if designed)
  - azimuth direction consistent with constraints (hazards/orbit)
- Evidence label contract:
  - `constraint_doc_plus_landing` renders as `Constraint-backed (doc + landing)`
  - `template_estimate` renders as `Template estimate`
  - pad-only renders as `Pad-only`
  - when `lineage_complete=false`, badge copy must not say `High confidence`

**Pass criteria**
- No physically implausible paths; labels/events are coherent.

### E) Performance & thermal
- Time to first camera frame (post-permissions): target p50 < 2s, p95 < 5s
- Sustained runtime: 3–5 minutes
  - FPS subjective + no severe UI stutter
  - Device does not rapidly overheat on mid-tier Android

**Pass criteria**
- Overlay remains responsive; no runaway CPU/GPU usage.

### F) Network & caching
- Cold load on cellular
- Repeat load (should use cached product/server caching)
- Brief offline (product already loaded):
  - AR should still function using cached trajectory

**Pass criteria**
- No hard dependency on continuous network after initial load.

### G) Offline replay benchmark (accuracy trend)
- Run deterministic replay benchmark:
  - `npm run trajectory:replay-bench`
- Optional report output for build artifacts:
  - `npm run trajectory:replay-bench -- --output=.artifacts/ar-trajectory-replay-bench.json`
- Run replay gate thresholds (strict default):
  - `npm run trajectory:replay-gate -- --report=.artifacts/ar-trajectory-replay-bench.json`
  - optional non-blocking local diagnostics: `npm run trajectory:replay-gate -- --report=.artifacts/ar-trajectory-replay-bench.json --warn-only`
- Review:
  - global `p50/p90/p95` angular error
  - `driftDeg` (end-window minus start-window mean error)
  - per-case `slopeDegPerMin`

**Pass criteria**
- Benchmark runs with non-zero sample count.
- Metrics are stable on repeated runs with the same fixture seed.
- Regressions are investigated when `p95` or drift worsens materially versus baseline artifact.
- Gate defaults:
  - evaluated cases `>= 6`
  - sample count `>= 60`
  - overall `p95 <= 3.5 deg`
  - overall `|drift| <= 2.0 deg`
  - overall `|slope| <= 1.8 deg/min`
  - per-case `p95 <= 4.25 deg`
  - per-case `|drift| <= 3.4 deg`

### H) Lock-on manual Android field validation
- Execute checklist: `docs/ar-lock-on-android-field-validation-checklist-2026-02-09.md`
- Capture one telemetry `sessionId` per required device/browser run.
- Validate thresholds using:
  - `docs/ar-lock-on-frame-budget-runbook-2026-02-09.md`

## Telemetry checks (to prove Android parity)

Use `public.ar_camera_guide_sessions` to compare:
- `client_env` buckets (`android_chrome` vs `ios_safari`)
- `client_profile` buckets (`android_chrome`, `android_samsung_internet`, `ios_webkit`, `android_fallback`)
- `mode_entered` (`ar` vs `sky_compass`) and `fallback_reason`
- `pose_source` and WebXR adoption (`xr_supported`, `xr_used`, `xr_error_bucket`)
- `lock_on_mode` (`auto` should dominate production runs; `manual_debug` should only appear in debug sessions)
- `heading_status` distribution
- `retry_count` distribution
- `trajectory_quality`, `avg_sigma_deg`

**Pass criteria**
- Android Chrome should show higher `mode_entered='ar'` rate and fewer `no_heading` fallbacks (especially when WebXR is used).

## Release gate (must-pass)

- Before production release, collect manual pass evidence for:
  - `android_chrome` (must-pass, WebXR preferred when supported)
  - `android_samsung_internet` (must-pass, fallback readiness required)
  - `ios_webkit` (must-pass, fallback-first path)
  - `android_fallback` (must-pass, non-WebXR fallback path)
- Block release if any profile above has unresolved P0 regressions in permissions, fallback transitions, or telemetry session integrity.

## Launch-day rehearsal checklist (recommended)

- Pick one upcoming eligible launch and do a 15-minute rehearsal:
  - 2 Android devices, 1 iPhone
  - Run through A–F once each
  - Capture telemetry session IDs and any screenshots

## Bug report template (copy/paste)

- Launch ID:
- Device:
- OS version:
- Browser + version:
- Mode attempted: `webxr` / `deviceorientation` / `sky_compass`
- Permissions: camera/location/motion (granted/denied)
- Steps to reproduce:
- Expected vs actual:
- Screenshots/screen recording:
- Telemetry sessionId (if available):
- Notes (heading stability, interference, network):
